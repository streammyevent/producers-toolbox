const { describe, test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const seed = require("../src/equipment.json");
const { runChecks } = require("../out/checks.js");
const { adminScript, pktmonScript, tcpdumpArgs } = require("../out/capture.js");
const { discover, mdnsQuery } = require("../out/probe.js");
const { age, decode, dhcp, mdns, observe, observeUdp, ptp, readCapture } = require("../out/wire.js");

// Synthetic frames only: the repo holds no real captures.
const mac = (s) => s.split(":").map((h) => parseInt(h, 16));
const ip = (s) => s.split(".").map(Number);
const u16 = (n) => [n >> 8, n & 255];
const eth = (src, dst, type, body, vlan) =>
  Uint8Array.from([...mac(dst), ...mac(src), ...(vlan ? [0x81, 0, ...u16(vlan)] : []), ...u16(type), ...body]);
const ipv4 = (src, dst, proto, body) => [
  0x45,
  0,
  ...u16(20 + body.length),
  0,
  0,
  0,
  0,
  1,
  proto,
  0,
  0,
  ...ip(src),
  ...ip(dst),
  ...body,
];
const udp = (sport, dport, data) => [...u16(sport), ...u16(dport), ...u16(8 + data.length), 0, 0, ...data];
const frame = (data, t = 1000) => ({ t, data });

const igmpQuery = (v3) => [0x11, 100, 0, 0, 0, 0, 0, 0, ...(v3 ? [0, 0, 0, 0] : [])];
const arp = (sha, spa) => [0, 1, 8, 0, 6, 4, 0, 2, ...mac(sha), ...ip(spa), ...mac("00:00:00:00:00:00"), 0, 0, 0, 0];
const bpdu = (root, tc) => [0x42, 0x42, 0x03, 0, 0, 2, 2, tc ? 1 : 0, 0x10, 0, ...mac(root), ...Array(25).fill(0)];
const tlv = (type, bytes) => [(type << 1) | (bytes.length >> 8), bytes.length & 255, ...bytes];
const str = (s) => [...Buffer.from(s)];
const lldp = [
  ...tlv(1, [4, ...mac("aa:aa:aa:aa:aa:aa")]),
  ...tlv(2, [5, ...str("12")]),
  ...tlv(4, str("GreenGO MCX")),
  ...tlv(5, str("Video switch")),
  ...tlv(127, [0x00, 0x80, 0xc2, 1, ...u16(40)]),
  0,
  0,
];
const ptp2 = (leader, domain = 0) => {
  const d = Array(64).fill(0);
  d[0] = 0x0b;
  d[1] = 2;
  d[4] = domain;
  d.splice(53, 8, ...mac(leader));
  return d;
};
const ptp1 = (leader) => {
  const d = Array(72).fill(0);
  d.splice(0, 2, 0, 1);
  d.splice(4, 5, ...str("_DFLT"));
  d[20] = 1; // event message
  d[32] = 0; // Sync
  d.splice(54, 6, ...mac(leader));
  return d;
};
const offer = (server) => {
  const d = Array(300).fill(0);
  d[0] = 2;
  d.splice(236, 4, 0x63, 0x82, 0x53, 0x63);
  d.splice(240, 10, 53, 1, 2, 54, 4, ...ip(server), 255);
  return d;
};
const dnsName = (n) => [...n.split(".").flatMap((l) => [l.length, ...str(l)]), 0];
const mdnsAnswer = (service, instance) => {
  const owner = dnsName(service);
  const target = dnsName(`${instance}.${service}`);
  return [0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, ...owner, 0, 12, 0, 1, 0, 0, 0, 120, ...u16(target.length), ...target];
};

describe("capture files", () => {
  const frames = [frame(Uint8Array.from([1, 2, 3, 4]), 1700000000123), frame(Uint8Array.from([5, 6]), 1700000001000)];
  test("classic pcap", () => {
    const head = Buffer.alloc(24);
    head.writeUInt32LE(0xa1b2c3d4, 0);
    head.writeUInt32LE(1, 20);
    const recs = frames.map((f) => {
      const h = Buffer.alloc(16);
      h.writeUInt32LE(Math.floor(f.t / 1000), 0);
      h.writeUInt32LE((f.t % 1000) * 1000, 4);
      h.writeUInt32LE(f.data.length, 8);
      h.writeUInt32LE(f.data.length, 12);
      return Buffer.concat([h, f.data]);
    });
    // a half-written last record is skipped
    const got = readCapture(Buffer.concat([head, ...recs, Buffer.from([9, 9, 9])]));
    assert.deepStrictEqual(
      got.map((f) => [f.t, [...f.data]]),
      frames.map((f) => [f.t, [...f.data]]),
    );
  });
  test("pcapng with nanosecond timestamps", () => {
    const block = (type, body) => {
      const pad = Buffer.alloc((4 - (body.length % 4)) % 4);
      const len = 12 + body.length + pad.length;
      const b = Buffer.alloc(8);
      b.writeUInt32LE(type, 0);
      b.writeUInt32LE(len, 4);
      const end = Buffer.alloc(4);
      end.writeUInt32LE(len, 0);
      return Buffer.concat([b, body, pad, end]);
    };
    const shb = Buffer.alloc(16);
    shb.writeUInt32LE(0x1a2b3c4d, 0);
    shb.writeUInt16LE(1, 4);
    shb.writeBigInt64LE(-1n, 8);
    const idb = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 9, 0, 1, 0, 9, 0, 0, 0, 0, 0, 0, 0]); // Ethernet, tsresol 10^-9
    const epb = (f) => {
      const h = Buffer.alloc(20);
      const ns = BigInt(f.t) * 1_000_000n;
      h.writeUInt32LE(Number(ns >> 32n), 4);
      h.writeUInt32LE(Number(ns & 0xffffffffn), 8);
      h.writeUInt32LE(f.data.length, 12);
      h.writeUInt32LE(f.data.length, 16);
      return block(6, Buffer.concat([h, f.data]));
    };
    const got = readCapture(Buffer.concat([block(0x0a0d0d0a, shb), block(1, idb), ...frames.map(epb)]));
    assert.deepStrictEqual(
      got.map((f) => [Math.round(f.t), [...f.data]]),
      frames.map((f) => [f.t, [...f.data]]),
    );
  });
});

