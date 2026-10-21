"use strict";
// Encrypts the switch and UniFi logins from .env into creds.enc, unlocked with a crew code. The network lead keeps
// creds.enc private (never in the repo or the app) and gives crew the file and the code. The Network Tool imports it
// once per computer and keeps the logins in the OS-encrypted secret store.
//
//   pnpm build && pnpm make-creds     (in tools/network-tool, with .env next to package.json)
const fs = require("node:fs");
const readline = require("node:readline/promises");
const { seal } = require("../out/creds.js");
const { readEnv } = require("./env.js");

async function main() {
  const env = readEnv();
  const creds = {
    switchUser: env.SWITCH_USER,
    switchPass: env.SWITCH_PASS,
    unifiUser: env.UNIFI_USER,
    unifiPass: env.UNIFI_PASS,
  };
  if (Object.values(creds).some((v) => !v))
    throw new Error(".env needs SWITCH_USER, SWITCH_PASS, UNIFI_USER and UNIFI_PASS.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await rl.question("Crew code (min. 6 characters): ");
  const again = await rl.question("Repeat the code: ");
  rl.close();
  if (code.length < 6 || code !== again) throw new Error("The codes are too short or do not match.");
  fs.writeFileSync("creds.enc", await seal(creds, code));
  console.log("Wrote creds.enc. Keep it private. Crew import it in the Network Tool with the crew code.");
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
