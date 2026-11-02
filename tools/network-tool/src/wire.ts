// Expanded scan: what this computer sees on the wire. Pure: capture-file readers, packet decoders, the observation
// memory and its checks. capture.ts (packet capture) and probe.ts (UDP probes) feed it.
import type { Level } from "./checks";
import { contains } from "./net";

export type Frame = { t: number; data: Uint8Array }; // t: ms since 1970
export type Packet = {
  t: number;
  vlan?: number;
  src: string;
  dst: string;
  arp?: { mac: string; ip: string };
  ip?: { src: string; dst: string; len: number };
  igmp?: { general: boolean; version: number };
  udp?: { sport: number; dport: number; data: Uint8Array };
  lldp?: { system?: string; port?: string; desc?: string; pvid?: number };
  stp?: { root: string; tc: boolean };
};
export type Obs =
  | { kind: "querier"; vlan: number; ip: string; mac: string; version: number }
  | { kind: "ptp"; vlan: number; version: number; domain: string; leader: string }
  | { kind: "dhcp"; vlan: number; server: string; mac: string }
  | { kind: "dante"; vlan: number; name: string; ip: string }
  | { kind: "ndi"; vlan: number; name: string; ip: string }
  | { kind: "greengo"; vlan: number; ip: string; group?: string }
  | { kind: "arp"; vlan: number; ip: string; mac: string }
  | { kind: "flood"; vlan: number; src: string; group: string; bps: number }
  | { kind: "lldp"; vlan: number; system: string; port: string; pvid?: number }
  | { kind: "stp"; vlan: number; root: string }
  | { kind: "tc"; vlan: number; bucket: number };
export type Memory = Map<string, Obs & { at: number }>;
/** What the expanded scan adds to a Scan. */
export type Wire = { obs: (Obs & { at: number })[]; capture: string; packets: number; errors: string[] };

// An IGMP querier sends a general query about every 125 s, so one 30 s scan is not enough: keep 5 min.
const AGE_MS = 5 * 60_000;
const FLOOD_AGE_MS = 60_000;
const FLOOD_WARN_BPS = 10e6;
const TC_WARN = 3;
// Dante multicast audio goes to UDP 4321 (239.255.x.x also carries SSDP, so the port decides).
const DANTE_AUDIO_PORT = 4321;
const GREENGO_PORT = 5810;
const ASK = "If you can't fix this, report it to the network lead.";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(":");
const ip4 = (b: Uint8Array, o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, "");
const multicast = (ip: string) => Number(ip.split(".")[0]) >= 224 && Number(ip.split(".")[0]) <= 239;
const list = (xs: (string | number)[]) => xs.join(", ");

// --- capture files ----------------------------------------------------------

/** Ethernet frames from a classic pcap (tcpdump) or a pcapng (pktmon) file. */
export function readCapture(buf: Uint8Array): Frame[] {
  if (buf.length < 24) return [];
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return v.getUint32(0, true) === 0x0a0d0d0a ? readPcapng(buf, v) : readPcap(buf, v);
}

function readPcap(buf: Uint8Array, v: DataView): Frame[] {
  const magic = v.getUint32(0, true);
  const nano = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
  const le = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  if (!le && magic !== 0xd4c3b2a1 && magic !== 0x4d3cb2a1) return [];
  if (v.getUint32(20, le) !== 1) return []; // not Ethernet
  const out: Frame[] = [];
  for (let o = 24; o + 16 <= buf.length;) {
    const len = v.getUint32(o + 8, le);
    if (o + 16 + len > buf.length) break; // the last record can be half written
    const t = v.getUint32(o, le) * 1000 + v.getUint32(o + 4, le) / (nano ? 1e6 : 1e3);
    out.push({ t, data: buf.subarray(o + 16, o + 16 + len) });
    o += 16 + len;
  }
  return out;
}

