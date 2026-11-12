# EPIC-154: Refactoring Phase 5.4 — finish the host migration and slim `TextFileModel`

## Status

**Status:** Completed 2026-11-12
**Created:** 2026-11-12

## Overview

This is the fourteenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the fourth part of Phase 5 (pages,
settings, startup and app conventions). It covers roadmap item 5.4 and findings **CORE-2 step 6**
(`doc/reviews/refactoring-2026-11/04-api-core.md`), **EDC-3** and **EDC-4** (`07-editors-core.md`).

The TextFileModel → `TextHostEditorModel` migration left every page with two shapes of "main editor": the real
`EditorModel` and, for text-bearing editors, the `TextFileModel` host the editor wraps. Callers pick one of the two
accessors and then branch on where the data lives. EPIC-151 to EPIC-153 cleaned up the pages layer around this; this
epic removes the split itself, and then moves and slims the host.

The code was checked on 2026-11-12, after EPIC-153. The findings' line numbers and counts predate Phases 5.1 to 5.3,
so the current state is restated here.

**The problems.**

- **Two main-editor accessors and a union type (CORE-2 step 6, EDC-4 step 3).**
  - `PageModel.mainEditor` returns `unwrapToHost(this.mainEditorInstance)` (`api/pages/PageModel.ts:39-46,236`): the
    `TextFileModel` host for a text editor, the editor otherwise. `mainEditorInstance` returns the real editor. About
    34 `.mainEditor` reads and 75 `mainEditorInstance` references remain.
  - `EditorOrHost = EditorModel | TextFileModel` (`editors/base/index.ts:10`, redeclared in
    `scripting/api-wrapper/PageWrapper.ts:67`) has about 50 references in 14 files, plus 5 `as unknown as EditorOrHost`
    casts.
  - **The factory still returns hosts.** `editors/editor-factory.ts` returns `Promise<EditorOrHost>` from
    `newEditorModel`, `createEditorFromFile` and friends (lines 66-173), and `attachEditorToPage(legacy)` (line 21)
    wraps the host into an editor afterwards. `PageNavigator` (line 133) and `open-request.ts` (`prepareOpenedEditor`,
    line 56) take the same union.
  - `ScriptRunner` and `ScriptContext` take a `page?: EditorOrHost`; `IPageHost.mainEditor` (line 58) publishes it.
