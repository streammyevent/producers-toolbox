# Network Tool

An audit tool for the Stream My Event flypack network, inside the Producers Toolbox. It finds the UniFi core and the MikroTik switches (SwOS or RouterOS) on the local network, reads their configuration, and reports what is wrong for Dante, multicast, VLANs and STP. It also reports devices that drop off the network. Crew run it on a laptop that is patched into the flypack.

The tool changes only one thing on the network: the VLAN of a port on a MikroTik switch that runs RouterOS (see below). It does not change UniFi or SwOS switches.

## For crew

1. Install the Producers Toolbox and open **Network Tool**.
2. The first time: choose the crew code file from the network lead and type the crew code, then click **Import**. The tool keeps the switch and UniFi logins on this computer, encrypted. You do this once per computer.
3. Connect the laptop to the flypack network with a cable. The tool scans every 30 seconds.
4. On a Mac, allow local network access when macOS asks. If you clicked "Don't Allow": open System Settings → Privacy & Security → Local Network and turn on Producers Toolbox.

The tool shows a list of every device it found: the UniFi gear, the MikroTik switches and all equipment, each with its status. The worst devices are at the top. Click a device to see its full status in the panel next to the list. Each result is FAIL, WARN, PASS or INFO. Every FAIL comes with the steps to fix it. If you can't fix a problem, report it to the network lead.

### Change the VLAN of a port

1. In the list, select a MikroTik switch that runs RouterOS. The panel shows the front of the switch. The colour of each port shows its VLAN, and the legend gives the names. A green light means the port has a link.
2. Click the port. The tool shows its speed and the devices connected to it.
3. In **Untagged VLAN**, select the new network. Only UniFi networks are in the list.
4. Click **Set ether… to …**. The port changes immediately and the tool scans again.

Some ports are locked (dashed outline). The tool tells you why: ports 1 and 2 are always trunks, and the tool does not change a port that connects to the core, to another switch or to this computer. A trunk port (T) carries all VLANs. Only SFP+ ports can be set back to trunk.

## For the network lead

`.env` in this folder holds the plain logins and is never committed:

```
SWITCH_USER=...
SWITCH_PASS=...
UNIFI_USER=...
UNIFI_PASS=...
```

`pnpm build && pnpm make-creds` encrypts them into `creds.enc` with a crew code (PBKDF2 600k + AES-256-GCM). Keep `creds.enc` private (a shared drive or a password manager) and give crew the file and the code. When the logins or the code change, make a new file; crew import it again. The file never goes into the app or the repo: the app and this repo are public, and a sealed file that anyone can download can be attacked offline.

`scripts/configure.py HOST [IDENTITY]` applies the standard flypack config to a RouterOS 7 switch (safe to re-run). `scripts/ros.py` is a small RouterOS API client. Both read `.env`.

`node scripts/dump.js tests/fixtures/<date> [cidr]` captures a scan as test fixtures. It removes secrets and personal data first (`scripts/sanitize.js`).

## Critical VLANs

The tool does not use a fixed VLAN plan. It reads the networks from UniFi and treats every network whose name contains **Dante**, **GreenGo**, **KVM** or **Control** as a *critical VLAN*. Critical VLANs get the strict checks: an IGMP querier is required, no Wi-Fi clients, 1 Gbit/s ports, and edge ports. If no network name matches, the tool warns: usually a network has been renamed.

## What it checks

**UniFi** (the gateway is the controller at `/api/auth/login`, site `default`):
- The networks it found, and which of them are critical
- The IGMP querier: the core switch only. FAIL when a critical VLAN has no querier
- Snooping without a querier or flooding on critical VLANs
- Core STP priority 4096, flow control off
- Per port: speed and QoS on critical VLAN ports, half duplex, rx/tx errors, edge state
- Clients: link-local (169.254.x) addresses, wireless clients on a critical VLAN

**MikroTik switches** are found with a ping sweep, then by MikroTik OUI in the ARP table, or by their login challenge: SwOS puts the model name in it, RouterOS answers its REST API with a Basic challenge and a JSON error.

**MikroTik SwOS** (read through the SwOS `.b` pages with HTTP digest auth):
- Links of 100M or slower, flow control, half duplex
- IGMP snooping and querier against the UniFi querier setup
- STP root is the flypack core
- RSTP edge ports
- Strict-mode PVIDs that are missing from the VLAN table, and PVIDs that are not a UniFi network

**MikroTik RouterOS 7** (read through the REST API at `http://<switch>/rest` with Basic auth, so the `www` service must be on). The tool also runs two `monitor` commands, for the STP root and the link speeds. REST sends these as POST, but they change nothing.
- Links of 100M or slower: FAIL without strict-priority QoS for DSCP 56 and 46 (Dante PTP and audio), otherwise INFO
- QoS in hardware, trust DSCP, DSCP 56 and 46 into strict-priority queues
- VLAN filtering on, every bridge port switched in hardware (not by the CPU)
- Flow control, half duplex, CRC errors
- IGMP snooping on, querier off, querier seen upstream; learned groups
- STP root is the flypack core; access ports are edge
- Access PVIDs that are missing from the bridge VLAN table, and PVIDs that are not a UniFi network

Configuration drift on RouterOS (VLAN filtering, QoS, hardware offload) is not fixed by crew: the fix tells them to report it.

**Equipment**: every client MAC is matched against the equipment list (`src/equipment.json`, by full MAC or OUI). The tool warns when a device is on a network it does not expect. In the list, `vlan` entries can be network names (`"Dante"`, matched case-insensitively) or VLAN IDs (`1`). **Add unknown devices** adds the unknown OUIs from the last scan, with their network names, to the list on that computer (the tool's data folder). The network lead moves good entries into `src/equipment.json`, so every computer gets them with the next update.

**Missing devices**: the app remembers every wired device and every online UniFi device it has seen since it started. A device that is gone for 2 scans in a row (about a minute) is reported: FAIL on a critical VLAN, WARN elsewhere. Wireless clients are not tracked. **Forget missing** clears the list after you remove gear on purpose. The memory resets when the Producers Toolbox restarts or when you pick another network interface.

The core switch is the online UniFi switch with the most ports.

## Credits

The background music is public-domain Drozerix tracks played with chiptune3 (MIT) and libopenmpt (BSD-3-Clause). The fonts are Press Start 2P and VT323 (SIL Open Font License). See `web/THIRD_PARTY_NOTICES.txt`; the tool shows it under **Credits & licenses**.
