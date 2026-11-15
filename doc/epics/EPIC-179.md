# EPIC-179: Dependency refresh

## Status

**Status:** Active
**Created:** 2026-11-15

## Overview

Bring every npm dependency up to its current release and drop the ones nothing uses any more. The user's
policy is to keep dependencies current rather than let them age until an upgrade becomes a migration
project. So this epic takes the major upgrades too, each as its own task, and ends with a recurring
refresh so the gap does not reopen.

## Goals

- No unused packages in `package.json`.
- Every package on its latest release, or a recorded reason why not yet. A blocker named in a task
  document counts, for example a plugin that does not support the new major.
- `patches/` still apply. Each patch is renamed to the new version, and dropped if upstream fixed the
  problem it works around.
- The vendored board libraries (`assets/boards/excalidraw/lib`, the REST Client CodeMirror bundle) are
  rebuilt from the updated packages.
- A recurring refresh is scheduled.

## Current state (verified 2026-11-15, `npm outdated`)

**Unused:** `d3`, `d3-drag`, `d3-zoom`, `@types/d3`, `@types/d3-drag` and `@types/d3-zoom` are left
over from the graph editor, which moved to a board. Nothing in `src/` or `scripts/` imports them.
Mermaid brings its own copy of d3 as one of its dependencies.

**Look unused but are not:**
- `react` and `react-dom` are only used by `scripts/build-board-lib.mjs` to vendor Excalidraw.
- `@excalidraw/*`, `@codemirror/*` and `@lezer/highlight` are build inputs for the bundled boards.

**Within the current version range (no major bump):**

| Package | Current → Latest |
|---|---|
| `@modelcontextprotocol/sdk` | 1.29.0 → 1.32.2 |
| `hls.js` | 1.6.16 → 1.7.4 |
| `immer` | 11.1.11 → 11.2.10 |
| `mermaid` | 11.16.0 → 11.17.2 (the 11.x line; 12 is US-2012) |
| `jszip` | 3.10.1 → 3.10.2 |
| `picomatch` | 4.0.5 → 4.0.7 |
| `turndown` | 7.2.4 → 7.2.5 |
| `csv-parse` | 7.0.1 → 7.0.3 |
| `csv-stringify` | 6.8.1 → 6.9.0 |
| `property-information` | 7.1.0 → 7.2.0 |
| `video.js` | 8.23.9 → 8.24.2 (the 8.x line; 10 is US-2018) |
| `vite` | 8.1.4 → 8.3.8 |
| `esbuild` | 0.28.1 → 0.28.2 |
| `electron-builder` | 26.15.3 → 26.18.0 |
| `typescript-eslint` and `@typescript-eslint/parser` | 8.63.0 → 8.72.2 |
| `globals` | 17.7.0 → 17.14.0 |
| `vite-plugin-monaco-editor-esm` | 2.0.2 → 2.0.3 (patched) |
| `@types/d3-zoom` | removed |
| `react` and `react-dom` | 19.3.0 → 19.3.1 (board lib rebuild) |
| `@codemirror/view` | 6.43.11 → 6.43.15 (pinned exactly; REST Client lib rebuild) |
| `@codemirror/language` | 6.12.4 → 6.13.1 (pinned exactly) |
| `@codemirror/commands` | 6.11.0 → 6.11.1 (pinned exactly) |
| `@types/node` | ^20 → **^24**: match Electron 44's Node 24 (`electron@44` depends on `@types/node ^24.9.0`), not the npm latest 26 |

**Major upgrades:**