describe("decoders", () => {
  const A = "00:1d:c1:00:00:01";
  const B = "00:1d:c1:00:00:02";
  test("IGMP general query, v2 and v3, tagged", () => {
    const p = decode(
      frame(eth(A, "01:00:5e:00:00:01", 0x0800, ipv4("10.0.0.11", "224.0.0.1", 2, igmpQuery(false)), 40)),
    );
    assert.deepStrictEqual([p.vlan, p.ip.src, p.igmp], [40, "10.0.0.11", { general: true, version: 2 }]);
    const v3 = decode(frame(eth(A, "01:00:5e:00:00:01", 0x0800, ipv4("10.0.0.11", "224.0.0.1", 2, igmpQuery(true)))));
    assert.deepStrictEqual([v3.vlan, v3.igmp.version], [undefined, 3]);
  });
  test("ARP, LLDP, STP", () => {
    assert.deepStrictEqual(decode(frame(eth(A, "ff:ff:ff:ff:ff:ff", 0x0806, arp(A, "10.0.0.5")))).arp, {
      mac: A,
      ip: "10.0.0.5",
    });
    assert.deepStrictEqual(decode(frame(eth(A, "01:80:c2:00:00:0e", 0x88cc, lldp))).lldp, {
      port: "12",
      desc: "GreenGO MCX",
      system: "Video switch",
      pvid: 40,
    });
    const b = bpdu(B, true);
    assert.deepStrictEqual(decode(frame(eth(A, "01:80:c2:00:00:00", b.length, b))).stp, { root: B, tc: true });
  });
  test("PTP, DHCP, mDNS", () => {
    assert.deepStrictEqual(ptp(Uint8Array.from(ptp2("00:1d:c1:ff:fe:00:00:01"))), {
      version: 2,
      domain: "0",
      leader: "00:1d:c1:ff:fe:00:00:01",
    });
    assert.deepStrictEqual(ptp(Uint8Array.from(ptp1(A))), { version: 1, domain: "_DFLT", leader: A });
    assert.deepStrictEqual(dhcp(Uint8Array.from(offer("10.0.0.1"))), { type: 2, server: "10.0.0.1" });
    assert.deepStrictEqual(mdns(Uint8Array.from(mdnsAnswer("_netaudio-arc._udp.local", "Stage Box 1"))), [
      { service: "dante", name: "Stage Box 1" },
    ]);
  });
  test("probe packets", () => {
    const q = mdnsQuery(["_netaudio-arc._udp.local"]);
    assert.strictEqual(q.readUInt16BE(4), 1);
    assert.deepStrictEqual([...q.subarray(12, 26)], dnsName("_netaudio-arc._udp.local").slice(0, 14));
    const d = discover(A);
    assert.deepStrictEqual([d[0], d.readUInt16BE(10), [...d.subarray(28, 34)], d[242]], [1, 0x8000, mac(A), 1]);
  });
});

