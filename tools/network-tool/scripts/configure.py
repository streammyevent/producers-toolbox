#!/usr/bin/env python3
"""Apply the standard flypack config to a RouterOS 7 CRS3xx switch. Safe to re-run.

python3 configure.py HOST [IDENTITY]
"""
import pathlib, socket, sys, time

ROOT = pathlib.Path(__file__).parent
exec((ROOT / "ros.py").read_text().split("def selfcheck")[0])  # RouterOS class

# Standard port layout, identical on every mobile switch. ether1, ether2 and SFP+ are trunks (untagged mgmt + all VLANs tagged).
ACCESS = {p: 30 for p in range(3, 7)} | {7: 50, 8: 50} | {p: 60 for p in range(9, 17)} | {p: 40 for p in range(17, 25)}
TRUNKS = ["ether1", "ether2"] + [f"sfp-sfpplus{i}" for i in range(1, 5)]
FALLBACK_IP = "192.168.88.1/24"  # same on every switch, like SwOS; ambiguous when chained
TAGGED_VLANS = [10, 20, 30, 40, 50, 60, 70, 100, 200]  # VLAN plan minus untagged mgmt (1)
# Dante DSCP → traffic class, both strict priority (Dante network admin guide v7.1).
QOS = {"dante-ptp": (56, 7), "dante-audio": (46, 6)}


def upsert(r, menu, match, **attrs):
    """Set attrs on the row matching `match`, or add it."""
    attrs = {k.replace("_", "-"): v for k, v in attrs.items()}
    rows = [x for x in r.cmd(f"{menu}/print") if all(x.get(k) == v for k, v in match.items())]
    if rows:
        if any(rows[0].get(k) != v for k, v in attrs.items()):
            r.cmd(f"{menu}/set", f"=.id={rows[0]['.id']}", *(f"={k}={v}" for k, v in attrs.items()))
    else:
        r.cmd(f"{menu}/add", *(f"={k}={v}" for k, v in {**match, **attrs}.items()))


def configure(r, identity):
    r.cmd("/system/identity/set", f"=name={identity}")

    # Services: no telnet/ftp; api stays for ros.py/audit, www for crew WebFig.
    for s in r.cmd("/ip/service/print"):
        want = "true" if s["name"] in ("telnet", "ftp", "api-ssl", "www-ssl") else "false"
        if s["disabled"] != want:
            r.cmd("/ip/service/set", f"=.id={s['.id']}", f"=disabled={'yes' if want == 'true' else 'no'}")
    r.cmd("/snmp/set", "=enabled=no")
    r.cmd("/ip/neighbor/discovery-settings/set", "=discover-interface-list=all")

    # Ethernet: flow control off everywhere.
    for e in r.cmd("/interface/ethernet/print"):
        if e.get("tx-flow-control") != "off" or e.get("rx-flow-control") != "off":
            r.cmd("/interface/ethernet/set", f"=.id={e['.id']}", "=tx-flow-control=off", "=rx-flow-control=off")

    # Bridge: RSTP at default priority (flypack core stays root), IGMP snooping without querier.
    upsert(r, "/interface/bridge", {"name": "bridge"}, protocol_mode="rstp", priority="0x8000",
           igmp_snooping="yes", multicast_querier="no", igmp_version="3")
    for port, vid in ACCESS.items():
        upsert(r, "/interface/bridge/port", {"interface": f"ether{port}"}, bridge="bridge", pvid=str(vid),
               frame_types="admit-only-untagged-and-priority-tagged", ingress_filtering="yes", edge="yes-discover")
    for t in TRUNKS:
        upsert(r, "/interface/bridge/port", {"interface": t}, bridge="bridge", pvid="1",
               frame_types="admit-all", ingress_filtering="yes", edge="auto")
    for vid in TAGGED_VLANS:
        untagged = ",".join(f"ether{p}" for p, v in ACCESS.items() if v == vid)
        upsert(r, "/interface/bridge/vlan", {"vlan-ids": str(vid)}, bridge="bridge", tagged=",".join(TRUNKS),
               **({"untagged": untagged} if untagged else {}))

    # Management: DHCP from the flypack on untagged VLAN 1, plus the fixed fallback address.
    upsert(r, "/ip/dhcp-client", {"interface": "bridge"}, disabled="no")
    upsert(r, "/ip/address", {"address": FALLBACK_IP}, interface="bridge")

    # QoS: trust DSCP on all ports, PTP and audio into strict-priority queues.
    for name, (dscp, tc) in QOS.items():
        upsert(r, "/interface/ethernet/switch/qos/profile", {"name": name}, traffic_class=str(tc), dscp=str(dscp))
        upsert(r, "/interface/ethernet/switch/qos/map/ip", {"dscp": str(dscp)}, profile=name)
        upsert(r, "/interface/ethernet/switch/qos/tx-manager/queue", {"tx-manager": "default", "traffic-class": str(tc)},
               schedule="strict-priority")
    for p in r.cmd("/interface/ethernet/switch/qos/port/print"):
        if p.get("trust-l3") != "keep":
            r.cmd("/interface/ethernet/switch/qos/port/set", f"=.id={p['.id']}", "=trust-l3=keep")
    r.cmd("/interface/ethernet/switch/set", "=numbers=switch1", "=qos-hw-offloading=yes")

    # VLAN filtering last, behind a dead-man rollback.
    h, m, s = map(int, r.cmd("/system/clock/print")[0]["time"].split(":"))
    t = (h * 3600 + m * 60 + s + 300) % 86400
    upsert(r, "/system/scheduler", {"name": "rollback"}, interval="0s", start_time=f"{t // 3600:02}:{t % 3600 // 60:02}:{t % 60:02}",
           on_event="/interface bridge set bridge vlan-filtering=no; /system scheduler remove rollback")
    upsert(r, "/interface/bridge", {"name": "bridge"}, vlan_filtering="yes")


def main():
    e = dict(l.split("=", 1) for l in (ROOT.parent / ".env").read_text().splitlines() if "=" in l)
    host = sys.argv[1]
    login = lambda: RouterOS(host, e["SWITCH_USER"], e["SWITCH_PASS"])
    r = login()
    identity = sys.argv[2] if len(sys.argv) > 2 else r.cmd("/system/identity/print")[0]["name"]
    try:
        configure(r, identity)
    except (socket.timeout, ConnectionError):
        pass  # vlan-filtering can briefly drop the session
    time.sleep(5)
    r = login()  # still reachable with filtering on → cancel rollback
    for s in r.cmd("/system/scheduler/print"):
        if s["name"] == "rollback":
            r.cmd("/system/scheduler/remove", f"=.id={s['.id']}")
    print(f"{identity} configured, rollback cancelled")


if __name__ == "__main__":
    assert sorted(ACCESS) == list(range(3, 25)) and set(ACCESS.values()) <= set(TAGGED_VLANS)
    main()
