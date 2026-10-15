# Punchlist — 2026-10-15

Pre-existing problems found while building the encrypted-garden lock badge and
the search-index TTL (merged as `3efa5ff`). None are caused by that work — the
e2e failures below were all reproduced against trunk's web sources — and none
were in its scope, so they are recorded here instead.

Each item has **Problem / Fix / Verify**. Branch per item, never on trunk.

## How to reproduce the e2e results

The suite talks to a live backend and mutates whatever garden is active, so run
it against a disposable data directory rather than your own gardens:

```bash
TEND_BASE_DIR=/tmp/tend-e2e TEND_AUTH_REQUIRED=false TEND_AUTH_DEFAULT_USER=dev \
  nix develop -c cargo run -p tend-server
nix develop -c pnpm --filter web dev
./scripts/run-e2e.sh
```

`scripts/run-e2e.sh` runs every `packages/web/e2e/*.mjs` in filename order and
does not stop on failure.

---

## 1. `pnpm lint` cannot run at all

- **Problem**: `packages/web/package.json:9` defines `"lint": "eslint ."`, and
  the eslint 9 toolchain is installed (`eslint`, `@eslint/js`,
  `typescript-eslint`, `eslint-plugin-react-hooks`,
  `eslint-plugin-react-refresh` in devDependencies), but there is no
  `eslint.config.js`. Eslint 9 requires a flat config and exits 2:

  ```
  ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
  ```

  `git log --all` finds no `eslint.config.*` or `.eslintrc*` ever committed, so
  this has never worked — the lint step in any documented verification sequence
  is silently vacuous. `tsc -b` (via `pnpm --filter web build`) is currently the
  only static check on the web client.
- **Fix**: add `packages/web/eslint.config.js` wiring up the plugins already
  installed — `@eslint/js` recommended, `typescript-eslint` recommended,
  `react-hooks` and `react-refresh` — scoped to `src/**/*.{ts,tsx}` with
  `dist/` and `node_modules/` ignored. Expect a first run to report a backlog
  of existing violations; triage into "fix now" versus rules to start as
  warnings, rather than blanket-disabling.
- **Verify**: `nix develop -c pnpm --filter web lint` exits 0 (or reports real
  findings) instead of exiting 2 on a missing config.

## 2. Twelve e2e checks fail on trunk

- **Problem**: on a clean `TEND_BASE_DIR`, the suite fails 12 checks across 7
  scripts. Confirmed against trunk's `packages/web/src`, so these predate the
  lock-badge work:

  | Script | Failing check |
  | --- | --- |
  | `editor-v2-move-collapse.mjs` | `Alt+ArrowUp moved beta above alpha` |
  | `editor-v2-structural.mjs` | `both alpha and beta present` |
  | `editor-v2-split-metadata.mjs` | `created two blocks (got 2)` |
  | `editor-v2-split-metadata.mjs` | `first TODO kept its metadata` |
  | `editor-v2-slash-format.mjs` | `format: Ctrl+B wrapped selection (got "****world")` |
  | `palette-link-or-create.mjs` | `create shown for exact/prefix match (standup)` |
  | `palette-link-or-create.mjs` | `create shown when nothing matches (zzz)` |
  | `palette-link-or-create.mjs` | `existing narrows to 2026-01-01` |
  | `compilations.mjs` | `file level prompts for a compilation first` |
  | `compilations.mjs` | `file field appears once a compilation is chosen` |
  | `task-manager-edit.mjs` | `status pill now shows DOING` |
  | `task-manager-edit.mjs` | `priority persisted (todos priority = 3)` |

  Two of these are worth singling out:

  - `Alt+ArrowUp moved beta above alpha` is the undiagnosed bullet-move
    oddity — this is a concrete, scripted repro for it.
  - `task-manager-edit.mjs` fails its two UI assertions while the adjacent
    `status persisted to origin page (todos = DOING)` passes, so the write
    reaches the file and the view does not reflect it. Suspect the status pill
    and priority are not re-rendering from the store after the edit.
- **Fix**: one branch per script, decide per check whether the product or the
  assertion is wrong — several of these scripts were written against the older
  editor and may be asserting retired behaviour (the `palette-link-or-create`
  create-row expectations look like they predate the `LinkPicker` rework).
  Anything judged to be asserting retired behaviour should have the assertion
  rewritten, not deleted.
- **Verify**: `./scripts/run-e2e.sh` against a fresh `TEND_BASE_DIR` ends with
  every script reporting `all checks passed`.

## 3. The e2e suite is not isolated between runs

- **Problem**: every script shares one garden and the suite never resets it, so
  results depend on what earlier scripts and earlier *runs* left behind.
  Observed concretely: `longform.mjs`'s `starts in V2 outline (has list chrome,
  not .longform)` passes on a fresh `TEND_BASE_DIR` and fails on a reused one,
  because an earlier run left its test page flagged `longform`. A second run
  over a dirty directory also surfaced failures in `editor-v2-move-collapse`
  and `compilations` that a fresh run did not. This makes the suite unreliable
  as a regression gate and makes failures hard to attribute.
- **Fix**: give each script its own namespace or garden, or have
  `scripts/run-e2e.sh` provision a throwaway `TEND_BASE_DIR` (and start the
  backend against it) for each invocation. The newest script,
  `garden-lock-badge.mjs`, documents the "point TEND_BASE_DIR somewhere
  disposable" requirement in its header and is re-runnable by design; that is
  the pattern to generalise.
- **Verify**: running `./scripts/run-e2e.sh` twice in a row over the same data
  directory produces identical results, and running the scripts in a different
  order does too.
