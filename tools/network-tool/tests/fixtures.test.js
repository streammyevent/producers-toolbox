const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { DROP, isPublic } = require("../scripts/sanitize.js");

const FIX = path.join(__dirname, "fixtures");
const files = fs.readdirSync(FIX, { recursive: true }).filter((f) => f.endsWith(".json"));

// The fixtures are real dumps of the flypack, published with the repo. scripts/sanitize.js must have run on them.
test("fixtures hold no secrets, serial numbers or public IPs", () => {
  assert.ok(files.length > 10);
  for (const f of files) {
    const found = [];
    const walk = (v, at) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          if (DROP.test(k)) found.push(`${at}.${k}`);
          walk(x, `${at}.${k}`);
        }
      } else if (typeof v === "string") {
        for (const ip of v.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])
          if (isPublic(ip)) found.push(`${at}: public IP`);
      }
    };
    walk(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")), "");
    assert.deepStrictEqual(found, [], f);
  }
});
