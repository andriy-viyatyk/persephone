# EPIC-151: Refactoring Phase 5.1 — the `PagesLifecycleModel` split

## Status

**Status:** Completed 2026-11-12
**Created:** 2026-11-12

## Overview

This is the eleventh epic of the [refactoring roadmap](../refactoring-roadmap.md) and the first part of Phase 5 (pages,
settings, startup and app conventions). It covers roadmap item 5.1 and finding **CORE-1**
(`doc/reviews/refactoring-2026-11/04-api-core.md`).

**The problem.** `PagesLifecycleModel` (`api/pages/PagesLifecycleModel.ts`, 1,346 lines) is one of the god files in
roadmap §2.3. `pages-architecture.md` §4 says it handles "create, open, close, navigate, movePageIn/Out". In practice
it does at least seven separate jobs. The code was checked on 2026-11-12. The finding's line numbers have drifted, and
some of its items are already done (see "Drift since the finding" below).

- **Editor construction, which belongs to the editors:**
  - the module-level `attachEditorToPage` and its `wrap` alias;
  - `buildEditorById`, `newEditorModel`, `newEditorModelByTarget`, `constructEditorFromFile`, `createEditorFromFile`
    and `createEditorFromFolder`;
  - the one-line wrapper `createPipeFromPath`.

  `PageNavigator` calls back into `model.lifecycle.createEditorFromFile`/`createEditorFromFolder`. It also
  `await import("./PagesLifecycleModel")` only to get `attachEditorToPage`, and so does `editors/base/editor-switch.ts`.
  Both dynamic imports exist to dodge the `PagesLifecycleModel ↔ PageNavigator` cycle, which guardrail 5 forbids.
- **Board routing:**
  - `resolveBoardRootForOpen` (public, but only used inside the file), `enqueueBoardSource` and
    `openSingleInstanceBoard`;
  - `addBundledBoardPage` and `openBoardHandlerPage`;
  - `openBoardRunPage` and its module-level `runUrlKey` URL normaliser;
  - `navigatePageToWithSingletonRouting`, which resolves the target, captures a `BoardSourceContext` and rewrites the
    navigation options before it routes to a single-instance board;
  - the board queries in `PagesQueryModel` (`findBoardRunPage`, `findPageByBoardRoot`, `isFullPlayerBoardPage`).

  `PagesLifecycleModel.ts` is one of the three files exempted from the US-1824 lint zone that stops `api/` importing
  `editors/board/`.
- **A catalogue of fixed-id pages, built three different ways:**
  - the `well-known-pages.ts` registry (`requireWellKnownPage`, two MCP log pages);
  - page-id constants loaded lazily from editor modules inside `showEditorPage` (`ABOUT_PAGE_ID`,
    `SETTINGS_PAGE_ID`, `MNEME_CONFIG_PAGE_ID`, `STORYBOOK_PAGE_ID`, `TOOLS_HUB_PAGE_ID`);
  - a local `CLIPBOARD_PAGE_ID` with its own `showClipboardPage` body.

  Next to them are openers that build one editor and reach into it through casts: `showMcpInspectorPage`
  (`as unknown as { connectionName… }`, `connect?.()`), `showToolsHubPage` (`setTab?.`), `openImageInNewTab` and
  `openSiteActionVideo`.
- **Open orchestration:** `openFile` (about 160 lines, with its nested `applyOpenHints`), `openDiff`,
  `openFileWithDialog`/`openFileFromDialog` (UI commands that import a dialog).
- **Two retry paths:** `retryPageRestore` (a failed deferred open) and `retryRestore` (a recovery placeholder). The
  doc comment above `retryRestore` describes `movePageIn`, because it was left behind by a move.
- **Window transfer and duplication:** `movePageIn`, `movePageOut` and `duplicatePage`.
- **Bulk close:** `closeToTheRight` and `closeOtherPages`, two near-identical loops.
- **Raw state surgery in five places.** Inserting a page into `state.pages`/`state.ordered` is written out by hand in
  `addPage`, `movePageIn` and `duplicatePage`. `retryRestore` replaces a page by mapping both arrays, and the
  `closeWindow` branch of `movePageOut` filters them, which duplicates `PagesModel.removePage`.