| Package | Current → Latest | Where it is used |
|---|---|---|
| `monaco-editor` | 0.55.1 → 0.57.0 | the text editor, plus the patch in `patches/monaco-editor+0.55.1.patch` (it disables Node process detection and stubs `IProductService` in paste) and the translated menu text in `src/renderer/i18n/monaco-nls.ts` |
| `mermaid` | 11 → 12 | the Mermaid editor (`editors/mermaid/render-mermaid.ts`), Markdown code blocks and the log-view Mermaid output |
| `@excalidraw/mermaid-to-excalidraw` | 2.2.2 → 3.6.0 | vendored into the Excalidraw board |
| `electron-store` | 11 → 12 | `src/main/e-store.ts` |
| `simple-git` | 3 → 4 | `src/main/git-service.ts`, the Git editor |
| `jschardet` | 3 → 4 | `src/renderer/core/utils/text-encoding.ts` |
| `eslint` and `@eslint/js` | 9 → 10 | `eslint.config.mjs`, which uses `eslint-plugin-import` and `eslint-import-resolver-typescript` |
| `typescript` | 5.9 → 7 | `tsc`, typescript-eslint, `scripts/typecheck-strict.mjs` (which uses the compiler API) |
| `video.js` | 8 → 10 | `editors/video/VPlayer.ts`; 10 is a rewrite |

`@excalidraw/excalidraw` 0.18.1 is already the latest.

## Tasks

