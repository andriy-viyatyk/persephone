# EPIC-152: Refactoring Phase 5.2 — the `PageModel` split

## Status

**Status:** Completed 2026-11-12
**Created:** 2026-11-12

## Overview

This is the twelfth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the second part of Phase 5 (pages,
settings, startup and app conventions). It covers roadmap item 5.2 and finding **CORE-2**, steps 1–5 and 7
(`doc/reviews/refactoring-2026-11/04-api-core.md`). Step 6 (finishing the host migration: `EditorOrHost`,
`unwrapToHost`, the dual `mainEditor`/`mainEditorInstance`) is roadmap 5.4 and is out of scope.

**The problem.** `PageModel` (`api/pages/PageModel.ts`, 1,045 lines) is one of the god files in roadmap §2.3.
`pages-architecture.md` calls it "the stable tab container that owns the browsing context", but it also carries the
jobs below. The code was checked on 2026-11-12, after EPIC-151, so the finding's line numbers and some of its callers
have moved.

- **A restore state machine:** `startRestore`, `cancelRestore`, `ready`, `restoreController`, `restoreAttempt`.
- **A recovery placeholder.** Five fields (`retainedDescriptor`, `recoveryRetry`, `recoveryInvalidated`,
  `recoveryCloseAuthorized`, `recoveryProtectionOwned`) plus cache-file protection (`fs.releaseCacheIds`,
  `fs.deleteCacheFiles` on an authorised close). `retainedDescriptor` is checked 18 times inside `PageModel` and 12
  more times outside it: `PageTabView` (6), `PagesLifecycleModel` (4), `PageNavigator` (1), `PagesLayoutModel` (1).
  Each mutator has to remember the check.
- **Two retry paths with confusing names.** `RestoreFailedEditor.retry` calls `lifecycle.retryRestore(pageId)`
  (`PagesPersistenceModel.ts`) to rebuild a recovery placeholder. The loading shell (`PageContentView.ts`) reads the
  transient `"retryRestore"` closure, falling back to `lifecycle.retryPageRestore(page)`, to retry a failed deferred
  open.
- **An untyped side channel.** `getTransient`/`setTransient`, also published on `IPageHost` (where
  `BrowserPanelHost` implements them as stubs), carry four contracts keyed by strings:
  - `"retryRestore"` and `"applyOpenHints"`: closures the lifecycle stores on the page and reads back later
    (`PagesLifecycleModel.openFile`, `retryPageRestore`, and `PageContentView`);
  - `"boardRunOwner"`: the board Run page's owner record, written and read only by `api/boards/board-page-router.ts`
    and read by `editors/browser/browser-pages.ts`;
  - `"lockedBoardRoot"`: set by `PagesLayoutModel`, read by the layout, `PageTabView`, `PageTabsView` and
    `BoardToolbar`.
- **Compatibility shims typed `any`.**
  - `addSecondaryView` (one caller, the lifecycle), `removeSecondaryView` (Archive, Git Tree, Mneme root) and
    `promoteSecondaryToMain` (Link editor ×2, Mneme tree), plus `setMainEditorId`, "the compat shim used by the v3
    restore path" (the lifecycle and `PagesPersistenceModel`).
  - `IPageHost` publishes `removeSecondaryView(editor: any)` and `promoteSecondaryToMain?(editor: any)`.
  - The finding names two unused shims (`removeSecondaryViewWithoutDispose`, `findSecondaryView`); the plan confirms
    whether they still exist.
- **A reach back into the collection.** `setMainEditor` does `await import("../pages")` to reach the singleton and exit
  compare mode when the new main editor has no text host. That is a layout rule run from inside the page.
- **`ui/` imports from `api/`.** `PageModel` imports `ui/dialogs/ConfirmationDialog`, `ui/dialogs/dialog-buttons` and
  `ui/secondary-views/panel-key`; `IPageHost`, `PagesPersistenceModel`, `BoardTargetModel`, `BrowserPanelHost` and
  `scripting/ai-vision/page-panels.ts` import `ui/secondary-views/SecondaryViewsModel` or `panel-key`. Both of those
  files are pure state and key helpers (53 and 41 lines) that the page owns.

## Goals

- **`PageModel` is the tab container and nothing else:** its editors, the main editor, the secondary views, the
  navigation stack, pinning and its descriptor. It ends this epic with no restore machine, no recovery fields, no
  string store, no `any` members, no `ui/` imports and no import of `../pages`. Target: under 850 lines.
- **`PageRestore`** (`api/pages/PageRestore.ts`) owns one restore attempt, its cancellation, `ready`, and a typed retry.
  It is exposed as `page.restore`.
