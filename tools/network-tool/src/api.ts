// Main-process API for the Network Tool (see apps/desktop/src/types/toolbox.d.ts). It talks to the local network
// directly, so the page never sends it an address: only an interface name, and a switch id from the last scan.
// The scan state lives here while the app runs, so it survives closing the window.
import fs from "node:fs";
import path from "node:path";
import { forget, learn, portCtx, runChecks, swInfo, type Equipment, type Known, type Seen } from "./checks";
import { unseal, type Creds } from "./creds";
import seed from "./equipment.json";
import { interfaces, pickInterface, rosCall, rosGet, scan, type Scan } from "./net";
import { planChange, portTable } from "./ports";

const LOGINS = ["switchUser", "switchPass", "unifiUser", "unifiPass"] as const;
const MAX_CREDS_FILE = 4096;

let lastSeen: Seen[] = [];
let lastScan: Scan | null = null;
let changing = false;
let running: Promise<object> | null = null;
// Devices seen since the app started, to report the ones that disappear.
const known: Known = new Map();
let knownIface: string | undefined;

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

async function audit(ctx: ToolContext, creds: Creds, iface?: string) {
  const t = performance.now();
  const s = await scan(creds, iface);
  if (s.network.name !== knownIface) known.clear();
  knownIface = s.network.name;
  const { devices, results, seen, networks } = runChecks(s, equipment(ctx), known);
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

/** The one write in the tool: the untagged VLAN of a port on a RouterOS switch. See src/ports.ts. */
async function changePort(creds: Creds, id: string, port: string, vlan: unknown) {
  const sw = lastScan?.switches.find((s) => s.os === "routeros" && swInfo(s).id === id);
  if (!lastScan || !sw) throw new Error(`${id} is not a RouterOS switch in the last scan. Scan again.`);
  const target = vlan === "trunk" ? "trunk" : Number(vlan);
  if (target !== "trunk" && !Number.isInteger(target)) throw new Error("Choose a VLAN.");
  const { switchUser: u, switchPass: p } = creds;
  const ctx = portCtx(lastScan, lastSeen);
  // Decide on the switch as it is now, not as it was at the last scan.
  const plan = planChange(await rosGet(sw.ip, u, p), ctx, port, target);
  if ("error" in plan) throw new Error(plan.error);
  if (!plan.ops.length) return { msg: `No change: ${port} is already on this VLAN.` };
  const name = (v: number | "trunk") => (v === "trunk" ? "trunk" : `${ctx.nets.get(v) ?? "VLAN"} (${v})`);
  const what = `${id} ${port}: ${name(plan.from)} → ${name(target)}`;
  try {
    for (const op of plan.ops) await rosCall(sw.ip, u, p, op.method, op.path, op.body);
  } catch (e) {
    console.log(`port change failed: ${what}: ${(e as Error).message}`);
    throw new Error(`The switch did not accept the change (${(e as Error).message}). Report it to the network lead.`);
  }
  const now = portTable(await rosGet(sw.ip, u, p), ctx).find((x) => x.name === port);
  if (now?.vlan !== target) {
    throw new Error(
      `The switch did not take the change: ${port} is still ${name(now?.vlan ?? plan.from)}. Report it to the network lead.`,
    );
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

  async "audit.run"(ctx: ToolContext, iface: unknown) {
    const creds = requireLogins(ctx);
    const name = interfaces().some((i) => i.name === iface) ? (iface as string) : undefined;
    running ??= audit(ctx, creds, name).finally(() => (running = null));
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

  async "port.change"(ctx: ToolContext, id: unknown, port: unknown, vlan: unknown) {
    const creds = requireLogins(ctx);
    if (changing) throw new Error("Another port change is running. Wait a moment.");
    changing = true;
    try {
      return await changePort(creds, String(id), String(port), vlan);
    } finally {
      changing = false;
    }
  },
};
