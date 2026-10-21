import { normMac } from "./net";

// The only code that writes to the network: the untagged VLAN of a port on a RouterOS switch.
// ether1 and ether2 are fixed trunks. Ports with network gear behind them stay locked, so a change can
// never cut a switch, the core or this computer off.

export type Ros = Record<string, any>;
export type PortCtx = {
  nets: Map<number, string>;
  /** Name of the switch or UniFi device a MAC belongs to. */
  gear: (mac: string) => string | undefined;
  /** Readable name of an endpoint MAC. */
  label: (mac: string) => string | undefined;
  me: string;
};
export type Port = {
  name: string;
  sfp: boolean;
  vlan: number | "trunk";
  up: boolean;
  rate?: string;
  hosts: string[];
  locked?: string;
};
export type Op = { method: "PATCH" | "PUT"; path: string; body: Record<string, string> };

const ACCESS = "admit-only-untagged-and-priority-tagged";
const FIXED = ["ether1", "ether2"];
const PORTS = [...Array.from({ length: 24 }, (_, i) => `ether${i + 1}`), ...[1, 2, 3, 4].map((i) => `sfp-sfpplus${i}`)];

export const vidList = (s: string) =>
  s
    .split(",")
    .filter(Boolean)
    .flatMap((x) => {
      const [a, b = a] = x.split("-").map(Number);
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });

export function portTable(ros: Ros, ctx: PortCtx): Port[] {
  const bp = new Map<string, any>(ros["interface/bridge/port"].map((p: any) => [p.interface, p]));
  const links = new Map<string, any>(
    ros["interface/ethernet/monitor"].filter((l: any) => l.status === "link-ok").map((l: any) => [l.name, l]),
  );
  const hosts: any[] = ros["interface/bridge/host"].filter((h: any) => h.local === "false");
  const root = ros["interface/bridge/monitor"][0]?.["root-port"];
  return PORTS.filter((n) => bp.has(n)).map((name) => {
    const p = bp.get(name);
    const macs = [...new Set(hosts.filter((h) => h["on-interface"] === name).map((h) => normMac(h["mac-address"])))];
    const gear = [...new Set(macs.map(ctx.gear).filter((g): g is string => !!g))].sort();
    const locked = FIXED.includes(name)
      ? "Trunk port. Ports 1 and 2 always carry all VLANs."
      : root === name
        ? "Uplink to the core switch."
        : gear.length
          ? `Link to ${gear.join(", ")}.`
          : p.inactive === "false" && p["edge-port"] === "false"
            ? "Another switch is connected to this port."
            : macs.includes(ctx.me)
              ? "This computer is connected to this port."
              : undefined;
    return {
      name,
      sfp: name.startsWith("sfp"),
      vlan: p["frame-types"] === ACCESS ? Number(p.pvid) : "trunk",
      up: links.has(name),
      rate: links.get(name)?.rate,
      hosts: gear.length ? gear : macs.map((m) => ctx.label(m) ?? m),
      locked,
    };
  });
}

/** The REST writes that put `name` on `target`, or why that is not allowed. */
export function planChange(
  ros: Ros,
  ctx: PortCtx,
  name: string,
  target: number | "trunk",
): { ops: Op[]; from: Port["vlan"] } | { error: string } {
  if (!ctx.nets.size) return { error: "No VLAN list from UniFi. Scan again when UniFi answers." };
  const port = portTable(ros, ctx).find((p) => p.name === name);
  if (!port) return { error: `Port ${name} is not on this switch.` };
  if (port.locked) return { error: port.locked };
  if (target === "trunk" && !port.sfp) return { error: "Only SFP+ ports can be set to trunk." };
  if (target !== "trunk" && !ctx.nets.has(target)) return { error: `VLAN ${target} is not a network in UniFi.` };
  if (target === port.vlan) return { ops: [], from: port.vlan };

  const bridge = ros["interface/bridge"][0];
  const bp = ros["interface/bridge/port"].find((p: any) => p.interface === name);
  const statics: any[] = ros["interface/bridge/vlan"].filter((v: any) => v.dynamic !== "true");
  const without = (csv: string) => csv.split(",").filter((x) => x && x !== name);
  const ops: Op[] = [];
  const members = (v: any, tagged: string[], untagged: string[]) => {
    if (tagged.join(",") !== v.tagged || untagged.join(",") !== v.untagged)
      ops.push({
        method: "PATCH",
        path: `interface/bridge/vlan/${v[".id"]}`,
        body: { tagged: tagged.join(","), untagged: untagged.join(",") },
      });
  };
  const setPort = (body: Record<string, string>) =>
    ops.push({ method: "PATCH", path: `interface/bridge/port/${bp[".id"]}`, body });

  if (target === "trunk") {
    setPort({ pvid: bridge.pvid ?? "1", "frame-types": "admit-all", "ingress-filtering": "yes", edge: "auto" });
    for (const v of statics) members(v, [...without(v.tagged), name], without(v.untagged));
    return { ops, from: port.vlan };
  }
  const entry = statics.find((v) => v["vlan-ids"] === String(target));
  // ponytail: entries that cover several VIDs (10,20 or 100-200) are left to WebFig
  if (!entry && statics.some((v) => vidList(v["vlan-ids"]).includes(target)))
    return { error: `VLAN ${target} shares a bridge VLAN entry with other VLANs. Change this port in WebFig.` };
  if (entry) members(entry, without(entry.tagged), [...without(entry.untagged), name]);
  else if (target !== Number(bridge.pvid ?? 1)) {
    const trunks = ros["interface/bridge/port"]
      .filter((p: any) => p["frame-types"] === "admit-all" && p.interface !== name)
      .map((p: any) => p.interface);
    ops.push({
      method: "PUT",
      path: "interface/bridge/vlan",
      body: { bridge: bridge.name, "vlan-ids": String(target), tagged: trunks.join(","), untagged: name },
    });
  }
  setPort({ pvid: String(target), "frame-types": ACCESS, "ingress-filtering": "yes", edge: "yes-discover" });
  for (const v of statics) if (v !== entry) members(v, without(v.tagged), without(v.untagged));
  return { ops, from: port.vlan };
}