function readPcapng(buf: Uint8Array, v: DataView): Frame[] {
  const out: Frame[] = [];
  let le = true;
  let ifs: { eth: boolean; perMs: number }[] = [];
  for (let o = 0; o + 12 <= buf.length;) {
    if (v.getUint32(o, true) === 0x0a0d0d0a) {
      le = v.getUint32(o + 8, true) === 0x1a2b3c4d;
      ifs = [];
    }
    const type = v.getUint32(o, le);
    const len = v.getUint32(o + 4, le);
    if (len < 12 || o + len > buf.length) break;
    if (type === 1) {
      let perMs = 1000; // default resolution: microseconds
      for (let p = o + 16; p + 4 <= o + len - 4;) {
        const code = v.getUint16(p, le);
        const olen = v.getUint16(p + 2, le);
        if (code === 0) break;
        if (code === 9 && olen >= 1) perMs = (buf[p + 4] & 0x80 ? 2 ** (buf[p + 4] & 0x7f) : 10 ** buf[p + 4]) / 1000;
        p += 4 + Math.ceil(olen / 4) * 4;
      }
      ifs.push({ eth: v.getUint16(o + 8, le) === 1, perMs });
    } else if (type === 6) {
      const i = ifs[v.getUint32(o + 8, le)];
      const cap = v.getUint32(o + 20, le);
      if (i?.eth && 28 + cap <= len) {
        const ts = v.getUint32(o + 12, le) * 2 ** 32 + v.getUint32(o + 16, le);
        out.push({ t: ts / i.perMs, data: buf.subarray(o + 28, o + 28 + cap) });
      }
    }
    o += len;
  }
  return out;
}

// --- decoders ---------------------------------------------------------------

export function decode({ t, data: b }: Frame): Packet | null {
  if (b.length < 14) return null;
  const p: Packet = { t, dst: hex(b.subarray(0, 6)), src: hex(b.subarray(6, 12)) };
  let type = u16(b, 12);
  let o = 14;
  if ((type === 0x8100 || type === 0x88a8) && b.length >= 18) {
    p.vlan = u16(b, 14) & 0xfff;
    type = u16(b, 16);
    o = 18;
  }
  if (type < 0x600) {
    // 802.3 with LLC 42 42 03: a spanning tree BPDU
    const s = o + 3;
    if (b[o] === 0x42 && b[o + 1] === 0x42 && b[o + 2] === 0x03 && b.length > s + 3) {
      if (b[s + 3] === 0x80)
        p.stp = { root: "", tc: true }; // topology change notification
      else if (b.length >= s + 13) p.stp = { root: hex(b.subarray(s + 7, s + 13)), tc: (b[s + 4] & 1) === 1 };
    }
    return p;
  }
  if (type === 0x88cc) {
    p.lldp = lldp(b.subarray(o));
    return p;
  }
  if (type === 0x0806) {
    if (b.length >= o + 28 && u16(b, o) === 1 && u16(b, o + 2) === 0x0800)
      p.arp = { mac: hex(b.subarray(o + 8, o + 14)), ip: ip4(b, o + 14) };
    return p;
  }
  if (type !== 0x0800 || b.length < o + 20 || b[o] >> 4 !== 4) return p;
  const ihl = (b[o] & 15) * 4;
  const total = u16(b, o + 2);
  const proto = b[o + 9];
  p.ip = { src: ip4(b, o + 12), dst: ip4(b, o + 16), len: total };
  if ((u16(b, o + 6) & 0x1fff) !== 0) return p; // not the first fragment
  const l4 = o + ihl;
  const end = Math.min(b.length, o + total);
  if (proto === 2 && end >= l4 + 8 && b[l4] === 0x11)
    p.igmp = { general: ip4(b, l4 + 4) === "0.0.0.0", version: total - ihl >= 12 ? 3 : b[l4 + 1] ? 2 : 1 };
  if (proto === 17 && end >= l4 + 8)
    p.udp = { sport: u16(b, l4), dport: u16(b, l4 + 2), data: b.subarray(l4 + 8, end) };
  return p;
}

