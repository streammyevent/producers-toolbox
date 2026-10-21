const { describe, test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const seed = require("../src/equipment.json");
const { forget, learn, networks, portCtx, runChecks } = require("../out/checks.js");
const { planChange, portTable } = require("../out/ports.js");
const { seal, unseal } = require("../out/creds.js");
const {
  bits,
  hexstr,
  hosts,
  ipLE,
  isRouterOs,
  parseArp,
  parseWinRoute,
  SWOS_REALM,
  swosParse,
} = require("../out/net.js");

const FIX = path.join(__dirname, "fixtures");
const ROS = path.join(FIX, "2026-10-07");
const load = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const startsWith = (s, prefix) => assert.ok(s?.startsWith(prefix), `"${s}" should start with "${prefix}"`);

/** The flypack on 2026-10-06: five switches on SwOS. */
function fixtureScan() {
  const switches = fs
    .readdirSync(FIX)
    .filter((f) => f.startsWith("SWITCH"))
    .sort()
    .map((f) => {
      const pages = load(FIX, f);
      return { ip: ipLE(pages.sys.cip), os: "swos", pages: { ...pages, "!igmp": [], "!dhost": [] } };
    });
  return {
    network: {
      name: "en7",
      address: "10.0.0.201",
      cidr: "10.0.0.201/24",
      mac: "6c:1f:f7:bb:ac:6f",
      gateway: "10.0.0.1",
    },
    unifi: load(FIX, "unifi.json"),
    switches,
    switchErrors: [],
  };
}

/** The flypack on 2026-10-07: all five switches on RouterOS 7. */
function rosScan() {
  return {
    network: {
      name: "en10",
      address: "10.0.0.201",
      cidr: "10.0.0.201/24",
      mac: "6c:1f:f7:bb:ac:6f",
      gateway: "10.0.0.1",
    },
    unifi: load(ROS, "unifi.json"),
    switches: fs
      .readdirSync(ROS)
      .filter((f) => f.startsWith("SWITCH"))
      .sort()
      .map((f) => load(ROS, f)),
    switchErrors: [],
  };
}

/** Compares with the snapshot in `dir`; regenerate on purpose with UPDATE_SNAPSHOT=1 pnpm test. */
function snapshot(dir, got) {
  const file = path.join(dir, "expected.json");
  if (process.env.UPDATE_SNAPSHOT) fs.writeFileSync(file, JSON.stringify(got, null, 1) + "\n");
  assert.deepStrictEqual(got, JSON.parse(fs.readFileSync(file, "utf8")));
}

describe("swos parser", () => {
  test("decodes JS literals", () => {
    const d = swosParse("{id:'5357495443483031',prio:0x8000,spd:[0x02,0x07],nm:['506f727431']}");
    assert.strictEqual(hexstr(d.id), "SWITCH01");
    assert.strictEqual(d.prio, 32768);
    assert.deepStrictEqual(d.spd, [2, 7]);
    assert.strictEqual(hexstr(d.nm[0]), "Port1");
    assert.strictEqual(swosParse("[{adr:'488f5a0c45f0',vid:0x003c}]")[0].vid, 60);
    assert.strictEqual(swosParse(""), null);
  });
  test("bitmasks and little-endian IPs", () => {
    assert.deepStrictEqual(bits(0x05000000, 28), [25, 27]);
    assert.strictEqual(bits(0x0fffffff, 28).length, 28);
    assert.strictEqual(ipLE(0xfe7f02e0), "224.2.127.254");
    assert.strictEqual(ipLE(0x6600000a), "10.0.0.102");
  });
});

describe("network detection", () => {
  test("arp on macOS", () => {
    const t = parseArp(
      "? (10.0.0.1) at d8:b3:70:29:7e:34 on en7 ifscope [ethernet]\n? (10.0.0.220) at 8:55:31:ca:8d:a on en7 ifscope [ethernet]\n? (10.0.0.5) at (incomplete) on en7",
    );
    assert.strictEqual(t.get("10.0.0.220"), "08:55:31:ca:8d:0a");
    assert.strictEqual(t.size, 2);
  });
  test("arp on Windows", () => {
    const t = parseArp(
      "Interface: 10.0.0.50 --- 0x5\n  Internet Address      Physical Address      Type\n  10.0.0.1              d8-b3-70-29-7e-34     dynamic\n  10.0.0.102            48-8f-5a-0c-18-1c     dynamic\n",
    );
    assert.strictEqual(t.get("10.0.0.102"), "48:8f:5a:0c:18:1c");
  });
  test("SwOS login challenge", () => {
    assert.strictEqual(
      SWOS_REALM.test('Digest realm="CSS328-24P-4S+", qop="auth", nonce="01bead0b", stale=FALSE'),
      true,
    );
    assert.strictEqual(SWOS_REALM.test('Digest realm="CRS326-24G-2S+"'), true);
    assert.strictEqual(SWOS_REALM.test('Digest realm="Dante Controller"'), false);
    assert.strictEqual(SWOS_REALM.test(""), false);
  });
  test("RouterOS REST challenge", () => {
    assert.strictEqual(isRouterOs(401, "Basic", '{"error":401,"message":"Unauthorized"}'), true);
    assert.strictEqual(isRouterOs(401, 'Basic realm="camera"', "<html>"), false);
    assert.strictEqual(isRouterOs(404, "", '{"error":404}'), false);
  });
  test("default gateway on Windows picks the lowest metric", () => {
    const out =
      "Active Routes:\nNetwork Destination        Netmask          Gateway       Interface  Metric\n          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.50     35\n          0.0.0.0          0.0.0.0         10.0.0.1      10.0.0.50     25\n";
    assert.strictEqual(parseWinRoute(out), "10.0.0.1");
  });
  test("subnet sweep", () => {
    assert.strictEqual(hosts("10.0.0.201/24").length, 254);
    assert.strictEqual(hosts("192.168.28.5/22").length, 1022);
    assert.strictEqual(hosts("10.4.3.2/16")[0], "10.4.3.1");
  });
});

describe("credentials", () => {
  const creds = { switchUser: "admin", switchPass: "a", unifiUser: "b", unifiPass: "c" };
  test("round trip", async () => {
    assert.deepStrictEqual(await unseal(await seal(creds, "flypack-123"), "flypack-123"), creds);
  });
  test("wrong code throws", async () => {
    await assert.rejects(async () => unseal(await seal(creds, "flypack-123"), "wrong-code"));
  });
});

describe("checks", () => {
  const verdicts = (results) =>
    results
      .filter((r) => r.level !== "INFO")
      .map((r) => `${r.level} ${r.where} ${r.msg}`)
      .sort();
  const renamed = (from, to) => {
    const scan = fixtureScan();
    scan.unifi["rest/networkconf"] = scan.unifi["rest/networkconf"].map((n) =>
      n.name === from ? { ...n, name: to } : n,
    );
    return scan;
  };

  test("verdicts on the 2026-10-06 snapshot", () => {
    snapshot(FIX, verdicts(runChecks(fixtureScan(), seed).results));
  });
  test("every FAIL has a fix", () => {
    const { results } = runChecks(fixtureScan(), seed);
    assert.deepStrictEqual(
      results.filter((r) => r.level === "FAIL" && !r.fix),
      [],
    );
  });
  test("critical VLANs follow the network name, not the VID", () => {
    assert.deepStrictEqual(networks(fixtureScan().unifi).critical, new Set([60, 40]));
    const ctx = networks(renamed("Tech", "Control room").unifi);
    assert.deepStrictEqual(ctx.critical, new Set([60, 40, 30]));
    const querier = (scan) => runChecks(scan, seed).results.find((r) => r.msg.startsWith("IGMP querier active")).msg;
    assert.ok(querier(fixtureScan()).endsWith("critical VLANs without querier: 40, 60"));
    assert.ok(querier(renamed("Dante", "Audio")).endsWith("critical VLANs without querier: 40"));
  });
  test("no critical network name gives a warning", () => {
    const scan = renamed("Dante", "Audio");
    scan.unifi["rest/networkconf"] = scan.unifi["rest/networkconf"].map((n) =>
      n.name === "Greengo" ? { ...n, name: "Intercom" } : n,
    );
    assert.ok(
      runChecks(scan, seed).results.some((r) => r.level === "WARN" && r.msg.startsWith("no critical VLAN found")),
    );
    assert.ok(!runChecks(fixtureScan(), seed).results.some((r) => r.msg.startsWith("no critical VLAN found")));
  });
  test("equipment inventory and wrong-VLAN warning", () => {
    const scan = fixtureScan();
    const { results, seen } = runChecks(scan, seed);
    assert.strictEqual(seen.filter((s) => s.equipment?.type === "Dante device (Audinate)").length, 4);
    assert.strictEqual(seen.find((s) => s.mac === scan.network.mac)?.name, "this computer");
    // port MAC 48:8f:5a:0c:18:36 folds into SWITCH01
    assert.strictEqual(seen.filter((s) => s.equipment?.type === "MikroTik switch").length, 5);
    assert.ok(!results.some((r) => r.msg.startsWith("Adder KVM on")));
    for (const vlan of [[70], ["KVM"]]) {
      const moved = runChecks(
        scan,
        seed.map((e) => (e.oui === "00:0f:58" ? { ...e, vlan } : e)),
      ).results;
      assert.strictEqual(moved.filter((r) => r.msg.startsWith("Adder KVM on VLAN 30 (Tech)")).length, 3);
    }
    assert.ok(!runChecks(renamed("Tech", "TECH"), seed).results.some((r) => r.msg.startsWith("Adder KVM on")));
  });
  test("learn adds unknown OUIs once, by network name", () => {
    const known = seed.filter((e) => e.type); // without entries learned in dev
    const { seen } = runChecks(fixtureScan(), known);
    const after = learn(seen, known);
    const added = after.slice(known.length);
    assert.ok(added.map((e) => e.oui).includes("00:60:35"));
    assert.ok(added.flatMap((e) => e.vlan).every((v) => typeof v === "string"));
    assert.strictEqual(new Set(added.map((e) => e.oui)).size, added.length);
    assert.strictEqual(learn(runChecks(fixtureScan(), after).seen, after).length, after.length);
  });
  test("every result belongs to a device card", () => {
    for (const scan of [fixtureScan(), { ...fixtureScan(), unifi: null, switches: [] }]) {
      const { devices, results } = runChecks(scan, seed);
      const ids = new Set(devices.map((d) => d.id));
      assert.deepStrictEqual(
        results.filter((r) => !ids.has(r.device)),
        [],
      );
    }
  });
  test("one device per endpoint, network gear only once", () => {
    const { devices, seen } = runChecks(fixtureScan(), seed);
    const ids = devices.map((d) => d.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.ok(devices.filter((d) => d.kind === "mikrotik").length > 0);
    const swMacs = seen.filter((s) => s.equipment?.type === "MikroTik switch").map((s) => s.mac);
    assert.ok(swMacs.length > 0);
    assert.deepStrictEqual(
      swMacs.filter((m) => ids.includes(m)),
      [],
    );
    assert.strictEqual(devices.filter((d) => d.kind === "equipment").length, seen.length - swMacs.length);
  });
  test("a switch that does not answer is still one device", () => {
    const scan = fixtureScan();
    const [sw, ...rest] = scan.switches;
    const failed = { ...scan, switches: rest, switchErrors: [{ ip: sw.ip, msg: "timeout" }] };
    const { devices, seen } = runChecks(failed, seed);
    const ids = new Set(devices.map((d) => d.id));
    assert.ok(ids.has(sw.ip));
    assert.deepStrictEqual(
      seen.filter((s) => s.ip === sw.ip && ids.has(s.mac)),
      [],
    );
    assert.deepStrictEqual(
      devices.filter((d) => d.kind === "equipment" && d.title === "MikroTik switch"),
      [],
    );
  });
  test("works without UniFi", () => {
    const scan = { ...fixtureScan(), unifi: null, unifiError: "timeout" };
    const { results } = runChecks(scan, seed);
    assert.strictEqual(results.find((r) => r.device === "UniFi")?.level, "FAIL");
    assert.ok(!results.some((r) => r.msg.startsWith("STP root")));
    assert.ok(!results.some((r) => r.msg.includes("is not a UniFi network")));
  });
});

describe("missing devices", () => {
  const dante = "00:1d:c1";
  const without = (prefix) => {
    const scan = fixtureScan();
    scan.unifi["stat/sta"] = scan.unifi["stat/sta"].filter((c) => !c.mac.startsWith(prefix));
    return scan;
  };
  const missing = (results) => results.filter((r) => r.msg.startsWith("missing since"));
  /** Runs the scans in order on one memory, returns the missing-device results of the last one. */
  const after = (known, ...scans) => missing(scans.map((s) => runChecks(s, seed, known))[scans.length - 1].results);

  test("reported after two scans in a row, FAIL on a critical VLAN", () => {
    const known = new Map();
    assert.deepStrictEqual(missing(runChecks(fixtureScan(), seed, known).results), []);
    assert.deepStrictEqual(missing(runChecks(without(dante), seed, known).results), []);
    const { devices, results } = runChecks(without(dante), seed, known);
    const gone = missing(results);
    assert.strictEqual(gone.length, 4);
    assert.ok(gone.every((r) => r.level === "FAIL" && r.device.startsWith(dante) && r.fix));
    assert.ok(gone.every((r) => devices.find((d) => d.id === r.device)?.subtitle === "missing"));
    assert.deepStrictEqual(missing(runChecks(fixtureScan(), seed, known).results), []);
  });
  test("a non-critical device gives a WARN", () => {
    const known = new Map();
    assert.deepStrictEqual(
      after(known, fixtureScan(), without("00:0f:58"), without("00:0f:58")).map((r) => r.level),
      ["WARN", "WARN", "WARN"],
    );
  });
  test("wireless clients are not tracked", () => {
    const known = new Map();
    const scan = fixtureScan();
    scan.unifi["stat/sta"] = scan.unifi["stat/sta"].map((c) =>
      c.mac.startsWith(dante) ? { ...c, is_wired: false, network_id: "guest" } : c,
    );
    assert.deepStrictEqual(after(known, scan, without(dante), without(dante)), []);
  });
  test("a failed UniFi read does not report its clients as missing", () => {
    const known = new Map();
    const down = { ...fixtureScan(), unifi: null, unifiError: "timeout" };
    assert.deepStrictEqual(after(known, fixtureScan(), down, down, down), []);
  });
  test("a UniFi device that goes offline is reported on its own card", () => {
    const known = new Map();
    const off = () => {
      const scan = fixtureScan();
      scan.unifi["stat/device"] = scan.unifi["stat/device"].map((d) =>
        d.name === "SME - Regieset Klein 2M/E" ? { ...d, state: 0 } : d,
      );
      return scan;
    };
    assert.ok(
      after(known, fixtureScan(), off(), off())
        .map((r) => r.device)
        .includes("SME - Regieset Klein 2M/E"),
    );
  });
  test("forget clears missing devices", () => {
    const known = new Map();
    after(known, fixtureScan(), without(dante), without(dante));
    forget(known);
    assert.deepStrictEqual(after(known, without(dante)), []);
  });
});

describe("RouterOS", () => {
  const verdicts = (scan) =>
    runChecks(scan, seed)
      .results.filter((r) => r.level !== "INFO")
      .map((r) => `${r.level} ${r.where} ${r.msg}`)
      .sort();
  /** rosScan() with SWITCH05 changed by `fn`. */
  const edit = (fn) => {
    const scan = rosScan();
    fn(scan.switches[4].ros);
    return runChecks(scan, seed).results.filter((r) => r.device === "SWITCH05");
  };
  const has = (results, level, start) => results.some((r) => r.level === level && r.msg.startsWith(start));

  test("verdicts on the 2026-10-07 snapshot", () => {
    snapshot(ROS, verdicts(rosScan()));
  });
  test("the standard config passes", () => {
    const { results } = runChecks(rosScan(), seed);
    assert.deepStrictEqual(
      results.filter((r) => r.device.startsWith("SWITCH") && ["FAIL", "WARN"].includes(r.level)),
      [],
    );
    assert.strictEqual(results.filter((r) => r.level === "PASS" && r.msg.startsWith("strict-priority QoS")).length, 5);
  });
  test("one device per switch, its MACs fold into it", () => {
    const { devices } = runChecks(rosScan(), seed);
    assert.deepStrictEqual(
      devices.filter((d) => d.kind === "mikrotik").map((d) => d.subtitle),
      [102, 185, 243, 210, 220].map((n) => `CRS328-24P-4S+ · RouterOS 7.24.5 · 10.0.0.${n}`),
    );
    assert.deepStrictEqual(
      devices.filter((d) => d.kind === "equipment" && d.id.startsWith("48:8f:5a")),
      [],
    );
  });
  test("every FAIL has a fix, every result has a device", () => {
    const { devices, results } = runChecks(rosScan(), seed);
    const ids = new Set(devices.map((d) => d.id));
    assert.deepStrictEqual(
      results.filter((r) => !ids.has(r.device) || (r.level === "FAIL" && !r.fix)),
      [],
    );
  });
  test("VLAN filtering off", () => {
    assert.ok(
      has(
        edit((r) => (r["interface/bridge"][0]["vlan-filtering"] = "false")),
        "FAIL",
        "VLAN filtering off",
      ),
    );
  });
  test("port switched by the CPU", () => {
    const res = edit((r) => (r["interface/bridge/port"].find((p) => p.interface === "ether3")["hw-offload"] = "false"));
    startsWith(res.find((r) => r.msg.includes("switched by the CPU"))?.msg, "ports ether3 ");
  });
  test("100M link: FAIL without QoS, INFO with QoS", () => {
    const slow = (r) => (r["interface/ethernet/monitor"].find((l) => l.name === "ether3").rate = "100Mbps");
    assert.ok(has(edit(slow), "INFO", "strict-priority QoS for DSCP 56, 46 in hardware; ≤100M links ether3"));
    const noQos = edit((r) => {
      slow(r);
      r["interface/ethernet/switch/qos/map/ip"] = [];
    });
    assert.ok(has(noQos, "FAIL", "≤100M links ether3 and no strict-priority QoS"));
    assert.ok(
      has(
        edit((r) => (r["interface/ethernet/switch"][0]["qos-hw-offloading"] = "false")),
        "WARN",
        "no strict-priority QoS",
      ),
    );
  });
  test("querier on the switch", () => {
    assert.ok(
      has(
        edit((r) => (r["interface/bridge"][0]["multicast-querier"] = "true")),
        "FAIL",
        "IGMP querier ON",
      ),
    );
    assert.ok(
      has(
        edit((r) => (r["interface/bridge"][0]["igmp-snooping"] = "false")),
        "FAIL",
        "IGMP snooping off",
      ),
    );
  });
  test("STP root elsewhere", () => {
    const res = edit((r) => (r["interface/bridge/monitor"][0]["root-bridge-id"] = "0x8000.48:8F:5A:0C:18:1C"));
    assert.ok(has(res, "FAIL", "STP root is 48:8f:5a:0c:18:1c"));
  });
  test("access PVID without a bridge VLAN entry", () => {
    const res = edit(
      (r) => (r["interface/bridge/vlan"] = r["interface/bridge/vlan"].filter((v) => v["vlan-ids"] !== "60")),
    );
    assert.ok(has(res, "FAIL", "access ports with PVID 60 "));
  });
});

describe("port change", () => {
  const LAPTOP = "c8:a3:62:31:45:81"; // on SWITCH05 ether3 in the fixture
  const setup = (mac = "6c:1f:f7:bb:ac:6f") => {
    const scan = rosScan();
    scan.network.mac = mac;
    const ros = scan.switches[4].ros; // SWITCH05
    return { ros, ctx: portCtx(scan, runChecks(scan, seed).seen) };
  };
  const plan = (port, target, mac) => {
    const { ros, ctx } = setup(mac);
    return planChange(ros, ctx, port, target);
  };
  const ops = (port, target) => {
    const p = plan(port, target);
    if ("error" in p) throw new Error(p.error);
    return p.ops;
  };
  const vlanOp = (o, id) => o.find((x) => x.path === `interface/bridge/vlan/${id}`)?.body;
  const { ros } = setup();
  const entry = (vid) => ros["interface/bridge/vlan"].find((v) => v["vlan-ids"] === vid)[".id"];

  test("ether9 Dante → GreenGo", () => {
    const o = ops("ether9", 40);
    assert.deepStrictEqual(
      o.map((x) => x.method),
      ["PATCH", "PATCH", "PATCH"],
    );
    assert.ok(vlanOp(o, entry("40")).untagged.split(",").includes("ether9"));
    assert.strictEqual(o[1].body.pvid, "40");
    assert.strictEqual(o[1].body["frame-types"], "admit-only-untagged-and-priority-tagged");
    assert.ok(!vlanOp(o, entry("60")).untagged.split(",").includes("ether9"));
  });
  test("to Management (VLAN 1) needs no bridge VLAN entry", () => {
    const o = ops("ether9", 1);
    assert.ok(!o.some((x) => x.method === "PUT"));
    assert.strictEqual(o.find((x) => x.path.startsWith("interface/bridge/port/")).body.pvid, "1");
    assert.deepStrictEqual(
      o.filter((x) => x.body.untagged?.split(",").includes("ether9")),
      [],
    );
  });
  test("a UniFi VLAN without a bridge entry gets one, tagged on every trunk", () => {
    const { ros, ctx } = setup();
    ros["interface/bridge/vlan"] = ros["interface/bridge/vlan"].filter((v) => v["vlan-ids"] !== "50");
    const p = planChange(ros, ctx, "ether5", 50);
    if ("error" in p) throw new Error(p.error);
    assert.deepStrictEqual(p.ops[0], {
      method: "PUT",
      path: "interface/bridge/vlan",
      body: {
        bridge: "bridge",
        "vlan-ids": "50",
        tagged: "ether1,ether2,sfp-sfpplus1,sfp-sfpplus2,sfp-sfpplus3,sfp-sfpplus4",
        untagged: "ether5",
      },
    });
  });
  test("refused", () => {
    const err = (p) => ("error" in p ? p.error : "allowed");
    startsWith(err(plan("ether1", 60)), "Trunk port");
    startsWith(err(plan("ether2", 60)), "Trunk port");
    assert.strictEqual(err(plan("ether5", 99)), "VLAN 99 is not a network in UniFi.");
    // bridge entry exists, UniFi network does not
    assert.strictEqual(err(plan("ether5", 70)), "VLAN 70 is not a network in UniFi.");
    assert.strictEqual(err(plan("ether5", "trunk")), "Only SFP+ ports can be set to trunk.");
    assert.strictEqual(err(plan("sfp-sfpplus3", 60)), "Uplink to the core switch.");
    assert.strictEqual(err(plan("sfp-sfpplus1", 60)), "Link to SWITCH01, SWITCH02, SWITCH03, SWITCH04.");
    assert.strictEqual(err(plan("ether3", 60, LAPTOP)), "This computer is connected to this port.");
    assert.strictEqual(err(plan("ether3", 60)), "allowed");
    startsWith(err(plan("ether48", 60)), "Port ether48 is not");
    const { ros } = setup();
    startsWith(err(planChange(ros, { ...setup().ctx, nets: new Map() }, "ether5", 60)), "No VLAN list from UniFi");
  });
  test("same VLAN sends nothing", () => {
    assert.deepStrictEqual(ops("ether9", 60), []);
  });
  test("free SFP+ to Dante and back to trunk", () => {
    const o = ops("sfp-sfpplus2", 60);
    assert.ok(vlanOp(o, entry("60")).untagged.includes("sfp-sfpplus2"));
    assert.deepStrictEqual(
      o.filter((x) => x.body.tagged?.split(",").includes("sfp-sfpplus2")),
      [],
    );
    const { ros, ctx } = setup();
    const port = ros["interface/bridge/port"].find((p) => p.interface === "sfp-sfpplus2");
    Object.assign(port, { pvid: "60", "frame-types": "admit-only-untagged-and-priority-tagged" });
    for (const v of ros["interface/bridge/vlan"]) {
      v.tagged = v.tagged
        .split(",")
        .filter((x) => x !== "sfp-sfpplus2")
        .join(",");
    }
    const back = planChange(ros, ctx, "sfp-sfpplus2", "trunk");
    if ("error" in back) throw new Error(back.error);
    assert.strictEqual(back.from, 60);
    assert.strictEqual(back.ops[0].body.pvid, "1");
    assert.strictEqual(back.ops[0].body["frame-types"], "admit-all");
    const statics = ros["interface/bridge/vlan"].filter((v) => v.dynamic !== "true").length;
    assert.strictEqual(back.ops.filter((x) => x.body.tagged?.split(",").includes("sfp-sfpplus2")).length, statics);
  });
  test("every RouterOS switch has a port table; locked ports say why", () => {
    const { devices } = runChecks(rosScan(), seed);
    const switches = devices.filter((d) => d.kind === "mikrotik");
    assert.ok(switches.every((d) => d.ports?.length === 28));
    for (const d of switches) {
      assert.ok(
        d.ports.filter((p) => ["ether1", "ether2"].includes(p.name)).every((p) => p.vlan === "trunk" && p.locked),
      );
      assert.strictEqual(d.ports.find((p) => p.name === "ether9").vlan, 60);
    }
    const { ctx } = setup(LAPTOP);
    assert.deepStrictEqual(
      portTable(ros, ctx)
        .filter((p) => p.locked)
        .map((p) => p.name),
      ["ether1", "ether2", "ether3", "sfp-sfpplus1", "sfp-sfpplus3"],
    );
  });
});