- **Two identities per editor (EDC-4 steps 1–2).**
  - `IEditorState.type` (`shared/types.ts:1,14`, the 18-member `EditorType` union) is still stamped at 36 sites and
    read to recognise the text host (`isTextFileModel`, 17 references; `unwrapToHost`; `editor-switch.ts:85`;
    `open-request.ts:67`) and the Explorer (`PageModel.ts:704`). `getDefaultEditorModelState()`
    (`editors/base/index.ts:16`) stamps `type: "textFile"` for the Browser, which overwrites it.
  - Data lives on the editor or on its host, so consumers branch: `EditorModel.getNavigationSourceId` (own state, then
    the host's), `sourceLinkFromEditor` (`editor-switch.ts:25`), the `hostState?.filePath ?? model.filePath ?? …` chains
    in `editor-switch-options.ts`.
  - `EditorModel` reads its own declared fields through casts (`filePath`, `language`, `type`, around lines 252-262).
- **`TextFileModel` is a god object in a misnamed folder (EDC-3).**
  - It lives in `editors/content-host/TextFileModel.ts` (427 lines); `editors/content-host/` holds no editor (the Text Editor is
    `monaco/`). About 31 files import the host directly from `editors/content-host/`, `editors/base/` among them; the existing
    `base/` ↔ `content-host/` cycle remains.
  - **F5 is handled in three places:** `TextChromeView.ts:487`, `TextFileActionsModel.ts:23` and `ScriptPanel.ts:133`.
    "Run script" is split between `MonacoEditor.runScript` and `TextFileActionsModel.runScript`, which calls the host's
    `getSelectedText()` stub (`TextFileModel.ts:177`). `TextChromeView` finds runners with duck checks
    (`"runScript" in model`, `"hasSelection" in state`, lines 27-35).
  - **Navigation goes through the host.** `TextFileModel.revealLine`/`setHighlightText`/`focusEditor`
    (`TextFileModel.ts:157-168`) reach into `page.mainEditorInstance` with duck-typed casts; `open-request.ts:101-102`
    calls them.
  - **`ScriptPanelModel` (`base/script-panel/ScriptPanel.ts`, 336 lines) is a UI panel holding a raw Monaco `editorRef`**, the
    library-save dialogs and `openInTab`, which builds an `ExplorerEditor` and attaches it to a page.
  - `TextFileActionsModel` imports the pages singleton, `PageModel` and `scriptRunner`.
  - Delegates and misspellings: `encript` (`TextFileModel.ts:381`, `TextFileEncryptionModel.ts:27`),
    `alertEncryptionError` and `runRelatedScript` delegates. `IContentHost` has one implementer and no consumer that
    types against it.
  - Already gone since the finding: `canClose`, `getRestoreData` on the host, `detectedContentEditor`.

## Goals

- **One editor shape.** The factory, lifecycle and navigator return `EditorModel`. `page.mainEditor` is the real
  editor; the host is reached as `editor.contentHost`. `EditorOrHost`, `unwrapToHost`, `editors/types.ts`'s use of it
  and the `mainEditorInstance` name are gone.
- **One identity.** `IEditorState.type` and `EditorType` are deleted. The text host and the Explorer are recognised
  by type, not by a string. Old session files that carry `type` are read by one dated migration in
  `api/pages/descriptor-migrations.ts` and nowhere else.
- **Data has one address.** `EditorModel` has canonical `filePath`, `sourceLink`, `language` and `displayTitle`
  getters; `TextHostEditorModel` overrides them to read its host. `getNavigationSourceId`'s two-location lookup,
  `sourceLinkFromEditor` and the `?? model.filePath` chains go.
- **The host has a true name and one job.** `editors/content-host/TextFileModel.ts`; the script panel is chrome in
  `editors/base/script-panel/`; `paste-rich-text.ts` moves to `monaco/`. One keymap in `TextChromeView`; script
  running in `scripting/`; navigation through an editor trait; `ScriptPanelModel` holds state only.

## Decisions this epic acts on

- **Getters before the union goes.** The canonical getters land first, so the `EditorOrHost` rewrite turns most
  `page.mainEditor.filePath`-style reads into reads on the editor without a branch.
- **`mainEditorInstance` is renamed `mainEditor` in the same task that deletes the unwrapped accessor**, as the last
  mechanical step, so no build ever has a `mainEditor` that means the host. The public script façade (`PageWrapper`,
  `PageCollectionWrapper`) keeps its own names; scripts and MCP are unaffected. If a script-facing value changes shape
  (for example something that returned host fields), the plan names it and keeps the façade's output identical.
- **Recognising the host without a string.** `isTextFileModel` becomes `instanceof TextFileModel` where the import
  direction allows it, or the existing `CONTENT_HOST_TRAIT` / `contentHost !== null` where it does not. No
  `await import()` to dodge a cycle (guardrail 5). The plan lists each of the 17 references and its replacement.
- **The persisted `type` field.** New descriptors stop writing it. Reading it is the job of one dated migration
  (`migrateLegacyExplorerId` already reads it; the host recognition joins it if it needs to). The plan checks the main
  process and `shared/` for readers of the persisted `type` before deleting it from `IEditorState`.
- **Move, then slim.** US-1885 moved the host and collaborators into `editors/content-host/`, with the class file
  named `TextFileModel.ts`, as a move-only task so the slimming diffs stay readable. `editors/base/` still imports the
  host type; the move did not change that direction or add `await import()`.
- **Traits for what the host used to reach into.** `TEXT_NAVIGATION_TRAIT` (`revealLine`, `setHighlightText`, focus)
  and `TEXT_SELECTION_TRAIT` (selected text) are registered by Monaco in `editors/base/editor-traits.ts`'s style.
  `open-request.ts`, the encryption model and the script runner use them on the main editor.
- **One keymap.** A `TextPageKeymap` (or a method set on `TextChromeView`; the plan picks) owns Ctrl+S, Ctrl+Shift+S,
  F5 and Ctrl+Shift+F. `TextFileActionsModel.handleKeyDown` and `ScriptPanelModel.handleKeyDown` lose their copies.
  Board content-host pages keep their current shortcuts; the plan says how `BoardEditorView` gets them.
- **Script running moves to `scripting/`.** `runPageScript(editor, { all, source: "page" | "panel" })`; the selection
  comes from `TEXT_SELECTION_TRAIT`. `TextFileActionsModel.runScript` and the `getSelectedText` stub go, and
  `TextFileActionsModel` stops importing the pages singleton and `scriptRunner` where the plan can manage it.
- **`ScriptPanelModel` keeps state only.** `openInTab` and the library-save dialogs move to
  `scripting/script-library-actions.ts` (or `api/library-service`; the plan picks the one with the right import
  direction). The view passes the selection through a callback. The panel's lifetime stays tied to the host id, and
  its cache file key (`fs.getCacheFile(id, "script")`) does not change.
- **God files only shrink** (guardrail 3). `PageModel` (883), `TextFileModel` (427), `TextChromeView` (510),
  `ScriptPanel` (336) and `PagesLifecycleModel` (658) each end smaller or equal. `EditorModel` (415) may grow by the
  getters only if `getNavigationSourceId`'s lookup and the casts it replaces come out in the same task.
- **`IContentHost`.** After the move, `EditorModel.contentHost` is typed against it, or the interface is deleted; the
  plan picks whichever leaves one declared shape.
- **`encript` is renamed `encrypt`** at its definition and every caller. The no-caller delegates on the host are
  deleted.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1882 | Canonical getters on `EditorModel` (EDC-4 step 2) | Done |
| US-1883 | One editor shape: factory returns `EditorModel`; delete `EditorOrHost`, `unwrapToHost`; `mainEditor` is the editor (CORE-2 step 6, EDC-4 step 3) | Done |
| US-1884 | Delete `state.type` and `EditorType` (EDC-4 step 1) | Done |
| US-1885 | Move the host to `editors/content-host/` and the script panel to `editors/base/script-panel/` (EDC-3 step 1) | Done |
| US-1886 | Slim `TextFileModel`: one keymap, script running in `scripting/`, navigation and selection traits, `ScriptPanelModel` state only (EDC-3 steps 2–6) | Done |

**Order.** Strictly sequential. US-1882 gives US-1883 the getters it rewrites call sites onto. US-1884 needs
US-1883, because `unwrapToHost` and the factory are the main `type` readers. US-1885 is a move-only commit and goes
after the call-site rewrites so it moves the final code once. US-1886 slims the moved files and deletes what EDC-3
step 6 left for "after EDC-4".

### Task notes for the planners

- **US-1882.**
  - `filePath`, `sourceLink`, `language` and `displayTitle` on `EditorModel`, reading `this.state` without casts
    (`EditorStateBase` already extends `Partial<IEditorState>`; confirm). `TextHostEditorModel` overrides each to read
    its host.
  - Rewrite `getNavigationSourceId` onto `sourceLink`, delete `sourceLinkFromEditor`, and remove the
    `hostState?.… ?? model.…` chains in `editor-switch-options.ts`. Grep for other two-location reads
    (`contentHost?.state.get().` followed by `filePath`, `sourceLink`, `title` or `language`) and list each.
  - Check whether `title` should be the canonical display title or whether `displayTitle` is a separate getter; keep
    one, and do not change what the tab strip shows.
- **US-1883.**
  - Map every `EditorOrHost` reference, every `.mainEditor` read and every `as unknown as EditorOrHost` cast before
    writing code; for each, say whether it wanted the host (rewrite to `.contentHost`) or the editor.
  - Migrate `PageWrapper`'s title/path/language reads with its model-shape change: until then its model is
    `EditorOrHost | null` and text pages wrap `TextFileModel`, which has no `displayTitle`.
  - Migrate `PageTabView.projectEditorState()` only with a selector/subscription redesign. It currently selects
    reactive editor state; replacing state reads with getters alone would stop updates from reaching the tab.
  - Decide and implement `PageModel.title`'s migration to `mainEditorInstance.displayTitle` as an intentional
    Save As/host-rename behavior change; account for `OpenTabsListView` title refresh, since it subscribes to page
    collection changes rather than editor title changes.
  - The factory returns the wrapped `EditorModel`; `attachEditorToPage` disappears or becomes internal to the
    factory. Check every caller of `createEditorFromFile`, `createEditorFromFolder` and `newEditorModel`, including
    `PageNavigator`, `editor-switch.ts`, `PagesLifecycleModel` and `PagesPersistenceModel`.
  - `ScriptRunner`/`ScriptContext` take an `EditorModel`. Whatever `page` returns to a script must stay the same
    object shape (`PageWrapper`); the plan shows the before and after for the script-facing values.
  - `IPageHost.mainEditor` is retyped; check `BrowserPanelHost` and every `IPageHost` implementer.
  - The `mainEditorInstance` → `mainEditor` rename is the last step, after `typecheck` passes on the rewrite.
  - Delete `editors/types.ts`'s `EditorOrHost` import; type `FileEditorView` and `SecondaryViewProps.model` as
    `EditorModel`.
  - Restore order and the open request's preparation step (`prepareOpenedEditor` runs before attach) must not move;
    record how they survive the factory change.
- **US-1884.**
  - List all 36 `type:` stamp sites and every reader; each reader gets a replacement (instanceof, trait,
    `editorId`). `getDefaultEditorModelState` loses `type`.
  - Archive deduplication: confirm whether it still reads `type` (the finding said yes); if so, it becomes
    `editorId === "archive-view"`.
  - Persisted descriptors: `migrateLegacyExplorerId` keeps reading `state.type` from old files. Check whether host
    restore needs `type` to recognise a text host in an old descriptor; if so, that recognition becomes a dated
    migration too. Check `src/main` and `src/shared` for readers of the persisted field.
- **US-1885.**
  - Completed as a move-only change: `TextFileModel.ts` and its collaborators now live in `editors/content-host/`;
    `ScriptPanel.ts` and `ScriptPanelView.ts` live in `editors/base/script-panel/`; `paste-rich-text.ts` lives in
    `monaco/`. The barrel consumers use direct imports, the old folder is removed, and current developer docs are
    updated. `doc/architecture/editors.md` has no moved-module paths.
- **US-1886.**
  - Each EDC-3 step 2–6 item, with the keyboard behaviour on Monaco, Grid and content-host board pages written down
    before and after (live check list for the user).
  - Traits: define them beside `CONTENT_HOST_TRAIT`; Monaco registers them; `open-request.ts`'s reveal/highlight,
    `TextFileEncryptionModel`'s focus and the script runner's selection use them. Then delete the host's
    `revealLine`, `setHighlightText`, `focusEditor` and `getSelectedText`.
  - `TextChromeView`'s duck checks (`"runScript" in model`, `"hasSelection" in state`) become a trait or a typed member.
  - Record the before and after line counts of every file named in "God files only shrink".

## Out of scope

- The `duplicatePage` editor-id bug found in EPIC-153 (a duplicated host editor keeps the source editor's id). It is
  its own task; if US-1883's factory change happens to fix it, the plan says so and the user decides.
- The editor-resolution predicates and magic ids (EDC-5) and the `draw-view`/`addDrawPage` leftovers.
- Settings schema and startup (roadmap 5.5), main conventions (5.6), Layer 2 typed `action` (5.7).
- Any change to public script names on `app.pages` or `page`.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-12
- Epic created after EPIC-153. Current state re-checked against the code: `canClose`, the host's `getRestoreData` and
  `detectedContentEditor` are already gone; about 50 `EditorOrHost` references (the finding counted 52), 34
  `.mainEditor` reads and 75 `mainEditorInstance` references remain.

### 2026-11-12 — implementation
- All five tasks implemented and staged; typecheck, lint and build-prod pass after each. Review, docs and userdoc are
  deferred to epic close.
- **Sizes (wc -l).** `EditorModel.ts` 415 -> 387 (after US-1882; unchanged since); `PageModel.ts` 883 -> 854;
  `TextFileModel.ts` (was `text/TextEditorModel.ts`) 427 -> 380; `TextChromeView.ts` 510 -> 502; `ScriptPanel.ts`
  336 -> 90; `PagesLifecycleModel.ts` 658 -> 653. `TextHostEditorModel.ts` 194 -> 208 (shared title rule and
  `displayTitle`; not on the budget list).
- **Decision refinements.**
  - US-1882: `filePath`, `sourceLink` and `language` read the editor's own state, then the host's, in the base class
    (so content-host boards are covered); `displayTitle` exists because a text editor's own title does not follow Save
    As.
  - US-1883: `modified` is host-first in the base getter; the script `page.data` reads the host's bag; the factory
    chooses the editor class before construction (`resolveContentEditorId`); `PageModel.title` follows Save As, and
    the tab strip and Open Tabs list subscribe to the host state (Open Tabs only to the fields a row shows).
  - US-1884: one dated migration (`migrateLegacyEditorStateType`) reads the old `type`; closed-window MCP summaries
    report the registry editor id in `type`. A session saved by this build does not restore its Explorer in an older
    build (downgrade unsupported).
  - US-1885: Claude ran the `git mv` moves (the Codex sandbox cannot write `.git`).
  - US-1886: `TextPageKeymap` owns the four shortcuts (board pages use a narrower policy); `IContentHost` deleted.
- **Deliberate behaviour changes.** Panel-focused F5 runs the script once (it ran twice). The "run script" action
  honours the page selection (it always ran the whole page). Page and tab titles follow Save As.
