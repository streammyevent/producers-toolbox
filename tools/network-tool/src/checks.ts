import { bits, hexstr, ipLE, normMac, type Scan, type Switch } from "./net";
import { portTable, vidList, type Port, type PortCtx } from "./ports";

// A critical VLAN carries multicast-sensitive traffic. The UniFi network name decides it.
export const CRITICAL = /dante|greengo|kvm|control/i;
const CRITICAL_NAMES = "Dante, GreenGo, KVM or Control";
// Scans in a row without a device before it counts as missing; tables like ARP and SwOS dhost age out.
const MISS_LIMIT = 2;
const SPEED: Record<number, string> = { 0: "10M", 1: "100M", 2: "1G", 3: "10G", 4: "2.5G", 5: "5G", 7: "-" };
const ASK = "If you can't fix this, report it to the network lead.";
// macOS blocks local network access until the user allows it once (Local Network privacy).
const MAC_LAN =
  "On a Mac, also open System Settings → Privacy & Security → Local Network and turn on Producers Toolbox.";

export type Level = "FAIL" | "WARN" | "PASS" | "INFO";
export type Result = { level: Level; device: string; where: string; msg: string; fix?: string };
export type Device = {
  id: string;
  title: string;
  subtitle: string;
  kind: "unifi" | "mikrotik" | "equipment";
  ports?: Port[];
};
/** `vlan` entries: a number matches the VID, a string matches the UniFi network name. */
export type Equipment = { mac?: string; oui?: string; type: string; vendor?: string; vlan: (number | string)[] };
export type Seen = {
  mac: string;
  vlan: number;
  network?: string;
  ip?: string;
  name?: string;
  vendor?: string;
  wired: boolean;
  fromUnifi: boolean;
  equipment?: Equipment;
};
type Tracked = { device: string; label: string; vlan: number; fromUnifi: boolean };
export type Known = Map<string, Tracked & { at: string; misses: number }>;
type Nets = { nets: Map<number, string>; critical: Set<number> };

const list = (xs: (string | number)[]) => xs.join(", ");
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function networks(u: Record<string, any[]> | null): Nets {
  const nets = new Map<number, string>();
  for (const n of u?.["rest/networkconf"] ?? []) if (n.purpose !== "wan") nets.set(Number(n.vlan) || 1, n.name);
  return { nets, critical: new Set([...nets].filter(([, name]) => CRITICAL.test(name)).map(([v]) => v)) };
}

/** The flypack core is the largest online UniFi switch. */
export function coreMac(u: Record<string, any[]>) {
  const devs = u["stat/device"];
  const max = Math.max(...devs.map((d) => d.port_table?.length ?? 0));
  return devs.find((d) => d.type === "usw" && d.state === 1 && (d.port_table?.length ?? 0) === max)?.mac as
    string | undefined;
}