function lldp(b: Uint8Array): NonNullable<Packet["lldp"]> {
  const l: NonNullable<Packet["lldp"]> = {};
  for (let q = 0; q + 2 <= b.length;) {
    const type = b[q] >> 1;
    const len = ((b[q] & 1) << 8) | b[q + 1];
    const v = b.subarray(q + 2, q + 2 + len);
    if (type === 0) break;
    if (type === 2) l.port = v[0] === 3 ? hex(v.subarray(1)) : text(v.subarray(1));
    if (type === 4) l.desc = text(v);
    if (type === 5) l.system = text(v);
    if (type === 127 && v[0] === 0x00 && v[1] === 0x80 && v[2] === 0xc2 && v[3] === 1) l.pvid = u16(v, 4);
    q += 2 + len;
  }
  return l;
}

/** PTP leader: a v1 Sync names the grandmaster UUID (a MAC), a v2 Announce the grandmaster identity (EUI-64). */
export function ptp(d: Uint8Array): { version: number; domain: string; leader: string } | null {
  if (d.length >= 61 && (d[1] & 0x0f) === 2 && (d[0] & 0x0f) === 0x0b)
    return { version: 2, domain: String(d[4]), leader: hex(d.subarray(53, 61)) };
  if (d.length >= 60 && u16(d, 0) === 1 && d[20] === 1 && d[32] === 0)
    return { version: 1, domain: text(d.subarray(4, 20)), leader: hex(d.subarray(54, 60)) };
  return null;
}

/** A DHCP OFFER or ACK and the server that sent it (option 54). */
export function dhcp(d: Uint8Array): { type: number; server?: string } | null {
  if (d.length < 244 || d[0] !== 2 || u16(d, 236) !== 0x6382 || u16(d, 238) !== 0x5363) return null;
  let type = 0;
  let server: string | undefined;
  for (let o = 240; o + 1 < d.length && d[o] !== 255;) {
    if (d[o] === 0) {
      o++;
      continue;
    }
    const len = d[o + 1];
    if (d[o] === 53) type = d[o + 2];
    if (d[o] === 54 && len === 4) server = ip4(d, o + 2);
    o += 2 + len;
  }
  return type === 2 || type === 5 ? { type, server } : null;
}

function dnsName(d: Uint8Array, o: number): [string, number] {
  const labels: string[] = [];
  let next = -1;
  for (let jumps = 0; o < d.length && jumps < 20;) {
    const n = d[o];
    if (n === 0) {
      o++;
      break;
    }
    if ((n & 0xc0) === 0xc0) {
      if (next < 0) next = o + 2;
      o = ((n & 0x3f) << 8) | d[o + 1];
      jumps++;
      continue;
    }
    labels.push(text(d.subarray(o + 1, o + 1 + n)));
    o += 1 + n;
  }
  return [labels.join("."), next < 0 ? o : next];
}

const SERVICES = { "_netaudio-arc._udp.local": "dante", "_ndi._tcp.local": "ndi" } as const;

/** Dante and NDI instances in an mDNS answer (PTR records). */
export function mdns(d: Uint8Array): { service: "dante" | "ndi"; name: string }[] {
  if (d.length < 12 || !(d[2] & 0x80)) return [];
  let o = 12;
  for (let i = u16(d, 4); i > 0 && o < d.length; i--) o = dnsName(d, o)[1] + 4;
  const out: { service: "dante" | "ndi"; name: string }[] = [];
  for (let i = u16(d, 6) + u16(d, 8) + u16(d, 10); i > 0 && o + 10 <= d.length; i--) {
    const [owner, p] = dnsName(d, o);
    const service = SERVICES[owner.toLowerCase() as keyof typeof SERVICES];
    if (u16(d, p) === 12 && service) {
      const instance = dnsName(d, p + 10)[0];
      out.push({ service, name: instance.slice(0, instance.length - owner.length - 1) });
    }
    o = p + 10 + u16(d, p + 8);
  }
  return out;
}

// --- observation memory -----------------------------------------------------

const put = (mem: Memory, o: Obs, at: number, key = JSON.stringify(o)) => mem.set(key, { ...o, at });

type Udp = { t: number; vlan: number; src: string; dst?: string; mac?: string; sport: number; dport: number };