### Drift since the finding

- **Done already:** `customEditorRegistry.findByRoot` exists, and the lifecycle uses it at its three lookups; the
  14 inline copies are gone. `openFileAsArchive`, `_openAsarArchive`, `_openZipArchive` and `handleOpenUrl` are deleted.
  Board construction already goes through `createBoardEditor(...)` in `editors/board`, behind a dynamic import.
- **Still true:** everything in the list above.

## Goals

- **`PagesLifecycleModel` keeps the page lifecycle and nothing else:** `addPage`, the `addEmptyPage*` methods,
  `addEditorPage`, `openLinks`, `openFile` and `navigatePageTo`, `closePage` and one `closePages(predicate)`,
  `movePageIn`/`movePageOut`, `duplicatePage`, and the two retry methods (their merge is roadmap 5.2). It ends this
  epic with no board vocabulary, no fixed-page catalogue and no editor construction. Target: under 700 lines.
- **An editor factory** owns editor construction. Nothing in `api/pages/` builds an editor class by name, and both
  dynamic imports of `PagesLifecycleModel` are gone.
- **A board page router** owns every board-specific open rule. The lifecycle consults a generic open-interceptor list
  at the top of `openFile` and `navigatePageTo`, and the router registers itself there.
- **One standalone-pages registry** replaces `well-known-pages.ts`, the lazy page-id loaders and `CLIPBOARD_PAGE_ID`.
- **`PagesModel` mutation primitives.** No submodel other than `PagesModel` writes `state.pages`/`state.ordered` for an
  insert, a replace or a remove.
- **`PagesLifecycleModel.ts` leaves the US-1824 lint exemption list** in `eslint.config.mjs`.

## Decisions this epic acts on

- **The factory lives in `src/renderer/editors/editor-factory.ts`, not in `editors/base/`.** CORE-1 suggests
  `editors/base/editor-factory.ts`. But the factory constructs `MonacoEditor` statically (the synchronous floor that
  `attachEditorToPage` documents) and routes `board-editor:<root>` ids to `createBoardEditor`. `base/` must not learn
  about boards (EDC-2, EPIC-150), and it must not import concrete editors. `editors/` is the composition level that
  already knows every editor (`register-editors.ts` lives there). The board branch moves as it is. Turning it into a
  module hook is EDC-2's editor catalogue (roadmap 6.4), not this epic.
- **The board router lives in `src/renderer/api/boards/board-page-router.ts`, not in `editors/board/`.** CORE-1
  suggests `editors/board/board-page-routing.ts`. Two of its callers are `api/boards/board-host-rpc.ts`
  (`openBoardRunPage`) and `api/capabilities/BoardCapabilityDispatcher.ts` (`openBoardHandlerPage`), and the
  capabilities lint zone forbids `editors/board/`. Decision D7 puts the board domain in `api/boards/` plus
  `shared/board/`. The router's open rules need the registry, the manifest reader and the page queries, which all
  live in `api/`. Code that genuinely needs the board editor (`createBoardEditor`, `BrowserEditor`) stays behind the
  factory or the existing dynamic imports.
- **The open interceptor is generic and owned by `api/pages/`.** `PagesLifecycleModel` exposes one registration point.
  The interceptor sees the open or navigate request. It can either take the request (return the page it showed), or
  let the request continue, optionally with rewritten options. The rewrite is needed because single-instance routing on
  `navigatePageTo` sets `target`, `preferredPageId` and the captured `sourceContext`, and those options must reach
  `PageNavigator` even when no singleton page exists. The US-1870 plan defines the exact type. It is not CORE-4's
  `PageOpenRequest` (roadmap 5.3), and must not grow into one.
- **The interceptor keeps today's order.** On `openFile`, single-instance routing runs before the existing-page dedupe.
  On `navigatePageTo`, it runs before `PageNavigator`. `addBundledBoardPage` still asks the router for a singleton page
  before it builds one.
