// Packet capture for the expanded scan: tcpdump on macOS, pktmon on Windows, in 10 s files in the tool's data
// folder. Rights are asked only when the capture starts and this computer has no capture access:
// - macOS with readable /dev/bpf* (Wireshark's ChmodBPF): tcpdump runs as the user, no prompt.
// - macOS otherwise: one admin prompt. tcpdump -Z drops to the user right after it opens BPF, so the app reads,
//   deletes and stops it as the user; a root watchdog stops it when the app is gone.
// - Windows: one UAC prompt for a pktmon loop; it stops on a stop file or when the app is gone.
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCapture, type Frame } from "./wire";

const FILTER = "ether multicast or udp port 68";
const SNAP = "600"; // DHCP options and mDNS answers fit; audio payload mostly does not
const SAFE = /^[\w.-]+$/;
const PROMPT = "Network Tool needs administrator rights once to capture network packets for the expanded scan.";

type How = "tcpdump" | "tcpdump (admin)" | "pktmon";
let session: { iface: string; dir: string; how: How } | null = null;
let child: ChildProcess | null = null;
let failed: string | undefined;
let failedIface: string | undefined;

const sq = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

export function tcpdumpArgs(iface: string, dir: string, user?: string) {
  return [
    ...(user ? ["-Z", user] : []),
    ...["-i", iface, "-s", SNAP, "-U", "-G", "10", "-w", path.join(dir, "cap-%s.pcap"), FILTER],
  ];
}

/** AppleScript for macOS without capture access. The command is inline: root never runs a file the user can edit. */
export function adminScript(iface: string, dir: string, user: string, appPid: number) {
  const cmd = ["/usr/sbin/tcpdump", ...tcpdumpArgs(iface, dir, user)].map(sq).join(" ");
  const pidFile = sq(path.join(dir, "tcpdump.pid"));
  const sh =
    `${cmd} >/dev/null 2>&1 & t=$!; echo $t > ${pidFile}; ` +
    `(while kill -0 ${appPid} && kill -0 $t; do sleep 5; done; kill $t) >/dev/null 2>&1 &`;
  const as = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return `do shell script ${as(sh)} with prompt ${as(PROMPT)} with administrator privileges`;
}

/** PowerShell loop for Windows, run elevated. pktmon has no privilege drop, so it ends itself. */
export function pktmonScript(dir: string, appPid: number) {
  return [
    `$d = '${dir.replaceAll("'", "''")}'`,
    "pktmon stop | Out-Null",
    `while ((Get-Process -Id ${appPid} -ErrorAction SilentlyContinue) -and -not (Test-Path "$d\\stop")) {`,
    `  pktmon start --capture --comp nics --pkt-size ${SNAP} --file-name "$d\\cur.etl" | Out-Null`,
    "  Start-Sleep -Seconds 10",
    "  pktmon stop | Out-Null",
    `  pktmon etl2pcap "$d\\cur.etl" --out "$d\\next.pcapng" | Out-Null`,
    `  Move-Item -Force "$d\\next.pcapng" "$d\\cap-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).pcapng"`,
    "}",
    "pktmon stop | Out-Null",
    `Remove-Item -ErrorAction SilentlyContinue "$d\\cur.etl"`,
  ].join("\n");
}

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, timeout: 120_000 }, (err, _out, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim())) : resolve(),
    ),
  );

