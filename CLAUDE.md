# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

Producers Toolbox: one Electron desktop app (Windows + macOS) that hosts the Stream My Event producer tools. A pnpm +
Turborepo monorepo:

- `apps/desktop/`: the Electron shell, in TypeScript (`src/main/*.ts`, compiled by `tsc` to `out/`). Launcher window
  (`src/renderer/`, plain JS), one window per tool, the `app://` protocol, encrypted secrets, the per-tool folder,
  settings, tray, auto-update (electron-updater from GitHub Releases).
- `tools/<id>/`: one folder per tool. The folder name is the tool id and its `app://<id>` origin: never rename a folder,
  or users lose that tool's stored data. `tool.json` is the manifest and policy, `web/` holds the pages (the only thing
  served), an optional `api.js` runs in the main process, `lib/` holds main-side helpers, `tests/` the tests.
  - `smoelenboek`: speaker photo directory (see `tools/smoelenboek/CLAUDE.md`).
  - `content-card-studio`: case and content cards, Rentman lookup, shared-drive sync, PNG export.
  - `quote-pricer`: price list, margins, quotes, Rentman CSV export.
- `scripts/check-secrets.js`: scans tracked and new files for secrets and personal data.

Tools ship inside the app (inside `app.asar`) and update with it. There is no runtime tool installation: do not add
one.

## The tool contract (`apps/desktop/src/types/toolbox.d.ts`)

- A tool page gets `window.toolbox` (`src/main/tool-preload.ts`), all async: `secrets.getAll/set/remove` (encrypted,
  only the names listed under `secrets` in `tool.json`), `folder.get/choose/clear/write/read/list/reveal` (a folder the
  user picks in a dialog; the page passes file names matching `folder.files`, never paths), `call(method, ...args)` (a
  method exported by the tool's own `api.js`) and `close()`.
- `api.js` exports `{ "ns.method": async (ctx, ...args) => result }`. `ctx` is a `ToolContext`: `dataDir`,
  `documentsDir`, `folder.requireFolder()`, `secrets.get(name)` and `net.fetchPublic(url, options)`. Results must be
  structured-cloneable (plain objects, strings, `Uint8Array`).
- `tool.json` holds the whole per-tool policy: `entry` and `icon` (relative to `web/`), `window`, `csp` (sent as a
  header; `script-src` must be exactly `'self'`), `permissions` (`camera`, `clipboard-read`), `secrets`, `folder`.
  Unknown fields are an error, and a broken manifest stops the app at start.
- Every IPC handler is registered through `handleTool` / `handleLauncher` in `src/main/ipc.ts`, which resolve the caller
  from the sending window and its top-level `app://` page. A unit test fails on a bare `ipcMain.handle` or `ipcMain.on`.
- `app://` serves files only (GET/HEAD). Do not add side effects to it: a page could trigger them with an `<img>`.
- Smoelenboek was written against `window.electronAPI`; `web/js/desktop-bridge.js` maps `window.toolbox` onto it.

## Commands

```bash
pnpm install
pnpm start                          # run the app from source
pnpm lint && pnpm format:check      # one ESLint config and one Prettier config at the root
pnpm check:secrets                  # must pass
pnpm typecheck
pnpm test                           # unit tests (node:test) through turbo
pnpm test:e2e                       # Electron app e2e + Smoelenboek Playwright
pnpm --filter @producers-toolbox/desktop dist:dir    # unpacked local build, unsigned (apps/desktop/dist)
```

Use Node 24 (`.nvmrc`). The shell may have `ELECTRON_RUN_AS_NODE=1` set, which makes Electron start as plain Node:
`scripts/start.js` and the e2e tests remove it.

## Conventions

- **Conventional Commits** on `main` (squash merge, the PR title is the commit). Scopes: `desktop`, `smoelenboek`,
  `content-card-studio`, `quote-pricer`, `repo`, `deps`. release-please builds `CHANGELOG.md` and the version from them.
- One version for the app: `apps/desktop/package.json` (bumped by release-please, together with the root
  `package.json`).
- TypeScript in stages: the shell is TypeScript; tool code is JavaScript, type-checked per file with `// @ts-check`
  (each tool's `tsconfig.json` includes the contract types). Move a file to TypeScript when it is seriously reworked.
- Lint and format config live only at the root. ESLint 10 uses the nearest `eslint.config.*`, so a config inside a
  package would silently replace the root one.
- Tool web code is classic `<script>` files that share globals. Declare a shared global in `eslint.config.mjs` only for
  the files that use it, never for the file that defines it (`no-redeclare`).
- All rights reserved (`LICENSE`: Stream My Event B.V. and VK Media). A vendored file or bundled font ships with its
  own license text next to it, and the `LICENSE` list of third-party files stays up to date.
- `electron-builder.yml`: never change `appId` or `productName`. `productName` is the userData folder name, and
  `appId` is what Windows knows the installed app by.

## Security rules

- Tool pages are untrusted with respect to each other and to the main process. Main-process code checks who is calling:
  the tool id comes from the sender's `app://<id>` origin, never from what the page claims.
- Build HTML from data only with escaping (`escapeHtml`) or DOM APIs (`textContent`). Pass URLs through a scheme check.
  No inline event handlers.
- Secrets (API keys, tokens) only through the shell's encrypted store (Electron `safeStorage`), never in localStorage,
  files, exports or the repo. No plaintext fallback when encryption is unavailable.
- Outbound requests from the main process go through `ctx.net.fetchPublic` (`src/main/net-guard.ts`): public
  addresses only, the DNS answer it checks is the one it connects to, redirects re-checked, bodies size-capped.
- No real customer data, prices, personal paths or real people's photos in code, tests or fixtures: use clearly
  fictional data. `pnpm check:secrets` catches paths, emails and secret shapes, not everything.
