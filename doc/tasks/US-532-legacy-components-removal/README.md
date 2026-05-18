# US-532: Final `components/` sweep — empty the legacy folder

## Status

**Plan ready for review.** Final EPIC-025 close-out cleanup. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4. **Blocked on** the
remaining per-screen migrations + overlay-infrastructure tasks
listed under "Blocked on" below.

## Goal

Empty `src/renderer/components/` of every folder that was either
already migrated to UIKit or whose contents are general-purpose
primitives that belong in UIKit. After this task, the only folders
remaining under `src/renderer/components/` are the four
**persephone-coupled** folders that the user has decided to keep
there permanently (see Background).

This task does NOT migrate any new code — it is a final
verification + delete sweep. The migration of every primitive
subfolder is tracked by its own per-folder task (see "Blocked on").
If a non-trivial usage surfaces during prep, the migration of that
usage spawns a follow-up task; this task does not absorb
implementation work.

**Documentation is explicitly out of scope.** The entire EPIC-025
documentation update — including any `uikit/` vs `components/`
standards write-up, folder-structure refresh, and stale-reference
sweep across `doc/`, `docs/`, `qa/`, `assets/`, and `src/main/` —
is a separate, post-epic effort that will be tracked by its own
task(s).

## Background

### `uikit/` vs `components/` — the agreed split

By user decision (2026-05-18), the two folders now have distinct
purposes that will outlive EPIC-025:

- **`src/renderer/uikit/`** — Persephone's standalone reusable
  component library. Components here do NOT depend on
  persephone-specific code (no `api/`, no `services/`, no editor
  models). They are general-purpose UI primitives that could ship
  as a separate package in principle. Governance: `uikit/CLAUDE.md`.
- **`src/renderer/components/`** — Persephone-coupled components.
  Components here MAY use persephone services (`api/`, settings,
  page model, events, etc.) and SHOULD be implemented on top of
  UIKit primitives where possible (no rolling new low-level
  styled chrome when a UIKit primitive exists).

Documenting this split is part of the post-epic documentation
effort, NOT this task. US-532 ships code-only changes.

### Current state of each subfolder

Folder caller counts grep'd against `src/` on the
`upcoming-v3.0.10` branch (2026-05-18):

| Folder | External callers | Disposition |
|---|---|---|
| `components/basic/` | 0 | DELETE |
| `components/form/` | 0 | DELETE |
| `components/layout/` | 0 | DELETE |
| `components/overlay/` | 2 (grid editor — `ColumnsOptions.tsx`, `CsvOptions.tsx`) | DELETE — after [US-542](../US-542-grid-options-popover-flip/README.md) lands |
| `components/TreeView/` | 0 | DELETE |
| `components/data-grid/` | — | already gone (US-536) |
| `components/virtualization/` | — | already gone (US-538) |
| `components/icons/` | many | KEEP — persephone-coupled |
| `components/page-manager/` | many | KEEP — persephone-coupled |
| `components/file-search/` | many | KEEP — persephone-coupled |
| `components/tree-provider/` | many | KEEP — persephone-coupled |

The five "DELETE" folders are the entire scope of US-532's
deletions. The four "KEEP" folders stay in `components/` untouched
by this task.

### `components/index.ts` today

```ts
// Basic components
export * from './basic';

// Form components
export * from './form';

// Layout components
export * from './layout';

// Overlay components
export * from './overlay';
```

After US-532, all four sub-barrels are gone and the file is empty.
The four KEEP folders are NOT exposed through `components/index.ts`
(callers already import via direct paths like
`components/icons/FileIcon` or `components/tree-provider/CategoryView`).

## Implementation Plan

### Step 1 — Verify preconditions

Re-run callerless verification for each folder slated for deletion.
For each `<folder>` in `basic`, `form`, `layout`, `overlay`,
`TreeView`, grep `src/` for any import path matching
`components/<folder>` (outside the folder itself). All five must
return zero matches before deletion begins.

