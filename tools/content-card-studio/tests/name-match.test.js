const test = require("node:test");
const assert = require("node:assert");
const { normalizeName, similarity, findGearByNameStrict, STRICT_THRESHOLD } = require("../web/js/name-match.js");

// Fictional gear, as the repo rules ask
const ITEMS = [
  { id: "a", name: "Zephyr Beam Spot 300 Pro", code: "ZBS-300", image: "assets/a.png" },
  { id: "b", name: "XLR cable 10m", aliases: ["xlr 10m"], image: "assets/b.png" },
  { id: "c", name: "Power cable", aliases: ["mains lead"], image: "assets/c.png" },
  { id: "d", name: "Nimbus Wash Panel", aliases: ["nimbus panel wide"], image: "assets/d.png" },
  null,
];

test("normalizeName lowercases, strips punctuation, accents and extra whitespace", () => {
  assert.strictEqual(normalizeName("  Zephyr-Beam   Spot (300)  "), "zephyr beam spot 300");
  assert.strictEqual(normalizeName("Café Lümen"), "cafe lumen");
  assert.strictEqual(normalizeName(null), "");
});

test("an exact (normalized) match scores 1", () => {
  assert.strictEqual(similarity("Zephyr Beam Spot 300 Pro", "zephyr beam spot 300 pro"), 1);
  assert.strictEqual(similarity("XLR cable, 10m", "xlr cable 10m"), 1);
  assert.strictEqual(findGearByNameStrict("ZEPHYR beam spot 300 pro", ITEMS).id, "a");
});

test("a one-character typo on a long name is at least 0.90 and matches", () => {
  assert.ok(similarity("Zephyr Beam Spot 300 Pro", "Zephir Beam Spot 300 Pro") >= STRICT_THRESHOLD);
  assert.strictEqual(findGearByNameStrict("Zephir Beam Spot 300 Pro", ITEMS).id, "a");
  assert.strictEqual(findGearByNameStrict("Nimbus Wash Panels", ITEMS).id, "d");
});

test("similar but different names stay under 0.90", () => {
  assert.ok(similarity("XLR cable 5m", "XLR cable 10m") < STRICT_THRESHOLD);
  assert.strictEqual(findGearByNameStrict("XLR cable 5m", ITEMS), null);
  // One edit apart, but a different length is a different item
  assert.strictEqual(findGearByNameStrict("XLR cable 15m", ITEMS), null);
});

test("sharing a single word is not a match", () => {
  assert.ok(similarity("black cable", "power cable") < STRICT_THRESHOLD);
  assert.strictEqual(findGearByNameStrict("black cable", ITEMS), null);
  assert.strictEqual(findGearByNameStrict("Zephyr", ITEMS), null);
});

test("aliases count, codes only on exact equality", () => {
  assert.strictEqual(findGearByNameStrict("Mains lead", ITEMS).id, "c");
  assert.strictEqual(findGearByNameStrict("zbs-300", ITEMS).id, "a");
  assert.strictEqual(findGearByNameStrict("ZBS-300 spare lamp", ITEMS), null);
});

test("empty and short input never match", () => {
  assert.strictEqual(similarity("", ""), 0);
  assert.strictEqual(similarity("", "Power cable"), 0);
  assert.strictEqual(findGearByNameStrict("", ITEMS), null);
  assert.strictEqual(findGearByNameStrict("x", ITEMS), null);
  assert.strictEqual(findGearByNameStrict("  -- ", ITEMS), null);
  assert.strictEqual(findGearByNameStrict(undefined, ITEMS), null);
  assert.strictEqual(findGearByNameStrict("Power cable", null), null);
  // Short names only match exactly: one edit on a short name is far below 0.90
  assert.ok(similarity("abc", "abd") < STRICT_THRESHOLD);
});