export function runChecks(
  scan: Scan,
  equipment: Equipment[],
  known: Known = new Map(),
  now = new Date().toISOString(),
) {
  const results: Result[] = [];
  const devices: Device[] = [];
  const add = (level: Level, device: string, where: string, msg: string, fix?: string) =>
    results.push({ level, device, where, msg, fix });
  const ctx = networks(scan.unifi);

  let queriers: Set<number> | null = null;
  const core = scan.unifi ? coreMac(scan.unifi) : undefined;
  if (scan.unifi && core) {
    queriers = auditUnifi(scan.unifi, core, ctx, add, devices);
  } else {
    devices.push({ id: "UniFi", title: "UniFi network", subtitle: scan.network.gateway, kind: "unifi" });
    add(
      "FAIL",
      "UniFi",
      "UniFi",
      scan.unifiError
        ? `can't read UniFi at ${scan.network.gateway}: ${scan.unifiError}`
        : "no online UniFi core switch found",
      `Check that this computer is connected to the management network of the flypack (VLAN 1) and that the UniFi gateway is on. Without UniFi data the switch checks are incomplete. ${MAC_LAN}`,
    );
  }

  if (!scan.switches.length && !scan.switchErrors.length)
    devices.push({ id: "MikroTik", title: "MikroTik switches", subtitle: scan.network.cidr, kind: "mikrotik" });
  if (!scan.switches.length && !scan.switchErrors.length)
    add(
      "WARN",
      "MikroTik",
      "MikroTik",
      "no MikroTik switches found",
      `No MikroTik switches answered. If switches are patched in, check that their uplink is on a trunk port and that they get an IP on the management network. ${MAC_LAN}`,
    );
  for (const { ip, msg } of scan.switchErrors) {
    devices.push({ id: ip, title: `MikroTik ${ip}`, subtitle: "no answer", kind: "mikrotik" });
    add(
      "WARN",
      ip,
      ip,
      `MikroTik device, but no switch data (${msg})`,
      `This MikroTik device did not answer as a SwOS or RouterOS switch. Check that it uses the standard password. ${ASK}`,
    );
  }
  for (const sw of scan.switches) {
    if (sw.os === "swos") auditSwos(sw, queriers, core, ctx, add, devices);
    else auditRouterOS(sw, queriers, core, ctx, add, devices);
  }

  const seen = inventory(scan, equipment);
  const owner = owners(scan, seen);
  for (const s of seen) {
    if (owner.has(s.mac)) continue;
    const what = s.equipment?.type || s.vendor;
    const title = s.name || what || s.mac;
    devices.push({
      id: s.mac,
      title,
      subtitle: [what !== title && what, s.ip ?? s.mac, vlanName(ctx, s.vlan)].filter(Boolean).join(" · "),
      kind: "equipment",
    });
    add(
      "INFO",
      s.mac,
      s.mac,
      [
        s.mac,
        s.ip,
        vlanName(ctx, s.vlan),
        s.vendor,
        s.wired ? "wired" : "wireless",
        !s.equipment && s.name !== "this computer" && "not in equipment.json",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  auditEquipment(seen, ctx, add);
  track(known, scan, seen, ctx, now, add, devices, owner);
  // A switch or UniFi device also shows up as a client; its results go to its own row.
  for (const r of results) r.device = owner.get(r.device) ?? r.device;
  const pctx = portCtx(scan, seen);
  for (const sw of scan.switches) {
    const dev = devices.find((d) => d.id === swInfo(sw).id);
    if (dev && sw.os === "routeros") dev.ports = portTable(sw.ros, pctx);
  }
  const nets = [...ctx.nets]
    .sort(([a], [b]) => a - b)
    .map(([vid, name]) => ({ vid, name, critical: ctx.critical.has(vid) }));
  return { devices, results, seen, networks: nets };
}

/** What the port table and the port change need to know about the rest of the network. */
export function portCtx(scan: Scan, seen: Seen[]): PortCtx {
  const owner = owners(scan, seen);
  const macNum = (m: string) => parseInt(m.replaceAll(":", ""), 16);
  // Switches and UniFi gear also send from MACs just above their base MAC.
  const bases = [
    ...scan.switches.map((sw) => swInfo(sw)).map(({ mac, id }) => ({ n: macNum(mac), id })),
    ...(scan.unifi?.["stat/device"] ?? []).map((d) => ({ n: macNum(d.mac), id: d.name as string })),
  ];
  const bySeen = new Map(seen.map((s) => [s.mac, s]));
  return {
    nets: networks(scan.unifi).nets,
    gear: (mac) => owner.get(mac) ?? bases.find((b) => macNum(mac) >= b.n && macNum(mac) <= b.n + 32)?.id,
    label: (mac) => (bySeen.has(mac) ? seenLabel(bySeen.get(mac)!) : undefined),
    me: scan.network.mac,
  };
}

/** MAC → device id for the network gear, which also appears in the client lists. */
function owners(scan: Scan, seen: Seen[]) {
  const owner = new Map<string, string>();
  const ips = new Map<string, string>(scan.switchErrors.map((e) => [e.ip, e.ip]));
  for (const sw of scan.switches) {
    const { id, mac, ip } = swInfo(sw);
    owner.set(mac, id);
    ips.set(ip, id);
  }
  for (const d of scan.unifi?.["stat/device"] ?? []) owner.set(d.mac, d.name);
  for (const s of seen) if (s.ip && ips.has(s.ip)) owner.set(s.mac, ips.get(s.ip)!);
  // Switches also send from MACs just above their base MAC (per port, per VLAN interface).
  const macNum = (m: string) => parseInt(m.replaceAll(":", ""), 16);
  const bases = [...owner].map(([mac, id]) => ({ n: macNum(mac), id }));
  for (const s of seen) {
    const n = macNum(s.mac);
    const gear = !s.ip && bases.find((b) => n > b.n && n <= b.n + 32);
    if (gear) owner.set(s.mac, gear.id);
  }
  return owner;
}

/** Name, base MAC, IP, model and OS of a switch, for both SwOS and RouterOS. */
export function swInfo(sw: Switch) {
  if (sw.os === "swos") {
    const s = sw.pages.sys;
    return {
      id: hexstr(s.id),
      mac: normMac(s.mac.match(/../g).join(":")),
      ip: s.cip ? ipLE(s.cip) : sw.ip,
      model: hexstr(s.brd),
      os: `SwOS ${hexstr(s.ver)}`,
    };
  }
  const r = sw.ros;
  return {
    id: r["system/identity"].name as string,
    mac: normMac(r["interface/bridge"][0]["mac-address"]),
    ip: sw.ip,
    model: r["system/routerboard"].model as string,
    os: `RouterOS ${r["system/resource"].version.split(" ")[0]}`,
  };
}

function vlanName({ nets }: Nets, v: number) {
  return `VLAN ${v}${nets.has(v) ? ` (${nets.get(v)})` : ""}`;
}

const seenLabel = (s: Seen) => [s.equipment?.type || s.vendor, s.name, s.ip ?? s.mac].filter(Boolean).join(" · ");

// --- UniFi ------------------------------------------------------------------

type Add = (level: Level, device: string, where: string, msg: string, fix?: string) => void;

function auditUnifi(u: Record<string, any[]>, coreMacAddr: string, ctx: Nets, add: Add, devices: Device[]) {
  const lan = u["rest/networkconf"].filter((n) => n.purpose !== "wan");
  const criticalIds = new Set(lan.filter((n) => ctx.critical.has(Number(n.vlan) || 1)).map((n) => n._id as string));
  const igmp = u["rest/setting"].find((s) => s.key === "igmp_snooping") ?? {};
  const devs = new Map(u["stat/device"].map((d) => [d.mac as string, d]));
  const core = devs.get(coreMacAddr).name as string;
  const igmpFix = `In UniFi: Settings → Networks → Global Switch Settings → IGMP Snooping. Select all networks, and set only "${core}" as querier. ${ASK}`;

  devices.push({ id: "UniFi", title: "UniFi network", subtitle: "VLANs, IGMP and multicast settings", kind: "unifi" });
  for (const d of devs.values())
    devices.push({
      id: d.name,
      title: d.name,
      subtitle: `${d.model} · ${d.ip}${d.mac === coreMacAddr ? " · core switch" : ""}`,
      kind: "unifi",
    });

  const defined = [...ctx.nets.keys()].sort((a, b) => a - b);
  add(
    "INFO",
    "UniFi",
    "UniFi",
    `networks: ${list(defined.map((v) => `${ctx.nets.get(v)} (${v}${ctx.critical.has(v) ? ", critical" : ""})`))}`,
  );
  if (!ctx.critical.size)
    add(
      "WARN",
      "UniFi",
      "UniFi",
      `no critical VLAN found: no network is named ${CRITICAL_NAMES}`,
      `The tool finds the critical VLANs by their network name. In UniFi: Settings → Networks. Check that the Dante, GreenGo, KVM and Control networks have these names. ${ASK}`,
    );

  // Policy: the flypack core switch is the only querier, on every VLAN.
  const qs: string[] = igmp.querier_switches ?? [];
  if (!qs.includes(coreMacAddr))
    add("FAIL", "UniFi", "UniFi", `core switch ${core} is not a configured IGMP querier`, igmpFix);
  for (const mac of qs.filter((m) => m !== coreMacAddr)) {
    const d = devs.get(mac);
    add(
      "WARN",
      "UniFi",
      "UniFi",
      `extra querier switch ${d ? d.name : mac} configured${!d || d.state !== 1 ? " (offline)" : ""}; keep only ${core}`,
      igmpFix,
    );
  }
  const queriers = new Map<number, string[]>();
  for (const d of devs.values()) {
    for (const q of d.igmp_snoop_table?.querier ?? []) {
      if ((q.querier_ip ?? "").includes(":")) continue; // MLD (IPv6) entry
      queriers.set(q.vlan, [...(queriers.get(q.vlan) ?? []), d.name]);
    }
  }
  for (const [vid, who] of queriers) {
    if (who.length !== 1 || who[0] !== core)
      add("WARN", "UniFi", "UniFi", `VLAN ${vid} querier is ${list(who)}, expected only ${core}`, igmpFix);
  }
  const missing = defined.filter((v) => !queriers.has(v));
  const criticalMissing = missing.filter((v) => ctx.critical.has(v));
  add(
    criticalMissing.length ? "FAIL" : "PASS",
    "UniFi",
    "UniFi",
    `IGMP querier active on VLANs ${list([...queriers.keys()].sort((a, b) => a - b))}; critical VLANs without querier: ${criticalMissing.length ? list(criticalMissing) : "none"}`,
    criticalMissing.length ? `Audio, video and intercom on these VLANs can drop out. ${igmpFix}` : undefined,
  );
  const other = missing.filter((v) => !criticalMissing.includes(v));
  if (other.length) add("WARN", "UniFi", "UniFi", `other VLANs without querier: ${list(other)}`, igmpFix);
  const flooded = new Set<string>(igmp.flood_unknown_multicast_for_network_ids ?? []);
  if (igmp.enabled && criticalMissing.length && ![...criticalIds].some((id) => flooded.has(id)))
    add(
      "FAIL",
      "UniFi",
      "UniFi",
      "snooping on, no querier and no unknown-multicast flooding on critical VLANs",
      igmpFix,
    );

  for (const d of devs.values()) {
    if (d.state !== 1) {
      add("INFO", d.name, d.name, `offline (${d.model})`);
      continue;
    }
    if (d.type === "usw" && d.mac === coreMacAddr && ![undefined, null, "0", 0, "4096", 4096].includes(d.stp_priority))
      add(
        "FAIL",
        d.name,
        d.name,
        `core STP priority ${d.stp_priority}; set 4096 so the core is root`,
        `In UniFi: Devices → ${d.name} → Settings → Services → Spanning Tree. Set the priority to 4096. ${ASK}`,
      );
    if (d.flowctrl_enabled)
      add(
        "FAIL",
        d.name,
        d.name,
        "flow control enabled",
        `In UniFi: Devices → ${d.name} → Settings. Turn off Flow Control.`,
      );
    const over = new Map((d.port_overrides ?? []).map((p: any) => [p.port_idx, p]));
    for (const p of d.port_table ?? []) {
      if (!p.up) continue;
      const o: any = over.get(p.port_idx) ?? {};
      const tag = `${d.name} port ${p.port_idx} (${p.name})`;
      const critical = criticalIds.has(o.native_networkconf_id);
      if (critical && (p.speed ?? 1000) < 1000) {
        const qos = o.qos_profile?.qos_policies;
        add(
          "WARN",
          d.name,
          tag,
          qos?.length ? `critical VLAN port at ${p.speed}M` : `critical VLAN port at ${p.speed}M without QoS policy`,
          `Port ${p.port_idx} runs at ${p.speed} Mbit/s. A critical VLAN needs 1 Gbit/s, or QoS with strict priority. Check the cable and the device. Use a 1 Gbit/s port on the device if it has one.`,
        );
      }
      if (p.full_duplex === false)
        add(
          "FAIL",
          d.name,
          tag,
          "half duplex",
          `Port ${p.port_idx} runs half duplex. Replace the cable, or set the port to auto-negotiation.`,
        );
      if (p.rx_errors || p.tx_errors)
        add(
          "WARN",
          d.name,
          tag,
          `errors rx=${p.rx_errors} tx=${p.tx_errors}: check cable/SFP`,
          `Port ${p.port_idx} shows transmission errors. Replace the cable or the SFP module.`,
        );
      if (critical && ![undefined, null, "auto", "enabled"].includes(o.stp_edge_state))
        add("WARN", d.name, tag, "critical VLAN port not edge");
    }
  }
  add(
    "INFO",
    "UniFi",
    "UniFi",
    "EEE state not exposed by the UniFi API: check per device in UI (Port Manager → Advanced)",
  );

  for (const c of u["stat/sta"]) {
    const ip: string = c.ip ?? "";
    const who = c.hostname || c.mac;
    if (ip.startsWith("169.254.") || ip.startsWith("172.31."))
      add(
        "FAIL",
        c.mac,
        who,
        `link-local address ${ip}: no DHCP on its VLAN`,
        `${who} did not get an address from DHCP. Check that it is patched into the correct VLAN.`,
      );
    if (!c.is_wired && criticalIds.has(c.network_id))
      add(
        "FAIL",
        c.mac,
        who,
        "wireless client on a critical VLAN",
        "A critical VLAN needs a wired connection. Connect this device with a cable.",
      );
  }
  return new Set(queriers.keys());
}

// --- MikroTik SwOS ----------------------------------------------------------

function auditSwos(
  sw: Extract<Switch, { os: "swos" }>,
  queriers: Set<number> | null,
  coreMacAddr: string | undefined,
  ctx: Nets,
  add: Add,
  devices: Device[],
) {
  const { sys: s, link, fwd, rstp, snmp } = sw.pages;
  const vlans: any[] = sw.pages.vlan ?? [];
  const n: number = link.prt;
  const id = hexstr(s.id);
  const ip = s.cip ? ipLE(s.cip) : sw.ip;
  const name = `${id} (${ip}, ${hexstr(s.brd)}, SwOS ${hexstr(s.ver)})`;
  const r: Add = (level, _device, where, msg, fix) => add(level, id, where, msg, fix);
  const up = bits(link.lnk, n);
  const pname = (p: number) => `${p}:${hexstr(link.nm[p - 1])}`;
  const web = `Open http://${ip} in the browser and log in.`;
  devices.push({ id, title: id, subtitle: `${hexstr(s.brd)} · SwOS ${hexstr(s.ver)} · ${ip}`, kind: "mikrotik" });

  r("INFO", id, name, `ports up: ${up.map((p) => `${pname(p)}@${SPEED[link.spd[p - 1]] ?? "?"}`).join(", ")}`);
  const slow = up.filter((p) => link.spd[p - 1] <= 1).map(pname);
  if (slow.length)
    r(
      "WARN",
      id,
      name,
      `≤100M links ${list(slow)}: Dante requires strict-priority QoS when 100M is in the path`,
      "A device runs at 100 Mbit/s or slower. Check the cable, or move Dante to a 1 Gbit/s port.",
    );
  const fc = up.filter((p) => Math.floor((link.fctc | (link.fctr ?? 0)) / 2 ** (p - 1)) % 2).map(pname);
  if (fc.length)
    r(
      "FAIL",
      id,
      name,
      `flow control enabled on active ports ${list(fc)}`,
      `${web} Go to the Link tab. Turn off Flow Control (TX and RX) on all ports, then click Apply.`,
    );
  if (up.some((p) => Math.floor(link.dpx / 2 ** (p - 1)) % 2 === 0))
    r("FAIL", id, name, "half duplex on an active port", "Replace the cable on the port that runs half duplex.");

  if (queriers) {
    if (s.igmp && !s.igmq) {
      const missing = [...ctx.critical].filter((v) => !queriers.has(v)).sort((a, b) => a - b);
      if (missing.length)
        r(
          "FAIL",
          id,
          name,
          `IGMP snooping ON, querier OFF, and no querier anywhere on VLAN ${list(missing)}: multicast/PTP gets pruned`,
          "The UniFi core switch must be the IGMP querier. Fix the UniFi querier problem first. This switch then works without changes.",
        );
      else r("PASS", id, name, "IGMP snooping on, querier provided upstream");
    } else if (s.igmq) {
      r(
        "FAIL",
        id,
        name,
        "IGMP querier ON; the flypack core is the querier, turn this off",
        `${web} Go to the System tab. Turn off IGMP Querier, then click Apply.`,
      );
    }
  }
  r(
    "INFO",
    id,
    name,
    `IGMP v${s.igve ? "3" : "2"}, unknown-multicast flood ports: ${bits(s.igfl ?? 0, n).length}/${n}`,
  );
  const groups: any[] = sw.pages["!igmp"] ?? [];
  r(
    "INFO",
    id,
    name,
    `IGMP groups learned: ${groups.length ? list(groups.map((g) => `${ipLE(g.addr)} (VLAN ${g.vlan})`)) : "none"}`,
  );

  if (coreMacAddr) {
    const root: string = s.rmac;
    if (root.toLowerCase() !== coreMacAddr.replaceAll(":", "").toLowerCase()) {
      const rn = root === s.mac ? "this switch" : root;
      r(
        "FAIL",
        id,
        name,
        `STP root is ${rn}, not the flypack core ${coreMacAddr}; bridge prio 0x${s.prio.toString(16)}`,
        `The UniFi core switch must be the root bridge (priority 4096). Fix this in UniFi, not on this switch. ${ASK}`,
      );
    }
  }
  if (!rstp.edge)
    r(
      "WARN",
      id,
      name,
      "no RSTP edge ports configured",
      `${web} Go to the RSTP tab. Set the ports with devices (not the uplinks) to Edge, then click Apply.`,
    );

  const members = new Set(vlans.map((v) => v.vid));
  const strict = [
    ...new Set(
      Array.from({ length: n }, (_, p) => p)
        .filter((p) => fwd.vlan[p] === 3)
        .map((p) => fwd.dvid[p]),
    ),
  ]
    .filter((v) => !members.has(v))
    .sort((a, b) => a - b);
  if (strict.length)
    r(
      "FAIL",
      id,
      name,
      `ports in VLAN mode strict with PVID ${list(strict)} not in VLAN table (table has ${members.size ? list([...members].sort((a, b) => a - b)) : "nothing"}): verify access ports pass traffic`,
      `${web} Go to the VLANs tab. Add VLANs ${list(strict)} with the correct member ports, or the access ports can drop all traffic.`,
    );
  const unknown = ctx.nets.size
    ? [...new Set<number>(fwd.dvid.filter((v: number) => !ctx.nets.has(v)))].sort((a, b) => a - b)
    : [];
  if (unknown.length) {
    const ports = Array.from({ length: n }, (_, p) => p)
      .filter((p) => unknown.includes(fwd.dvid[p]))
      .map((p) => p + 1);
    r(
      "FAIL",
      id,
      name,
      `PVID ${list(unknown)} is not a UniFi network, on ports ${list(ports)}`,
      `${web} Go to the VLAN tab. Ports ${list(ports)} use VLAN ${list(unknown)}, which is not a network in UniFi. Change the Default VLAN ID to an existing VLAN, then click Apply.`,
    );
  }
  r("INFO", id, name, `PVID per port: ${Array.from({ length: n }, (_, p) => `${p + 1}=${fwd.dvid[p]}`).join(" ")}`);

  if (snmp?.en && hexstr(snmp.com) === "public")
    r(
      "WARN",
      id,
      name,
      "SNMP community 'public'",
      `${web} Go to the SNMP tab. Change the community from "public", or turn SNMP off.`,
    );
  r("INFO", id, name, "EEE and DSCP strict-priority not configurable on SwOS: unmanaged");
}

// --- MikroTik RouterOS -----------------------------------------------------

const mbps = (rate: string) => parseFloat(rate) * (rate.endsWith("Gbps") ? 1000 : 1);
// The Dante network admin guide: PTP (CS7) and audio (EF) each in a strict-priority queue.
const DANTE_DSCP = ["56", "46"];

function auditRouterOS(
  sw: Extract<Switch, { os: "routeros" }>,
  queriers: Set<number> | null,
  coreMacAddr: string | undefined,
  ctx: Nets,
  add: Add,
  devices: Device[],
) {
  const ros = sw.ros;
  const { id, ip, model, os } = swInfo(sw);
  const name = `${id} (${ip}, ${model}, ${os})`;
  const r: Add = (level, _device, where, msg, fix) => add(level, id, where, msg, fix);
  const web = `Open http://${ip} in the browser, log in and click WebFig.`;
  const drift = `This switch is not on the standard configuration. Do not change it yourself. ${ASK}`;
  devices.push({ id, title: id, subtitle: `${model} · ${os} · ${ip}`, kind: "mikrotik" });

  const bridge = ros["interface/bridge"][0];
  const mon = ros["interface/bridge/monitor"][0] ?? {};
  const ports: any[] = ros["interface/bridge/port"];
  const eth = new Map<string, any>(ros["interface/ethernet"].map((e: any) => [e.name, e]));
  const links: any[] = ros["interface/ethernet/monitor"].filter((l: any) => l.status === "link-ok");

  r("INFO", id, name, `ports up: ${links.map((l) => `${l.name}@${l.rate ?? "?"}`).join(", ") || "none"}`);
  if (bridge["vlan-filtering"] !== "true")
    r("FAIL", id, name, "VLAN filtering off: all VLANs are mixed on every port", drift);
  const soft = ports.filter((p) => p.inactive === "false" && p["hw-offload"] !== "true").map((p) => p.interface);
  if (soft.length)
    r("FAIL", id, name, `ports ${list(soft)} are switched by the CPU, not in hardware: Dante can drop out`, drift);

  // QoS
  const profiles = new Map<string, any>(ros["interface/ethernet/switch/qos/profile"].map((p: any) => [p.name, p]));
  const queues: any[] = ros["interface/ethernet/switch/qos/tx-manager/queue"];
  const strict = (dscp: string) => {
    const m = ros["interface/ethernet/switch/qos/map/ip"].find((x: any) => x.dscp === dscp && x.disabled !== "true");
    const tc = profiles.get(m?.profile)?.["traffic-class"];
    return tc !== undefined && queues.some((q) => q["traffic-class"] === tc && q.schedule === "strict-priority");
  };
  const trusted = ros["interface/ethernet/switch/qos/port"].every((p: any) => p["trust-l3"] !== "ignore");
  const qos =
    ros["interface/ethernet/switch"].every((s: any) => s["qos-hw-offloading"] === "true") &&
    trusted &&
    DANTE_DSCP.every(strict);
  const slow = links.filter((l) => l.rate && mbps(l.rate) <= 100).map((l) => l.name);
  if (!qos && slow.length)
    r(
      "FAIL",
      id,
      name,
      `≤100M links ${list(slow)} and no strict-priority QoS for DSCP ${list(DANTE_DSCP)}: Dante requires it when 100M is in the path`,
      drift,
    );
  else if (!qos)
    r("WARN", id, name, `no strict-priority QoS for DSCP ${list(DANTE_DSCP)} (Dante PTP and audio)`, drift);
  else
    r(
      slow.length ? "INFO" : "PASS",
      id,
      name,
      `strict-priority QoS for DSCP ${list(DANTE_DSCP)} in hardware${slow.length ? `; ≤100M links ${list(slow)}` : ""}`,
    );

  const fc = links
    .filter((l) =>
      [eth.get(l.name)?.["rx-flow-control"], eth.get(l.name)?.["tx-flow-control"]].some((f) => f && f !== "off"),
    )
    .map((l) => l.name);
  if (fc.length)
    r(
      "FAIL",
      id,
      name,
      `flow control enabled on active ports ${list(fc)}`,
      `${web} Go to Interfaces → Ethernet. Open ${list(fc)}, set Tx Flow Control and Rx Flow Control to off, then click OK.`,
    );
  if (links.some((l) => l["full-duplex"] === "false"))
    r("FAIL", id, name, "half duplex on an active port", "Replace the cable on the port that runs half duplex.");
  for (const l of links) {
    const errs = Number(eth.get(l.name)?.["rx-fcs-error"] ?? 0);
    if (errs)
      r(
        "WARN",
        id,
        `${id} ${l.name}`,
        `errors rx-fcs=${errs}: check cable/SFP`,
        `Port ${l.name} shows transmission errors. Replace the cable or the SFP module.`,
      );
  }

  // IGMP: snooping on, the flypack core is the querier.
  if (bridge["igmp-snooping"] !== "true")
    r(
      "FAIL",
      id,
      name,
      "IGMP snooping off: multicast floods every port",
      `${web} Go to Bridge → Bridge and open "${bridge.name}". Turn on IGMP Snooping, then click OK.`,
    );
  else if (bridge["multicast-querier"] === "true")
    r(
      "FAIL",
      id,
      name,
      "IGMP querier ON; the flypack core is the querier, turn this off",
      `${web} Go to Bridge → Bridge and open "${bridge.name}". In the IGMP Snooping section, turn off Multicast Querier, then click OK.`,
    );
  else if (queriers) {
    const missing = [...ctx.critical].filter((v) => !queriers.has(v)).sort((a, b) => a - b);
    if (missing.length)
      r(
        "FAIL",
        id,
        name,
        `IGMP snooping ON, querier OFF, and no querier anywhere on VLAN ${list(missing)}: multicast/PTP gets pruned`,
        "The UniFi core switch must be the IGMP querier. Fix the UniFi querier problem first. This switch then works without changes.",
      );
    else
      r(
        "PASS",
        id,
        name,
        `IGMP snooping on, querier provided upstream${mon["igmp-querier"] ? ` (${mon["igmp-querier"]})` : ""}`,
      );
  }
  const groups = [
    ...new Set<string>(
      ros["interface/bridge/mdb"]
        .filter((g: any) => !g.group.includes(":"))
        .map((g: any) => `${g.group} (VLAN ${g.vid})`),
    ),
  ];
  r("INFO", id, name, `IGMP groups learned: ${groups.length ? list(groups) : "none"}`);

  if (coreMacAddr && mon["root-bridge-id"]) {
    const root = mon["root-bridge-id"].split(".").pop().toLowerCase();
    if (root !== coreMacAddr.toLowerCase()) {
      const rn = mon["root-bridge"] === "true" ? "this switch" : root;
      r(
        "FAIL",
        id,
        name,
        `STP root is ${rn}, not the flypack core ${coreMacAddr}; bridge prio ${bridge.priority}`,
        `The UniFi core switch must be the root bridge (priority 4096). Fix this in UniFi, not on this switch. ${ASK}`,
      );
    }
  }
  const access = ports.filter((p) => p["frame-types"] === "admit-only-untagged-and-priority-tagged");
  const notEdge = access.filter((p) => p.edge === "no").map((p) => p.interface);
  if (notEdge.length)
    r(
      "WARN",
      id,
      name,
      `access ports not edge: ${list(notEdge)}`,
      `${web} Go to Bridge → Ports. Open ${list(notEdge)}, set Edge to "yes-discover", then click OK.`,
    );

  const members = new Set(ros["interface/bridge/vlan"].flatMap((v: any) => vidList(v["vlan-ids"])));
  const absent = [...new Set(access.map((p) => Number(p.pvid)))]
    .filter((v) => v !== Number(bridge.pvid) && !members.has(v))
    .sort((a, b) => a - b);
  if (absent.length)
    r(
      "FAIL",
      id,
      name,
      `access ports with PVID ${list(absent)} that is not in the bridge VLAN table: these ports pass no traffic`,
      drift,
    );
  const pvid = (p: any) => Number(p.pvid);
  const unknown = ctx.nets.size
    ? [...new Set(ports.map(pvid))].filter((v) => !ctx.nets.has(v)).sort((a, b) => a - b)
    : [];
  if (unknown.length) {
    const on = ports.filter((p) => unknown.includes(pvid(p))).map((p) => p.interface);
    r(
      "FAIL",
      id,
      name,
      `PVID ${list(unknown)} is not a UniFi network, on ports ${list(on)}`,
      `${web} Go to Bridge → Ports. Ports ${list(on)} use VLAN ${list(unknown)}, which is not a network in UniFi. Set PVID to an existing VLAN, then click OK.`,
    );
  }
  r("INFO", id, name, `PVID per port: ${ports.map((p) => `${p.interface}=${p.pvid}`).join(" ")}`);
  if (ros.snmp?.enabled === "true") r("INFO", id, name, "SNMP enabled");
  r("INFO", id, name, "EEE not available on this switch chip");
}

// --- Equipment --------------------------------------------------------------

export function inventory(scan: Scan, equipment: Equipment[]): Seen[] {
  const byMac = new Map<string, Seen>();
  const vids = new Map((scan.unifi?.["rest/networkconf"] ?? []).map((n) => [n._id, Number(n.vlan) || 1]));
  for (const c of scan.unifi?.["stat/sta"] ?? []) {
    byMac.set(c.mac, {
      mac: c.mac,
      vlan: vids.get(c.network_id) ?? 1,
      ip: c.ip,
      name: c.hostname || c.name,
      vendor: c.oui,
      wired: c.is_wired !== false,
      fromUnifi: true,
    });
  }
  for (const sw of scan.switches) {
    const hosts =
      sw.os === "swos"
        ? (sw.pages["!dhost"] ?? []).map((h: any) => ({
            mac: normMac(h.adr.match(/../g).join(":")),
            vlan: h.vid as number,
          }))
        : sw.ros["interface/bridge/host"]
            .filter((h: any) => h.local === "false" && h.vid)
            .map((h: any) => ({ mac: normMac(h["mac-address"]), vlan: Number(h.vid) }));
    for (const { mac, vlan } of hosts)
      if (!byMac.has(mac)) byMac.set(mac, { mac, vlan, wired: true, fromUnifi: false });
  }
  const { nets } = networks(scan.unifi);
  // A CRS3xx sends BPDUs from per-port MACs just above its base MAC; count those as the switch itself.
  const bases = scan.switches.map((sw) => parseInt(swInfo(sw).mac.replaceAll(":", ""), 16));
  const macNum = (m: string) => parseInt(m.replaceAll(":", ""), 16);
  for (const [mac, s] of byMac) {
    const n = macNum(mac);
    if (!s.ip && bases.some((b) => n > b && n <= b + 32)) byMac.delete(mac);
  }
  for (const s of byMac.values()) {
    s.equipment = equipment.find((e) => e.mac === s.mac) ?? equipment.find((e) => e.oui && s.mac.startsWith(e.oui));
    if (s.mac === scan.network.mac) s.name = "this computer";
    s.network = nets.get(s.vlan);
  }
  return [...byMac.values()].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
}

export const allowed = (e: Equipment, s: Seen) =>
  e.vlan.some((x) => (typeof x === "number" ? x === s.vlan : x.toLowerCase() === s.network?.toLowerCase()));

function auditEquipment(seen: Seen[], ctx: Nets, add: Add) {
  const name = (x: number | string) => (typeof x === "number" ? vlanName(ctx, x) : x);
  for (const s of seen) {
    const e = s.equipment;
    // Without UniFi there are no network names to compare against.
    const checkable = ctx.nets.size || e?.vlan.every((x) => typeof x === "number");
    if (e && e.vlan.length && checkable && !allowed(e, s))
      add(
        "WARN",
        s.mac,
        seenLabel(s),
        `${e.type || s.vendor} on ${vlanName(ctx, s.vlan)}, expected ${list(e.vlan.map(name))}`,
        `This device is on the wrong network. Check which switch port it is patched into, and move it to a port for ${list(e.vlan.map(name))}.`,
      );
  }
  const vlans = [...new Set(seen.map((s) => s.vlan))];
  for (const v of vlans) {
    const counts = new Map<string, number>();
    for (const s of seen.filter((x) => x.vlan === v)) {
      const label =
        s.name === "this computer"
          ? "this computer"
          : s.equipment
            ? s.equipment.type || s.equipment.vendor || "unnamed"
            : `unknown (${s.vendor || s.mac.slice(0, 8)})`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    add("INFO", "UniFi", vlanName(ctx, v), [...counts].map(([k, c]) => `${c}× ${k}`).join(", "));
  }
}

/** Unknown OUIs from a scan, ready to append to equipment.json. */
export function learn(seen: Seen[], equipment: Equipment[]): Equipment[] {
  const added = new Map<string, Equipment>();
  for (const s of seen) {
    if (s.equipment || s.name === "this computer") continue;
    const oui = s.mac.slice(0, 8);
    const e = added.get(oui) ?? { oui, type: "", vendor: s.vendor ?? "", vlan: [] };
    const where = s.network ?? s.vlan;
    if (!e.vlan.includes(where)) e.vlan.push(where);
    added.set(oui, e);
  }
  return [...equipment, ...added.values()];
}

// --- Missing devices --------------------------------------------------------

/** Remembers wired devices and online UniFi devices across scans, and reports the ones that stop answering. */
function track(
  known: Known,
  scan: Scan,
  seen: Seen[],
  ctx: Nets,
  now: string,
  add: Add,
  devices: Device[],
  owner: Map<string, string>,
) {
  const present = new Map<string, Tracked>();
  for (const s of seen) {
    if (s.wired && s.name !== "this computer")
      present.set(s.mac, { device: s.mac, label: seenLabel(s), vlan: s.vlan, fromUnifi: s.fromUnifi });
  }
  for (const d of scan.unifi?.["stat/device"] ?? []) {
    if (d.state === 1)
      present.set(d.mac, { device: d.name, label: `${d.name} (${d.model})`, vlan: 1, fromUnifi: true });
  }
  for (const [mac, p] of present) known.set(mac, { ...p, at: now, misses: 0 });
  for (const [mac, k] of known) {
    if (present.has(mac)) continue;
    // A failed UniFi read is reported on its own; it does not mean its clients left.
    if (k.fromUnifi && !scan.unifi) continue;
    if (++k.misses < MISS_LIMIT) continue;
    const id = owner.get(k.device) ?? k.device;
    if (!devices.some((d) => d.id === id))
      devices.push({ id, title: k.label, subtitle: "missing", kind: k.device === mac ? "equipment" : "unifi" });
    add(
      ctx.critical.has(k.vlan) ? "FAIL" : "WARN",
      id,
      k.label,
      `missing since ${time(k.at)}, last seen on ${vlanName(ctx, k.vlan)}`,
      `This device answered before, but not anymore. Check its power and its cable. If you removed it on purpose, click "Forget missing".`,
    );
  }
}

/** Drops the devices that are missing now, so they are no longer reported. */
export function forget(known: Known) {
  for (const [mac, k] of known) if (k.misses) known.delete(mac);
}
