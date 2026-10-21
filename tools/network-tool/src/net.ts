import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import https from "node:https";
import { networkInterfaces } from "node:os";
import type { Creds } from "./creds";

export const MIKROTIK_OUI = [
  "48:8f:5a",
  "08:55:31",
  "2c:c8:1b",
  "64:d1:54",
  "74:4d:28",
  "b8:69:f4",
  "cc:2d:e0",
  "dc:2c:6e",
  "e4:8d:8c",
  "18:fd:74",
  "c4:ad:34",
  "d4:01:c3",
  "f4:1e:57",
  "78:9a:18",
];
const SWOS_PAGES = ["sys", "link", "fwd", "vlan", "rstp", "snmp", "!dhost", "!igmp"];
const ROS_PATHS = [
  "system/identity",
  "system/resource",
  "system/routerboard",
  "snmp",
  "interface/bridge",
  "interface/bridge/port",
  "interface/bridge/vlan",
  "interface/bridge/mdb",
  "interface/bridge/host",
  "interface/ethernet",
  "interface/ethernet/switch",
  "interface/ethernet/switch/qos/port",
  "interface/ethernet/switch/qos/profile",
  "interface/ethernet/switch/qos/map/ip",
  "interface/ethernet/switch/qos/tx-manager/queue",
];
const UNIFI_PATHS = ["rest/networkconf", "stat/device", "rest/setting", "stat/sta"];
const isWin = process.platform === "win32";

export type Iface = { name: string; address: string; cidr: string; mac: string };
export type Switch =
  { ip: string; os: "swos"; pages: Record<string, any> } | { ip: string; os: "routeros"; ros: Record<string, any> };
export type Scan = {
  network: Iface & { gateway: string };
  unifi: Record<string, any[]> | null;
  unifiError?: string;
  switches: Switch[];
  switchErrors: { ip: string; msg: string }[];
};

// --- SwOS -------------------------------------------------------------------

/** SwOS pages are JS literals: bare keys, 0x ints, single-quoted hex strings. */
export function swosParse(text: string): any {
  if (!text.trim()) return null;
  return JSON.parse(
    text
      .replace(/([{,])([A-Za-z_][A-Za-z0-9_]*):/g, '$1"$2":')
      .replace(/'([^']*)'/g, '"$1"')
      .replace(/0x([0-9a-fA-F]+)/g, (_, h) => String(parseInt(h, 16))),
  );
}

export const hexstr = (s: string) => Buffer.from(s, "hex").toString("utf8");
export const bits = (mask: number, n: number) =>
  Array.from({ length: n }, (_, p) => p + 1).filter((p) => Math.floor(mask / 2 ** (p - 1)) % 2);
export const ipLE = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24].join(".");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

