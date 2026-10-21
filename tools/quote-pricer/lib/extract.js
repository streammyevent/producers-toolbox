/* Pulls product name + price out of a product page's HTML. Pure functions, no network. */
"use strict";

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&#(\d+);/g, function (_, n) {
      return String.fromCodePoint(+n);
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) {
      return String.fromCodePoint(parseInt(n, 16));
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|euro);/g, function (_, e) {
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€" }[e];
    })
    .replace(/\s+/g, " ")
    .trim();
}

// "1234.50", "1.234,50", "139,00", "€ 139" -> number | null
function toNumber(v) {
  if (typeof v === "number") return isFinite(v) && v >= 0 ? v : null;
  var t = String(v == null ? "" : v).replace(/[^0-9.,]/g, "");
  if (!/\d/.test(t)) return null;
  var c = t.lastIndexOf(","),
    d = t.lastIndexOf(".");
  if (c >= 0 && d >= 0) t = c > d ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (c >= 0) t = t.replace(",", ".");
  var n = parseFloat(t);
  return isFinite(n) ? n : null;
}

function metaContent(html, key) {
  var re = new RegExp(
    "<meta\\b[^>]*?(?:property|name|itemprop)\\s*=\\s*[\"']" + key.replace(/[.:]/g, "\\$&") + "[\"'][^>]*>",
    "i",
  );
  var m = re.exec(html);
  if (!m) return null;
  var c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(m[0]);
  return c ? decodeEntities(c[1] != null ? c[1] : c[2]) : null;
}

function jsonLdBlocks(html) {
  var out = [],
    re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch (e) {
      /* some shops emit invalid JSON-LD: skip it */
    }
  }
  return out;
}

function typeIs(node, name) {
  var t = node && node["@type"];
  return Array.isArray(t) ? t.indexOf(name) >= 0 : t === name;
}

function findProducts(node, acc) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    node.forEach(function (n) {
      findProducts(n, acc);
    });
    return acc;
  }
  if (typeIs(node, "Product") || typeIs(node, "ProductGroup")) acc.push(node);
  Object.keys(node).forEach(function (k) {
    if (k !== "offers" && typeof node[k] === "object") findProducts(node[k], acc);
  });
  return acc;
}

function offerInfo(offers) {
  var list = Array.isArray(offers) ? offers : offers ? [offers] : [],
    best = null;
  list.forEach(function (o) {
    if (!o || typeof o !== "object") return;
    var spec = Array.isArray(o.priceSpecification) ? o.priceSpecification[0] : o.priceSpecification;
    var price = toNumber(o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : spec && spec.price);
    if (price == null) {
      if (o.offers) best = best || offerInfo(o.offers);
      return;
    }
    var vat = o.valueAddedTaxIncluded != null ? o.valueAddedTaxIncluded : spec && spec.valueAddedTaxIncluded;
    var cand = {
      price: price,
      currency: o.priceCurrency || (spec && spec.priceCurrency) || null,
      vatIncluded: vat == null ? null : vat === true || /^true$/i.test(String(vat)),
    };
    if (!best || cand.price < best.price) best = cand; // cheapest offer, e.g. several sellers
  });
  return best;
}

function extractProduct(html) {
  html = String(html || "");
  var name = null,
    info = null,
    source = null;

  var products = [];
  jsonLdBlocks(html).forEach(function (b) {
    findProducts(b, products);
  });
  for (var i = 0; i < products.length && !info; i++) {
    var p = products[i];
    var oi = offerInfo(p.offers);
    if (oi) {
      info = oi;
      name = p.name ? decodeEntities(p.name) : name;
      source = "json-ld";
    } else if (!name && p.name) name = decodeEntities(p.name);
  }

  if (!info) {
    var amount =
      metaContent(html, "product:price:amount") || metaContent(html, "og:price:amount") || metaContent(html, "price");
    var n = toNumber(amount);
    if (n != null) {
      info = {
        price: n,
        currency:
          metaContent(html, "product:price:currency") ||
          metaContent(html, "og:price:currency") ||
          metaContent(html, "priceCurrency"),
        vatIncluded: null,
      };
      source = "meta";
    }
  }

  if (!name) name = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  if (!name) {
    var t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (t) name = decodeEntities(t[1]);
  }

  return {
    name: name || null,
    price: info ? info.price : null,
    currency: info ? info.currency : null,
    vatIncluded: info ? info.vatIncluded : null,
    source: source,
  };
}

module.exports = { extractProduct, toNumber, decodeEntities };
