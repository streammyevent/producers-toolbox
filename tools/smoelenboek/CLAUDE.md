# Smoelenboek (Speaker Photo Directory)

Vanilla HTML/CSS/JS in `web/`, no build step. The same pages run inside the Producers Toolbox app and in a plain browser,
so the code must not depend on Node or Electron. Desktop-only features are behind `window.electronAPI` (secrets, backup
folder through the main process); without it the tool runs in browser mode. In the app, `js/desktop-bridge.js` builds
`window.electronAPI` from the shell's `window.toolbox`, and `tool.json` sets the policy (CSP, camera and clipboard,
the `gsearchApiKey` secret, the backup folder and its file-name pattern, which must equal `SYNC_FILE_NAME_PATTERN` in
`util.js`; a unit test in `apps/desktop` checks that).

## Commands

```bash
pnpm --filter @producers-toolbox/tool-smoelenboek test:e2e
pnpm --filter @producers-toolbox/tool-smoelenboek exec playwright test tests/e2e/projects.spec.js -g "duplicates a project"
```

Playwright serves only `web/` on `127.0.0.1:8422` (`E2E_PORT` overrides it).

**Tests** (`tests/e2e/`, 176) started as characterization tests. They use stable hooks (ids, `data-action`, `data-id`,
`data-filter`), never CSS classes or screenshots, so keep those hooks when changing markup. `fixtures.js` stubs every
external request so runs are offline, and seeds localStorage via `seedStorage`. It also fakes `window.electronAPI`
(`desktopSecrets`, `desktopSyncFolder`) to cover the desktop flows; that fake is the contract the app relies on.
`security.spec.js` renders XSS payloads and asserts they stay inert text. `validation.spec.js` covers the `util.js`
helpers, import and stored-data validation, the CSV round trip, image fallbacks, the CSP and the absence of inline
handlers. `view-only.spec.js` calls each mutating method directly. `structure.spec.js` checks that the shared globals
and mixin methods exist (catches a missing or mis-ordered `<script>` tag).

## Architecture

**Classic scripts sharing globals, no modules.** Load order in `index.html` matters. `js/theme.js` loads first in
`<head>` and sets `<html data-theme>` before first paint. Then, at the end of `<body>`:

1. `js/data.js`: `INITIAL_SPEAKERS` (fictional sample speakers, no photos).
2. `js/util.js`: `escapeHtml`, `safeUrl`, `safeMicType`, `defaultAvatarUrl` (a local SVG initials avatar), the
   normalizers (`normalizeSpeaker(s)`, `normalizeMicInventory`, `normalizeProject(s)`, `normalizeSyncConfig`),
   `stripSecretFields`, `parseCsv` / `csvQuote` and the backup-file helpers (`isSyncFileName`, `syncFileName`).
3. `js/secrets.js`: `SecretStore`.
4. `js/sync-folder.js`: the backup folder service (`window.syncFolderService`).
5. `js/sync-controller.js`: `SyncFolderController` (the Backup folder modal and top-bar pill).
6. `js/app-core.js`: `GSEARCH_CX_KEY` and the `SpeakerDirectoryApp` class: constructor, `initElements`,
   `attachEventListeners`, `showToast`, the Share modal, `openModal` / `closeModal`.
7. Mixins add the rest of `SpeakerDirectoryApp`, by concern: `app-projects.js`, `app-speakers.js`, `app-mics.js`,
   `app-photos.js`, `app-print.js`, `app-io.js`, `app-ui.js`.
8. `js/main.js` bootstraps on `DOMContentLoaded`: awaits `SecretStore.init()` and `SecretStore.migrateLegacy()`, creates
   `app`, calls `initDesktopAppIntegration(app)` and creates `window.syncController`.

**Mixin rule:** add methods with `Object.assign(SpeakerDirectoryApp.prototype, { method() {...} })` (method shorthand,
no `super`, no getters) in the file for that concern; keep the class and constructor in `app-core.js`. A new script file
goes into `index.html` in the right place (after `app-core.js`, before `main.js`, with a `?v=` cache-buster) and gets
its own globals block in the root `eslint.config.mjs`.

**State lives in localStorage.**
- `speaker_projects_registry_v1` holds the projects `{id, title, speakers[], micInventory[], lastModified}`;
  `speaker_current_project_id_v1` the active one.
- The legacy keys (`speaker_photo_directory_v1`, `speaker_mic_inventory_v1`, `speaker_project_title_v1`) are still
  written on every save. Keep them in sync if the project shape changes.
- Everything read from storage, imports (JSON/CSV) and backup restores goes through the `util.js` normalizers.
- Every mutation goes through `saveCurrentProjectState()`, which persists, flashes the save indicator and calls
  `syncController.onProjectSaved()` (debounced backup when auto-backup is on).
- Config keys: `spd_sync_folder_v1` (only `autoSync`, `lastSyncTime`), `spd_gsearch_cx_id`, `spd_ui_mode`, `spd_theme`.
  The browser backup backend keeps its folder handle in IndexedDB (`spd_sync_folder`).

**Secrets** (only the Google Custom Search API key) are never stored in localStorage, exports or backups. Read and write
them only through `SecretStore` (`await init()` once, then sync `get(name)`, async `set` / `remove`). In browser mode
(`SecretStore.available === false`) the Search key inputs are disabled and photo search falls back to
Wikipedia/Commons. Do not add a code path that keeps a secret anywhere else. `stripSecretFields` keeps secret-shaped
fields out of exports and backups.

**Backup folder:** `Backup_<title>.json` and `RunSheet_<title>.csv` in a folder the user picks (normally inside Google
Drive for desktop, OneDrive or Dropbox, which does the syncing), in a `Speaker Photo Directory` subfolder. Two backends
behind one async interface (`status`, `choose`, `reconnect`, `clear`, `write`, `read`, `list`, `reveal`): desktop
(`window.electronAPI.syncFolder`, the main process owns the path, the page passes file names only) and browser (File
System Access API: Chrome/Edge, secure contexts only).

**Design:** light/dark tokens on `:root` / `:root[data-theme="dark"]` in `css/style.css` (red accent `#D7263D`, Geist).
Use the tokens, never hardcoded colors. The **printed A4 sheet is pinned to its original look** (always white, Outfit,
values repeated in `@media print`); compare print emulation before and after changing a base style.

**Rendering and security rules:** methods build HTML strings and assign them to `innerHTML`; events are delegated
through `data-action` / `data-id`. Always wrap user or API text in `escapeHtml()` (text and attribute values), pass
every `src`/`href` through `safeUrl()`, use `safeMicType()` for the mic type in class names. Never write inline event
handlers: the CSP `<meta>` in `index.html` forbids them and inline scripts. Image fallbacks use `data-fallback-name` /
`data-hide-on-error`, handled by one capture-phase `error` listener in `app-ui.js`. Keep the CSP in sync when the app
calls a new external host. Toasts use `textContent`. Every CSV cell is written with `csvQuote()` (formula-injection
guard) and imports undo it with `csvUnescapeFormula()`.

**View-only mode:** `?view=readonly` (or `?mode=view`) sets `isViewOnly`, adds the `view-only` body class, and every
mutating method returns early, also when called directly.
