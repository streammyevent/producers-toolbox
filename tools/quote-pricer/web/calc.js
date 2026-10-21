/* Pure pricing helpers for the quotation tool. All prices are ex BTW (Rentman adds BTW itself).
   Works in the browser (window.QuoteCalc) and in Node (module.exports) so tests can load it. */
(function (root) {
  "use strict";

  // Round half up to 2 decimals; the epsilon guards against binary float artefacts (1.005 etc.).
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // "€ 139,00", "1.234,56", "139.00", "139" -> number; anything unusable -> null
  function parseEuro(s) {
    if (typeof s === "number") return isFinite(s) ? s : null;
    if (s == null) return null;
    var t = String(s)
      .replace(/[€\s\u00a0]/g, "")
      .replace(/[^0-9.,-]/g, "");
    if (!/\d/.test(t)) return null;
    var hasComma = t.indexOf(",") >= 0,
      hasDot = t.indexOf(".") >= 0;
    if (hasComma && hasDot) {
      // the later separator is the decimal one
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if (hasComma) {
      t = t.replace(",", ".");
    } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
      t = t.replace(/\./g, ""); // "1.234" / "1.234.567" are thousands separators
    }
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  // "21%", "21", "21,5 %" -> 21 / 21.5 (percent points, not a fraction)
  function parsePct(s) {
    if (typeof s === "number") return isFinite(s) ? s : null;
    if (s == null) return null;
    var t = String(s).replace("%", "").replace(",", ".").trim();
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  // Cost ex BTW. extOverride (a typed-in EXT) wins; otherwise strip BTW only when the buy price includes it.
  function calcExt(item) {
    if (item.extOverride != null && item.extOverride !== "") return round2(Number(item.extOverride));
    var buy = Number(item.buyPrice) || 0;
    var vat = Number(item.vat) || 0;
    return round2(item.buyIncl ? buy / (1 + vat / 100) : buy);
  }

  // Sale price ex BTW = EXT x (1 + margin%)
  function calcSale(ext, margin) {
    return round2(ext * (1 + (Number(margin) || 0) / 100));
  }

  function itemSale(item, marginOverride) {
    var m = marginOverride != null && marginOverride !== "" ? marginOverride : item.margin;
    return calcSale(calcExt(item), m);
  }

  // Resolve one quote line to { type, desc, qty, unitCost, unitSale, total, cost }.
  // Groups carry no money themselves; their subtotal is filled in by quoteTotals.
  function resolveLine(line, itemsById) {
    if (line.type === "group") return { type: "group", desc: line.title || "", total: 0, cost: 0 };
    var qty = Number(line.qty);
    if (!isFinite(qty)) qty = 0;
    var unitCost, unitSale, desc;
    if (line.type === "custom") {
      desc = line.name || "";
      unitCost = Number(line.cost) || 0;
      unitSale = Number(line.price) || 0;
    } else {
      var item = itemsById[line.itemId];
      if (!item)
        return {
          type: "item",
          desc: "(item removed)",
          missing: true,
          qty: qty,
          unitCost: 0,
          unitSale: 0,
          total: 0,
          cost: 0,
        };
      desc = item.name;
      unitCost = calcExt(item);
      unitSale = itemSale(item, line.margin);
    }
    return {
      type: line.type,
      desc: desc,
      qty: qty,
      unitCost: unitCost,
      unitSale: unitSale,
      total: round2(unitSale * qty),
      cost: round2(unitCost * qty),
    };
  }

  // Totals for a whole quote, with per-group subtotals (a group runs until the next group heading).
  function quoteTotals(lines, itemsById) {
    var resolved = [],
      total = 0,
      cost = 0,
      groupIdx = -1;
    lines.forEach(function (l) {
      var r = resolveLine(l, itemsById);
      if (r.type === "group") {
        r.total = 0;
        r.cost = 0;
        groupIdx = resolved.length;
      } else {
        total += r.total;
        cost += r.cost;
        if (groupIdx >= 0) {
          resolved[groupIdx].total = round2(resolved[groupIdx].total + r.total);
          resolved[groupIdx].cost = round2(resolved[groupIdx].cost + r.cost);
        }
      }
      resolved.push(r);
    });
    total = round2(total);
    cost = round2(cost);
    var profit = round2(total - cost);
    return {
      lines: resolved,
      total: total,
      cost: cost,
      profit: profit,
      marginPct: total > 0 ? round2((profit / total) * 100) : 0,
    };
  }

  // ---- CSV (Google Sheets export, comma/semicolon/tab, quoted fields) ----
  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, "");
    var first = text.split(/\r?\n/, 1)[0] || "";
    var delim = ",";
    [";", "\t"].forEach(function (d) {
      if (first.split(d).length > first.split(delim).length) delim = d;
    });
    var rows = [],
      row = [],
      field = "",
      q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (f) {
        return String(f).trim() !== "";
      });
    });
  }

  function csvEscape(v, delim) {
    var s = String(v == null ? "" : v);
    return s.indexOf('"') >= 0 || s.indexOf(delim) >= 0 || /[\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows, delim) {
    delim = delim || ",";
    return rows
      .map(function (r) {
        return r
          .map(function (v) {
            return csvEscape(v, delim);
          })
          .join(delim);
      })
      .join("\r\n");
  }

  // Map CSV rows to items. Understands the original sheet (name, Ict BTW, BTW, EXT, Sale Mage, Sale price, link)
  // and this tool's own export (name, buy_price, buy_incl, vat, margin, ext_override, link).
  // The sheet's EXT column is ignored on purpose: it was calculated with x0.79 instead of /1.21.
  function itemsFromCSV(text, newId) {
    var rows = parseCSV(text);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) {
      return String(h).trim().toLowerCase();
    });
    function col() {
      for (var a = 0; a < arguments.length; a++) {
        var i = head.indexOf(arguments[a]);
        if (i >= 0) return i;
      }
      return -1;
    }
    var cName = col("name", "naam"),
      cBuy = col("buy_price", "ict btw", "buy price"),
      cInc = col("buy_incl"),
      cVat = col("vat", "btw"),
      cMar = col("margin", "sale mage", "sale margin", "marge"),
      cOvr = col("ext_override"),
      cLink = col("link");
    if (cName < 0 || cBuy < 0)
      throw new Error('CSV needs at least a "name" column and an "Ict BTW" / "buy_price" column.');
    var out = [];
    rows.slice(1).forEach(function (r) {
      var name = String(r[cName] || "").trim();
      var buy = parseEuro(r[cBuy]);
      if (!name || buy == null) return; // skips blank rows and the price-less category list at the bottom
      var vat = cVat >= 0 ? parsePct(r[cVat]) : null;
      if (vat == null) vat = 21;
      var incl;
      if (cInc >= 0 && String(r[cInc]).trim() !== "") incl = /^(1|true|yes|ja|incl)/i.test(String(r[cInc]).trim());
      else incl = vat > 0; // sheet: 0% rows are ex-BTW suppliers
      var mar = cMar >= 0 ? parsePct(r[cMar]) : null;
      var link = cLink >= 0 ? String(r[cLink] || "").trim() : "";
      var ovr = cOvr >= 0 ? parseEuro(r[cOvr]) : null;
      out.push({
        id: newId(),
        name: name,
        buyPrice: buy,
        buyIncl: incl,
        vat: vat,
        margin: mar == null ? 15 : mar,
        extOverride: ovr,
        link: /^https?:\/\//i.test(link) ? link : "",
      });
    });
    return out;
  }

  var api = {
    round2: round2,
    parseEuro: parseEuro,
    parsePct: parsePct,
    calcExt: calcExt,
    calcSale: calcSale,
    itemSale: itemSale,
    resolveLine: resolveLine,
    quoteTotals: quoteTotals,
    parseCSV: parseCSV,
    toCSV: toCSV,
    itemsFromCSV: itemsFromCSV,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QuoteCalc = api;
})(typeof window !== "undefined" ? window : this);
