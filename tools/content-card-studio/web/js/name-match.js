// @ts-check
/* Strict name matching for gear items: a database item only counts as "the same thing" when its name (or an alias)
   is at least 90% similar to the name asked for. Used where a wrong guess is worse than no match, such as picking a
   photo for a Rentman item that has none.
   Works in the browser (window.NameMatch) and in Node (module.exports) so tests can load it. */
(function (root) {
  "use strict";

  var STRICT_THRESHOLD = 0.9;
  var MIN_LENGTH = 2;

  /** Lowercase, accents removed, punctuation turned into spaces, whitespace collapsed. */
  function normalizeName(s) {
    if (typeof s !== "string") return "";
    return s
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  /** Edit distance (insert, delete, substitute) between two strings. */
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    var cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      var tmp = prev;
      prev = cur;
      cur = tmp;
    }
    return prev[b.length];
  }

  /** 1 - levenshtein / max(length) on the normalized names: 1 is identical, 0 when either is empty. */
  function similarity(a, b) {
    var x = normalizeName(a);
    var y = normalizeName(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  }

  // "XLR cable 15m" and "XLR cable 10m" are one edit apart but different items: the numbers must agree exactly
  function sameNumbers(x, y) {
    var nx = x.match(/\d+/g) || [];
    var ny = y.match(/\d+/g) || [];
    return nx.join(" ") === ny.join(" ");
  }

  /**
   * The item whose name or alias best matches `name` at STRICT_THRESHOLD or more, else null. A code matches only when
   * it is exactly the name (after normalizing), never as a substring.
   * @param {string} name
   * @param {Array<any>} items gear items with `name`, optional `aliases` and `code`
   * @returns {any}
   */
  function findGearByNameStrict(name, items) {
    var target = normalizeName(name);
    if (target.length < MIN_LENGTH || !Array.isArray(items)) return null;

    var best = null;
    var bestScore = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || typeof item !== "object") continue;
      if (typeof item.code === "string" && normalizeName(item.code) === target) return item;

      var candidates = [item.name].concat(Array.isArray(item.aliases) ? item.aliases : []);
      for (var c = 0; c < candidates.length; c++) {
        var cand = normalizeName(candidates[c]);
        if (cand.length < MIN_LENGTH) continue;
        if (cand === target) return item;
        if (!sameNumbers(cand, target)) continue;
        var score = 1 - levenshtein(cand, target) / Math.max(cand.length, target.length);
        if (score > bestScore) {
          bestScore = score;
          best = item;
        }
      }
    }
    return bestScore >= STRICT_THRESHOLD ? best : null;
  }

  var api = {
    STRICT_THRESHOLD: STRICT_THRESHOLD,
    normalizeName: normalizeName,
    levenshtein: levenshtein,
    similarity: similarity,
    findGearByNameStrict: findGearByNameStrict,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else /** @type {any} */ (root).NameMatch = api;
})(typeof window !== "undefined" ? window : this);
