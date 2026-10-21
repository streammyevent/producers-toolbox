"use strict";
// Read-only: scans the network and writes sanitized test fixtures, unifi.json plus one JSON per switch.
//
//   pnpm build && node scripts/dump.js tests/fixtures/<date> [cidr]    (cidr: sweep another subnet than the own one)
const fs = require("node:fs");
const path = require("node:path");
const { discoverSwitches, scan } = require("../out/net.js");
const { readEnv } = require("./env.js");
const { sanitizeFiles } = require("./sanitize.js");

async function main() {
  const dir = process.argv[2] ?? "dump";
  const env = readEnv();
  const creds = {
    switchUser: env.SWITCH_USER,
    switchPass: env.SWITCH_PASS,
    unifiUser: env.UNIFI_USER,
    unifiPass: env.UNIFI_PASS,
  };
  const s = await scan(creds);
  if (process.argv[3]) Object.assign(s, await discoverSwitches(process.argv[3], creds));
  const raw = { "unifi.json": s.unifi };
  for (const sw of s.switches) raw[`${sw.os === "routeros" ? sw.ros["system/identity"].name : sw.ip}.json`] = sw;
  const { files } = sanitizeFiles(raw);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, data] of Object.entries(files))
    fs.writeFileSync(path.join(dir, f), JSON.stringify(data, null, 1) + "\n");
  console.log(
    `${s.switches.length} switches, errors: ${JSON.stringify(s.switchErrors)}, unifi: ${s.unifiError ?? "ok"}`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
