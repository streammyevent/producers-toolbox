// Light / dark theme switch. Loaded synchronously in <head> (a classic script, not inline, so a strict
// Content-Security-Policy can forbid inline scripts) so the theme is applied before the first paint.
// The choice is stored in localStorage under "spd_theme"; without a stored choice the OS setting
// (prefers-color-scheme) decides. Every storage access is wrapped in try/catch because storage can be
// unavailable (private windows, blocked site data, file:// restrictions).
(function () {
  var STORAGE_KEY = "spd_theme";
  var THEME_COLORS = { light: "#FFFFFF", dark: "#18181B" };
  var root = document.documentElement;

  function readStoredTheme() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }

  function systemTheme() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  function updateToggleButton(theme) {
    var btn = document.getElementById("btn-theme-toggle");
    if (!btn) return;
    var label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
    updateToggleButton(theme);
  }

  applyTheme(readStoredTheme() || systemTheme());

  // Follow OS changes until the user picks a theme explicitly
  try {
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var onSystemChange = function () {
      if (!readStoredTheme()) applyTheme(systemTheme());
    };
    if (media.addEventListener) media.addEventListener("change", onSystemChange);
  } catch {
    // matchMedia unavailable: keep the current theme
  }

  document.addEventListener("DOMContentLoaded", function () {
    updateToggleButton(root.dataset.theme);
    var btn = document.getElementById("btn-theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = root.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage unavailable: the theme still applies for this session
      }
    });
  });
})();
