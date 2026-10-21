#!/usr/bin/env node
// Repo guard: scans every file tracked by git (and new files not ignored by .gitignore) for things that look like real
// secrets (API keys, OAuth tokens, client secrets, GitHub tokens, JWTs, private keys) or personal data (user folders,
// cloud-drive paths, email addresses), and for files that must never be committed (HANDOFF.md, *.local.md, .env, ...).
// Exits 1 when it finds one. Usage: pnpm check:secrets
//
// Findings are printed as file:line plus a masked preview; the value itself is never printed.
// Obvious placeholders ("AIzaSy...", "your-api-key", "<token>", "/Users/<you>/", "xxxx") are ignored. A line that must
// contain such a string on purpose can carry the marker "secret-scan:ignore" (use sparingly; reviewers should question
// it).
//
// No dependencies: Node built-ins only. The patterns below are assembled from pieces so this file does not match
// itself.

"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const IGNORE_MARKER = "secret-scan:" + "ignore";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const PATTERNS = [
  { kind: "Google API key", regex: new RegExp("AI" + "za[0-9A-Za-z_\\-]{35}(?![0-9A-Za-z_\\-])", "g") },
  { kind: "Google OAuth access token", regex: new RegExp("ya" + "29\\.[0-9A-Za-z_\\-]{20,}", "g") },
  { kind: "Google OAuth client secret", regex: new RegExp("GOC" + "SPX-[0-9A-Za-z_\\-]{10,}", "g") },
  { kind: "GitHub token", regex: new RegExp("\\bg" + "h[pousr]_[0-9A-Za-z]{30,}", "g") },
  { kind: "GitHub token", regex: new RegExp("\\bgithub" + "_pat_[0-9A-Za-z_]{30,}", "g") },
  { kind: "Private key", regex: new RegExp("-----BEGIN " + "(?:[A-Z0-9]+ )*PRIVATE " + "KEY-----", "g") },
  { kind: "JSON Web Token", regex: new RegExp("\\bey" + "J[\\w-]{10,}\\.ey" + "J[\\w-]{10,}\\.[\\w-]+", "g") },
  { kind: "Anthropic API key", regex: new RegExp("\\bsk-" + "ant-[\\w-]{8,}", "g") },
  { kind: "Token in a URL", regex: new RegExp("[?&]to" + "ken=([\\w.~-]{8,})", "g"), group: 1 },
  {
    kind: "Generic API key assignment",
    regex: new RegExp("api[_\\-]?" + "key[\"']?\\s*[:=]\\s*[\"']([^\"'\\s]{16,})[\"']", "gi"),
    group: 1,
  },
];

// Personal data. Not checked in vendored code, license texts (font authors' emails) and the lockfile.
const EMAIL_ALLOWED = /@(?:example\.(?:com|org|net)|[\w.-]+\.(?:test|invalid)|users\.noreply\.github\.com)$/i;
const PERSONAL_PATTERNS = [
  { kind: "Windows user folder", regex: new RegExp("\\b[A-Za-z]:[\\\\/]+Us" + "ers[\\\\/]+[\\w.-]+", "g") },
  { kind: "macOS user folder", regex: new RegExp("(?<![\\w.:/])/Us" + "ers/(?!Shared/)[\\w.-]+/", "g") },
  { kind: "Linux home folder", regex: new RegExp("(?<![\\w.:/])/ho" + "me/[\\w.-]+/", "g") },
  {
    kind: "Cloud drive path",
    regex: new RegExp("(?:(?:Shared|Gedeelde) dri" + "ves|(?:My|Mijn) Dri" + "ve)[\\\\/]+\\w", "gi"),
  },
  {
    kind: "Email address",
    regex: /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g,
    allow: (value) => EMAIL_ALLOWED.test(value) || /^git@/i.test(value),
  },
];
const PERSONAL_EXEMPT_FILE = /(?:^|\/)(?:vendor\/|pnpm-lock\.yaml$|(?:LICENSE|OFL|THIRD_PARTY_NOTICES)[^/]*$)/;

