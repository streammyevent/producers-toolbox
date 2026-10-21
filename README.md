# Producers Toolbox

One desktop app (Windows and macOS) with the small tools Stream My Event producers use on a show:

| Tool | What it does |
|---|---|
| **Smoelenboek** | Speaker photo directory and wireless-mic sheet, printable on A4 |
| **Content Card Studio** | Case and content cards for flight cases, with Rentman lookup |
| **Quote Pricer** | Price list with margins and quotes, exported to Rentman |

The app is built with Electron and updates itself from this repo's GitHub Releases.

## Layout

```
apps/desktop/      the Electron app (TypeScript): launcher, tool windows, app:// protocol, secrets, updates
tools/<id>/        one folder per tool: tool.json (manifest and policy), web/ (its pages), optional api.js
                   (main-process code), tests/
scripts/           repo scripts (secret and personal-data scanner)
```

## Getting started

Needs Node 24 (`.nvmrc`) and pnpm, which Node's corepack provides:

```bash
corepack enable
pnpm install
pnpm start            # run the app from source
```

## Commands

```bash
pnpm lint             # ESLint, one config for the whole repo
pnpm format           # Prettier (pnpm format:check in CI)
pnpm check:secrets    # secrets and personal data (user folders, drive paths, emails) in tracked files
pnpm test             # unit tests (node:test) of every package, through Turborepo
pnpm test:e2e         # Electron app tests and Smoelenboek's Playwright suite
pnpm dist             # build installers into apps/desktop/dist
```

Run one package's tasks with a filter, for example `pnpm --filter @producers-toolbox/tool-smoelenboek test:e2e`.

## Commits and releases

Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org). PRs are squash-merged, so the
PR title becomes the commit message, and a check enforces its format:

```
feat(smoelenboek): add camera capture
fix(desktop): keep the window size after an update
```

Scopes are the package names: `desktop`, `smoelenboek`, `content-card-studio`, `quote-pricer`, plus `repo` and
`deps`. Use `!` (`feat!:`) for a breaking change.

[release-please](https://github.com/googleapis/release-please) keeps a release PR open that bumps the version and
writes `CHANGELOG.md` from those commits. Merging it builds and signs the installers and attaches them to a draft
GitHub Release. Publishing that draft is the release: installed apps pick it up automatically.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

To be decided. Until a license is added, all rights are reserved.