- **The public script API does not change.** `pages.d.ts` and `PageCollectionWrapper` expose `openFileWithDialog`,
  `addDrawPage`, `openDiff`, `showAboutPage`, `showSettingsPage`, `showMcpInspectorPage`, `showMnemeConfigPage`,
  `showToolsHubPage`, `showBrowserPage` and `openUrlInBrowserTab`. Those names and signatures stay on `PagesModel`.
  Removing the flat delegates is CORE-6 (roadmap 5.3).
- **Persisted ids do not change.** The fixed page ids (`about-page`, `settings-page`, `mneme-config-page`,
  `storybook-page`, the tools-hub id, `clipboard-page`, `mcp-ui-log`, `mcp-server-log`) are stored in page
  descriptors, and the log-page titles are file names that scripts and agents read.
- **The standalone-pages registry must not load editor chunks at startup.** Today the page ids come from the editor
  modules through `await import(...)` so that those chunks stay out of the startup bundle. The registry keeps that
  property: an id moves into the registry (or into a tiny id file, as `board-info-id.ts` already does), and the editor
  module is still loaded only when its page opens.
- **Pure moves are committed apart from logic changes** (roadmap §8). Each task's plan says which of its steps are
  moves and which change code.

## Linked Tasks

Task documents were written per task and deleted at epic close.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1869 | The editor factory | 5.1, part 1: CORE-1 step 1 | Done |
| US-1870 | The board page router and the open interceptor | 5.1, part 2: CORE-1 step 2 | Done |
| US-1871 | The standalone-pages registry | 5.1, part 3: CORE-1 step 3 | Done |
| US-1872 | `PagesModel` mutation primitives and the lifecycle cleanup | 5.1, part 4: CORE-1 steps 4–6 | Done |

### Task scopes

**US-1869: The editor factory.**
- Move `attachEditorToPage`, `buildEditorById`, `newEditorModel`, `newEditorModelByTarget`, `constructEditorFromFile`,
  `createEditorFromFile` and `createEditorFromFolder` into `editors/editor-factory.ts`. Delete the `wrap` alias and the
  `createPipeFromPath` wrapper (call `pipeFromSourcePath` directly).
- `PageNavigator` and `editors/base/editor-switch.ts` import the factory statically. Their
  `await import("…/PagesLifecycleModel")` lines are deleted, and `PageNavigator` no longer calls
  `model.lifecycle.createEditor*`.
- The lifecycle's own callers (`addEmptyPage`, `addEditorPage`, `requireWellKnownPage`, `openLinks`, `openFile`,
  `addBundledBoardPage`) use the factory.
- **Before any code moves,** the plan lists every caller of each moved function, every comment that names
  `PagesLifecycleModel.attachEditorToPage` (`GridEditor.ts`, `editorRegistry.ts`, `register-editors.ts`,
  `BrowserBookmarks.ts`), and the import graph after the move. It proves the new graph has no cycle and that the
  factory stays in the startup chunk only through what the lifecycle already loads statically today.
- **Keep:** Monaco as the synchronous floor; `createEditorSync` for the other text-host editors and
  `bootstrapFromHost` after `adoptHost`; the content-host board's pipe and language reset on its host; title seeding;
  the `!def`/no-`newEditorModel` text fallback.

**US-1870: The board page router and the open interceptor.**
- `PagesLifecycleModel` gets the generic interceptor registration (see the decisions). `openFile` and `navigatePageTo`
  consult it, and `navigatePageToWithSingletonRouting` is deleted.
- `api/boards/board-page-router.ts` (`BoardPageRouter`) takes `resolveBoardRootForOpen`, `enqueueBoardSource`,
  `openSingleInstanceBoard`, the singleton pre-routing with its `BoardSourceContext` capture, `addBundledBoardPage`,
  `openBoardHandlerPage`, `openBoardRunPage` with `runUrlKey`, and the three `PagesQueryModel` board queries. The plan
  lists every caller of `findPagesByBoardRoot` and says whether it moves too.
- The plan says where the router is constructed and registered, and proves that it is registered before the first
  open (session restore, command-line files, the second-instance hand-off).
- `PagesLifecycleModel.ts` is removed from the US-1824 exemption list. `PagesPersistenceModel.ts` and `api/boards.ts`
  stay on it; they belong to roadmap 5.3.
