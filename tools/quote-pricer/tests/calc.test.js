const test = require("node:test");
const assert = require("node:assert");
const C = require("../web/calc.js");

const check = (name, got, want) => test(name, () => assert.deepStrictEqual(got, want));

// parsing
check("euro nl", C.parseEuro("€ 139,00"), 139);
check("euro thousands", C.parseEuro("€ 1.234,56"), 1234.56);
check("euro dot decimal", C.parseEuro("139.50"), 139.5);
check("euro thousands dot only", C.parseEuro("1.234"), 1234);
check("euro blank", C.parseEuro(""), null);
check("pct", C.parsePct("21%"), 21);
check("pct comma", C.parsePct("12,5 %"), 12.5);

// buy price incl BTW -> EXT = /1.21 (a spreadsheet's x0.79 shortcut is deliberately not copied)
const cable = { buyPrice: 99, buyIncl: true, vat: 21, margin: 20 };
check("EXT incl", C.calcExt(cable), 81.82);
check("sale incl", C.itemSale(cable), 98.18);
// buy price ex BTW (0% supplier)
const light = { buyPrice: 250, buyIncl: false, vat: 0, margin: 25 };
check("EXT excl", C.calcExt(light), 250);
check("sale excl", C.itemSale(light), 312.5);
// ex-BTW supplier with 21% on the item: BTW must NOT be stripped
check("excl ignores vat", C.calcExt({ buyPrice: 100, buyIncl: false, vat: 21 }), 100);
// override
check("override sale", C.itemSale({ buyPrice: 50, buyIncl: true, vat: 21, margin: 30, extOverride: 80 }), 104);

// quote totals with group + margin override + custom line
const q = C.quoteTotals(
  [
    { type: "group", title: "Basis" },
    { type: "item", itemId: "a", qty: 2 },
    { type: "item", itemId: "b", qty: 1, margin: 10 },
    { type: "group", title: "Werk" },
    { type: "custom", name: "8 uur pre-productie", qty: 8, price: 75, cost: 40 },
    { type: "item", itemId: "gone", qty: 1 },
  ],
  { a: cable, b: light },
);
check("line total", q.lines[1].total, 196.36);
check("override margin unit", q.lines[2].unitSale, 275);
check("group1 subtotal", q.lines[0].total, 471.36);
check("group2 subtotal", q.lines[3].total, 600);
check("total", q.total, 1071.36);
check("cost", q.cost, 733.64);
check("missing item flagged", q.lines[5].missing, true);

// CSV: spreadsheet export shape, incl. the price-less category rows at the bottom
const csv =
  "name,Ict BTW,BTW,EXT,Sale Mage,Sale price,,link\r\n" +
  '"Example Cable","€ 99,00",21%,"€ 78,21",20%,"€ 93,85",,https://shop.example/a\r\n' +
  '"Example Light","€ 250,00",0%,"€ 250,00",25%,"€ 312,50",,Supplier A\r\n' +
  ",,,,,,,\r\n" +
  "Example-cable,,,,,,,\r\n";
let n = 0;
const imp = C.itemsFromCSV(csv, () => "id" + n++);
check("import count", imp.length, 2);
check("import incl", [imp[0].buyIncl, imp[1].buyIncl], [true, false]);
check("import ignores sheet EXT", C.calcExt(imp[0]), 81.82);
check("import link filter", [imp[0].link, imp[1].link], ["https://shop.example/a", ""]);

// CSV round trip of own export format
const out = C.toCSV([
  ["name", "buy_price", "buy_incl", "vat", "margin", "ext_override", "link"],
  ['Cable, 5m "x"', 11.9, "yes", 21, 15, "", ""],
]);
const back = C.itemsFromCSV(out, () => "z");
check("roundtrip name", back[0].name, 'Cable, 5m "x"');
check("roundtrip values", [back[0].buyPrice, back[0].buyIncl, back[0].vat, back[0].margin], [11.9, true, 21, 15]);
