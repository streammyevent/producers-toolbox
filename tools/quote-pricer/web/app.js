(function () {
  "use strict";
  var C = window.QuoteCalc;
  var KEY = "sme_quote_tool_v1";

  // ---- seed: example items so a first start is not empty. Fictional prices. ----
  var SEED = [
    ["Example DMX cable 5 m", 10, 21, 20, ""],
    ["Example DMX splitter", 100, 21, 20, ""],
    ["Example LED bar", 150, 21, 20, ""],
    ["Example power cable 10 m", 30, 21, 20, ""],
    ["Example touchscreen 15 inch", 400, 0, 25, ""],
    ["Example mini PC", 600, 21, 25, "", 500],
  ];

  var uid = function () {
    return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  function seedItems() {
    return SEED.map(function (s) {
      return {
        id: uid(),
        name: s[0],
        buyPrice: s[1],
        buyIncl: s[2] > 0,
        vat: s[2],
        margin: s[3],
        extOverride: s[5] != null ? s[5] : null,
        link: s[4],
      };
    });
  }

  var state = load();
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var s = raw && C.normalizeState(JSON.parse(raw), uid);
      if (s) return s;
    } catch (e) {}
    return { items: seedItems(), quotes: [], activeQuote: null };
  }
  var saveFailed = false;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      if (!saveFailed) {
        saveFailed = true;
        toast("Could not save to this browser — use Backup to keep your data.");
      }
    }
  }

  // ---- helpers ----
  var $ = function (id) {
    return document.getElementById(id);
  };
  var fmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
  var money = function (n) {
    return fmt.format(n || 0);
  };
  var itemsById = function () {
    var m = {};
    state.items.forEach(function (i) {
      m[i.id] = i;
    });
    return m;
  };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.classList.remove("show");
    }, 2200);
  }
  function download(name, text, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }
  var num = function (v) {
    var n = C.parseEuro(v);
    return n == null ? 0 : n;
  };
  var fixed = function (n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  };

  // In-page confirm: native confirm() is blocked in some embedded browsers, which made delete buttons do nothing.
  function askConfirm(msg, okLabel, onOk) {
    $("confirmMsg").textContent = msg;
    $("confirmOk").textContent = okLabel;
    $("confirmOk").onclick = function () {
      $("confirmDlg").close();
      onOk();
    };
    $("confirmCancel").onclick = function () {
      $("confirmDlg").close();
    };
    $("confirmDlg").showModal();
  }

  // ---- tabs / theme ----
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (x) {
        x.classList.toggle("active", x === b);
      });
      document.querySelectorAll(".pane").forEach(function (p) {
        p.classList.toggle("active", p.id === "pane-" + b.dataset.tab);
      });
      if (b.dataset.tab === "quote") renderQuote();
    });
  });
  $("themeBtn").addEventListener("click", function () {
    var cur =
      document.documentElement.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("qp_theme", next);
    } catch (e) {}
  });

  // =================== PRICE LIST ===================
  function itemRowHtml(it) {
    return (
      '<tr data-id="' +
      esc(it.id) +
      '">' +
      '<td><input data-f="name" value="' +
      esc(it.name) +
      '"></td>' +
      '<td class="num"><input data-f="buyPrice" inputmode="decimal" value="' +
      esc(it.buyPrice) +
      '"></td>' +
      '<td><select data-f="buyIncl"><option value="1"' +
      (it.buyIncl ? " selected" : "") +
      '>incl. BTW</option><option value="0"' +
      (!it.buyIncl ? " selected" : "") +
      ">excl. BTW</option></select></td>" +
      '<td class="num"><input data-f="vat" inputmode="decimal" value="' +
      esc(it.vat) +
      '"></td>' +
      '<td class="num ext-cell"><input data-f="ext" inputmode="decimal"></td>' +
      '<td class="num"><input data-f="margin" inputmode="decimal" value="' +
      esc(it.margin) +
      '"></td>' +
      '<td class="num calc sale" data-r="sale"></td>' +
      '<td><input data-f="link" value="' +
      esc(it.link) +
      '" placeholder="https://…"></td>' +
      '<td class="w-act"><button class="icon" data-act="pull" title="Pull name &amp; price from link">⟳</button> <button class="icon" data-act="open" title="Open link">↗</button><button class="icon" data-act="reset" title="Reset EXT override">↺</button> <button class="icon danger" data-act="del" title="Delete">✕</button></td></tr>'
    );
  }
  function refreshItemRow(tr, skipExt) {
    var it = itemsById()[tr.dataset.id];
    if (!it) return;
    var ext = C.calcExt(it);
    var extInput = tr.querySelector("[data-f=ext]");
    if (!skipExt) extInput.value = fixed(ext);
    tr.querySelector(".ext-cell").classList.toggle("overridden", it.extOverride != null);
    tr.querySelector("[data-act=reset]").style.visibility = it.extOverride != null ? "visible" : "hidden";
    var hasLink = /^https?:\/\//i.test(it.link);
    tr.querySelector("[data-act=open]").style.visibility = hasLink ? "visible" : "hidden";
    tr.querySelector("[data-act=pull]").style.visibility = hasLink ? "visible" : "hidden";
    tr.querySelector("[data-r=sale]").textContent = money(C.calcSale(ext, it.margin));
    // the "BTW %" only matters when the buy price includes BTW
    tr.querySelector("[data-f=vat]").style.opacity = it.buyIncl ? 1 : 0.4;
  }
  function renderItems() {
    var q = $("itemSearch").value.trim().toLowerCase();
    var list = state.items.filter(function (i) {
      return !q || i.name.toLowerCase().indexOf(q) >= 0;
    });
    $("itemRows").innerHTML = list.map(itemRowHtml).join("");
    $("itemRows")
      .querySelectorAll("tr")
      .forEach(function (tr) {
        refreshItemRow(tr);
      });
    $("itemsEmpty").hidden = list.length > 0;
    $("itemCount").textContent =
      list.length + (list.length === state.items.length ? "" : " of " + state.items.length) + " items";
  }
  $("itemSearch").addEventListener("input", renderItems);
  $("addItemBtn").addEventListener("click", function () {
    $("itemSearch").value = "";
    state.items.unshift({
      id: uid(),
      name: "",
      buyPrice: 0,
      buyIncl: true,
      vat: 21,
      margin: 15,
      extOverride: null,
      link: "",
    });
    save();
    renderItems();
    var first = $("itemRows").querySelector("input[data-f=name]");
    if (first) first.focus();
  });
  $("itemRows").addEventListener("input", function (e) {
    var el = e.target,
      tr = el.closest("tr");
    if (!tr || !el.dataset.f) return;
    var it = itemsById()[tr.dataset.id],
      f = el.dataset.f;
    if (f === "name" || f === "link") it[f] = el.value;
    else if (f === "buyIncl") it.buyIncl = el.value === "1";
    else if (f === "ext") {
      var v = C.parseEuro(el.value);
      it.extOverride = v == null ? null : v;
    } else {
      var n = C.parseEuro(el.value);
      it[f] = n == null ? 0 : n;
    }
    // editing the buy price / BTW setting / incl-toggle means "recalculate": drop a stale EXT override
    if (f === "buyPrice" || f === "vat" || f === "buyIncl") it.extOverride = null;
    save();
    refreshItemRow(tr, f === "ext");
  });
  $("itemRows").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var tr = b.closest("tr"),
      it = itemsById()[tr.dataset.id];
    if (b.dataset.act === "reset") {
      it.extOverride = null;
      save();
      refreshItemRow(tr);
    } else if (b.dataset.act === "open") window.open(it.link, "_blank", "noopener");
    else if (b.dataset.act === "pull") pullFromLink(it.id);
    else if (b.dataset.act === "del") {
      var used = state.quotes.filter(function (q) {
        return q.lines.some(function (l) {
          return l.itemId === it.id;
        });
      }).length;
      askConfirm(
        'Delete "' +
          (it.name || "this item") +
          '"?' +
          (used ? " It is used in " + used + ' quotation(s); those lines will show "(item removed)".' : ""),
        "Delete",
        function () {
          state.items = state.items.filter(function (x) {
            return x.id !== it.id;
          });
          save();
          renderItems();
        },
      );
    }
  });

  // Pull name + price from a product link (needs serve.js; browsers can't read other sites directly).
  // Fires when a link is pasted/committed. Name is filled only if empty; price is always updated.
  $("itemRows").addEventListener("change", function (e) {
    if (e.target.dataset.f !== "link") return;
    var it = itemsById()[e.target.closest("tr").dataset.id];
    if (it && /^https?:\/\//i.test(it.link)) pullFromLink(it.id);
  });
  function pullFromLink(id) {
    var it = itemsById()[id];
    if (!it) return;
    var tr = $("itemRows").querySelector('tr[data-id="' + id + '"]');
    var btn = tr && tr.querySelector("[data-act=pull]");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "…";
    }
    toast("Fetching from link…");
    (window.toolbox
      ? window.toolbox.call("product.fetch", it.link)
      : Promise.reject(new Error("Pulling from links works in the Producers Toolbox app."))
    )
      .then(function (d) {
        if (d.error) {
          toast(d.error);
          return;
        }
        var got = [];
        if (d.name && !String(it.name).trim()) {
          it.name = d.name;
          got.push("name");
        }
        if (d.price != null) {
          it.buyPrice = d.price;
          it.buyIncl = d.vatIncluded == null ? true : d.vatIncluded; // shops normally show consumer prices incl. BTW
          if (it.buyIncl && !it.vat) it.vat = 21;
          it.extOverride = null;
          got.push("price " + money(d.price) + (it.buyIncl ? " incl. BTW" : " excl. BTW"));
        }
        save();
        renderItems();
        var warn =
          d.currency && d.currency !== "EUR"
            ? " — currency is " + d.currency + ", check it!"
            : d.price != null && d.vatIncluded == null
              ? " — check incl./excl. BTW"
              : "";
        toast("Pulled " + (got.join(" + ") || "nothing new") + warn);
      })
      .catch(function (e) {
        toast(e.message || "Could not fetch that page.");
      })
      .then(function () {
        var b = $("itemRows").querySelector('tr[data-id="' + id + '"] [data-act=pull]');
        if (b) {
          b.disabled = false;
          b.textContent = "⟳";
        }
      });
  }

  // CSV export / import
  $("exportItemsBtn").addEventListener("click", function () {
    var rows = [["name", "buy_price", "buy_incl", "vat", "margin", "ext_override", "link", "ext", "sale_ex_btw"]];
    state.items.forEach(function (i) {
      var ext = C.calcExt(i);
      rows.push([
        i.name,
        i.buyPrice,
        i.buyIncl ? "yes" : "no",
        i.vat,
        i.margin,
        i.extOverride == null ? "" : i.extOverride,
        i.link,
        fixed(ext),
        fixed(C.calcSale(ext, i.margin)),
      ]);
    });
    download("price-list.csv", "﻿" + C.toCSV(rows), "text/csv");
  });
  $("importBtn").addEventListener("click", function () {
    $("importText").value = "";
    $("importFile").value = "";
    $("importDlg").showModal();
  });
  $("importFile").addEventListener("change", function () {
    var f = this.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      $("importText").value = r.result;
    };
    r.readAsText(f);
  });
  $("importGo").addEventListener("click", function () {
    var text = $("importText").value;
    if (!text.trim()) return;
    var incoming;
    try {
      incoming = C.itemsFromCSV(text, uid);
    } catch (err) {
      toast(err.message);
      return;
    }
    if (!incoming.length) {
      toast("No priced rows found in that CSV.");
      return;
    }
    var mode = document.querySelector("input[name=impMode]:checked").value,
      added = 0,
      updated = 0;
    if (mode === "replace") {
      askConfirm(
        "Replace the whole price list with " +
          incoming.length +
          ' imported items? Quotation lines pointing at old items will show "(item removed)".',
        "Replace",
        function () {
          state.items = incoming;
          save();
          renderItems();
          toast("Imported: " + incoming.length + " items");
        },
      );
      return;
    }
    incoming.forEach(function (n) {
      var ex = state.items.filter(function (i) {
        return i.name.trim().toLowerCase() === n.name.toLowerCase();
      })[0];
      if (ex) {
        n.id = ex.id;
        Object.assign(ex, n);
        updated++;
      } else {
        state.items.push(n);
        added++;
      }
    });
    save();
    renderItems();
    toast("Imported: " + added + " added, " + updated + " updated");
  });

  // =================== QUOTATION ===================
  function activeQuote() {
    return (
      state.quotes.filter(function (q) {
        return q.id === state.activeQuote;
      })[0] || null
    );
  }
  function newQuote(base) {
    var q = base || {
      id: "",
      name: "New quotation",
      client: "",
      date: new Date().toISOString().slice(0, 10),
      lines: [],
    };
    q.id = "q" + uid();
    state.quotes.unshift(q);
    state.activeQuote = q.id;
    save();
    return q;
  }
  function renderQuoteSelect() {
    $("quoteSelect").innerHTML =
      state.quotes
        .map(function (q) {
          return (
            '<option value="' +
            esc(q.id) +
            '"' +
            (q.id === state.activeQuote ? " selected" : "") +
            ">" +
            esc(q.name || "(unnamed)") +
            (q.client ? " — " + esc(q.client) : "") +
            "</option>"
          );
        })
        .join("") || "<option>No quotations yet</option>";
  }
  function lineHtml(l, i) {
    var acts =
      '<button class="icon" data-act="up" title="Move up">↑</button> <button class="icon" data-act="down" title="Move down">↓</button> <button class="icon danger" data-act="del" title="Remove">✕</button>';
    if (l.type === "group") {
      return (
        '<tr class="group" data-i="' +
        i +
        '"><td colspan="5"><input data-f="title" value="' +
        esc(l.title) +
        '" placeholder="Group heading"></td>' +
        '<td class="num calc" data-r="total"></td><td class="w-act">' +
        acts +
        "</td></tr>"
      );
    }
    var qtyCell = '<td class="num"><input data-f="qty" inputmode="decimal" value="' + esc(l.qty) + '"></td>';
    if (l.type === "custom") {
      return (
        '<tr data-i="' +
        i +
        '"><td><input data-f="name" value="' +
        esc(l.name) +
        '" placeholder="Description (e.g. 8 uur pre-productie)"></td>' +
        qtyCell +
        '<td class="num"><input data-f="cost" inputmode="decimal" value="' +
        esc(l.cost) +
        '" title="Your cost per unit (for profit only)"></td>' +
        '<td class="num muted" data-r="mar"></td>' +
        '<td class="num"><input data-f="price" inputmode="decimal" value="' +
        esc(l.price) +
        '"></td>' +
        '<td class="num calc" data-r="total"></td><td class="w-act">' +
        acts +
        "</td></tr>"
      );
    }
    return (
      '<tr data-i="' +
      i +
      '"><td data-r="desc"></td>' +
      qtyCell +
      '<td class="num muted" data-r="cost"></td>' +
      '<td class="num"><input data-f="margin" inputmode="decimal" value="' +
      esc(l.margin == null ? "" : l.margin) +
      '"></td>' +
      '<td class="num" data-r="unit"></td><td class="num calc" data-r="total"></td>' +
      '<td class="w-act"><button class="icon" data-act="copy" title="Copy unit price ex BTW">⧉</button> ' +
      acts +
      "</td></tr>"
    );
  }
  function refreshQuote() {
    var q = activeQuote();
    if (!q) return;
    var ids = itemsById(),
      t = C.quoteTotals(q.lines, ids);
    $("lineRows")
      .querySelectorAll("tr")
      .forEach(function (tr) {
        var i = +tr.dataset.i,
          r = t.lines[i],
          l = q.lines[i],
          set = function (k, v) {
            var c = tr.querySelector("[data-r=" + k + "]");
            if (c) c.textContent = v;
          };
        tr.classList.toggle("missing", !!r.missing);
        set("total", money(r.total));
        if (l.type === "item") {
          var it = ids[l.itemId];
          set("desc", r.desc);
          set("cost", money(r.unitCost));
          set("unit", money(r.unitSale));
          var m = tr.querySelector("[data-f=margin]");
          m.placeholder = it ? String(it.margin) : "";
        } else if (l.type === "custom") {
          set("mar", r.unitSale > 0 ? fixed(((r.unitSale - r.unitCost) / r.unitSale) * 100) + "%" : "");
        }
      });
    $("tCost").textContent = money(t.cost);
    $("tProfit").textContent = money(t.profit);
    $("tMargin").textContent = t.marginPct.toLocaleString("nl-NL") + "%";
    $("tTotal").textContent = money(t.total);
  }
  function renderQuote() {
    renderQuoteSelect();
    var q = activeQuote();
    $("quoteCard").style.display = q ? "" : "none";
    ["dupQuoteBtn", "delQuoteBtn", "exportQuoteBtn", "clearLinesBtn"].forEach(function (id) {
      $(id).disabled = !q;
    });
    if (!q) return;
    $("qName").value = q.name;
    $("qClient").value = q.client;
    $("qDate").value = q.date;
    $("lineRows").innerHTML = q.lines.map(lineHtml).join("");
    $("linesEmpty").hidden = q.lines.length > 0;
    refreshQuote();
  }
  $("quoteSelect").addEventListener("change", function () {
    state.activeQuote = this.value;
    save();
    renderQuote();
  });
  $("newQuoteBtn").addEventListener("click", function () {
    newQuote();
    renderQuote();
    $("qName").select();
  });
  $("clearLinesBtn").addEventListener("click", function () {
    var q = activeQuote();
    if (!q) return;
    if (!q.lines.length) {
      toast("This project has no lines.");
      return;
    }
    askConfirm(
      "WARNING: this removes all " + q.lines.length + ' lines from "' + q.name + '". This cannot be undone.',
      "Remove all lines",
      function () {
        q.lines = [];
        save();
        renderQuote();
      },
    );
  });
  $("clearItemsBtn").addEventListener("click", function () {
    if (!state.items.length) {
      toast("The price list is already empty.");
      return;
    }
    askConfirm(
      "WARNING: this deletes all " +
        state.items.length +
        ' items from the price list. Existing quotations will show "(item removed)" on lines that used them. This cannot be undone (make a Backup first if unsure).',
      "Remove all items",
      function () {
        state.items = [];
        $("itemSearch").value = "";
        save();
        renderItems();
      },
    );
  });
  $("dupQuoteBtn").addEventListener("click", function () {
    var q = activeQuote();
    if (!q) return;
    var c = JSON.parse(JSON.stringify(q));
    c.name = q.name + " (copy)";
    newQuote(c);
    renderQuote();
  });
  $("delQuoteBtn").addEventListener("click", function () {
    var q = activeQuote();
    if (!q) return;
    askConfirm('Delete quotation "' + q.name + '"?', "Delete", function () {
      state.quotes = state.quotes.filter(function (x) {
        return x !== q;
      });
      state.activeQuote = state.quotes.length ? state.quotes[0].id : null;
      save();
      renderQuote();
    });
  });
  [
    ["qName", "name"],
    ["qClient", "client"],
    ["qDate", "date"],
  ].forEach(function (p) {
    $(p[0]).addEventListener("input", function () {
      var q = activeQuote();
      if (!q) return;
      q[p[1]] = this.value;
      save();
      if (p[1] !== "date") {
        var o = $("quoteSelect").selectedOptions[0];
        if (o) o.textContent = (q.name || "(unnamed)") + (q.client ? " — " + q.client : "");
      }
    });
  });

  // line editing
  $("lineRows").addEventListener("input", function (e) {
    var el = e.target,
      tr = el.closest("tr"),
      q = activeQuote();
    if (!tr || !q || !el.dataset.f) return;
    var l = q.lines[+tr.dataset.i],
      f = el.dataset.f;
    if (f === "title" || f === "name") l[f] = el.value;
    else if (f === "margin") {
      var m = C.parseEuro(el.value);
      l.margin = m == null ? null : m;
    } else l[f] = num(el.value);
    save();
    refreshQuote();
  });
  $("lineRows").addEventListener("click", function (e) {
    var b = e.target.closest("button"),
      q = activeQuote();
    if (!b || !q) return;
    var i = +b.closest("tr").dataset.i,
      a = b.dataset.act;
    if (a === "copy") {
      var r = C.resolveLine(q.lines[i], itemsById()),
        txt = fixed(r.unitSale).replace(".", ",");
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
        function () {
          toast("Copied " + txt);
        },
        function () {
          toast(txt + " (select & copy manually)");
        },
      );
      return;
    }
    if (a === "del") q.lines.splice(i, 1);
    else if (a === "up" && i > 0) q.lines.splice(i - 1, 0, q.lines.splice(i, 1)[0]);
    else if (a === "down" && i < q.lines.length - 1) q.lines.splice(i + 1, 0, q.lines.splice(i, 1)[0]);
    save();
    renderQuote();
  });
  function addLine(l) {
    var q = activeQuote() || newQuote();
    q.lines.push(l);
    save();
    renderQuote();
    return q.lines.length - 1;
  }
  $("addCustomBtn").addEventListener("click", function () {
    var i = addLine({ type: "custom", name: "", qty: 1, cost: 0, price: 0 });
    var r = $("lineRows").querySelector('tr[data-i="' + i + '"] input');
    if (r) r.focus();
  });
  $("addGroupBtn").addEventListener("click", function () {
    var i = addLine({ type: "group", title: "" });
    var r = $("lineRows").querySelector('tr[data-i="' + i + '"] input');
    if (r) r.focus();
  });

  // item picker
  var pickSel = 0;
  function renderPick() {
    var q = $("pickInput").value.trim().toLowerCase();
    var list = state.items
      .filter(function (i) {
        return i.name && (!q || i.name.toLowerCase().indexOf(q) >= 0);
      })
      .slice(0, 60);
    pickSel = Math.min(pickSel, Math.max(0, list.length - 1));
    $("pickList").innerHTML =
      list
        .map(function (it, n) {
          return (
            '<div data-id="' +
            esc(it.id) +
            '" class="' +
            (n === pickSel ? "sel" : "") +
            '"><span>' +
            esc(it.name) +
            "</span><b>" +
            money(C.itemSale(it)) +
            "</b></div>"
          );
        })
        .join("") || '<div class="muted">No match</div>';
    $("pickList").classList.add("open");
  }
  function pickItem(id) {
    if (!id) return;
    addLine({ type: "item", itemId: id, qty: 1, margin: null });
    $("pickInput").value = "";
    $("pickList").classList.remove("open");
    $("pickInput").focus();
  }
  $("pickInput").addEventListener("focus", function () {
    pickSel = 0;
    renderPick();
  });
  $("pickInput").addEventListener("input", function () {
    pickSel = 0;
    renderPick();
  });
  $("pickInput").addEventListener("keydown", function (e) {
    var rows = $("pickList").querySelectorAll("div[data-id]");
    if (e.key === "ArrowDown") {
      pickSel = Math.min(rows.length - 1, pickSel + 1);
      renderPick();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      pickSel = Math.max(0, pickSel - 1);
      renderPick();
      e.preventDefault();
    } else if (e.key === "Enter" && rows[pickSel]) {
      pickItem(rows[pickSel].dataset.id);
      e.preventDefault();
    } else if (e.key === "Escape") $("pickList").classList.remove("open");
  });
  $("pickList").addEventListener("mousedown", function (e) {
    var d = e.target.closest("div[data-id]");
    if (d) {
      e.preventDefault();
      pickItem(d.dataset.id);
    }
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".picker")) $("pickList").classList.remove("open");
  });

  // Rentman export: ex-BTW numbers, ; delimiter and decimal comma so it opens correctly in Dutch Excel
  $("exportQuoteBtn").addEventListener("click", function () {
    var q = activeQuote();
    if (!q) return;
    var t = C.quoteTotals(q.lines, itemsById()),
      dec = function (n) {
        return fixed(n).replace(".", ",");
      };
    var rows = [["Description", "Qty", "Unit price ex BTW", "Total ex BTW"]];
    t.lines.forEach(function (r) {
      if (r.type === "group") rows.push([r.desc, "", "", dec(r.total)]);
      else rows.push([r.desc, String(r.qty).replace(".", ","), dec(r.unitSale), dec(r.total)]);
    });
    rows.push(["TOTAL ex BTW", "", "", dec(t.total)]);
    download((q.name || "quotation").replace(/[^\w\- ]+/g, "").trim() + ".csv", "﻿" + C.toCSV(rows, ";"), "text/csv");
  });

  // backup / restore
  $("backupBtn").addEventListener("click", function () {
    download("quote-pricer-backup.json", JSON.stringify(state, null, 1), "application/json");
  });
  $("restoreBtn").addEventListener("click", function () {
    $("restoreFile").click();
  });
  $("restoreFile").addEventListener("change", function () {
    var f = this.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var s = C.normalizeState(JSON.parse(r.result), uid);
        if (!s) throw new Error("bad");
        askConfirm("Replace ALL current items and quotations with this backup?", "Restore", function () {
          state = s;
          save();
          renderItems();
          renderQuote();
          toast("Backup restored");
        });
      } catch (e) {
        toast("That file is not a Quote Pricer backup.");
      }
    };
    r.readAsText(f);
    this.value = "";
  });

  // init
  if (!state.activeQuote || !activeQuote()) state.activeQuote = state.quotes.length ? state.quotes[0].id : null;
  renderItems();
  renderQuote();
})();