For `overlay/` specifically: this requires
[US-542](../US-542-grid-options-popover-flip/README.md) to land so
its two remaining callers (`ColumnsOptions.tsx`, `CsvOptions.tsx`)
stop importing `Popper`. (US-509 — Grid editor chrome — already
landed in `e506c81` but deliberately scoped to chrome and left
these popovers for US-542.)

### Step 2 — Delete the five primitive folders

```
git rm -r src/renderer/components/basic
git rm -r src/renderer/components/form
git rm -r src/renderer/components/layout
git rm -r src/renderer/components/overlay
git rm -r src/renderer/components/TreeView
```

Use `git rm -r` so history shows the directory removals.

### Step 3 — Delete `components/index.ts`

After Step 2, `src/renderer/components/index.ts` references four
non-existent sub-barrels. Delete the file. The four KEEP folders
are accessed via direct paths, so no consumer breaks.

Verify with grep for `from "[^"]*renderer/components"` (the bare
folder import) — the result must be empty.

### Step 4 — Build & smoke test

- `npm run lint` — clean (no NEW warnings vs the pre-US-532 baseline)
- `npx tsc --noEmit` — no NEW errors vs the pre-US-532 baseline
- `npm run dist` — production build succeeds (catches any stragglers
  the dev bundler tolerated)
- `npm start` — manual smoke across high-traffic surfaces: Text page,
  Grid page, Notebook, Browser editor, LinkEditor, Rest Client,
  Settings page, Sidebar (Files / Open Tabs / Script Library /
  Tools Editors), Explorer secondary editor

### Step 5 — Dashboard

- Mark US-532 `[x]` in `doc/active-work.md`.
- Do NOT move EPIC-025 to `epics/completed.md` yet. EPIC-025 close
  requires the post-epic documentation effort (separate task(s)) to
  land first — that's where `/review` and any documentation
  refreshes run. US-532 is the last *code* task; the epic closes
  after its documentation tasks complete.

## Concerns

### A. Components/index.ts — delete or keep as empty file?