- **`RecoveryPlaceholder`** (`api/pages/RecoveryPlaceholder.ts`) owns the retained descriptor, the cache protection,
  the invalidation and retry promise, and the close authorisation. It is exposed as `page.recovery?`, and one
  predicate, `page.isInert`, replaces every `retainedDescriptor` guard.
- **Typed slots replace the string store.** `getTransient`/`setTransient` are deleted from `PageModel`, `IPageHost` and
  `BrowserPanelHost`.
- **Typed members replace the shims.** `IPageHost` has no `any`.
- **The two retry methods have names that say what they retry:** `retryRestore` → `recoverPage` (rebuild a recovery
  placeholder), `retryPageRestore` → `retryOpen` (retry a failed deferred open).

## Decisions this epic acts on

- **The restore retry and the open hints become `PageRestore` members, not transients.** `PageRestore` holds a typed
  `retry?: () => Promise<void>` that the lifecycle sets when it starts a deferred open, and the loading shell calls
  `page.restore.retry()`. The `"applyOpenHints"` closure becomes a typed hook on the same class (for example
  `page.restore.afterReady(fn)`, which survives a retry), so `retryOpen` reapplies the hints without a string key. The
  plan defines the exact shape. Folding the hints into the open request is CORE-4 (roadmap 5.3); this epic only gives
  them a typed home and must not build a `PageOpenRequest`.
- **The board Run owner leaves the page.** `BoardPageRouter` keeps a `WeakMap<PageModel, BoardRunPageOwner>` and
  exposes the read that `browser-pages.ts` needs. `PageModel` loses `setBoardRunOwner`/`getBoardRunOwner` and the
  `BoardRunPageOwner` type.
- **`lockedBoardRoot` stays on the page as a typed field.** Unlike the Run owner, it is page layout state: the tab
  strip, the tab view, the board toolbar and the layout's pinning rules all read it, and `setLockedBoardRoot` already
  clears the pin side and bumps the version. Moving it into a board-owned map would make four UI readers reach into
  `api/boards`. It becomes a plain private field with the existing getter.
- **`isInert` guards at the collection level, and the block moves whole.** The recovery guards protect real data (the
  cache files of a page that failed to restore). Every entry point that checks `retainedDescriptor` today in the
  lifecycle, layout, navigator and tab view checks `page.isInert` instead, and the plan lists each one, old line and
  new line. The checks inside `PageModel`'s own mutators go away only where an entry point outside the page already
  guards that call; the plan proves it per mutator, or keeps the check as `isInert`.
- **Compare-mode cleanup moves to `PagesLayoutModel`.** The layout subscribes to each attached page's main-editor
  change in `PagesModel.attachPage` (or the existing equivalent the plan finds) and exits compare mode itself.
  `PageModel` no longer imports `../pages`.
- **Confirmation goes through `app.ui.confirm`,** which already exists in `api/ui.ts`. `SecondaryViewsModel` and
  `panel-key` move to `api/pages/` as a pure move, with every importer updated. The plan checks that the
  `PageModel → api/ui` edge adds no cycle, and that no `ui/secondary-views/` file is left importing a deleted path.
- **The `switchMainEditor` dynamic import of `editors/base/editor-switch` stays.** It keeps the editor-switching
  machinery out of the page's static graph (`api/` must not import `editors/`); it is not a cycle dodge. The plan
  confirms that and says so in a comment.
- **The public script API does not change.** The page facade (`page`, `pages[i]`) and `pages.d.ts` keep their names.
  If a facade forwards a renamed `PageModel` member, the facade keeps its public name.
- **Persisted data does not change.** Page descriptors (including `mainEditorId`, the editor list and the cache ids a
  recovery placeholder protects) are read and written exactly as now.
- **Pure moves are committed apart from logic changes** (roadmap §8). Each task's plan says which of its steps are
  moves and which change code.

## Linked Tasks

Task documents were written per task and deleted at epic close.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1874 | `PageRestore` and the open retry | 5.2, part 1: CORE-2 step 1 | Done |
| US-1875 | `RecoveryPlaceholder` and the `isInert` guard | 5.2, part 2: CORE-2 step 2 | Done |
| US-1876 | Typed slots and typed members | 5.2, part 3: CORE-2 steps 3–4 | Done |
| US-1877 | Compare-mode cleanup and the `ui/` imports | 5.2, part 4: CORE-2 steps 5 and 7 | Done |

### Task scopes