/** One UDP payload, from a capture or from a probe socket. */
export function observeUdp(mem: Memory, u: Udp & { data: Uint8Array }) {
  const { t, vlan, src, sport, dport, data } = u;
  if ([sport, dport].some((p) => p === 319 || p === 320)) {
    const r = ptp(data);
    if (r) put(mem, { kind: "ptp", vlan, ...r }, t);
  }
  if (sport === 67 && dport === 68) {
    const r = dhcp(data);
    if (r)
      put(mem, { kind: "dhcp", vlan, server: r.server ?? src, mac: u.mac ?? "" }, t, `dhcp|${vlan}|${r.server ?? src}`);
  }
  if (sport === 5353 || dport === 5353)
    for (const r of mdns(data)) put(mem, { kind: r.service, vlan, name: r.name, ip: src }, t);
  if (sport === GREENGO_PORT || dport === GREENGO_PORT)
    put(mem, { kind: "greengo", vlan, ip: src, group: u.dst && multicast(u.dst) ? u.dst : undefined }, t);
}

/** Adds what the captured packets show. Untagged frames are on `own`, the VLAN of this computer. */
export function observe(mem: Memory, packets: Packet[], own: number) {
  const flows = new Map<
    string,
    { vlan: number; src: string; group: string; bytes: number; first: number; last: number }
  >();
  for (const p of packets) {
    const vlan = p.vlan ?? own;
    if (p.igmp?.general && p.ip)
      put(mem, { kind: "querier", vlan, ip: p.ip.src, mac: p.src, version: p.igmp.version }, p.t);
    if (p.arp && p.arp.ip !== "0.0.0.0") put(mem, { kind: "arp", vlan, ip: p.arp.ip, mac: p.arp.mac }, p.t);
    if (p.lldp?.system) {
      const { system, port, desc, pvid } = p.lldp;
      const where = port && desc && desc !== port ? `${port} (${desc})` : (port ?? desc ?? "?");
      put(mem, { kind: "lldp", vlan, system, port: where, pvid }, p.t, "lldp");
    }
    if (p.stp?.root) put(mem, { kind: "stp", vlan, root: p.stp.root }, p.t);
    if (p.stp?.tc) put(mem, { kind: "tc", vlan, bucket: Math.floor(p.t / 10_000) }, p.t);
    if (!p.udp || !p.ip) continue;
    observeUdp(mem, { ...p.udp, t: p.t, vlan, src: p.ip.src, dst: p.ip.dst, mac: p.src });
    const audio =
      multicast(p.ip.dst) && (p.udp.dport === DANTE_AUDIO_PORT || p.udp.dport === GREENGO_PORT) ? p.ip.dst : "";
    if (!audio) continue;
    const key = `${vlan}|${p.ip.src}|${audio}`;
    const f = flows.get(key) ?? { vlan, src: p.ip.src, group: audio, bytes: 0, first: p.t, last: p.t };
    f.bytes += p.ip.len;
    f.last = p.t;
    flows.set(key, f);
  }
  for (const [key, f] of flows) {
    const bps = (f.bytes * 8) / Math.max(1, (f.last - f.first) / 1000);
    put(mem, { kind: "flood", vlan: f.vlan, src: f.src, group: f.group, bps }, f.last, `flood|${key}`);
  }
}

export function age(mem: Memory, now: number) {
  for (const [k, o] of mem) if (now - o.at > (o.kind === "flood" ? FLOOD_AGE_MS : AGE_MS)) mem.delete(k);
}

// --- checks -----------------------------------------------------------------

export type WireCtx = {
  nets: Map<number, string>;
  subnets: Map<number, string>;
  /** Gateway addresses of the UniFi networks: the only expected DHCP servers. */
  gateways: Set<string>;
  /** Network gear (switch, UniFi device) by MAC. */
  gear: (mac: string) => string | undefined;
  /** Gear, or a known client by MAC. */
  name: (mac: string) => string | undefined;
  vendor: (mac: string) => string | undefined;
  core?: string;
};
type Add = (level: Level, where: string, msg: string, fix?: string) => void;

const group = <T, K>(xs: T[], key: (x: T) => K) => {
  const m = new Map<K, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};