**Resolution:** Delete the file. An empty barrel is a footgun (a
future contributor wonders what's missing). The four KEEP folders
already work via direct paths and don't need re-exporting.

### B. Inner cross-references between KEEP folders

The four KEEP folders may currently reference each other or
reference primitives from soon-to-be-deleted folders.

**Verified (2026-05-18):** `components/tree-provider/` does NOT
import from `components/TreeView/` — confirmed via grep. The other
three KEEP folders are smaller and unlikely to cross-reference
deleted primitives, but Step 1's per-folder grep covers this
because it greps the entire `src/` tree (including each KEEP
folder's own files). Any straggler surfaces in Step 1 and is
either fixed inline or spun out as a follow-up.

### C. `components/tree-provider/` and the `components/TreeView/` deletion

`components/tree-provider/TreeProviderView.tsx` was historically
the last consumer of `components/TreeView/`. US-497 already flipped
it to UIKit `Tree` + `TREE_ITEM_KEY` (commit `082f974`, bundled
with the sidebar migration). `components/TreeView/` is now fully
callerless — verified via grep on 2026-05-18 (zero matches for
`from "[^"]*components/TreeView` across `src/`).

**Resolution:** No remaining concern. The `tree-provider/` folder
stays in `components/` as a persephone-coupled UIKit-consumer
(matching the Background contract), and `components/TreeView/` is
safe to delete in Step 2 because nothing imports it anymore.

### D. What if a tsc / lint regression surfaces after deletion?

**Resolution:** Investigate immediately. Any new error is by
definition coming from a stale import that the per-folder grep
missed (most likely a non-relative path or a typo). Fix inline. Do
NOT restore deleted folders to make a regression go away — the
right answer is always to fix the caller.

### E. Production build (`npm run dist`) catching stragglers

The dev bundler (Vite + Electron Forge) is more permissive than
the production build (electron-builder + Vite production). Some
import errors only surface during `npm run dist`.

**Resolution:** Step 4 explicitly includes `npm run dist`. If it
fails, fix the cited file and re-run. Do not declare US-532 done
until `npm run dist` is green.

### F. Stale references in docs and assets

Several `doc/`, `docs/`, `assets/mcp-res-*.md`, `qa/`, and
potentially `src/main/` references may still cite the deleted
folder paths after US-532 lands.

**Resolution:** Out of scope. These references are addressed by
the post-epic documentation effort, NOT here. US-532 leaves them
as-is; downstream doc tasks pick them up. If a `src/main/`
reference turns out to be runtime code (not a comment / doc
string), Step 4's `npm run dist` will catch it and it gets fixed
inline as a Step 4 regression.

## Acceptance criteria

- [ ] `src/renderer/components/basic/` is deleted.
- [ ] `src/renderer/components/form/` is deleted.
- [ ] `src/renderer/components/layout/` is deleted.
- [ ] `src/renderer/components/overlay/` is deleted.
- [ ] `src/renderer/components/TreeView/` is deleted.
- [ ] `src/renderer/components/index.ts` is deleted (no consumers
      remain — verified via grep for `from ".*renderer/components"`).
- [ ] `src/renderer/components/icons/`,
      `src/renderer/components/page-manager/`,
      `src/renderer/components/file-search/`,
      `src/renderer/components/tree-provider/` remain in place and
      their callers continue to work.
- [ ] Repo-wide grep
      `from "[^"]*components/(basic|form|layout|overlay|TreeView)`
      returns zero matches (outside this README itself).
- [ ] `npm run lint` clean — no NEW warnings or errors vs the
      pre-US-532 baseline.
- [ ] `npx tsc --noEmit` reports no NEW errors vs the pre-US-532
      baseline.
- [ ] `npm run dist` succeeds.
- [ ] Smoke test (Step 4) passes.

This task does NOT run `/review`, `/document`, or `/userdoc`.
Per-epic documentation is a separate, post-epic effort tracked by
its own task(s).

## Files Changed (expected)

| Path | Change |
|---|---|
| `src/renderer/components/basic/` | deleted (folder + all files) |
| `src/renderer/components/form/` | deleted (folder + all files) |
| `src/renderer/components/layout/` | deleted (folder + all files) |
| `src/renderer/components/overlay/` | deleted (folder + all files) |
| `src/renderer/components/TreeView/` | deleted (folder + all files) |
| `src/renderer/components/index.ts` | deleted |
| `doc/active-work.md` | US-532 marked `[x]` |

## Files NOT changed

- `src/renderer/components/icons/` (FileIcon, FolderIcon,
  LanguageIcon — 12+ callers, persephone-coupled, KEEP)
- `src/renderer/components/page-manager/` (AppPageManager,
  PageManager, GroupContainer, ImperativeSplitter — persephone-coupled, KEEP)
- `src/renderer/components/file-search/` (FileSearch,
  FileSearchModel — persephone-coupled, KEEP)
- `src/renderer/components/tree-provider/` (CategoryView,
  CategoryViewModel, TreeProviderItemIcon, TreeProviderView,
  TreeProviderViewModel, favicon-cache — persephone-coupled, KEEP;
  US-497 flips `TreeProviderView`'s internal Tree dependency to
  UIKit but the folder stays put)
- All `doc/`, `docs/`, `assets/mcp-res-*.md`, `qa/`, and `src/main/`
  files — documentation sweep is the post-epic effort, not this task

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 close-out — final `components/` sweep
- Blocked on:
  - [US-542](../US-542-grid-options-popover-flip/README.md) — Grid options popovers `Popper`→`Popover` flip (the sole remaining `components/overlay/` callers)
- Previously listed blockers, now confirmed COMPLETE (no longer relevant):
  - US-481 (UIKit Menu) — primitive in place and widely consumed
  - US-509 (Grid editor chrome) — committed `e506c81`; scoped to chrome only, sub-component popovers tracked by US-542
  - US-530 (Editor base chrome) — committed `7746de8`
  - US-531 (`showPopupMenu`) — committed `6e3f332`
  - US-535 (MenuItem flips) — committed `f7aa6a6`
  - US-497 (TreeProviderView) — committed `082f974`
