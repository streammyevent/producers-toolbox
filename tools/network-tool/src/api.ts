// Main-process API for the Network Tool (see apps/desktop/src/types/toolbox.d.ts). It talks to the local network
// directly, so the page never sends it an address: only an interface name, and a switch id from the last scan.
// The scan state lives here while the app runs, so it survives closing the window.
import fs from "node:fs";
import path from "node:path";
import { captureStatus, readNew, resetCapture, startCapture } from "./capture";
import {
  forget,
  learn,
  networks as unifiNets,
  portCtx,
  runChecks,
  swInfo,
  type Counters,
  type Equipment,
  type Known,
  type Seen,
} from "./checks";
import { unseal, type Creds } from "./creds";
import seed from "./equipment.json";
import { contains, interfaces, pickInterface, rosCall, rosGet, scan, type Scan } from "./net";
import { planChange, portTable } from "./ports";
import { probe } from "./probe";
import { age, decode, observe, observeUdp, type Memory, type Packet } from "./wire";

const LOGINS = ["switchUser", "switchPass", "unifiUser", "unifiPass"] as const;
const MAX_CREDS_FILE = 4096;

let lastSeen: Seen[] = [];
let lastScan: Scan | null = null;
let changing = false;
let running: Promise<object> | null = null;
// Devices seen since the app started, to report the ones that disappear.
const known: Known = new Map();
const counters: Counters = new Map();
let knownIface: string | undefined;
// Expanded scan: what the wire showed in the last minutes, and whether crew declined the capture prompt.
const wire: Memory = new Map();
let declined = false;
let lastDhcp = 0;
let idle: NodeJS.Timeout | undefined;
const DHCP_EVERY_MS = 5 * 60_000;
const IDLE_MS = 2 * 60_000;

function logins(ctx: ToolContext): Creds | null {
  const [switchUser, switchPass, unifiUser, unifiPass] = LOGINS.map((n) => ctx.secrets.get(n));
  return switchUser && switchPass && unifiUser && unifiPass ? { switchUser, switchPass, unifiUser, unifiPass } : null;
}

function requireLogins(ctx: ToolContext): Creds {
  const creds = logins(ctx);
  if (!creds) throw new Error("No logins on this computer. Import the crew code file first.");
  return creds;
}

