// Unit tests for scripts/check-secrets.js (node:test, no browser). Run with: pnpm test
//
// Every secret-shaped fixture is assembled at runtime from harmless pieces, so this file itself never contains a
// string the scanner (or any other secret scanner) would flag.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { scanText, scanRepo, isPlaceholder, mask } = require("./check-secrets.js");

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Deterministic, varied fake body of `length` characters (not a real credential). */
function fakeBody(length, seed = 7) {
  return Array.from({ length }, (_, i) => CHARSET[(i * seed + 3) % CHARSET.length]).join("");
}

const fake = {
  googleKey: () => ["AI", "za", fakeBody(35)].join(""),
  oauthToken: () => ["ya", "29.", fakeBody(40, 11)].join(""),
  clientSecret: () => ["GOC", "SPX-", fakeBody(28, 5)].join(""),
  githubToken: () => ["gh", "p_", fakeBody(36, 13)].join(""),
  privateKeyHeader: () => ["-----BEGIN ", "RSA PRIVATE ", "KEY-----"].join(""),
  clientId: () => ["1234567890-", "abcdefghij", ".apps.google", "usercontent.com"].join(""),
  jwt: () => ["ey", "J", fakeBody(20), ".ey", "J", fakeBody(30, 3), ".", fakeBody(16, 9)].join(""),
  anthropicKey: () => ["sk-", "ant-", fakeBody(24, 23)].join(""),
};

test("detects each secret shape and reports the line number", () => {
  const cases = [
    [fake.googleKey(), "Google API key"],
    [fake.oauthToken(), "Google OAuth access token"],
    [fake.clientSecret(), "Google OAuth client secret"],
    [fake.githubToken(), "GitHub token"],
    [fake.privateKeyHeader(), "Private key"],
    [fake.jwt(), "JSON Web Token"],
    [fake.anthropicKey(), "Anthropic API key"],
  ];
  for (const [secret, kind] of cases) {
    const findings = scanText(`first line\nconst value = "${secret}";\n`);
    assert.equal(findings.length, 1, `${kind} should be found exactly once`);
    assert.equal(findings[0].kind, kind);
    assert.equal(findings[0].line, 2);
  }
});

test("detects a generic api_key assignment with a long value", () => {
  const value = fakeBody(24, 17);
  for (const line of [`api_key = "${value}"`, `"apiKey": "${value}"`, `API-KEY: '${value}'`]) {
    const findings = scanText(line);
    assert.equal(findings.length, 1, line.slice(0, 8));
    assert.equal(findings[0].kind, "Generic API key assignment");
  }
  // Short values and non-literal values are not flagged
  assert.deepEqual(scanText(`apiKey: "short-value"`), []);
  assert.deepEqual(scanText(`const apiKey = readKeyFromStore();`), []);
});

test("detects a token in a URL query string", () => {
  const findings = scanText(`fetch("https://api.example.net/files?${"tok" + "en"}=${fakeBody(24, 29)}")`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "Token in a URL");
});

test("detects personal folders, cloud-drive paths and email addresses", () => {
  const cases = [
    [["C:", "\\", "Us", "ers", "\\", "jdoe", "\\Documents"].join(""), "Windows user folder"],
    [["/Us", "ers/", "jdoe", "/Library/"].join(""), "macOS user folder"],
    [["/ho", "me/", "jdoe", "/projects/"].join(""), "Linux home folder"],
    [["G:", "\\", "Shared dri", "ves", "\\", "Team"].join(""), "Cloud drive path"],
    [["/Volumes/GoogleDrive/", "My Dri", "ve", "/Cards"].join(""), "Cloud drive path"],
    [["Gedeelde dri", "ves", "/Team"].join(""), "Cloud drive path"],
    [["jane.doe", "@", "company", ".nl"].join(""), "Email address"],
  ];
  for (const [text, kind] of cases) {
    const findings = scanText(`const p = "${text}";`);
    assert.equal(findings.length, 1, `${kind}: ${findings.map((f) => f.kind)}`);
    assert.equal(findings[0].kind, kind);
  }
});

