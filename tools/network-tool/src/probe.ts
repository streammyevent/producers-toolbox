// Expanded scan probes: plain UDP sockets, no extra rights. Two of them send traffic (see CLAUDE.md): a DHCP
// DISCOVER, and an IGMP join of the PTP group so the switches forward PTP to this computer.
import { randomInt } from "node:crypto";
import dgram from "node:dgram";
import type { Iface } from "./net";

export type Heard = { t: number; src: string; sport: number; dport: number; data: Uint8Array };
const PTP_GROUP = "224.0.1.129";
const MDNS = "224.0.0.251";

/** An mDNS PTR query. Sent from a port other than 5353, so devices answer by unicast (RFC 6762 6.7). */
export function mdnsQuery(names: string[]) {
  const parts = [Buffer.from([0x4e, 0x54, 0, 0, 0, names.length, 0, 0, 0, 0, 0, 0])];
  for (const n of names) {
    for (const l of n.split(".")) parts.push(Buffer.from([l.length]), Buffer.from(l));
    parts.push(Buffer.from([0, 0, 12, 0, 1]));
  }
  return Buffer.concat(parts);
}

/** A DHCP DISCOVER for this computer's own MAC, with the broadcast flag, so it takes no new address. */
export function discover(mac: string) {
  const b = Buffer.alloc(300);
  b.set([1, 1, 6], 0);
  b.writeUInt32BE(randomInt(2 ** 32 - 1), 4);
  b.writeUInt16BE(0x8000, 10);
  b.set(
    mac.split(":").map((h) => parseInt(h, 16)),
    28,
  );
  b.writeUInt32BE(0x63825363, 236);
  b.set([53, 1, 1, 55, 3, 1, 3, 6, 255], 240);
  return b;
}

/** Listens for `ms` on the PTP, GreenGo and DHCP ports, and asks for Dante and NDI devices. */
export async function probe(iface: Iface, withDhcp: boolean, ms = 4000) {
  const heard: Heard[] = [];
  const errors: string[] = [];
  const socks: dgram.Socket[] = [];
  const open = (port: number, what: string, quiet = false) =>
    new Promise<dgram.Socket | null>((resolve) => {
      const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
      let bound = false;
      s.on("error", (e) => {
        if (bound || !quiet) errors.push(`${what}: ${e.message}`);
        if (!bound) {
          s.close();
          resolve(null);
        }
      });
      s.on("message", (data, r) =>
        heard.push({ t: Date.now(), src: r.address, sport: r.port, dport: s.address().port, data }),
      );
      s.bind(port, () => {
        bound = true;
        socks.push(s);
        resolve(s);
      });
    });
  const tryDo = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      errors.push(`${what}: ${(e as Error).message}`);
    }
  };

  const [mdns, ptpEvent, ptpGeneral] = await Promise.all([
    open(0, "mDNS"),
    open(319, "PTP", true),
    open(320, "PTP", true),
  ]);
  await open(5810, "GreenGo");
  // Port 319/320 can be taken (Dante Controller); then join from any port, so the capture still sees PTP.
  const ptp = [ptpEvent, ptpGeneral].filter((s) => s !== null);
  if (!ptp.length) ptp.push(...[await open(0, "PTP")].filter((s) => s !== null));
  for (const s of ptp) tryDo("PTP", () => s.addMembership(PTP_GROUP, iface.address));
  if (mdns)
    tryDo("mDNS", () => {
      mdns.setMulticastInterface(iface.address);
      mdns.send(mdnsQuery(["_netaudio-arc._udp.local", "_ndi._tcp.local"]), 5353, MDNS);
    });
  if (withDhcp) {
    // The system DHCP client can hold port 68; the offer then only shows in the capture.
    const s = (await open(68, "DHCP", true)) ?? (await open(0, "DHCP"));
    if (s)
      tryDo("DHCP", () => {
        s.setBroadcast(true);
        s.send(discover(iface.mac), 67, "255.255.255.255");
      });
  }
  await new Promise((r) => setTimeout(r, ms));
  for (const s of socks) s.close();
  return { heard, errors };
}
