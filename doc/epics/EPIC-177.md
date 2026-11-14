# EPIC-177: Refactoring Phase 7 — lock it in: error-level layer zones, `overview.md` dependency rules, `strictNullChecks` per folder

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirty-seventh and last epic of the [refactoring roadmap](../reviews/refactoring-roadmap.md): **Phase 7, Lock it
in.** It turns the layer map of roadmap §4.1 into error-level import zones, rewrites the `overview.md` dependency rules
so they state exactly what is enforced, and turns on `strictNullChecks` per folder (decision
[D10](../reviews/refactoring-roadmap.md#6-decisions-for-you), accepted). The third Phase 7 item — the §7 guardrails in
`doc/agents-common.md` and in the Codex delegation brief — is not code: the agent may not edit those files, so the
proposed wording goes to the user (see Notes).

The code was checked on 2026-11-14, after EPIC-176:

- **No import zone is a warning any more.** Every `import/no-restricted-paths` block in `eslint.config.mjs` is already
  `"error"`: `uiImportZone` (nothing outside `ui/` imports `ui/`), Rule 6 (`uikit/` must not import `api/`,
  `components/`, `src/shared`), `api/` and `api/capabilities/` must not import `editors/board/` (two documented
  exception files), and `editors/base/` must not import board modules. So "warnings → errors" means: **add the zones the
  §4.1 map still lacks, at error level**, fixing the violations or recording a legitimate exception with its reason.
- **Violations of the §4.1 map today** (static, type-only and lazy imports counted; stories excluded):
  - `core/` → `api/` 11 imports in 6 files (`core/utils/guard.ts` → `api/ui`; `core/utils/file-watcher.ts` and
    `copy-files.ts` → `api/fs`, `api/path-watch`; `core/traits/linkTraits.ts`, `fileLinkTraits.ts` → `api/fs`,
    `api/types/io.tree`; `core/utils/html-resources.ts` type-only), `core/` → `ipc/` 2 (`utils.ts` clipboard,
    `file-watcher.ts` type). This is the unfinished part of roadmap item 2.3 (CORE-3 steps 1–4).
  - `shared/` → `renderer/api/types` 5, type-only (`link-data.ts`, `types.ts`: the script-API type contract);
    `shared/` → `ipc/` 4 (`execute-handle.ts` runtime, `capability-client.ts`, `i18n/board-pack.ts` type-only).
  - `content/` → `editors/` 7 (`editors/base/editor-catalog` and `editorRegistry` from `builtin-schemes.ts`,
    `resolvers.ts`, `open-in-persephone.ts`, `tree-providers/FileTreeProvider.ts`; a lazy `editors/browser/BrowserEditor`
    in `open-actions/browser.ts`).
  - `components/` → `editors/` 3 (`components/icons/icon-elements.ts` → `editors/board/board-glyph-element`,
    `language-icon-resolver.ts` → `editors/base/editor-catalog`, `editors/board/board-icon-cache`) — roadmap 2.4's
    "`components/` boundary".
  - `theme/` → `uikit/` 2 (`token-vars.ts` → `uikit/tokens`, `icons.ts` type-only) while `uikit/` → `theme/` 8;
    `theme/themes/index.ts` → `ipc/`.
  - `uikit/` has no import outside `core/`, `theme/` and `uikit/` except what Rule 6 already forbids (0 today).
  - `api/` → `editors/` 72 (30 files), `api/` → `scripting/` 9, `api/` → `content/` 19, `api/` → `components/` 1;
    `scripting/` and `editors/` import everything below them as the map allows.
- **`strictNullChecks`** is off in `tsconfig.json` (no `strict`). A whole-program `tsc --noEmit --strictNullChecks`
  reports 510 errors: `editors/` 215, `main/` 93, `content/` 53, `uikit/` 43, `scripting/` 32, `ui/` 23, `api/` 18,
  `ipc/` 10, `module-service-host/` 8, `core/` 4, `components/` 4, `audio/` 4, `shared/` 2, `automation/` 1, and **0**
  in `board-shim/`, `node-script-host/`, `preload-webview/`, `renderer/guides`, `renderer/i18n`, `renderer/theme`,
  `renderer/types`. A per-folder `tsconfig` cannot simply `include` a folder: `tsc` type-checks and reports every file
  the included ones import, so the check must report only the errors located in the strict folders.

## Goals

- Every rule of the §4.1 layer map that the code meets is an **error-level** import zone in `eslint.config.mjs`; every
  rule it cannot meet yet is listed (in `overview.md` and the roadmap) with the edge count and the reason.
- `doc/architecture/overview.md` "Dependency Rules" states exactly what is enforced, and separately what is a target.
- `npm run typecheck` fails on a `strictNullChecks` error in a strict folder; the strict set covers at least `shared/`,
  `core/` and `content/` plus every folder that is already clean; the rest is recorded in the roadmap.
- No behaviour change. Null-check fixes keep every runtime condition; where a fix needs a guard, the plan states what
  the old code did when the value was null (it threw, or it read `undefined`) and keeps that outcome.

## Decisions this epic acts on

- **Scope: four tasks.**
  - **US-1996 — `core/` and `shared/` boundary.** Finish roadmap 2.3's `core/` part: `core/` imports only `core/` and
    `shared/` (and its own third-party packages). The guard reporter is injected (registered by `api/` at startup) instead
    of `core/` importing `api/ui`; `toClipboard` leaves `core/utils/utils.ts` for `api/`; the file services
    (`file-watcher.ts`, `copy-files.ts`) move to `api/`; the link traits that call `fs` are registered from `api/` (or
    take `fs` by injection) — the plan picks per file and names the owner. Type-only `api/types/*.d.ts` contract imports
    are judged per case: move the type to `shared/` only if the script-API `.d.ts` files stay byte-identical in what
    they expose, otherwise keep a narrow, documented `except`. `shared/` must not import `renderer/`, `main/`,
    `board-shim/` or `preload*` (its 5 type-only `renderer/api/types` imports: fix or documented exception); the plan
    decides whether `shared/` → `ipc/` contracts is allowed (both are contract layers per §4.1) and proves no cycle. Two
    error-level zones (`core/`, `shared/`), each proven with a temporary violating import.
  - **US-1997 — upper-layer zones and the dependency rules.** Error-level zones for `content/` (no `editors/` except
    the documented catalog/registry seam, or that seam moved — the plan decides with the owner named; no `components/`,
    `scripting/`), `components/` (no `editors/`, `scripting/`: fix the icon/board-glyph edge — roadmap 2.4's
    `components/` boundary — by registration or by moving the helper down), `uikit/` (extend Rule 6 to the full map:
    only `core/`, `theme/` and itself), `theme/` (the `theme` ↔ `uikit` token direction settled: tokens have one owner),
    and `api/` → `components/`/`scripting/` if the edge count is small enough to fix; `api/` → `editors/` (72) is
    recorded, not enforced. Then `overview.md` "Dependency Rules" is rewritten: one list of enforced rules (each naming
    its zone) and one list of targets with counts and the roadmap item that owns them.
  - **US-1998 — `strictNullChecks`, wave 1.** The mechanism (owner named; reuses `tsc`, adds no dependency), wired into
    `npm run typecheck`, with the strict folder list in one place. Folders: `shared/`, `renderer/core`,
    `renderer/content`, plus the clean ones (`board-shim/`, `node-script-host/`, `preload-webview/`, `renderer/guides`,
    `renderer/i18n`, `renderer/theme`, `renderer/types`) and the near-clean `renderer/components`, `renderer/audio`,
    `renderer/automation` (9 errors).
  - **US-1999 — `strictNullChecks`, wave 2.** `renderer/api`, `ipc/`, `module-service-host/`, `renderer/scripting`,
    `renderer/ui` (91 errors). The remainder (`editors/` 215, `main/` 93, `uikit/` 43) is recorded in the roadmap.
- **Null-check fix rules.** No `!` to silence an error without a stated reason; no `as` casts to dodge one; no changed
  runtime condition. Prefer correcting the declared type (an optional field that is always set, a return type that can
  be `undefined`) over adding guards. A guard that changes what happens on `null` is a behaviour change: the plan lists
  it as a recorded change or does not make it. Latent bugs found (a dereference that can really throw) are listed
  separately; fixing one is allowed only as a recorded change.
- **Pure moves.** Files move with `git mv`; importers are updated; no shim, no barrel. A lazy `import()` whose path
  changes stays lazy; no new `await import()`.
- **Contracts that must not change:** the script API and `api/types/*.d.ts` as seen by scripts, ai-vision paths and
  agent-facing messages, MCP `call` results, the `data-name` contract, persisted settings and `uiPreferences` keys,
  `window.persephone` (not touched, so no `BOARD_BRIDGE_VERSION` bump).
- **Guardrails.** No new protocol code (1). Board rules stay in `shared/board/` and the board registries (2). God files
  only shrink (3). Plans name the owner of every moved file, new zone and new script, and the helper reused (4). No
  `await import()` to break a cycle (5). Error-level import zones must pass.
- **Order.** The four plans are written in parallel (staggered starts, each touching only its own task document) and
  implemented one at a time, US-1996 → US-1997 → US-1998 → US-1999. The strict-null plans list error categories and
  the risky fixes; the implementer re-runs the strict check after the zone tasks have moved files.
- **Live verification limits.** The user may be using Persephone. Live checks run in a separate window opened and
  closed by the agent; no page, dialog or window the agent did not open is touched, and the app is not restarted while
  other windows are open. `npm run build-prod` runs with `.vite/build` backed up and restored.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1996 | `core/` and `shared/` boundary: injected guard reporter, file services to `api/`, error-level zones | Done |
| US-1997 | Upper-layer zones (`content/`, `components/`, `uikit/`, `theme/`) and the `overview.md` dependency rules | Done |
| US-1998 | `strictNullChecks` wave 1: mechanism, `shared/`, `core/`, `content/` and the clean folders | Done |
| US-1999 | `strictNullChecks` wave 2: `api/`, `ipc/`, `module-service-host/`, `scripting/`, `ui/` | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved file and new rule, and the helper reused. For every exported symbol that
  moves, list its importers and update them (no re-export shims). Check every new import against the zones in
  `eslint.config.mjs` and the §4.1 map. ESLint flat config replaces `import/no-restricted-paths` per matching block:
  a file matched by several blocks gets only the last block's zones, so every block that matches a file must carry
  `uiImportZone` and the new zones that apply to it. Prove each new zone with a temporary violating import. No unit
  tests. Comments move with the code.
- **US-1996.** For the guard reporter: who registers it, when relative to the first possible `guard()` call, and what
  happens before registration (today `guard` always reaches `ui.notify`). For moved file services: every importer,
  lazy or static. Import cycles: run the cycle check the roadmap used (or `madge`-style resolution with the TS
  resolver) before and after; the main-process startup hang of EPIC-175 came from a new cycle.
- **US-1997.** The `content/` → `editors/base` catalog seam: why `content/` needs the editor catalog (file→editor
  resolution) and who should own it; the board icon change subscription in `components/icons`; Storybook stories
  stay excluded from Rule 6 but not from `uiImportZone`.
- **US-1998 / US-1999.** The mechanism's run time and how it reports (file:line like `tsc`); a fix list grouped by
  pattern (declared-optional-but-always-set, missing `| undefined` in a return type, map lookups, DOM queries,
  `find()` results), and every fix that touches a runtime path named with the old behaviour on `null`.

## Out of scope

- `api/` → `editors/` (72 imports) and the `strictNullChecks` remainder (`editors/`, `main/`, `uikit/`): recorded in the
  roadmap.
- Editing `doc/agents-common.md` beyond a factual pointer, `CLAUDE.md`, `AGENTS.md`, `.claude/` or `.agents/` (the §7
  guardrail wording goes to the user).
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-176. Findings checked against the code (see Overview). The Codex weekly limit was reset by
  the user; planning runs on `--terra`, implementation and completion on `--luna`.

### 2026-11-14 — plans
- Four plans written in parallel by Codex (Terra). Three first runs stopped early as "BLOCKED" with half-written
  documents; each was resumed once and completed.
- **US-1996 corrections:** `linkTypes.ts` replaces its now-false `linkTraits` side-effect import with the new
  `api/core-bootstrap.ts` instead of adding a second one; the plan proves the bootstrap's static runtime closure
  (`api/ui`, `api/fs`) never reaches `api/app.ts` (no evaluation-time cycle). **Decided:** `core/utils/guard.ts` takes an
  injected reporter (registered by `api/core-bootstrap.ts`, imported by `api/app.ts`) with a FIFO queue for reports made
  before registration; the link traits register from `api/` at bootstrap; `file-watcher.ts`, `copy-files.ts` and
  `toClipboard` move to `api/`; `shared/` may import `ipc/` contracts; the type-only `api/types/*.d.ts` imports stay
  as exact per-file exceptions (the script `.d.ts` files are self-contained by design). **Recorded changes:** trait
  registration and the `api/ui`/`api/fs` module evaluation happen earlier in startup (no user-visible effect).
- **US-1997 corrections:** dropped a new `api/boards/file-icon-editor.ts` wrapper that only moved an `editorCatalog`
  call behind `api/` to pass the zone (guardrail 4); `components/` instead gets the same narrow
  `editors/base/editor-catalog.ts` exception `content/` has. The `uikit/CLAUDE.md` token path gets a factual update.
  Target rules cite this epic's roadmap remainder, not item 2.5. **Decided:** board icon cache and glyph move to
  `components/icons/` (presentation, not a board rule); `uikit/tokens.ts` moves to `theme/tokens.ts`; the
  `NativeCSSProperties` type moves to `core/`.
- **US-1998 / US-1999 corrections:** both plans first added new throws for malformed input (six and two recorded
  changes, some imitating V8's native messages). Rejected: every fix is now type-only and erases to identical
  JavaScript (a declared-type correction, an inlined condition, or a `!` with a one-line reason per function). Wave 1
  adds 57 `!` because repeated reads of a shared `ILinkData` across calls cannot be cached without a possible behaviour
  change. **Mechanism:** `scripts/typecheck-strict.mjs` (TypeScript API, one folder list, location filter), run by
  `npm run typecheck` after `tsc --noEmit`.

### 2026-11-14 — results
- **US-1996:** `api/core-bootstrap.ts` (imported by `api/app.ts`) registers the guard reporter and both link traits;
  `file-watcher.ts`, `copy-files.ts` and `toClipboard` moved to `api/`; error-level `core/` and `shared/` zones.
- **US-1997:** board icon cache and glyph to `components/icons/`, `theme/tokens.ts`, `core/native-css-properties.ts`;
  zones for `content/`, `components/`, `uikit/`, `theme/`, `audio/`, `automation/`, `guides/` and `i18n/`, each proven with
  a temporary violating import. In the `overview.md` rewrite I restored the layer-roles text it had dropped and
  replaced the "recount" placeholders with the counts.
- **US-1998 / US-1999:** `scripts/typecheck-strict.mjs`; 18 folders strict with 0 errors; `npm run typecheck` takes
  about 20 s. Checked by transpiling every changed file before and after: the emitted JavaScript is identical except
  `pipe-resource-server.ts` (inlined condition), `PcmAudioCapture.ts` (`Number(x)`, NaN either way) and seven US-1999
  files whose rewrites are value-identical (a captured local, an inlined condition, a `typeof` check that
  `Number.isInteger` already implied, an early return equal to the old optional chain).
- No BOM, mojibake, glued import/export, re-export shim or lost comment in the diff; static import cycles unchanged.
- **Live (own window, closed afterwards):** a file, a zip archive entry, a folder workspace (Explorer rows and icons),
  a `data:` URL, a `persephone-guide://` link, and the Tools & Editors hub with 14 board icon images; 39 `--p-*` token
  variables, as in the main window; no console errors.
- **Not verified live:** drag and drop (traits), a `guard()` failure toast, clipboard copy, native theme sync, the
  module-service host provider paths.
- **Builds:** `npm run typecheck`, `npm run lint`, `npm run build-prod` (with `.vite/build` backed up and restored) and
  `npm run i18n:check` pass.

### 2026-11-14 — completion
- **Completion skills (Codex, Luna):** `/review` changed nothing; it listed the new non-null assertions, which are this
  epic's decision (type-only, one reason comment per function). `/document` updated `folder-structure.md`,
  `key-files.md`, `trait-system.md`, `coding-style.md` and `uikit-vs-components-split.md`, and added a `npm run typecheck`
  pointer line to `doc/agents-common.md`. `/userdoc` changed nothing. No catalog message changed.