test("allows placeholder paths, example emails and git remotes", () => {
  const ok = [
    ["/Us", "ers/", "<you>", "/Library/"].join(""),
    ["/Us", "ers/", "Shared", "/Toolbox/"].join(""),
    "https://example.com/home/docs/",
    "Push to the Shared Drive (My Drive is fine too)",
    ["someone", "@", "example.com"].join(""),
    ["dev", "@", "box.test"].join(""),
    ["123+bot", "@", "users.noreply.github.com"].join(""),
    ["git", "@", "github.com:streammyevent/producers-toolbox.git"].join(""),
    "electron-updater@6.8.11 @producers-toolbox/desktop",
  ];
  for (const text of ok) assert.deepEqual(scanText(text), [], text);
  // Vendored code and the lockfile are not checked for personal data
  assert.deepEqual(scanText(["jane", "@", "company.nl"].join(""), { personal: false }), []);
});

test("an OAuth client id is only flagged together with a client secret", () => {
  assert.deepEqual(scanText(`clientId: "${fake.clientId()}"`), []);
  const secretValue = fakeBody(20, 19);
  const findings = scanText(`clientId: "${fake.clientId()}"\nclient_secret: "${secretValue}"\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "OAuth client secret next to a client id");
  assert.equal(findings[0].line, 2);
});

test("ignores placeholders", () => {
  const placeholders = [
    `placeholder="Google API Key (AIzaSy...)"`,
    ["AI", "za", "A".repeat(35)].join(""),
    ["ya", "29.", "x".repeat(30)].join(""),
    `api_key = "your-api-key-goes-here"`,
    `apiKey: "<insert your api key here>"`,
    `apiKey: "\${GOOGLE_API_KEY_FROM_ENV}"`,
  ];
  for (const text of placeholders) assert.deepEqual(scanText(text), [], text);
  assert.equal(isPlaceholder("example-value-1234567890"), true);
  assert.equal(isPlaceholder(fakeBody(30)), false);
});

test("the ignore marker suppresses a single line", () => {
  const marker = ["secret-scan", "ignore"].join(":");
  assert.deepEqual(scanText(`const k = "${fake.googleKey()}"; // ${marker}`), []);
  assert.equal(scanText(`const k = "${fake.googleKey()}";`).length, 1);
});

test("never prints the secret: the masked form keeps at most 4 characters", () => {
  const secret = fake.googleKey();
  const masked = mask(secret);
  assert.ok(!masked.includes(secret.slice(4, 12)));
  assert.match(masked, /\*\*\* \(39 chars\)$/);
  const [finding] = scanText(secret);
  assert.ok(!JSON.stringify(finding).includes(secret.slice(4)));
});

test("the scanner's own source and this test file are clean", () => {
  const root = path.join(__dirname, "..");
  for (const file of ["scripts/check-secrets.js", "scripts/check-secrets.test.js"]) {
    assert.deepEqual(scanText(fs.readFileSync(path.join(root, file), "utf8")), [], file);
  }
});

test("scanRepo reports files that must never be committed", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spd-check-secrets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  } catch {
    t.skip("git is not available");
    return;
  }
  for (const name of [
    "HANDOFF.md",
    "notes.local.md",
    "storage_config.json",
    ".env",
    ".env.example",
    "creds.enc",
    "README.md",
  ]) {
    fs.writeFileSync(path.join(dir, name), "x\n");
  }
  assert.deepEqual(
    scanRepo(dir)
      .map((f) => f.file)
      .sort(),
    [".env", "HANDOFF.md", "creds.enc", "notes.local.md", "storage_config.json"],
  );
});

test("scanRepo skips the email check in license texts only", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spd-check-secrets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  } catch {
    t.skip("git is not available");
    return;
  }
  fs.mkdirSync(path.join(dir, "fonts"));
  const author = "Copyright 2011, The Font Project Authors (" + "author@" + "font-project.org)\n";
  for (const name of ["fonts/OFL.txt", "LICENSE-thing.txt", "THIRD_PARTY_NOTICES.txt", "notes.txt"]) {
    fs.writeFileSync(path.join(dir, name), author);
  }
  assert.deepEqual(
    scanRepo(dir).map((f) => [f.file, f.kind]),
    [["notes.txt", "Email address"]],
  );
});

test("scanRepo scans tracked and new files of a git repo and skips ignored ones", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spd-check-secrets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  try {
    git("init", "-q");
  } catch {
    t.skip("git is not available");
    return;
  }
  fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
  fs.writeFileSync(path.join(dir, "clean.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(dir, "leak.js"), `\n\nconst key = "${fake.oauthToken()}";\n`);
  fs.writeFileSync(path.join(dir, "ignored.txt"), fake.googleKey());
  git("add", "clean.js", ".gitignore");

  const findings = scanRepo(dir);
  assert.deepEqual(
    findings.map((f) => [f.file, f.line, f.kind]),
    [["leak.js", 3, "Google OAuth access token"]],
  );
});