describe("capture commands", () => {
  test("tcpdump drops to the user; the admin script quotes paths", () => {
    assert.deepStrictEqual(tcpdumpArgs("en10", "/d", "crew").slice(0, 4), ["-Z", "crew", "-i", "en10"]);
    const s = adminScript("en10", "/opt/Application Support/it's", "crew", 42);
    assert.ok(s.startsWith("do shell script \"'/usr/sbin/tcpdump' '-Z' 'crew'"));
    assert.ok(s.includes("Application Support/it'\\\\''s/cap-%s.pcap"));
    assert.ok(s.includes("kill -0 42") && s.endsWith("with administrator privileges"));
  });
  test("pktmon loop stops on a stop file or when the app is gone", () => {
    const s = pktmonScript("D:\\Tool data\\o'neil", 42);
    assert.ok(s.startsWith("$d = 'D:\\Tool data\\o''neil'"));
    assert.ok(s.includes("Get-Process -Id 42") && s.includes('Test-Path "$d\\stop"'));
    assert.ok(s.trim().split("\n").at(-2).startsWith("pktmon stop"));
  });
});

// --- checks over the 2026-10-06 fixture --------------------------------------

const FIX = path.join(__dirname, "fixtures");
const { ipLE } = require("../out/net.js");
function fixtureScan(obs) {
  const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
  return {
    network: {
      name: "en7",
      address: "10.0.0.201",
      cidr: "10.0.0.201/24",
      mac: "6c:1f:f7:bb:ac:6f",
      gateway: "10.0.0.1",
    },
    unifi: load("unifi.json"),
    switches: fs
      .readdirSync(FIX)
      .filter((f) => f.startsWith("SWITCH"))
      .sort()
      .map((f) => {
        const pages = load(f);
        return { ip: ipLE(pages.sys.cip), os: "swos", pages: { ...pages, "!igmp": [], "!dhost": [] } };
      }),
    switchErrors: [],
    wire: { obs, capture: "capture on: tcpdump on en7", packets: 1, errors: [] },
  };
}
function memory(packets, udps = []) {
  const mem = new Map();
  observe(
    mem,
    packets.map((f) => decode(f)),
    1,
  );
  for (const u of udps) observeUdp(mem, { ...u, data: Uint8Array.from(u.data) });
  return [...mem.values()];
}
const results = (obs) => runChecks(fixtureScan(obs), seed).results;
const lines = (obs, device = "Expanded scan") =>
  results(obs)
    .filter((r) => r.device === device && r.level !== "INFO")
    .map((r) => `${r.level} ${r.msg}`);