function canBpf() {
  try {
    fs.accessSync("/dev/bpf0", fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts capture on `iface`, or keeps the running one. `declined` when crew cancel the prompt. After a failure it
 * does not try again (that would prompt every scan) until `resetCapture()`.
 */
export async function startCapture(iface: string, dataDir: string): Promise<{ declined?: boolean }> {
  if (session?.iface === iface || failedIface === iface) return {};
  stopCapture();
  failed = undefined;
  failedIface = iface;
  if (!SAFE.test(iface)) {
    failed = "unsupported interface name";
    return {};
  }
  const root = path.join(dataDir, "capture");
  // Each session gets its own folder: an old Windows loop may still hold its files for up to 10 s.
  for (const old of fs.existsSync(root) ? fs.readdirSync(root) : [])
    try {
      fs.rmSync(path.join(root, old), { recursive: true, force: true });
    } catch {
      // still in use, removed next time
    }
  const dir = path.join(root, String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (process.platform === "darwin" && canBpf() && !process.env.NETWORK_TOOL_ADMIN_CAPTURE) {
      const c = spawn("/usr/sbin/tcpdump", tcpdumpArgs(iface, dir), { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      c.stderr?.on("data", (d) => (err += d));
      c.on("exit", (code) => {
        if (child === c && code) failed = `tcpdump stopped: ${err.trim().split("\n").pop()}`;
        if (child === c) child = null;
      });
      child = c;
      session = { iface, dir, how: "tcpdump" };
    } else if (process.platform === "darwin") {
      const user = os.userInfo().username;
      if (!SAFE.test(user)) throw new Error("unsupported user name");
      await run("osascript", ["-e", adminScript(iface, dir, user, process.pid)]);
      session = { iface, dir, how: "tcpdump (admin)" };
    } else if (process.platform === "win32") {
      const enc = Buffer.from(pktmonScript(dir, process.pid), "utf16le").toString("base64");
      const args = `'-NoProfile','-NonInteractive','-EncodedCommand','${enc}'`;
      await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList ${args}`,
      ]);
      session = { iface, dir, how: "pktmon" };
    } else failed = "packet capture is not available on this system";
  } catch (e) {
    const msg = (e as Error).message;
    if (/cancel/i.test(msg)) return { declined: true };
    failed = msg;
  }
  if (session) failedIface = undefined;
  return {};
}

/** Stops capture and allows a new attempt (and prompt). */
export function resetCapture() {
  stopCapture();
  failed = failedIface = undefined;
}

/** PID of the tcpdump the admin script started, if it still runs. Only ours: a PID can be reused. */
function adminPid(dir: string) {
  try {
    const pid = Number(fs.readFileSync(path.join(dir, "tcpdump.pid"), "utf8"));
    const comm = execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim();
    return comm.endsWith("tcpdump") ? pid : undefined;
  } catch {
    return undefined;
  }
}

export function stopCapture() {
  if (!session) return;
  const { dir, how } = session;
  session = null;
  if (child) child.kill();
  child = null;
  const pid = how === "tcpdump (admin)" ? adminPid(dir) : undefined;
  if (pid) process.kill(pid);
  // Captured packets do not stay on disk. The pktmon loop still holds its folder; the next start removes it.
  if (how === "pktmon") fs.writeFileSync(path.join(dir, "stop"), "");
  else fs.rmSync(dir, { recursive: true, force: true });
}

export function captureStatus() {
  if (failed) return `capture off: ${failed}`;
  return session ? `capture on: ${session.how} on ${session.iface}` : "capture off";
}

/** Frames from the files that are complete, then deletes those files. */
export function readNew(): Frame[] {
  if (!session) return [];
  const { dir, how } = session;
  if (how === "tcpdump (admin)" && !adminPid(dir)) failed = "tcpdump stopped";
  const num = (f: string) => Number(f.match(/\d+/)?.[0]);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^cap-\d+\.pcap(ng)?$/.test(f))
    .sort((a, b) => num(a) - num(b));
  // tcpdump is still writing the newest file; pktmon renames a file only when it is complete.
  const frames: Frame[] = [];
  for (const f of how === "pktmon" ? files : files.slice(0, -1)) {
    const p = path.join(dir, f);
    try {
      for (const fr of readCapture(fs.readFileSync(p))) frames.push(fr);
    } catch {
      // unreadable file: skip it
    }
    fs.rmSync(p, { force: true });
  }
  return frames;
}

process.on("exit", stopCapture);
