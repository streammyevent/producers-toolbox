# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

Producers Toolbox: one Electron desktop app (Windows + macOS) that hosts the Stream My Event producer tools. A pnpm +
Turborepo monorepo:

- `apps/desktop/`: the Electron shell. Launcher window, one window per tool, the `app://` protocol, encrypted secrets,
  settings, tray, auto-update (electron-updater from GitHub Releases). Main-process code in `src/main/`, launcher UI in
  `src/renderer/`.
- `tools/<id>/`: one folder per tool. The folder name is the tool id and its `app://<id>` origin: never rename a folder,
  or users lose that tool's stored data. `tool.json` is the manifest, `web/` holds the pages, an optional `api.js` runs in
  the main process, `lib/` holds main-side helpers, `tests/` the tests.
  - `smoelenboek`: speaker photo directory (see `tools/smoelenboek/CLAUDE.md`).
  - `content-card-studio`: case and content cards, Rentman lookup, shared-drive sync, PNG export.
  - `quote-pricer`: price list, margins, quotes, Rentman CSV export.
- `scripts/check-secrets.js`: scans tracked and new files for secrets and personal data.

Tools ship inside the app and update with it. There is no runtime tool installation: do not add one.

## Commands

```bash
pnpm install
pnpm start                          # run the app from source
pnpm lint && pnpm format:check      # one ESLint config and one Prettier config at the root
pnpm check:secrets                  # must pass
pnpm typecheck
pnpm test                           # unit tests (node:test) through turbo
pnpm test:e2e                       # Electron app e2e + Smoelenboek Playwright
pnpm --filter @producers-toolbox/desktop pack    # unpacked local build, unsigned
```

Use Node 24 (`.nvmrc`). The shell may have `ELECTRON_RUN_AS_NODE=1` set, which makes Electron start as plain Node:
`scripts/start.js` and the e2e tests remove it.

## Conventions

- **Conventional Commits** on `main` (squash merge, the PR title is the commit). Scopes: `desktop`, `smoelenboek`,
  `content-card-studio`, `quote-pricer`, `repo`, `deps`. release-please builds `CHANGELOG.md` and the version from them.
- One version for the app: `apps/desktop/package.json` (bumped by release-please, together with the root
  `package.json`). The `version` in a `tool.json` is display-only.
- Lint and format config live only at the root. ESLint 10 uses the nearest `eslint.config.*`, so a config inside a
  package would silently replace the root one.
- Tool web code is classic `<script>` files that share globals. Declare a shared global in `eslint.config.mjs` only for
  the files that use it, never for the file that defines it (`no-redeclare`).
- `electron-builder.yml`: never change `appId` or `productName`. `productName` is the userData folder name, and
  `appId` is what Windows knows the installed app by.

## Security rules

- Tool pages are untrusted with respect to each other and to the main process. Main-process code checks who is calling:
  the tool id comes from the sender's `app://<id>` origin, never from what the page claims.
- Build HTML from data only with escaping (`escapeHtml`) or DOM APIs (`textContent`). Pass URLs through a scheme check.
  No inline event handlers.
- Secrets (API keys, tokens) only through the shell's encrypted store (Electron `safeStorage`), never in localStorage,
  files, exports or the repo. No plaintext fallback when encryption is unavailable.
- Outbound requests from the main process go through `net-guard` (no private or local addresses).
- No real customer data, prices, personal paths or real people's photos in code, tests or fixtures: use clearly
  fictional data. `pnpm check:secrets` catches paths, emails and secret shapes, not everything.