| ID | Title | Depends on | Notes |
|---|---|---|---|
| [US-2010](../tasks/US-2010-dependency-refresh-in-range/README.md) | Remove d3; in-range updates; `@types/node` 24 | — | Also rebuild both board libraries and rename the Vite plugin patch |
| [US-2011](../tasks/US-2011-monaco-0-57/README.md) | Monaco 0.57 | US-2010 | Redo the patch, check the worker setup and the translated menu text |
| [US-2012](../tasks/US-2012-mermaid-12/README.md) | Mermaid 12 and mermaid-to-excalidraw 3 | US-2010 | Rebuild the Excalidraw lib; check every place a diagram renders |
| US-2013 | electron-store 12 | US-2010 | Settings must survive the upgrade; check whether 12 requires a newer Electron or ESM. **Done (no task doc):** 12.0.0 needs Electron ≥ 35 (we ship 44) and pulls `conf` 16. Its breaking changes cover migrations, schema, encryption and invalid dot paths; `e-store.ts` passes no options and every key is a plain dotted string, so no code changed. A cold start read the existing `config.json` intact |
| US-2014 | simple-git 4 | US-2010 | Go through the Git editor and Git service API calls. **Done (no task doc):** 4.0.2 guards every `GIT_*` variable — it strips inherited ones and throws on an explicit `.env("GIT_…")` that is not in `allowEnvironment`, which broke `status`, refs, fetch, push and ahead/behind. `git-service.ts` now builds every instance through `gitAt()`, which allows `GIT_OPTIONAL_LOCKS` and `GIT_TERMINAL_PROMPT`. We already used the named `simpleGit` export and full option names. Verified live: status, refs, log, identity, remote URL, fetch and ahead/behind |
| US-2015 | jschardet 4 | US-2010 | Encoding detection on sample files. **Done (no task doc):** 4.1.0 is a rewrite (port of chardet 7) with a new confidence scale — correct single-byte answers score 0.06–0.43, so the old `> 0.7` cutoff would ignore them. `text-encoding.ts` now uses `DETECTION_MIN_CONFIDENCE = 0.05`. Opening samples in the app: cp1251 Ukrainian, UTF-8 and ASCII unchanged; cp1252 German (v3: x-mac-cyrillic → windows-1251 fallback) and BOM-less UTF-16 (v3: ascii) are now right. The model ships as JS, so bundling works; the renderer `fs` chunk grows by about 1 MB |
| US-2016 | ESLint 10 | US-2010 | Blocked until `eslint-plugin-import` supports 10, or replace it with `eslint-plugin-import-x`. The import zones must keep failing the build on a violation. **Done (no task doc):** `eslint-plugin-import` 2.32 still stops at ESLint 9, so it is replaced by `eslint-plugin-import-x` 4.18 (resolvers via `import-x/resolver-next`; rules renamed `import/` → `import-x/`). Probe files confirmed a zone violation and an unresolved import still error. ESLint 10's new recommended rules flagged 46 sites, fixed by Codex: `preserve-caught-error` (36, add `{ cause }`), `no-unassigned-vars` (3; one was a real latent bug — `TextTranslationProvider` operations used unassigned resolve/reject until `promiseFor()` ran) and `no-useless-assignment` (7). Open question: `BrowserWebviewModel.restoreClaimedNavigation` ignores `reportedCanGoBack` (always overwritten); unchanged. `overview.md` now names `import-x/no-restricted-paths` |
| US-2017 | TypeScript 7 | US-2016 | **Blocked, checked 2026-11-15; folded into US-2019's Watch list** (no separate scheduled task): TypeScript 7.0.2 is released, but typescript-eslint 8.72.2 (latest) requires `typescript >=4.8.4 <6.1.0`; TypeScript 6.0.3 is inside that range. Blocked until typescript-eslint supports it. `typecheck-strict.mjs` uses the JS compiler API, which 7 may not ship |
| US-2018 | video.js 10 | US-2010 | Migration investigation first. If 10 does not fit, record the reason and stay on the latest 8.x. **Done (no task doc) — video.js removed:** 10 is a different product (the `video.js` package is a throwing shim; the player is `@videojs/html` web components with separate HLS adapters; v8 gets security fixes until 2028-10-01). Persephone used video.js only to skin HLS streams — playback was already our own hls.js with the header-forwarding loader, and mp4/audio used native controls. User decision 2026-11-15: drop it. `VPlayer.ts` now gives HLS the same native element, listeners and controls as other media; hls.js still attaches to that element. Visible change: HLS controls look like mp4's |
| [US-2019](../tasks/US-2019-dependency-refresh/README.md) | Dependency refresh (recurring) | — | Scheduled about every 3 months, like US-1757. **Done:** recurring task document written (procedure, EPIC-179 lessons, Watch list with TypeScript 7); first round scheduled for 2027-02-15 |
| [US-2021](../tasks/US-2021-typescript-6/README.md) | TypeScript 6 | US-2016 | Bridge release towards 7 (6.0.3 is inside typescript-eslint's range). Removed the deprecated `baseUrl`; `"strict": false` stated explicitly because 6 defaults it on; three `HTMLElement.hidden` type fixes |
| [US-2020](../tasks/US-2020-mermaid-look-layout/README.md) | Mermaid view look and layout switches | US-2012 | Per-page look and layout comparison with immediate rendering |

### Ordering and rules

- **US-2010 goes first.** It takes the cheap wins and gives the later tasks a clean `npm outdated`.
- **One major per task, each committed separately.** A regression then traces back to one package.
- **A blocked major is not a failure.** If the ecosystem is not ready (US-2016, US-2017), the task
  records the blocker and the date it was checked. It moves to **Scheduled** with a re-check date
  instead of being forced.
- **Every task runs** `npm run typecheck`, `npm run lint` and `npm run build-prod`, plus a cold
  `npm start` smoke check of the editors the package touches.
- **A task that changes a vendored board library** reruns `npm run build-board-lib` or
  `npm run build-rest-client-lib` and commits the regenerated output.
- **These are package upgrades only.** No user-visible behavior change is intended, so `/userdoc` is
  expected to be a no-op. Developer docs that name a version (for example `CLAUDE.md` / `agents-common.md`
  "Tech Stack") are updated by `/document`.

## Concerns

- **Monaco** changed its ESM layout in 0.55. 0.56 and 0.57 may move the worker entry points the Vite
  plugin resolves, or the `esm/nls.messages.*.js` files.
- **TypeScript 7** is a Go-native compiler. Whether a JS API package exists for
  `typecheck-strict.mjs`, and for `monaco-project-intellisense`, which runs Monaco's bundled TS rather
  than ours, is the first thing US-2017 must establish.
- **video.js 10** may not keep the plugin and tech model that `VPlayer` and the HLS loader rely on.