**US-1874: `PageRestore` and the open retry.**
- Move `startRestore`, `cancelRestore`, `ready`, `restoreController` and `restoreAttempt` out of `PageModel` into
  `api/pages/PageRestore.ts`, exposed as `page.restore`. The plan lists every caller of each member (the lifecycle, the
  persistence model, `PageContentView`, the editors that defer restore) and the status/error state the loading shell
  reads.
- The `"retryRestore"` and `"applyOpenHints"` transients become typed `PageRestore` members (see the decisions).
  `PageContentView` calls `page.restore.retry()` and loses its `lifecycle.retryPageRestore` fallback, or the plan shows
  why the fallback is still reachable.
- Rename `retryPageRestore` → `retryOpen`.
- **Keep:** the attempt counter that ignores a stale attempt's result; abort on a new attempt and on close; starting the
  attempt synchronously so the inserted page is never rendered as an editor before the loading shell sees it; the
  hints applied once after the first successful restore and again after a successful retry, and never on a page that
  was replaced or closed.

**US-1875: `RecoveryPlaceholder` and the `isInert` guard.**
- Move `retainedDescriptor`, `recoveryRetry`, `recoveryInvalidated`, `recoveryCloseAuthorized`,
  `recoveryProtectionOwned`, their methods and the cache-protection release and delete into
  `api/pages/RecoveryPlaceholder.ts`. A recovery page is `PageModel` + `RestoreFailedEditor` +
  `page.recovery: RecoveryPlaceholder`.
