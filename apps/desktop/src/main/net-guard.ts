// Outbound requests that tools make on the user's behalf (product pages, Rentman, images). Only public internet
// addresses: never loopback, the local network or other special ranges, so a tool cannot be pointed at the LAN.
// The host is resolved once and the connection goes to exactly that address (no DNS rebinding between check and
// connect); every redirect hop is checked again; the body is counted while it streams.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

// IPv4 ranges that are not the public internet (RFC 6890 and friends).
const blockedV4 = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(address, prefix, "ipv4");
}

// IPv6: only global unicast (2000::/3), minus documentation, Teredo, 6to4 and other special ranges. Everything else,
// including IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96), site-local and unique-local, is refused.
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new net.BlockList();
specialV6.addSubnet("2001::", 23, "ipv6");
specialV6.addSubnet("2001:db8::", 32, "ipv6");
specialV6.addSubnet("2002::", 16, "ipv6");
specialV6.addSubnet("3fff::", 20, "ipv6");

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !blockedV4.check(ip, "ipv4");
  if (net.isIPv6(ip)) return globalV6.check(ip, "ipv6") && !specialV6.check(ip, "ipv6");
  return false;
}

export class NetGuardError extends Error {}

const notAllowed = () => new NetGuardError("That address is not allowed.");

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;
export type Lookup = (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => void;

/** dns.lookup that refuses non-public answers; the socket then connects to exactly the address that was checked. */
export function pinnedLookup(resolve: typeof dns.lookup = dns.lookup): Lookup {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
      if (err) return callback(err, []);
      const list = addresses as dns.LookupAddress[];
      if (!list.length || !list.every((a) => isPublicAddress(a.address))) return callback(notAllowed(), []);
      // Node asks for all addresses when it tries IPv4 and IPv6 in parallel (autoSelectFamily)
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function decode(res: http.IncomingMessage): Readable {
  switch ((res.headers["content-encoding"] ?? "").toLowerCase()) {
    case "gzip":
      return res.pipe(zlib.createGunzip());
    case "deflate":
      return res.pipe(zlib.createInflate());
    case "br":
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

interface Hop {
  status: number;
  headers: Record<string, string>;
  location: string | null;
  body: Buffer;
}

function requestOnce(url: URL, headers: Record<string, string>, opts: Required<ToolFetchOptions>, lookup: Lookup) {
  return new Promise<Hop>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    // Settles the promise once; destroying the request alone does not always surface an error once a response started
    const fail = (err: Error) => {
      reject(err);
      req.destroy();
    };
    const req = client.request(url, { method: "GET", headers, lookup, agent: false }, (res) => {
      const status = res.statusCode ?? 0;
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers))
        if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(", ") : v;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ status, headers: flat, location: res.headers.location, body: Buffer.alloc(0) });
        return;
      }
      const declared = Number(res.headers["content-length"]);
      if (!opts.truncate && declared > opts.maxBytes && !res.headers["content-encoding"]) {
        fail(new NetGuardError("The response is too large."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = decode(res);
      const finish = () => resolve({ status, headers: flat, location: null, body: Buffer.concat(chunks, size) });
      stream.on("data", (chunk: Buffer) => {
        const room = opts.maxBytes - size;
        if (chunk.length <= room) {
          chunks.push(chunk);
          size += chunk.length;
          return;
        }
        if (!opts.truncate) {
          stream.removeAllListeners("data");
          fail(new NetGuardError("The response is too large."));
          return;
        }
        chunks.push(chunk.subarray(0, room));
        size += room;
        stream.removeAllListeners("data");
        finish();
        req.destroy();
      });
      stream.on("end", finish);
      stream.on("error", fail);
      res.on("error", fail);
    });
    const timer = setTimeout(() => {
      const err = new NetGuardError("The site took too long to answer.");
      err.name = "TimeoutError";
      fail(err);
    }, opts.timeoutMs);
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

/** GET a public http(s) URL. `lookup` is only for tests. */
export async function fetchPublic(
  input: string,
  options: ToolFetchOptions = {},
  lookup: Lookup = pinnedLookup(),
): Promise<ToolFetchResult> {
  const opts: Required<ToolFetchOptions> = {
    headers: options.headers ?? {},
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    truncate: options.truncate ?? false,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new NetGuardError("That is not a valid link.");
  }
  let headers: Record<string, string> = { "accept-encoding": "gzip, deflate, br", ...opts.headers };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new NetGuardError("Only http(s) links are supported.");
    if (url.username || url.password) throw new NetGuardError("Links with a user name or password are not supported.");
    // IP literals skip the lookup, so they are checked here
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !isPublicAddress(host)) throw notAllowed();

    const res = await requestOnce(url, headers, opts, lookup);
    if (res.location) {
      const next = new URL(res.location, url);
      // Credentials are for the host they were meant for, never for wherever it redirects to
      if (next.origin !== url.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|cookie)$/i.test(k)));
      }
      url = next;
      continue;
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      url: url.href,
      headers: res.headers,
      body: res.body,
    };
  }
  throw new NetGuardError("Too many redirects.");
}