// Files that hold local notes, machine config or secrets.
const FORBIDDEN_FILE =
  /^(?:HANDOFF\.md|storage_config\.json|creds\.enc|.+\.local\.(?:md|json)|\.env(?!\.example$).*)$/i;

// An OAuth client id is public on its own; it only matters next to a client secret in the same file.
const CLIENT_ID_REGEX = new RegExp("[0-9]+-[0-9a-z]+\\.apps\\.google" + "usercontent\\.com", "i");
const CLIENT_SECRET_REGEX = new RegExp("client[_\\-]?" + "secret[\"']?\\s*[:=]\\s*[\"']([^\"'\\s]{8,})[\"']", "gi");

/** True for values that are clearly placeholders rather than real secrets. */
function isPlaceholder(value) {
  const v = String(value);
  if (/\.\.\.|…|<|>|\{|\}|\$/.test(v)) return true;
  if (/x{4,}|\*{3,}|placeholder|example|your[_-]?|dummy|changeme|redacted/i.test(v)) return true;
  // One character repeated after a fixed prefix (e.g. "AIza" followed by 35 times "A")
  const body = v.replace(/^(AIza|ya29\.|GOCSPX-|gh[pousr]_|github_pat_)/, "");
  return body.length > 0 && new Set(body).size <= 2;
}

/** Masked preview: the first 4 characters, then the length. Never the secret itself. */
function mask(value) {
  const v = String(value);
  return `${v.slice(0, Math.min(4, Math.floor(v.length / 4)))}*** (${v.length} chars)`;
}

/** Returns [{line, kind, masked}] for every likely secret (and, unless `personal` is false, personal data) in `text`. */
function scanText(text, { personal = true } = {}) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  const pairedClientId = CLIENT_ID_REGEX.test(text);

  lines.forEach((line, index) => {
    if (line.includes(IGNORE_MARKER)) return;
    const checks = [
      ...PATTERNS,
      ...(pairedClientId
        ? [{ kind: "OAuth client secret next to a client id", regex: CLIENT_SECRET_REGEX, group: 1 }]
        : []),
      ...(personal ? PERSONAL_PATTERNS : []),
    ];
    for (const { kind, regex, group = 0, allow } of checks) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        const value = match[group];
        if (isPlaceholder(value) || (allow && allow(value))) continue;
        findings.push({ line: index + 1, kind, masked: mask(value) });
      }
    }
  });
  return findings;
}

function trackedFiles(cwd) {
  // Tracked files plus new, not-ignored ones, so a secret is caught before it is even committed
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  const out = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

/** Scans the tracked files under `cwd`. Returns [{file, line, kind, masked}]. */
function scanRepo(cwd) {
  const results = [];
  for (const file of trackedFiles(cwd)) {
    if (FORBIDDEN_FILE.test(path.posix.basename(file))) {
      results.push({ file, line: 0, kind: "File that must not be committed", masked: "" });
      continue;
    }
    const full = path.join(cwd, file);
    let buf;
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      buf = fs.readFileSync(full);
    } catch {
      continue; // deleted in the working tree
    }
    if (buf.includes(0)) continue; // binary
    const personal = !PERSONAL_EXEMPT_FILE.test(file);
    for (const finding of scanText(buf.toString("utf8"), { personal })) results.push({ file, ...finding });
  }
  return results;
}

function main() {
  const cwd = process.cwd();
  const findings = scanRepo(cwd);
  if (findings.length === 0) {
    console.log(`check-secrets: nothing found in ${trackedFiles(cwd).length} files (tracked and new, not ignored).`);
    return 0;
  }
  console.error(`check-secrets: ${findings.length} possible secret(s) or personal data found:`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.kind}  ${f.masked}`);
  console.error("Remove them (and rotate any real key or token), or mark a deliberate placeholder.");
  return 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { scanText, scanRepo, isPlaceholder, mask, PATTERNS };
