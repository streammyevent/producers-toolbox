"use strict";
// Strips secrets and personal data from scan dumps before they become test fixtures. UniFi returns the device SSH
// password, adoption keys and Wi-Fi keys in x_* fields and its remote-access domain, switches report serial numbers and SNMP contacts, and client
// hostnames name people's devices. Public IPs become 203.0.113.x, client hostnames host-NN (switch names stay).
//
//   node scripts/sanitize.js <fixture folder>    rewrites the dumps in that folder (not expected.json)
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const DROP =
  /^x_|pass(word|wd)?|secret|token|psk|private|authkey|serial|^sid$|geo_info|ssh_session|syslog_key|community|^contact$|^location$|^username$|public_key|device_domain|uuid|anon_id|external_id|ssid/i;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// Private, local, benchmarking (UniFi's querier uses 198.18.x), documentation and multicast ranges stay as they are
const NOT_PUBLIC = new net.BlockList();
for (const [a, len] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
]) {
  NOT_PUBLIC.addSubnet(a, len);
}
const isPublic = (ip) => net.isIPv4(ip) && !NOT_PUBLIC.check(ip);

const hexstr = (s) => Buffer.from(s, "hex").toString("utf8");
const isUnifi = (d) => d && typeof d === "object" && Array.isArray(d["stat/sta"]);

/** Switch names in a set of dumps (RouterOS identity or SwOS id); those hostnames stay readable. */
function switchNames(dumps) {
  const out = new Set();
  for (const d of dumps) {
    if (d?.ros?.["system/identity"]?.name) out.add(d.ros["system/identity"].name);
    const sys = d?.pages?.sys ?? d?.sys;
    if (typeof sys?.id === "string") out.add(hexstr(sys.id));
  }
  return out;
}

/**
 * Sanitizes a set of dumps that belong together ({ file name: parsed JSON }). Returns the cleaned set and the
 * hostname map (old → new), so a test snapshot can be checked against it.
 */
function sanitizeFiles(files) {
  const keep = switchNames(Object.values(files));
  const hosts = new Map();
  const unifis = Object.values(files).filter(isUnifi);
  const names = [...new Set(unifis.flatMap((u) => u["stat/sta"].flatMap((c) => [c.hostname, c.name])))]
    .filter((n) => typeof n === "string" && n && !keep.has(n))
    .sort();
  names.forEach((n, i) => hosts.set(n, `host-${String(i + 1).padStart(2, "0")}`));
  const ips = new Map();
  const ip = (m) => {
    if (!isPublic(m)) return m;
    if (!ips.has(m)) ips.set(m, `203.0.113.${ips.size + 1}`);
    return ips.get(m);
  };

  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => !DROP.test(k))
          .map(([k, x]) => [k, walk(x)]),
      );
    }
    return typeof v === "string" ? v.replace(IPV4, ip) : v;
  };

  const out = {};
  for (const [file, data] of Object.entries(files)) {
    const copy = structuredClone(data);
    if (isUnifi(copy)) {
      for (const c of copy["stat/sta"]) {
        for (const k of ["hostname", "name"]) if (hosts.has(c[k])) c[k] = hosts.get(c[k]);
      }
    }
    out[file] = walk(copy);
  }
  return { files: out, hosts };
}

/** Rewrites the dumps in a folder (every .json except expected.json). */
function sanitizeDir(dir) {
  const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "expected.json");
  const files = Object.fromEntries(names.map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]));
  const result = sanitizeFiles(files);
  for (const [f, data] of Object.entries(result.files)) {
    fs.writeFileSync(path.join(dir, f), JSON.stringify(data, null, 1) + "\n");
  }
  return result;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: node scripts/sanitize.js <fixture folder>");
  const { hosts } = sanitizeDir(dir);
  console.log(`Sanitized ${dir}: ${hosts.size} client hostnames replaced.`);
}

module.exports = { sanitizeFiles, sanitizeDir, isPublic, DROP };