const uniq = (xs: string[]) => [...new Set(xs)];
/** A PTPv2 identity is an EUI-64; ff:fe in the middle means it was made from a MAC. */
const leaderMac = (id: string) => {
  const b = id.split(":");
  return b.length === 8 && b[3] === "ff" && b[4] === "fe" ? [...b.slice(0, 3), ...b.slice(5)].join(":") : id;
};

/** IGMP queriers seen on the wire, per VLAN, named like the UniFi querier list. */
export function wireQueriers(obs: Wire["obs"], gear: WireCtx["gear"], vendor: WireCtx["vendor"]) {
  const out = new Map<number, string[]>();
  for (const o of obs)
    if (o.kind === "querier") {
      const who = gear(o.mac) ?? `${o.ip} (${vendor(o.mac) ?? o.mac})`;
      if (!out.get(o.vlan)?.includes(who)) out.set(o.vlan, [...(out.get(o.vlan) ?? []), who]);
    }
  return out;
}

export function wireChecks(w: Wire, c: WireCtx, add: Add) {
  const vlan = (v: number) => `VLAN ${v}${c.nets.has(v) ? ` (${c.nets.get(v)})` : ""}`;
  const who = (mac: string, ip?: string) =>
    c.name(mac) ?? [ip, c.vendor(mac) ?? (mac ? mac : undefined)].filter(Boolean).join(" · ");
  const of = <K extends Obs["kind"]>(kind: K) =>
    w.obs.filter((o): o is Extract<Obs, { kind: K }> & { at: number } => o.kind === kind);

  add("INFO", "Expanded scan", `${w.capture} · ${w.packets} packets since the last scan`);
  for (const e of w.errors) add("INFO", "Expanded scan", `probe: ${e}`);

  for (const l of of("lldp"))
    add("INFO", "LLDP", `this computer is on ${l.system} port ${l.port}${l.pvid ? `, ${vlan(l.pvid)}` : ""}`);

  for (const [v, qs] of group(of("querier"), (q) => q.vlan)) {
    add("INFO", "IGMP", `${vlan(v)}: IGMP queries from ${list(uniq(qs.map((q) => who(q.mac, q.ip))))}`);
    const versions = uniq(qs.map((q) => `v${q.version}`));
    if (versions.length > 1) add("WARN", "IGMP", `${vlan(v)}: IGMP queries in ${list(versions)}`);
  }

  for (const [, ls] of group(of("ptp"), (p) => `${p.vlan}|${p.version}|${p.domain}`)) {
    const { vlan: v, version } = ls[0];
    const leaders = uniq(ls.map((p) => who(leaderMac(p.leader))));
    if (leaders.length === 1) add("INFO", "PTP", `${vlan(v)}: PTPv${version} clock leader ${leaders[0]}`);
    else
      add(
        "WARN",
        "PTP",
        `${vlan(v)}: ${leaders.length} PTPv${version} clock leaders in 5 min: ${list(leaders)}`,
        "Two devices act as clock leader, or the leader changes. In Dante Controller: Clock Status. Set one device as Preferred Leader.",
      );
  }

  for (const [v, ds] of group(of("dhcp"), (d) => d.vlan)) {
    const servers = uniq(ds.map((d) => d.server));
    const rogue = c.gateways.size ? ds.filter((d) => !c.gateways.has(d.server)) : [];
    const named = list(uniq(ds.map((d) => who(d.mac, d.server))));
    if (servers.length === 1 && !rogue.length) add("INFO", "DHCP", `${vlan(v)}: DHCP from ${named}`);
    else
      add(
        "FAIL",
        "DHCP",
        rogue.length
          ? `${vlan(v)}: DHCP server that is not the UniFi gateway: ${list(uniq(rogue.map((d) => who(d.mac, d.server))))}`
          : `${vlan(v)}: ${servers.length} DHCP servers: ${named}`,
        `Devices get addresses from the wrong server. Find the device that is not the UniFi gateway, then turn off its DHCP server or disconnect it. ${ASK}`,
      );
  }

  const dante = of("dante");
  for (const [v, ds] of group(dante, (d) => d.vlan))
    add("INFO", "Dante", `${vlan(v)}: Dante devices ${list(uniq(ds.map((d) => `${d.name} (${d.ip})`)))}`);
  for (const [name, ds] of group(dante, (d) => d.name)) {
    const ips = uniq(ds.map((d) => d.ip));
    if (ips.length > 1)
      add(
        "WARN",
        "Dante",
        `${ips.length} Dante devices named "${name}": ${list(ips)}`,
        "In Dante Controller, rename one of the devices.",
      );
  }
  for (const d of dante)
    if (!/dante/i.test(c.nets.get(d.vlan) ?? ""))
      add(
        "WARN",
        "Dante",
        `Dante device "${d.name}" (${d.ip}) on ${vlan(d.vlan)}`,
        `Dante devices belong on the Dante VLAN. Connect this device to a Dante port. ${ASK}`,
      );
  for (const [v, ns] of group(of("ndi"), (n) => n.vlan))
    add("INFO", "NDI", `${vlan(v)}: NDI sources ${list(uniq(ns.map((n) => `${n.name} (${n.ip})`)))}`);
  for (const [v, gs] of group(of("greengo"), (g) => g.vlan)) {
    add("INFO", "GreenGo", `${vlan(v)}: GreenGo devices ${list(uniq(gs.map((g) => g.ip)))}`);
    const groups = uniq(gs.flatMap((g) => (g.group ? [g.group] : [])));
    if (groups.length > 1)
      add(
        "WARN",
        "GreenGo",
        `${vlan(v)}: ${groups.length} GreenGo multicast groups (${list(groups)}): more than one GreenGo config`,
        "In Green-GO Control, check that all devices on this VLAN use the same config.",
      );
  }

  for (const as of group(of("arp"), (a) => `${a.vlan}|${a.ip}`).values()) {
    const { vlan: v, ip } = as[0];
    const owners = uniq(as.map((a) => who(a.mac)));
    if (owners.length > 1 && !ip.startsWith("169.254."))
      add(
        "FAIL",
        "ARP",
        `${vlan(v)}: IP ${ip} is used by ${owners.length} devices: ${list(owners)}`,
        `Two devices use the same IP address. Give one of them another address. ${ASK}`,
      );
    const net = c.subnets.get(v);
    if (net && !ip.startsWith("169.254.") && !contains(net, ip))
      add(
        "WARN",
        "ARP",
        `${vlan(v)} carries ${ip} from ${owners[0]}: an address of another network`,
        `A device connects two VLANs, or has a fixed address of another network. Find it, then remove the bridge or network sharing, or give it an address in ${net}. ${ASK}`,
      );
  }

  for (const root of uniq(of("stp").map((s) => s.root)))
    if (c.core && c.gear(root) !== c.core)
      add(
        "WARN",
        "STP",
        `STP root bridge is ${who(root)}, not the core switch ${c.core}`,
        `The UniFi core switch must be the root bridge (priority 4096). Fix this in UniFi, not on the other switch. ${ASK}`,
      );
  const tcs = of("tc").length;
  if (tcs > TC_WARN)
    add(
      "WARN",
      "STP",
      `${tcs} spanning tree topology changes in 5 min: a loop, or a link that goes on and off`,
      `Look at the switch port lights for a port that goes on and off. Remove cables that connect two ports of the same network. ${ASK}`,
    );

  for (const [v, fs] of group(of("flood"), (f) => f.vlan)) {
    const bps = fs.reduce((s, f) => s + f.bps, 0);
    const msg = `${vlan(v)}: this computer receives ${fs.length} audio multicast flows it did not join (${(bps / 1e6).toFixed(1)} Mbit/s)`;
    if (bps > FLOOD_WARN_BPS)
      add(
        "WARN",
        "Multicast",
        msg,
        `IGMP snooping does not stop this traffic, and it fills 100 Mbit/s devices. Check that the VLAN has a querier, and turn off unknown-multicast flooding for it in UniFi: Settings → Networks → Global Switch Settings → IGMP Snooping. ${ASK}`,
      );
    else add("INFO", "Multicast", msg);
  }
}
