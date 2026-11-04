# CLAUDE.md

Network Tool: audit app for the flypack network (UniFi core + MikroTik switches on SwOS or RouterOS 7). Read-only,
except for one action: changing the VLAN of ports on a RouterOS switch (or setting them to trunk). See README.md for
what it checks.

## Layout

- `src/` (TypeScript, compiled to `out/` by `pnpm build`; `api.js` re-exports `out/api.js`):
  - `api.ts`: the methods the page calls (`status.get`, `creds.import`, `audit.run`, `known.forget`,
    `equipment.learn`, `port.change`). It holds the state while the app runs: the last scan, the `known` devices.
  - `net.ts`: data collection. Interface and gateway detection (macOS `route`/`arp`, Windows `route print`/`arp -a`),
    ping sweep, SwOS digest-auth client and literal parser, RouterOS REST client (`rosGet`), UniFi API client. Produces
    a `Scan`; each `Switch` is `os: "swos"` (`pages`) or `os: "routeros"` (`ros`, keyed by REST path).
  - `checks.ts`: pure functions over a `Scan`. `auditSwos` and `auditRouterOS` give the same message for the same
    check; `swInfo()` gives id/MAC/IP for both. `runChecks(scan, equipment, known, now, counters)` returns
    `{ devices, results, seen }` and updates `known` (missing-device tracking) and `counters` (port error samples of
    the last 5 minutes, for a rising error rate, and to clear errors from a link-up when the window is clean).
    `networks()` derives VLAN names and critical VLANs from UniFi.
    `locate()` fills `Seen.links` (per VLAN: IPs and port). The port is the edge port: where the MAC is learned and
    no network gear is (uplinks always see the core or the next switch). Without one, UniFi's client location.
  - `ports.ts`: the only write path. `portTable()` (per port: VLAN or trunk, link, connected devices, lock reason) and
    `planChange()` (the REST ops that put one or more ports on a VLAN, or why not; one plan for all ports, because
    separate plans would overwrite each other's bridge VLAN entries). Pure; `api.ts` runs the ops.
  - `creds.ts`: seal/unseal of the crew code file (PBKDF2-SHA256 600k, AES-GCM).
  - Expanded scan (opt-in, `audit.run(iface, expanded)`): `wire.ts` is pure (pcap/pcapng readers, decoders, the
    observation memory `observe()`/`age()`, `wireChecks()`, `wireQueriers()` for the UniFi querier count).
    `probe.ts` runs UDP probes during the scan. `capture.ts` runs the packet capture in 10 s files under
    `dataDir/capture/`. `api.ts` keeps the memory (5 min; an IGMP query comes every ~125 s).
  - `equipment.json`: known MAC/OUI → type + allowed networks (names or VIDs). "Add unknown devices" writes additions
    to the tool's data folder on that computer; the list is this file plus those additions.
- `web/`: `index.html`, `styles.css`, `app.js` (vanilla JS, retro/keygen theme with tracker music). A device list with
  a detail panel; the selection survives the 30 s auto-scan. Cmd+K / Ctrl+K searches the devices of the last scan.
  `vendor/chiptune3/` plays the `.xm` tracks in `music/`.
- `scripts/` (dev and network-lead tools, not shipped): `make-creds.js` (`.env` → `creds.enc`), `dump.js` (captures
  sanitized fixtures), `sanitize.js`, `configure.py` + `ros.py` (standard RouterOS config, over the API on port 8728).
- `tests/`: `checks.test.js` against `tests/fixtures/` (SwOS + UniFi from 2026-10-06, RouterOS + UniFi in
  `2026-10-07/`). Each set has an `expected.json` verdict snapshot (`UPDATE_SNAPSHOT=1 pnpm test`). `wire.test.js`
  builds its frames in the test: no real captures in the repo.

## Rules

- **Read-only towards the network, with one exception: the port VLAN change** (`src/ports.ts`, `port.change`). Never
  add other writes, and never write to SwOS or UniFi. RouterOS `monitor ... once` is a POST but only reads.
- The expanded scan sends exactly two things, and changes no configuration: a DHCP DISCOVER with this computer's own
  MAC (at most every 5 min) and an IGMP join of the PTP group 224.0.1.129. Everything else in it only listens.
- Packet capture asks for rights only when the expanded scan starts and the computer has no capture access. macOS:
  tcpdump directly when `/dev/bpf*` is readable, else one admin prompt that runs `tcpdump -Z <user>` (drops root right
  after opening BPF) plus a root watchdog, as an inline command: root never runs a file the user can edit. Windows: one
  UAC prompt for an elevated pktmon loop that ends on a `stop` file or when the app is gone. After a cancel or a
  failure it does not ask again until crew turn the expanded scan off and on. The page passes only the toggle; the
  interface name is checked against `interfaces()`.
- Port change rules (enforced in `planChange`, in the main process): RouterOS only; only VLANs that are UniFi networks;
  ether1/ether2 never; locked: the root port, ports with switches or UniFi gear behind them (MAC or received BPDUs),
  and the port of this computer. `api.ts` re-reads the switch before the change and verifies after.
- The page never passes an address to the main process: only an interface name (checked against `interfaces()`) and a
  switch id from the last scan.
- Re-running `configure.py` resets every port to the standard layout.
- **Critical VLAN** = a UniFi network whose name matches `CRITICAL` (Dante, GreenGo, KVM, Control). No fixed VLAN plan:
  roles come from names, and VIDs differ per flypack. Use the term "critical VLAN" the same way in all copy.
- Missing devices: memory exists only while the app runs. A device counts as missing after `MISS_LIMIT` scans in a
  row. A failed UniFi read must not mark UniFi clients as missing.
- Discovery must not depend on ARP alone: macOS can hide the ARP and routing table from the app (Local Network
  privacy). The fallback is the login challenge: the SwOS digest realm (board model), or the RouterOS REST 401
  (`isRouterOs`). On macOS the app needs Local Network access (`NSLocalNetworkUsageDescription` in
  `apps/desktop/electron-builder.yml`); the fixes for "can't read UniFi" and "no switches" say where to allow it.
- SwOS and RouterOS: fetch one page at a time per switch. The SwOS web server handles concurrent requests badly, and
  the CRS3xx CPU is slow.
- RouterOS REST values are all strings (`"true"`, `"60"`). Fixes for config drift on RouterOS send crew to the network
  lead, not into WebFig.
- SwOS data is hex-encoded strings (`hexstr`), port bitmasks (`bits`) and little-endian IPs (`ipLE`).
- Every FAIL needs a `fix` with crew-level instructions (tested). Every result must map to a device in the list
  (tested).
- Devices: one per UniFi device, SwOS switch and endpoint (endpoint id = MAC). Network gear also appears as a client;
  `owners()` in checks.ts maps those MACs (and per-port MACs just above a base MAC) to the gear's row, so nothing shows
  twice.
- Crew-facing copy is plain English and follows ASD-STE100: imperative, short, with the exact UI path to click.
- Logins: only in the shell's encrypted secret store (`switchUser`, `switchPass`, `unifiUser`, `unifiPass`), put there
  by `creds.import`. Never in the app, the repo or a release: a sealed file in a public download can be brute-forced
  offline. `creds.enc` and `.env` are git-ignored and blocked by `pnpm check:secrets`.
- Fixtures are real dumps. Run new ones through `scripts/sanitize.js` (`dump.js` does this): UniFi returns the device
  SSH password, adoption keys and Wi-Fi keys in `x_*` fields. `tests/fixtures.test.js` fails when one comes back.

## Commands

```sh
pnpm build                          # src/ → out/ (pnpm start at the root does this too)
pnpm test                           # after pnpm build
pnpm make-creds                     # .env → creds.enc, asks for the crew code
node scripts/dump.js tests/fixtures/<date> [cidr]   # read-only capture, sanitized
```

`.env` (in this folder) contains real credentials. Never print or commit it.
