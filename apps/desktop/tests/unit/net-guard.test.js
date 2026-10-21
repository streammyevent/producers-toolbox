const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const zlib = require("zlib");
const { isPublicAddress, pinnedLookup, fetchPublic } = require("../../out/main/net-guard");

test("only public internet addresses are allowed", () => {
  const refused = [
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.10",
    "172.16.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "fec0::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "2002:7f00:1::",
    "not an ip",
  ];
  for (const ip of refused) assert.strictEqual(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4001::200e"]) {
    assert.strictEqual(isPublicAddress(ip), true, ip);
  }
});

test("the lookup refuses a host that resolves to a private address (DNS rebinding)", async () => {
  // The answer that is checked is the one the socket connects to: one lookup per connection, no second resolve
  const calls = [];
  const resolve = (host, options, cb) => {
    calls.push(host);
    cb(null, [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
  };
  await assert.rejects(() => fetchPublic("http://rebind.example/", {}, pinnedLookup(resolve)), /not allowed/);
  assert.deepStrictEqual(calls, ["rebind.example"]);
});

test("refuses non-http schemes, credentials and private IP literals before connecting", async () => {
  await assert.rejects(() => fetchPublic("file:///etc/passwd"), /Only http/);
  await assert.rejects(() => fetchPublic("http://user:pw@example.com/"), /user name/);
  for (const url of ["http://127.0.0.1:9/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/"]) {
    await assert.rejects(() => fetchPublic(url), /not allowed/, url);
  }
  await assert.rejects(() => fetchPublic("not a url"), /valid link/);
});

// A local server that a test lookup presents as a public host, to test redirects, size limits and decoding.
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const lookup = (host, options, cb) =>
    options.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
  try {
    await fn(`http://site.example:${port}`, lookup, port);
  } finally {
    server.close();
  }
}

test("follows redirects, checks every hop and drops credentials for another host", async () => {
  const seen = [];
  await withServer(
    (req, res) => {
      seen.push([req.url, req.headers.authorization || null]);
      if (req.url === "/start") return res.writeHead(302, { location: "/same-host" }).end();
      if (req.url === "/same-host")
        return res.writeHead(302, { location: "http://other.example:" + req.socket.localPort + "/end" }).end();
      if (req.url === "/to-private")
        return res.writeHead(302, { location: "http://127.0.0.1:" + req.socket.localPort + "/" }).end();
      res.end("done");
    },
    async (base, lookup) => {
      const res = await fetchPublic(base + "/start", { headers: { Authorization: "Bearer t" } }, lookup);
      assert.strictEqual(res.body.toString(), "done");
      assert.deepStrictEqual(seen, [
        ["/start", "Bearer t"],
        ["/same-host", "Bearer t"],
        ["/end", null],
      ]);
      await assert.rejects(() => fetchPublic(base + "/to-private", {}, lookup), /not allowed/);
    },
  );
});

test("limits the body while it streams, also after decompression", async () => {
  const big = Buffer.alloc(64 * 1024, "a");
  await withServer(
    (req, res) => {
      if (req.url === "/gzip") {
        res.writeHead(200, { "content-encoding": "gzip" });
        return res.end(zlib.gzipSync(big));
      }
      res.end(big);
    },
    async (base, lookup) => {
      await assert.rejects(() => fetchPublic(base + "/plain", { maxBytes: 1000 }, lookup), /too large/);
      await assert.rejects(() => fetchPublic(base + "/gzip", { maxBytes: 1000 }, lookup), /too large/);
      const cut = await fetchPublic(base + "/gzip", { maxBytes: 1000, truncate: true }, lookup);
      assert.strictEqual(cut.body.length, 1000);
      const full = await fetchPublic(base + "/gzip", {}, lookup);
      assert.deepStrictEqual(full.body, big);
    },
  );
});

test("gives up on a slow site", async () => {
  await withServer(
    () => {}, // never answers
    async (base, lookup) => {
      await assert.rejects(() => fetchPublic(base + "/", { timeoutMs: 200 }, lookup), /too long/);
    },
  );
});
