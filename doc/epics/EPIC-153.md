# EPIC-153: Refactoring Phase 5.3 — the open request, restore hooks and one `PagesModel` surface

## Status

**Status:** Completed 2026-11-12
**Created:** 2026-11-12

## Overview

This is the thirteenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the third part of Phase 5 (pages,
settings, startup and app conventions). It covers roadmap item 5.3 and findings **CORE-4**, **CORE-5** and **CORE-6**
(`doc/reviews/refactoring-2026-11/04-api-core.md`). Phases 5.1 (EPIC-151) and 5.2 (EPIC-152) split
`PagesLifecycleModel` and `PageModel`; this epic removes the three remaining duplications in the pages layer: how an open
request reaches the editor, how a saved page is rebuilt, and how callers reach the collection.

The code was checked on 2026-11-12, after EPIC-152. The findings' line numbers predate both splits, so the current
state is restated here.

**The problems.**

- **Open hints are applied along several paths, each with its own copy (CORE-4).**
  - `PagesLifecycleModel.openFile` builds an `applyOpenHints` closure (around line 414) that runs now or through
    `page.restore.afterReady(...)` (EPIC-152's typed home for it). `PageNavigator.navigatePageTo` repeats the hints on a
    fresh build (around 287–300) and on its reuse exits.
  - `applyDiffRevisions` is duck-typed through a cast in both places (`PagesLifecycleModel.ts:418`,
    `PageNavigator.ts:299`); only `FileDiffEditor` implements it.
  - The `acceptOpenContext({ mode: "register-session" })` block appears twice (`PagesLifecycleModel.ts:390`,
    `PageNavigator.ts:287`), as does the explicit-host-target selection.
  - The title is applied more than one way, including a post-open `state.update` in `content/open-handler.ts:72-75`.
  - **File identity** (`includes("://") || startsWith("data:")`) is computed three times: `PagesQueryModel.ts:35,41`
    and `PageNavigator.ts:61,154`.
  - **The archive "logical path"** is rebuilt from the archive transformer's `config.entryPath` in
    `content/open-handler.ts:23`, `content/board-pipe-utils.ts:7`, `editors/text/TextFileIOModel.ts:228` and
    `editors/image/ImageEditor.ts:138`; the last two hand-build the `!` separator instead of calling
    `buildArchivePath`. (`ContentPipe.cloneForMovedSource` reads it too, but it is the pipe itself, so that one is
    legitimate.)
  - **Latent bug:** `openFile` reads `options.sourceLink` although `options` is optional (roadmap issue 18). It
    compiles only because `strictNullChecks` is off.
- **The generic page restorer knows each editor's restore rules (CORE-5).** `PagesPersistenceModel.constructPage`
  (469-line file; the function starts at line 193) has per-editor branches for boards (`board-view`/`draw-view`),
  Board Info, Explorer and the host path, a hand-kept `NO_HOST_EDITOR_IDS` set (line 105) that duplicates
  `editorRegistry` metadata (`hasContentHost`), descriptor migrations mixed into normalisation (`draw-view` →
  Excalidraw board, bundled-root repair), `editorRegistry` re-imported dynamically several times, and an active-panel
  validation that re-implements `PageModel`'s panel rules.
- **`PagesModel` has two public surfaces (CORE-6).**
  - About 45 members of `PagesModel` (390 lines) only forward to a submodel (`findPage` → `query.findPage`,
    `showPage` → `navigation.showPage`, `pinTab` → `layout.pinTab`, …), while the submodels are public too and 37 call
    sites outside `api/pages` reach into them directly. The same operation has two names.
  - Four delegates have no caller: `isRightPinned`, `isInCompareMode`, `focusPage`, `saveStateDebounced`. The
    finding's other dead names (`onAppQuit` and the board-root finders) are already gone or moved to the router.
  - `PagesModel.openFile(path)` dispatches a raw link through Layer 1, while `PagesLifecycleModel.openFile(path, pipe,
    options)` is the Layer 3 sink: same name, different layers. `app.openRawLink` already exists.
  - Two names for the singleton: `pages` and the alias `pagesModel` ("backward-compatible during migration",
    `api/pages.ts:10`), imported by 75 files.
  - `PagesLayoutModel` and `PagesPersistenceModel` still write the collection's `pages`/`ordered` arrays directly
    through `this.model.state.update`, bypassing the mutation primitives EPIC-151 added to `PagesModel`.

## Goals

- **One open request, one hint function.** `api/pages/open-request.ts` defines a typed `PageOpenRequest`, built once
  from `ILinkData`, and `applyOpenHints(page, editor, request, { fresh })`. `openFile` and every `navigatePageTo` exit
  call it. No hint logic remains anywhere else, and no cast reaches `applyDiffRevisions`.
- **One file-identity rule and one logical-path rule.** `fileIdentity(path)` in `core/utils/file-path.ts`;
  `logicalPath` / `logicalPathFor(sourcePath)` on `IContentPipe`. No module outside the pipe reads the archive
  transformer's config.
- **Editors own their restore.** An optional `restoreFromDescriptor` hook on the editor module definition. Board, Board
  Info and Explorer implement theirs; the default handles host/no-host from `hasContentHost`. `constructPage` is
  normalise → restore each editor → attach → apply the sidebar, and names no editor id. `NO_HOST_EDITOR_IDS` is gone.
- **Migrations are dated and separate.** `api/pages/descriptor-migrations.ts`, one function per migration with the
  date it was added, so each can be deleted later.
- **One `PagesModel` surface.** No forwarding delegates; callers use the submodel. One name for the singleton. The
  Layer-1 open has a name that says it is Layer 1. Only `PagesModel` writes the page arrays.

## Decisions this epic acts on

- **The `fresh` flag, not separate code paths.** Most hints apply only when the editor was freshly built; the fragment
  applies on every exit (`content-pipeline.md`). `applyOpenHints` takes `{ fresh }` and encodes that difference in one
  place.
- **Deferred hints keep EPIC-152's hook.** When restore is deferred, the lifecycle passes the `applyOpenHints` call to
  `page.restore.afterReady(...)`, as now. `PageRestore` does not learn about requests.
- **`applyDiffRevisions?` becomes a declared optional member of `EditorModel`** (an overridable no-op or an optional
  method; the plan picks). `FileDiffEditor` overrides it.
- **Keep the submodels as the public grouping; delete the flat delegates (CORE-6's recommended option).** The
  grouping (`pages.query.findPage`, `pages.navigation.showPage`, `pages.layout.pinTab`) says which collaborator owns
  each operation, which is the point of EPIC-151's split, and it shrinks `PagesModel` instead of freezing a 45-member
  façade. This applies to getters too (`activePage`, `groupedPage`, `pages`): a member that only forwards is deleted,
  whatever its shape. What stays on `PagesModel` is what it owns itself: state, events, the mutation primitives, the
  popover, and the router/registry references. The public script façade (`PageCollectionWrapper`) keeps its own
  names, so scripts and MCP are unaffected; only its internals are rewritten.
- **The Layer-1 `PagesModel.openFile(path)` is deleted**, and its callers use `app.openRawLink` if the plan confirms
  it is equivalent; otherwise it is renamed `openPath`. The plan checks every caller.
- **The `pagesModel` alias is deleted** with a mechanical import rewrite to `pages`.
- **Page-array writes go through `PagesModel` primitives.** `PagesLayoutModel` may still write the fields it owns
  alone (for example `compareGroups`); any write to `pages` or `ordered` from a submodel moves into a primitive. The
  plan lists each of the remaining writes and which side it lands on.
- **`editorRegistry` imports.** A dynamic import of `editorRegistry` inside `constructPage` is not code splitting
  (the module is already loaded statically); per guardrail 5 the duplicates become the static import. Editor
  modules themselves (board, Explorer) stay dynamically imported (critical pattern 1).

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1878 | `fileIdentity` and the pipe's `logicalPath` (CORE-4 steps 3–4) | Done |
| US-1879 | `PageOpenRequest` and one `applyOpenHints` (CORE-4 steps 1–2) | Done |
| US-1880 | Editor-module `restoreFromDescriptor` hooks and descriptor migrations (CORE-5) | Done |
| US-1881 | One `PagesModel` surface (CORE-6) | Done |

**Order.** US-1878 first: it is small and gives US-1879 the identity and path helpers. US-1879 and US-1880 touch
different files (`PagesLifecycleModel`/`PageNavigator`/`open-handler` versus `PagesPersistenceModel`/editor modules)
and can be planned in either order. US-1881 goes last because it rewrites call sites in about 100 files; running it
after the others keeps their diffs readable and means it rewrites the final code once.

### Task notes for the planners

- **US-1878.**
  - `fileIdentity(path)` returns the key two paths are compared by: the raw string for a URL or `data:` value, the
    normalised path otherwise. Callers: `PagesQueryModel.findPageByFilePath` and `PageNavigator` (both sites).
    Check whether `content/resolvers.ts:30,46` is the same rule (it also excludes archive paths) before touching it.
  - `logicalPath` (getter) and `logicalPathFor(sourcePath)` on `IContentPipe` and `ContentPipe`, built with
    `buildArchivePath`. The four call sites use them. If the pipe interface lives in `api/types/io.pipe.d.ts`
    (script-facing), say whether the new members are public script API and update the typings and `scripting.md`
    only if they are.
- **US-1879.**
  - Map every hint and every exit before writing code: fragment, revealLine/highlightText, diff revisions, explicit
    host target, session registration, sourceLink, title, panel expansion; exits: `openFile` new page, `openFile`
    existing page, `navigatePageTo` fresh build, `navigatePageTo` reuse exits.
  - The title is applied in one place after this task. Remove the post-open `state.update` in `open-handler.ts`.
  - Fix the optional-`options` read (roadmap issue 18).
  - `open-handler.ts` builds the request once. Keep the `openFile`/`navigatePageTo` signatures callers outside
    `api/pages` rely on, or update every caller in this task.
- **US-1880.**
  - The hook lives on the editor module definition in `editors/base/editorRegistry.ts`, beside `newEditorModel`.
    Its default is today's host/no-host path keyed on `hasContentHost`.
  - Restore order matters: boards build their host before restoring, and Explorer attaches synchronously before its
    auto-init microtask. Keep `attach` after every editor is constructed. Record in the plan how each ordering
    constraint survives.
  - The folder-board claim check against `customEditorRegistry`, the Folder View fallback and the "busy board must not
    resurrect" rule go to the board module's hook if they are board rules, or stay in `constructPage` with a reason.
  - `page.applySidebarDescriptor(desc.sidebar)` on `PageModel` reuses `composedPanels`; it must not grow `PageModel`
    past its 883 lines (god files only shrink) — net-zero or smaller, or put the logic in `SecondaryViewsModel`.
  - One `normalizePinSide(desc)` helper replaces the duplicated pin-side normalisation.
  - Delete the `IEditorState` re-export shim at the end of `PagesPersistenceModel.ts` if it is still there, rewriting
    its importers.
- **US-1881.**
  - Generate the delegate list from the code, not from this document. Record the before and after `PagesModel` size.
  - Every call site is rewritten, including `scripting/` wrappers, `automation/`, MCP handlers and `ui/`.
  - Update `pages-architecture.md` §4 and `key-files.md` in the same task, since the docs describe the surface.

## Out of scope

- The host migration (`EditorOrHost`, `unwrapToHost`, `state.type`, the dual `mainEditor`/`mainEditorInstance`):
  roadmap 5.4.
- Layer 2 recording a typed `action` and the `phase` guards: CORE-11, roadmap 5.7.
- Any change to the public script names on `app.pages` (the `PageCollectionWrapper` façade).
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-12
- Epic created after EPIC-152. Current state re-checked against the code; the CORE-6 counts differ from the finding
  (about 45 delegates rather than 69; `onAppQuit` and `save-window-state` duplication already resolved).

### 2026-11-12 — implementation
- All four tasks implemented and staged; typecheck, lint and build-prod pass after each. Review, docs and userdoc are
  deferred to epic close.
- **Sizes.** `PagesModel.ts` 390 → 296; `PagesPersistenceModel.ts` 469 → 271 (plus the new 77-line
  `descriptor-migrations.ts`); `PagesLifecycleModel.ts` 689 → 658; `PageNavigator.ts` 320 → 232 (plus the new 108-line
  `open-request.ts`); `PageModel.ts` held at 883.
- **Decision refinements.**
  - US-1879: the hint context is one discriminant, `{ exit: "fresh"; newPage } | { exit: "reuse" } | { exit: "reveal" }`,
    instead of `{ fresh }`; three exits behave differently today and two flags could contradict each other. Hints split
    into a pre-attach `prepareOpenedEditor` (sourceLink, title, explicit target / preview selection),
    `registerOpenSession` (at today's session points) and the post-ready `applyOpenHints`. Restore order is unchanged.
  - US-1880: `draw-view` and Explorer are restore-only ids in `editorRegistry` (`registerRestoreOnly`), so the board
    module keeps its legacy `draw-view` conversion where EPIC-144 put it and `editors/base` names no editor. The legacy
    `type: "fileExplorer"` recognition became a dated migration (`migrateLegacyExplorerId`) instead of a rule in the
    registry. `restore-failed` rejects its own descriptors through its module hook. The default restore keys on the
    descriptor's `host`, as before; `hasContentHost` replaces only the hand-kept `NO_HOST_EDITOR_IDS` list.
  - US-1881: the seven lazy-loading openers (`openUrlInBrowserTab`, `openImageInNewTab`, `showBrowserPage`,
    `showMcpInspectorPage`, `openSiteActionVideo`, `openFileWithDialog`, `openFileFromDialog`) stay on `PagesModel`:
    each owns a code-split boundary and forwards to no submodel. The Layer-1 `PagesModel.openFile(path)` became
    `openPath`, because `app.openRawLink` does not return the page, resolve folders or wait for restore. Page-array
    writes go through one `setPageArrays` primitive.
- **Deliberate behaviour change.** The same-file reveal exit now applies a link fragment too, as `content-pipeline.md`
  already documents (fragment on every exit).
- **Found, not fixed (pre-existing).** `duplicatePage` gives each editor descriptor a fresh id but leaves `state.id`,
  and the host restore path takes the id from the state, so a duplicated host editor keeps the source editor's id and
  the duplicate page has no main editor. Same behaviour before this epic; worth its own task.

### 2026-11-12 — completion
- `/review` found nothing; `/document` updated seven developer docs; `/userdoc` updated
  `assets/guides/scripting/api/io.md`. No i18n changes. Task folders deleted.