export async function swosGet(ip: string, page: string, user: string, pass: string): Promise<string> {
  const uri = `/${page}.b`;
  const url = `http://${ip}${uri}`;
  const first = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (first.ok) return first.text();
  await first.body?.cancel();
  const challenge = first.headers.get("www-authenticate") ?? "";
  const field = (k: string) => challenge.match(new RegExp(`${k}="([^"]*)"`))?.[1] ?? "";
  const [realm, nonce, qop] = [field("realm"), field("nonce"), field("qop")];
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`GET:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  let auth = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  const r = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(5000) });
  if (r.status === 401) throw new Error("switch refused the login");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// --- RouterOS ---------------------------------------------------------------

/** One RouterOS REST call (www service, plain HTTP). Values come back as strings. */
export async function rosCall(
  ip: string,
  user: string,
  pass: string,
  method: string,
  path: string,
  body?: object,
): Promise<any> {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
  const r = await fetch(`http://${ip}/rest/${path}`, {
    method,
    headers,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (r.status === 401) throw new Error("switch refused the login");
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Reads a RouterOS 7 switch. */
export async function rosGet(ip: string, user: string, pass: string) {
  const call = (path: string, body?: object) => rosCall(ip, user, pass, body ? "POST" : "GET", path, body);
  const ros: Record<string, any> = {};
  // one path at a time, like SwOS: these switches have one slow CPU
  for (const p of ROS_PATHS) ros[p] = await call(p);
  // `monitor` only reads, but REST runs commands as POST. Root bridge and link speed exist only here.
  ros["interface/bridge/monitor"] = await call("interface/bridge/monitor", {
    numbers: ros["interface/bridge"][0].name,
    once: "",
  });
  const running = ros["interface/ethernet"].filter((e: any) => e.running === "true").map((e: any) => e.name);
  const links = running.length
    ? await call("interface/ethernet/monitor", { numbers: running.join(","), once: "" })
    : [];
  for (const l of links) delete l.eeprom; // SFP module dumps: large and not used
  ros["interface/ethernet/monitor"] = links;
  return ros;
}

/** RouterOS answers an unauthenticated REST call with a Basic challenge and its own JSON error. */
export const isRouterOs = (status: number, auth: string, body: string) =>
  status === 401 && /^Basic/i.test(auth) && body.startsWith('{"error":401');

// --- UniFi ------------------------------------------------------------------

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

/** HTTPS to the UniFi gateway. Node's fetch cannot skip certificate checks per request. */
function unifiRequest(
  url: string,
  ms: number,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<Reply>((resolve, reject) => {
    // ponytail: self-signed UniFi cert, pin it if this ever leaves the LAN
    const req = https.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        rejectUnauthorized: false,
        signal: AbortSignal.timeout(ms),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

export async function unifiGet(host: string, user: string, pass: string) {
  const login = await unifiRequest(`https://${host}/api/auth/login`, 10_000, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (login.status === 401 || login.status === 403) throw new Error("UniFi refused the login");
  if (login.status < 200 || login.status > 299) throw new Error(`UniFi login HTTP ${login.status}`);
  const cookies = [login.headers["set-cookie"] ?? []].flat();
  const headers = {
    cookie: cookies.map((c) => c.split(";")[0]).join("; "),
    "x-csrf-token": [login.headers["x-csrf-token"] ?? ""].flat()[0],
  };
  const out: Record<string, any[]> = {};
  for (const p of UNIFI_PATHS) {
    const r = await unifiRequest(`https://${host}/proxy/network/api/s/default/${p}`, 15_000, { headers });
    if (r.status < 200 || r.status > 299) throw new Error(`UniFi ${p} HTTP ${r.status}`);
    out[p] = JSON.parse(r.body).data;
  }
  return out;
}

// --- Network detection ------------------------------------------------------

const toInt = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const toIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

function subnet(cidr: string) {
  const [ip, len] = cidr.split("/");
  const size = 2 ** (32 - Number(len));
  return { base: Math.floor(toInt(ip) / size) * size, size };
}

export const contains = (cidr: string, ip: string) => {
  const { base, size } = subnet(cidr);
  const n = toInt(ip);
  return n >= base && n < base + size;
};

export function hosts(cidr: string) {
  let { base, size } = subnet(cidr);
  // ponytail: sweep capped at the own /24 for subnets larger than /22
  if (size > 1024) {
    size = 256;
    base = Math.floor(toInt(cidr.split("/")[0]) / 256) * 256;
  }
  return Array.from({ length: size - 2 }, (_, i) => toIp(base + 1 + i));
}

export const firstHost = (cidr: string) => toIp(subnet(cidr).base + 1);

export const normMac = (mac: string) =>
  mac
    .toLowerCase()
    .split(/[:-]/)
    .map((b) => b.padStart(2, "0"))
    .join(":");

/** Parses `arp -an` (macOS) and `arp -a` (Windows) output. */
export function parseArp(out: string) {
  const table = new Map<string, string>();
  for (const [, ip, mac] of out.matchAll(
    /(\d+\.\d+\.\d+\.\d+)\)?\s+(?:at\s+)?([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/gi,
  ))
    table.set(ip, normMac(mac));
  return table;
}

/** Default gateway from `route print` on Windows (lowest metric wins). */
export function parseWinRoute(out: string) {
  const routes = [...out.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+\S+\s+(\d+)/gm)];
  return routes.sort((a, b) => Number(a[2]) - Number(b[2]))[0]?.[1];
}

/** Output of a system command; a failing command gives what it printed (often nothing). */
const sh = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { windowsHide: true, timeout: 10_000 }, (_err, stdout) => resolve(String(stdout ?? ""))),
  );

async function defaultGateway() {
  if (isWin) return parseWinRoute(await sh("route", ["print", "-4", "0.0.0.0"]));
  return (await sh("route", ["-n", "get", "default"])).match(/gateway:\s*([\d.]+)/)?.[1];
}

export function interfaces(): Iface[] {
  return Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? [])
      .filter((i) => i.family === "IPv4" && !i.internal && i.cidr)
      .map((i) => ({ name, address: i.address, cidr: i.cidr!, mac: i.mac })),
  );
}

export async function pickInterface(name?: string) {
  const all = interfaces();
  const gw = await defaultGateway();
  const iface =
    all.find((i) => i.name === name) ??
    all.find((i) => gw && contains(i.cidr, gw)) ??
    all.find((i) => !i.address.startsWith("169.254."));
  if (!iface) throw new Error("No network connection found. Connect the network cable and try again.");
  return { ...iface, gateway: gw && contains(iface.cidr, gw) ? gw : firstHost(iface.cidr) };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<unknown>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

function ping(ip: string) {
  const args = isWin ? ["-n", "1", "-w", "500", ip] : ["-c", "1", "-t", "1", ip];
  return new Promise<boolean>((resolve) =>
    execFile("ping", args, { windowsHide: true, timeout: 5000 }, (err) => resolve(!err)),
  );
}

/** SwOS puts the board model in its digest realm, e.g. "CSS328-24P-4S+". */
export const SWOS_REALM = /realm="(CSS|CRS|RB\d|netPower|netFiber)/i;
async function mikrotikOs(ip: string): Promise<Switch["os"] | null> {
  const get = (path: string) => fetch(`http://${ip}${path}`, { signal: AbortSignal.timeout(2000) });
  try {
    const swos = await get("/sys.b");
    await swos.arrayBuffer();
    if (SWOS_REALM.test(swos.headers.get("www-authenticate") ?? "")) return "swos";
    const ros = await get("/rest/system/identity");
    if (isRouterOs(ros.status, ros.headers.get("www-authenticate") ?? "", await ros.text())) return "routeros";
  } catch {}
  return null;
}

/**
 * Switches are on DHCP: sweep the subnet, then keep MikroTik MACs from the ARP table, plus hosts whose
 * login challenge is SwOS or RouterOS. The second path is needed in the macOS app: its child processes
 * get an empty ARP table.
 */
export async function discoverSwitches(cidr: string, creds: Creds) {
  const alive: string[] = [];
  await pool(hosts(cidr), 64, async (ip) => void ((await ping(ip)) && alive.push(ip)));
  const arp = parseArp(await sh("arp", isWin ? ["-a"] : ["-an"]));
  const byMac = [...arp]
    .filter(([ip, mac]) => contains(cidr, ip) && MIKROTIK_OUI.some((o) => mac.startsWith(o)))
    .map(([ip]) => ip);
  const found = new Map<string, Switch["os"] | null>();
  await pool([...new Set([...byMac, ...alive])], 32, async (ip) => {
    const os = await mikrotikOs(ip);
    if (os || byMac.includes(ip)) found.set(ip, os);
  });
  const switches: Switch[] = [];
  const switchErrors: Scan["switchErrors"] = [];
  await Promise.all(
    [...found].map(async ([ip, os]) => {
      try {
        if (!os) throw new Error("answers as neither SwOS nor RouterOS");
        if (os === "routeros")
          return void switches.push({ ip, os, ros: await rosGet(ip, creds.switchUser, creds.switchPass) });
        const pages: Record<string, any> = {};
        // one page at a time: the SwOS web server handles concurrent requests badly
        for (const p of SWOS_PAGES) pages[p] = swosParse(await swosGet(ip, p, creds.switchUser, creds.switchPass));
        switches.push({ ip, os, pages });
      } catch (e) {
        switchErrors.push({ ip, msg: (e as Error).message });
      }
    }),
  );
  switches.sort((a, b) => toInt(a.ip) - toInt(b.ip));
  return { switches, switchErrors };
}

export async function scan(creds: Creds, ifaceName?: string): Promise<Scan> {
  const network = await pickInterface(ifaceName);
  const [unifi, sw] = await Promise.all([
    unifiGet(network.gateway, creds.unifiUser, creds.unifiPass).then(
      (u) => ({ u }),
      (e: Error) => ({ u: null, err: e.message }),
    ),
    discoverSwitches(process.env.SCAN_CIDR || network.cidr, creds),
  ]);
  return { network, unifi: unifi.u, unifiError: "err" in unifi ? unifi.err : undefined, ...sw };
}