// The bundled list ships with the app; "Add unknown devices" keeps its additions per computer.
const localFile = (ctx: ToolContext) => path.join(ctx.dataDir, "equipment.json");
function localEquipment(ctx: ToolContext): Equipment[] {
  try {
    const list = JSON.parse(fs.readFileSync(localFile(ctx), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
const equipment = (ctx: ToolContext): Equipment[] => [...(seed as Equipment[]), ...localEquipment(ctx)];

function stopExpanded() {
  clearTimeout(idle);
  resetCapture();
  wire.clear();
  declined = false;
}

async function audit(ctx: ToolContext, creds: Creds, iface: string | undefined, expanded: boolean) {
  const t = performance.now();
  clearTimeout(idle);
  const net = expanded ? await pickInterface(iface) : null;
  if (!net) stopExpanded();
  else {
    if (!declined) declined = !!(await startCapture(net.name, ctx.dataDir)).declined;
    // The window can close without turning the scan off: stop capturing when nobody asks.
    idle = setTimeout(stopExpanded, IDLE_MS);
  }
  const dhcp = !!net && Date.now() - lastDhcp > DHCP_EVERY_MS;
  if (dhcp) lastDhcp = Date.now();
  const [s, heard] = await Promise.all([scan(creds, iface), net ? probe(net, dhcp) : null]);
  if (s.network.name !== knownIface) {
    known.clear();
    wire.clear();
    counters.clear();
  }
  knownIface = s.network.name;
  if (heard) {
    // Untagged frames are on the VLAN of this computer.
    const own = [...unifiNets(s.unifi).subnets].find(([, c]) => contains(c, s.network.address))?.[0] ?? 1;
    const frames = readNew();
    observe(
      wire,
      frames.map(decode).filter((p): p is Packet => p !== null),
      own,
    );
    for (const h of heard.heard) observeUdp(wire, { ...h, vlan: own });
    age(wire, Date.now());
    s.wire = {
      obs: [...wire.values()],
      capture: declined
        ? "capture off: permission declined. Turn Expanded scan off and on to ask again"
        : captureStatus(),
      packets: frames.length,
      errors: heard.errors,
    };
  }
  const { devices, results, seen, networks } = runChecks(s, equipment(ctx), known, new Date().toISOString(), counters);
  lastSeen = seen;
  lastScan = s;
  return {
    network: s.network,
    devices,
    results,
    seen,
    networks,
    scannedAt: new Date().toISOString(),
    ms: Math.round(performance.now() - t),
  };
}

/** The one write in the tool: the VLAN (or trunk) of ports on a RouterOS switch. See src/ports.ts. */
async function changePorts(creds: Creds, id: string, names: string[], vlan: unknown) {
  const sw = lastScan?.switches.find((s) => s.os === "routeros" && swInfo(s).id === id);
  if (!lastScan || !sw) throw new Error(`${id} is not a RouterOS switch in the last scan. Scan again.`);
  const target = vlan === "trunk" ? "trunk" : Number(vlan);
  if (target !== "trunk" && !Number.isInteger(target)) throw new Error("Choose a VLAN.");
  const { switchUser: u, switchPass: p } = creds;
  const ctx = portCtx(lastScan, lastSeen);
  // Decide on the switch as it is now, not as it was at the last scan.
  const plan = planChange(await rosGet(sw.ip, u, p), ctx, names, target);
  if ("error" in plan) throw new Error(plan.error);
  if (!plan.ops.length) return { msg: "No change: already on this VLAN." };
  const name = (v: number | "trunk") => (v === "trunk" ? "trunk" : `${ctx.nets.get(v) ?? "VLAN"} (${v})`);
  const changed = plan.ports.map((x) => x.name);
  const from = [...new Set(plan.ports.map((x) => name(x.vlan)))];
  const what = `${id} ${changed.join(", ")}: ${from.join(", ")} → ${name(target)}`;
  try {
    for (const op of plan.ops) await rosCall(sw.ip, u, p, op.method, op.path, op.body);
  } catch (e) {
    console.log(`port change failed: ${what}: ${(e as Error).message}`);
    throw new Error(`The switch did not accept the change (${(e as Error).message}). Report it to the network lead.`);
  }
  const now = portTable(await rosGet(sw.ip, u, p), ctx);
  const failed = changed.filter((n) => now.find((x) => x.name === n)?.vlan !== target);
  if (failed.length) {
    throw new Error(`The switch did not take the change on ${failed.join(", ")}. Report it to the network lead.`);
  }
  console.log(`port changed: ${what}`);
  return { msg: `Done: ${what}` };
}

export const methods = {
  async "status.get"(ctx: ToolContext) {
    const net = await pickInterface().catch(() => null);
    return { hasLogins: !!logins(ctx), interfaces: interfaces(), defaultIface: net?.name };
  },

  /** Unseals a creds.enc file (scripts/make-creds.js) with the crew code and stores the logins on this computer. */
  async "creds.import"(ctx: ToolContext, file: unknown, code: unknown) {
    if (typeof file !== "string" || file.length > MAX_CREDS_FILE || typeof code !== "string") {
      throw new Error("This is not a crew code file.");
    }
    let creds: Creds;
    try {
      creds = await unseal(file, code);
    } catch {
      throw new Error("Wrong crew code, or this is not a crew code file.");
    }
    for (const name of LOGINS) {
      if (typeof creds[name] !== "string" || !creds[name]) throw new Error("The crew code file is incomplete.");
    }
    for (const name of LOGINS) ctx.secrets.set(name, creds[name]);
    known.clear();
    return true;
  },

  async "audit.run"(ctx: ToolContext, iface: unknown, expanded: unknown) {
    const creds = requireLogins(ctx);
    const name = interfaces().some((i) => i.name === iface) ? (iface as string) : undefined;
    running ??= audit(ctx, creds, name, expanded === true).finally(() => (running = null));
    return running;
  },

  "known.forget"() {
    forget(known);
    return true;
  },

  "equipment.learn"(ctx: ToolContext) {
    const before = equipment(ctx);
    const added = learn(lastSeen, before).slice(before.length);
    if (added.length) {
      fs.mkdirSync(ctx.dataDir, { recursive: true });
      fs.writeFileSync(localFile(ctx), JSON.stringify([...localEquipment(ctx), ...added], null, 2) + "\n");
    }
    return { added: added.length };
  },

  async "port.change"(ctx: ToolContext, id: unknown, ports: unknown, vlan: unknown) {
    const creds = requireLogins(ctx);
    if (!Array.isArray(ports) || !ports.length || ports.length > 28 || !ports.every((x) => typeof x === "string")) {
      throw new Error("Choose one or more ports.");
    }
    if (changing) throw new Error("Another port change is running. Wait a moment.");
    changing = true;
    try {
      return await changePorts(creds, String(id), [...new Set(ports)], vlan);
    } finally {
      changing = false;
    }
  },
};
