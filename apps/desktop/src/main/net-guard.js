"use strict";
// Outbound-request guard for tool APIs that fetch URLs on the user's behalf.
// Refuses loopback / private / link-local targets so a tool can't be pointed at the local network.
const dns = require("dns").promises;
const net = require("net");

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return (
    v === "::1" ||
    v === "::" ||
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("fe8") ||
    v.startsWith("fe9") ||
    v.startsWith("fea") ||
    v.startsWith("feb")
  );
}

async function assertPublic(u) {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) links are supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("That address is not allowed.");
}

// fetch() that checks the target on every hop, so a redirect can't lead into the local network.
async function guardedFetch(urlStr, init = {}, maxHops = 5) {
  let u = new URL(urlStr);
  for (let hop = 0; hop < maxHops; hop++) {
    await assertPublic(u);
    const res = await fetch(u, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = new URL(res.headers.get("location"), u);
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}

module.exports = { isPrivateIp, assertPublic, guardedFetch };