describe("expanded scan checks", () => {
  const X = "00:11:22:33:44:55";
  const Y = "00:11:22:33:44:66";
  const query = (src, from, vlan) =>
    frame(eth(src, "01:00:5e:00:00:01", 0x0800, ipv4(from, "224.0.0.1", 2, igmpQuery(false)), vlan));

  test("a querier of another brand counts: no false FAIL, and a second querier warns", () => {
    const base = results([]);
    assert.ok(base.some((r) => r.level === "FAIL" && r.msg.endsWith("critical VLANs without querier: 40, 60")));
    const foreign = results(memory([query(X, "192.168.40.9", 40), query(X, "192.168.40.9", 60)]));
    assert.ok(foreign.some((r) => r.level === "PASS" && r.msg.endsWith("critical VLANs without querier: none")));
    const twice = results(memory([query(X, "10.0.0.9", 10)]));
    assert.ok(twice.some((r) => r.msg === `VLAN 10 has 2 queriers: 48 Pro POE switch, 10.0.0.9 (${X})`));
  });
  test("rogue DHCP, duplicate IP, another network's address", () => {
    const dhcpFrom = (server, from) => ({
      t: 1,
      vlan: 1,
      src: server,
      mac: from,
      sport: 67,
      dport: 68,
      data: offer(server),
    });
    assert.deepStrictEqual(lines(memory([], [dhcpFrom("10.0.0.1", "")])), []);
    assert.deepStrictEqual(lines(memory([], [dhcpFrom("10.0.0.1", ""), dhcpFrom("10.0.0.77", X)])), [
      `FAIL VLAN 1 (Default): DHCP server that is not the UniFi gateway: 10.0.0.77 · ${X}`,
    ]);
    const a = (m, addr) => frame(eth(m, "ff:ff:ff:ff:ff:ff", 0x0806, arp(m, addr)));
    assert.deepStrictEqual(lines(memory([a(X, "10.0.0.50"), a(Y, "10.0.0.50")])), [
      `FAIL VLAN 1 (Default): IP 10.0.0.50 is used by 2 devices: ${X}, ${Y}`,
    ]);
    assert.deepStrictEqual(lines(memory([a(X, "192.168.40.7")])), [
      `WARN VLAN 1 (Default) carries 192.168.40.7 from ${X}: an address of another network`,
    ]);
  });
  test("PTP leaders, Dante names and VLAN, flooding", () => {
    const ptpFrom = (leader) => ({ t: 1, vlan: 60, src: "169.254.1.1", sport: 319, dport: 319, data: ptp1(leader) });
    assert.deepStrictEqual(lines(memory([], [ptpFrom(X)])), []);
    assert.deepStrictEqual(lines(memory([], [ptpFrom(X), ptpFrom(Y)])), [
      `WARN VLAN 60 (Dante): 2 PTPv1 clock leaders in 5 min: ${X}, ${Y}`,
    ]);
    const dante = (name, addr, vlan) => ({
      t: 1,
      vlan,
      src: addr,
      sport: 5353,
      dport: 5353,
      data: mdnsAnswer("_netaudio-arc._udp.local", name),
    });
    assert.deepStrictEqual(lines(memory([], [dante("Box", "169.254.1.1", 60), dante("Box", "169.254.1.2", 60)])), [
      'WARN 2 Dante devices named "Box": 169.254.1.1, 169.254.1.2',
    ]);
    assert.deepStrictEqual(lines(memory([], [dante("Box", "10.0.0.40", 1)])), [
      'WARN Dante device "Box" (10.0.0.40) on VLAN 1 (Default)',
    ]);
    const audio = (t) =>
      frame(
        eth(
          X,
          "01:00:5e:7f:00:01",
          0x0800,
          ipv4("169.254.1.1", "239.255.0.1", 17, udp(4321, 4321, Array(1400).fill(0))),
        ),
        t,
      );
    const flood = (n) => memory(Array.from({ length: n }, (_, i) => audio(i)));
    assert.deepStrictEqual(lines(flood(2)), []);
    assert.deepStrictEqual(lines(flood(1000)).length, 1); // ~11 Mbit in 1 s
    const ssdp = frame(
      eth(X, "01:00:5e:7f:ff:fa", 0x0800, ipv4("10.0.0.18", "239.255.255.250", 17, udp(1900, 1900, [1]))),
    );
    assert.deepStrictEqual(
      memory([ssdp]).filter((o) => o.kind === "flood"),
      [],
    );
  });
  test("LLDP, STP root and topology changes", () => {
    const info = results(memory([frame(eth(X, "01:80:c2:00:00:0e", 0x88cc, lldp))])).filter((r) => r.where === "LLDP");
    assert.deepStrictEqual(
      info.map((r) => r.msg),
      ["this computer is on Video switch port 12 (GreenGO MCX), VLAN 40 (Greengo)"],
    );
    const b = (root, tc, t) => frame(eth(X, "01:80:c2:00:00:00", 39, bpdu(root, tc)), t);
    assert.deepStrictEqual(lines(memory([b(X, false, 1)])), [
      `WARN STP root bridge is ${X}, not the core switch 48 Pro POE switch`,
    ]);
    const core = "ac:8b:a9:b1:db:a2";
    assert.deepStrictEqual(lines(memory([b(core, false, 1)])), []);
    assert.strictEqual(lines(memory([0, 1, 2, 3].map((i) => b(core, true, i * 10_000)))).length, 1);
  });
  test("every FAIL has a fix, every result has a device, old observations age out", () => {
    const obs = memory(
      [query(X, "10.0.0.9", 10)],
      [{ t: 1, vlan: 1, src: "10.0.0.77", mac: X, sport: 67, dport: 68, data: offer("10.0.0.77") }],
    );
    const { devices, results: rs } = runChecks(fixtureScan(obs), seed);
    assert.deepStrictEqual(
      rs.filter((r) => r.level === "FAIL" && !r.fix),
      [],
    );
    const ids = new Set(devices.map((d) => d.id));
    assert.deepStrictEqual(
      rs.filter((r) => !ids.has(r.device)),
      [],
    );
    const mem = new Map();
    observe(mem, [decode(query(X, "10.0.0.9", 10))], 1);
    age(mem, 1000 + 4 * 60_000);
    assert.strictEqual(mem.size, 1);
    age(mem, 1000 + 6 * 60_000);
    assert.strictEqual(mem.size, 0);
  });
});