- `board-host-rpc.ts` and `BoardCapabilityDispatcher.ts` call the router. `PagesModel.addBundledBoardPage` stays as a
  delegate if anything outside `api/pages` calls it; the plan checks.
- **Keep:** the interceptor order; `singleInstanceMasks` and the full-player preference for the source page; the
  `acceptOpenContext` hand-off and the pipe dispose; the `sourceContext` file-mask filter; the Run page reuse key
  limits, reload-or-navigate rule and owner record; the handler board's title.

**US-1871: The standalone-pages registry.**
- `api/pages/standalone-pages.ts` holds one registry of fixed-id pages. An entry has its id and how the page is built
  (a standalone editor id, a text-host page with an editor, language and title, or a custom builder such as the
  clipboard Explorer page), plus an optional step that runs on the live editor whether the page is new or reused (the
  About page's `atContents`, the Tools hub tab, the clipboard's `openClipboard`). The plan defines the shape.
- One `showStandalonePage(id, options)` replaces `showEditorPage`, `requireWellKnownPage` and the bodies of the
  `show*Page` methods and `showClipboardPage`. The public `show*Page` names on `PagesModel` stay as one-line calls.
  `requireWellKnownPage` keeps its synchronous return for its two MCP callers, or the plan shows that both can await.
- `well-known-pages.ts` and `CLIPBOARD_PAGE_ID` are deleted.
- The openers that are not fixed pages (`showMcpInspectorPage`, `openImageInNewTab`, `openSiteActionVideo`) move to
  modules owned by their editors, following the `browser-pages.ts` precedent. Their `as unknown as` casts are replaced
  with the editor's typed members.
- **Keep:** the `guard` around page-id resolution and editor creation; dedupe by id; the MCP log page titles; the image
  page's session-handle rule (bytes, not URL, for a Tor or proxied page) and its blob cache.

**US-1872: `PagesModel` mutation primitives and the lifecycle cleanup.**
- `PagesModel` gets `insertPage(page, { at? })` and `replacePage(old, recovered)`; `removePage` already exists. They
  are used by `addPage`, `movePageIn`, `movePageOut` (including the `closeWindow` branch), `duplicatePage` and
  `retryRestore`. The plan names any other submodel write that is an insert, a replace or a remove.
  `PagesLayoutModel`'s reorders and `PagesPersistenceModel`'s bulk load are not inserts and stay.
- `closeToTheRight` and `closeOtherPages` become one `closePages(predicate)`; the public names stay as one-line calls.
- `openFileWithDialog`/`openFileFromDialog` move to `ui/` (the dialog module or a small command module). The
  `PagesModel` names stay, because `openFileWithDialog` is public.
- Delete the migration leftovers: the "Page-actions (from old page-actions.ts)" header, the doubled doc block, the
  "Walkthrough NN" references, the stale `retryRestore` comment, and "legacy" names for the live `TextFileModel` host.
- **Keep:** where a moved-in page lands next to a locked board page and before the right-pinned zone; the activate and
  grouping rules; the saves (`saveState` vs `saveStateDebounced`) exactly where they are now; the recovery-protection
  release and placeholder dispose order in `retryRestore`.

### Order

US-1869 first, because the router and the registry both build editors through the factory. Then US-1870, US-1871 and
US-1872, one at a time. US-1872 is last because it rewrites the insert code that the earlier tasks move around.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Each plan names the owner of each rule it touches and the helper it reuses.
- **Each job is moved, not wrapped.** A task is done when the old body is gone from `PagesLifecycleModel.ts`. A one-line
  delegate stays only where a public name or an outside caller needs it, and the plan lists each one.
- **God files only shrink.** `PagesLifecycleModel.ts`, `PagesQueryModel.ts` and `PageNavigator.ts` end each task no
  larger than they started it. `PagesModel.ts` may grow by the mutation primitives only.
- **No new `await import()` to break a cycle.** A dynamic import that only keeps an editor chunk out of startup is
  allowed, and the plan says which kind each one is.
