// Run: npm test
const test = require("node:test");
const assert = require("node:assert");
const { isPrivateIp, assertPublic, guardedFetch } = require("../../src/main/net-guard.js");

test("private and local addresses are refused", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.10",
    "172.16.0.1",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.strictEqual(isPrivateIp(ip), true, ip);
  }
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.strictEqual(isPrivateIp(ip), false, ip);
  }
});

test("assertPublic rejects non-http and private URLs", async () => {
  await assert.rejects(() => assertPublic(new URL("file:///c:/windows/win.ini")));
  await assert.rejects(() => assertPublic(new URL("http://127.0.0.1:8085/")));
  await assert.rejects(() => assertPublic(new URL("http://[::1]/")));
});

test("guardedFetch refuses a private target before connecting", async () => {
  await assert.rejects(() => guardedFetch("http://10.1.2.3/secret"), /not allowed/);
});
