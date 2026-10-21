"use strict";
const fs = require("node:fs");

/** KEY=value lines from .env in the current folder. It holds the real logins: never print or commit it. */
function readEnv(file = ".env") {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  return Object.fromEntries(
    lines
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

module.exports = { readEnv };
