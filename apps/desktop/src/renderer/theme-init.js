// Runs synchronously in <head> before first paint, so the launcher never flashes the wrong theme.
// The saved choice is mirrored in localStorage by launcher.js; settings.json stays the source of truth.
(function () {
  var pref = "system";
  try {
    pref = localStorage.getItem("tb-theme") || "system";
  } catch (e) {}
  var dark = pref === "dark" || (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
