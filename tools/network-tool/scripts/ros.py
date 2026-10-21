#!/usr/bin/env python3
"""Minimal RouterOS API client (port 8728), works on v6 and v7.

python3 ros.py HOST /system/resource/print
python3 ros.py HOST /interface/ethernet/set =.id=ether1 =tx-flow-control=off
"""
import socket, sys


class RouterOS:
    def __init__(self, host, user, pw, port=8728):
        self.s = socket.create_connection((host, port), timeout=10)
        self.cmd("/login", f"=name={user}", f"=password={pw}")

    def _len(self, n):
        if n < 0x80: return bytes([n])
        if n < 0x4000: return (n | 0x8000).to_bytes(2, "big")
        if n < 0x200000: return (n | 0xC00000).to_bytes(3, "big")
        if n < 0x10000000: return (n | 0xE0000000).to_bytes(4, "big")
        return b"\xf0" + n.to_bytes(4, "big")

    def _recv(self, n):
        b = b""
        while len(b) < n:
            chunk = self.s.recv(n - len(b))
            if not chunk:
                raise ConnectionError("connection closed")
            b += chunk
        return b

    def _read_len(self):
        c = self._recv(1)[0]
        if c < 0x80: return c
        if c < 0xC0: return ((c & 0x3F) << 8) + self._recv(1)[0]
        if c < 0xE0: return ((c & 0x1F) << 16) + int.from_bytes(self._recv(2), "big")
        if c < 0xF0: return ((c & 0x0F) << 24) + int.from_bytes(self._recv(3), "big")
        return int.from_bytes(self._recv(4), "big")

    def cmd(self, *words):
        """Send a sentence, return list of reply dicts. Raises on !trap."""
        for w in words:
            w = w.encode()
            self.s.sendall(self._len(len(w)) + w)
        self.s.sendall(b"\x00")
        out, err = [], None
        while True:
            sentence = []
            while (n := self._read_len()):
                sentence.append(self._recv(n).decode(errors="replace"))
            kind, attrs = sentence[0], dict(w[1:].split("=", 1) for w in sentence[1:] if w.startswith("="))
            if kind == "!re":
                out.append(attrs)
            elif kind in ("!trap", "!fatal"):
                err = attrs.get("message", str(attrs))
            elif kind == "!done":
                if err:
                    raise RuntimeError(f"{words[0]}: {err}")
                return out


def selfcheck():
    r = RouterOS.__new__(RouterOS)
    assert r._len(5) == b"\x05" and r._len(0x80) == b"\x80\x80" and r._len(0x4000) == b"\xc0\x40\x00"


if __name__ == "__main__":
    selfcheck()
    import pathlib
    e = dict(l.split("=", 1) for l in (pathlib.Path(__file__).parent.parent / ".env").read_text().splitlines() if "=" in l)
    ros = RouterOS(sys.argv[1], e["SWITCH_USER"], e["SWITCH_PASS"])
    for row in ros.cmd(*sys.argv[2:]):
        print(row)