- **Behaviour to keep, and to check in every plan that touches it:**
  - session restore after restart, including deferred-restore editors and the loading shell's retry;
  - the recovery placeholder and its retry;
  - open with hints: line, highlight, fragment and diff, on a fresh open and on an already-open file;
  - existing-page dedupe and the `onReopen` pipe hand-off;
  - single-instance boards, the board Run page, the capability handler board and new bundled board pages;
  - moving a page between windows (in, out, and out of the last page, which closes the window), and duplicate;
  - every fixed page: About (and `atContents`), Settings, Mneme config, Storybook, Tools hub (and its tab), the video
    player, the clipboard page, and the two MCP log pages.
- **Verification:** run `npm run typecheck`, `npm run lint` and `npm run build-prod` after every task. No unit tests.
  The live flows below are the user's.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close. `/document`
  rewrites `doc/architecture/pages-architecture.md` §4 (submodels), §5 (internal vs public operations), the
  well-known pages section and the single-instance board section, and updates key-files.

## Live checks the user runs at close

- **Restart restore:** open a text file, a Grid file, a content-host board, a folder board and the About page; restart.
  Every page comes back.
- **Recovery placeholder:** restore a page whose editor fails to load, then retry it once the cause is fixed.
- **Open with hints:** open a file at a line from search results; follow a Markdown anchor link into a file that is
  already open; open a diff from the Git panel.
- **Boards:** open a file claimed by a single-instance board twice (one page, the second source is queued); press a
  board's Run twice (one Browser page, reloaded); trigger a capability handler board; create a new page from a bundled
  board in the "+" menu.
- **Fixed pages:** open each from the menu twice (one page each), the Tools hub on a given tab, the clipboard page, and
  the MCP log through an agent call.
- **Window transfer:** drag a page to another window and back; drag the only page out of a window (it closes);
  duplicate a page; Close Others and Close to the Right with a pinned page present.

## Notes

- **Sizes at the start:** `PagesLifecycleModel.ts` 1,346 lines, `PagesModel.ts` 358, `PageNavigator.ts` 319,
  `PagesQueryModel.ts` 216, `well-known-pages.ts` 51.
- **Out of scope, with where it goes:** `applyOpenHints` and the `PageOpenRequest` (CORE-4, roadmap 5.3); the
  `PagesModel` flat delegates (CORE-6, 5.3); editor-module restore hooks and the board construction in
  `PagesPersistenceModel` (CORE-5, 5.3); merging the two retry paths and the string transients (CORE-2, 5.2).
- **Sizes at the end of implementation:** `PagesLifecycleModel.ts` 1,346 → 692 lines; `PagesQueryModel.ts` 216 → 159;
  `PagesModel.ts` 358 → 386 (the mutation primitives, `standalonePages`, the `boardPageRouter` wiring and the
  `removePage` options); `PagesLayoutModel.ts` 292 → 321 (`requireGroupedText` moved in, because layout owns
  grouping); `PageNavigator.ts` 319 → 320 (the `legacy` renames). New: `editors/editor-factory.ts` 180,
  `api/boards/board-page-router.ts` 299, `api/pages/standalone-pages.ts` 174, five page-id files,
  `ui/dialogs/OpenFileCommands.ts` 30, and the editor-owned openers `mcp-inspector-pages.ts`, `image-pages.ts` and
  `video-pages.ts`. `well-known-pages.ts` is deleted.
- **Corrections made in plan review** (each recorded in its task document):
  - US-1869: the "acyclic" claim was overstated; the existing `editors/text` ↔ `api/pages` module cycle is unchanged.
  - US-1870: the plan added main-process launch-input changes; dropped, because the router is registered in the
    `PagesModel` constructor, before any renderer path can open a page.
  - US-1871: editor classes in the live-editor steps are loaded lazily, not statically; the lifecycle keeps no
    fixed-page methods; the sync and async accessors are separate (`requireTextPage`, `show`); registry keys are the
    persisted page ids.
  - US-1872: `openDiff`, `addDrawPage`, `openPathInNewWindow` and the close commands stay in the lifecycle instead of
    moving into `PagesModel` or the layout model to meet the line target.