- Add `page.isInert` and replace every outside `retainedDescriptor` check with it; the plan lists all of them. Reads
  that need the descriptor itself (`getDescriptor`, `modified`, the lifecycle's rebuild) use
  `page.recovery.descriptor`.
- Rename `retryRestore` → `recoverPage`; `RestoreFailedEditor.retry` calls the new name.
- **Keep:** the descriptor returned unchanged by `getDescriptor`, so a placeholder survives another restart; the
  `modified` answer from the retained descriptor; close-while-retrying (`recoveryInvalidated`) and the close
  confirmation; the release-then-delete order of the cache files and the rule that only an authorised close deletes
  them; `recoverPage`'s protection release and placeholder dispose order from EPIC-151.

**US-1876: Typed slots and typed members.**
- Delete `getTransient`/`setTransient` from `PageModel`, `IPageHost` and `BrowserPanelHost`. The Run owner moves to the
  router's `WeakMap`; `lockedBoardRoot` becomes a typed field (see the decisions).
- Replace the shims with typed members: `releaseEditor(editor: EditorModel, { dispose })` for `removeSecondaryView`,
  `promoteToMain(editor: EditorModel)` for `promoteSecondaryToMain`, and `assignMain(id)` for `setMainEditorId`. The
  `addSecondaryView` caller uses the typed attach path the plan names. Delete the shims that have no caller. Every
  caller in Archive, Git Tree, Mneme, Link editor, the lifecycle and the persistence model moves to the typed member.
- `IPageHost` loses both `any` signatures and their `eslint-disable` lines. `BrowserPanelHost` implements the typed
  members, or the interface marks them optional and the plan says why.
- **Keep:** `promoteSecondaryToMain`'s toggle (promoting the current main clears it); the detach-before-dispose order
  in `removeSecondaryView`; the Archive self-evict on a main-editor change; the Run page reuse rule in
  `browser-pages.ts` (a page with a Run owner is never reused).

**US-1877: Compare-mode cleanup and the `ui/` imports.**
- `PagesLayoutModel` owns the compare-mode exit on a main-editor change (see the decisions). The `await
  import("../pages")` in `setMainEditor` and its `try`/`catch` are deleted.
- `PageModel`'s close confirmation uses `app.ui.confirm` (or the `api/ui` export it wraps); the two `ui/dialogs`
  imports are deleted.
- Move `ui/secondary-views/SecondaryViewsModel.ts` and `panel-key.ts` to `api/pages/` as a pure move, and update every
  importer. After this task no file under `api/pages/` imports `ui/` statically. `PagesModel`'s on-demand
  import of `ui/dialogs/OpenFileCommands` stays: EPIC-151 (US-1872) put the open-file commands in `ui/` on purpose.
- **Keep:** the compare pair exits only when the new main has no text host; nothing happens before `PagesModel` is
  ready; the close confirmation's text, buttons and default.

### Order

US-1874 first: the recovery placeholder's retry runs through the restore machine, and US-1875 builds on its shape. Then
US-1875, US-1876 and US-1877, one at a time. US-1876 and US-1877 touch disjoint code and could swap if needed.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Each plan names the owner of each rule it touches and the helper it reuses.
- **Each job is moved, not wrapped.** A task is done when the old body is gone from `PageModel.ts`. A one-line delegate
  stays only where a public name or an outside caller needs it, and the plan lists each one.
- **God files only shrink.** `PageModel.ts`, `PagesLifecycleModel.ts` and `PageNavigator.ts` end each task no larger
  than they started it. `PagesLayoutModel.ts` may grow by the compare-mode subscription only.
- **No new `await import()` to break a cycle.** A dynamic import that only keeps an editor chunk out of startup, or
  `editors/` out of `api/`'s static graph, is allowed, and the plan says which kind each one is.
- **Behaviour to keep, and to check in every plan that touches it:**
  - session restore after restart, including deferred-restore editors and the loading shell's retry;
  - the recovery placeholder: its tab, its menu limits, its retry, closing it while a retry runs, and its cache files;
  - open with hints on a deferred-restore page, on the first open and after a retry;
  - the board Run page reuse and the locked board page's pinning;
  - promote and release from the Archive, Git Tree, Mneme and Link editor panels;
  - compare mode exiting when the main editor changes to a non-text editor;
  - the close confirmation for a modified page.
- **Verification:** run `npm run typecheck`, `npm run lint` and `npm run build-prod` after every task. No unit tests.
  The live flows below are the user's.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close. `/document`
  updates `doc/architecture/pages-architecture.md` (the `PageModel` section, restore, the recovery placeholder and the
  two retry names), `key-files.md`, and any doc that names `getTransient`, `retainedDescriptor`,
  `promoteSecondaryToMain` or the old secondary-views paths.

## Live checks the user runs at close

- **Restart restore:** open a text file, a Grid file, a content-host board, a folder board and the About page; restart.
  Every page comes back.
- **Loading shell retry:** make a deferred-restore page fail (for example a board whose folder is briefly renamed),
  then press Retry once the cause is fixed. Open a file at a line from search results into such a page and check the
  line is revealed after the retry.
- **Recovery placeholder:** restore a page whose editor fails to load; check its tab menu and that it cannot be
  dragged; retry it once the cause is fixed; restart with it still failed (it stays); close it (its cache is removed).
- **Boards:** press a board's Run twice (one Browser page, reloaded); open a single-instance board and check its tab
  stays locked at the left.
- **Panels:** promote and release from the Archive, Git Tree, Mneme and Link editor panels.
- **Compare:** open two text files in compare mode, then switch one to Grid; compare mode ends.
- **Close:** close a modified page and answer each button of the confirmation.

## Notes

- **Size at the start:** `PageModel.ts` 1,045 lines.
- **Out of scope, with where it goes:** the host migration (`EditorOrHost`, `unwrapToHost`, `mainEditor` vs
  `mainEditorInstance`; CORE-2 step 6, roadmap 5.4); `applyOpenHints` folded into a `PageOpenRequest` (CORE-4, 5.3);
  the `PagesModel` flat delegates (CORE-6, 5.3).
- **Sizes at the end:** `PageModel.ts` 1,045 → 883 lines (short of the under-850 target; most of the rest is the
  `mainEditor`/`EditorOrHost` dual shape, roadmap 5.4); `PagesLifecycleModel.ts` 692 → 689; `PagesLayoutModel.ts`
  321 → 328 (the compare listener); `PagesModel.ts` 386 → 390 (the event subscription). New: `PageRestore.ts` 80,
  `RecoveryPlaceholder.ts` 53; `SecondaryViewsModel.ts` and `panel-key.ts` moved from `ui/secondary-views/` to
  `api/pages/`.
- **Corrections made in plan review** (each recorded in its task document):
  - US-1874: `BrowserPanelHost`'s seeded `restoreStatus` removed with the field; `afterReady` hooks isolated so a
    failing hint cannot fail the restore; the reopen fragment reveal stays one-shot.
  - US-1875: on a successful recovery the tracked retry is cleared before the placeholder is disposed (otherwise the
    attempt awaits itself); `page.recovery` is assigned after the guarded pin and main-editor setters.
  - US-1877: the compare event fires only for a non-null new main (clearing the main never left compare mode); it is a
    dedicated `mainEditorChanged` event, not part of `notifyMainEditorChanged`.
- **Reverted in review:** the US-1877 run moved the open-file dialog commands into `api/ui.ts`, against EPIC-151's
  US-1872 decision; reverted. `PagesModel` keeps its on-demand import of `ui/dialogs/OpenFileCommands`.
- **Epic review:** `/review` found nothing; `/document` updated pages-architecture.md, key-files.md,
  secondary-views.md, folder-structure.md, scripting.md and browser-editor.md; `/userdoc` needed no changes. No
  English catalog messages changed.
