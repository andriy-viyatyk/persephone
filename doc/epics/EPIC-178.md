# EPIC-178: Page navigation history (Back / Forward for every page)

## Status

**Status:** Completed
**Created:** 2026-11-15
**Completed:** 2026-11-15

## Overview

Only the Markdown view can go back today: a link click inside a Markdown document pushes the current document on a
page-owned stack, and a **Back** button in the Markdown toolbar pops it. Every other way a page moves to new content
(a file clicked in the Explorer, a link or button in any editor, a board calling `openRawLink(..., { inPlace: true })`,
a script calling `pages.navigatePageTo`) leaves no trail.

This epic gives every page a browser-style history: **Back** and **Forward** that return the page to what it showed
before, whatever moved it, with the familiar shortcuts.

## Goals

- Every in-place navigation of a page is recorded, whoever started it.
- Back / Forward work for every editor kind, including boards, folder views and archive entries.
- One mechanism: the Markdown-only stack is absorbed, not kept beside the new one.
- History survives restart (the Markdown stack already does).
- Scripts and agents can read and drive it through the object model.

## Current state (verified 2026-11-15)

- **One choke point already exists.** Every in-place navigation ends in `navigatePageTo`
  (`src/renderer/api/pages/PageNavigator.ts:178`), reached through `PagesLifecycleModel.navigatePageTo`
  (`PagesLifecycleModel.ts:446`), which first lets open interceptors run. Callers:
  - the Layer 3 open handler for any `openRawLink` with a `pageId` (`content/open-handler.ts:25`) — Explorer clicks,
    links, board in-place opens, Markdown links;
  - the script API `pages.navigatePageTo` (`scripting/api-wrapper/PageCollectionWrapper.ts:263`);
  - `openFile` when the file is already open and a reveal is asked for (`PagesLifecycleModel.ts:318`; same page, a
    reveal, not a navigation).
- **Exits of `navigatePageTo`:** same-file reveal (line 197, not a navigation), cancelled save prompt (line 210,
  returns `false`), reuse of a per-page singleton or a surviving panel editor (lines 212-223), fresh build
  (lines 225-233).
- **Interceptor "take":** a single-instance board takes the navigation and shows its *own* page
  (`api/boards/board-page-router.ts:61-95`). The source page did not move, so nothing is recorded there.
- **The Markdown stack:** `NavBackStack` (`api/pages/NavBackStack.ts`) owned by `PageModel` (`PageModel.ts:192-211`),
  count mirrored into `state.navBackCount`, persisted as `PageDescriptor.navBack: NavEntry[]` with
  `NavEntry = { href, title? }` (`shared/persistence.ts:32-58`), restored in `PagesPersistenceModel.ts:125`, and
  repaired by the dated board-link migration (`descriptor-migrations.ts:51-56`). Pushed in
  `MarkdownEditor.followLink` (`editors/markdown/MarkdownEditor.ts:98-111`), popped by `navigateBack` (line 87), which
  reopens through `openRawLink` with `target: mdView`. The Back button is `MarkdownEditorView.ts:114-139`.
- **What a page knows about its content:** `EditorModel.sourceLink` (`editors/base/EditorModel.ts:254`), the stored
  link written by `prepareOpenedEditor`; it carries `href`/`url`, `target` and a `pipeDescriptor`. Resolvers rebuild a
  pipe from the URL (`content/builtin-schemes.ts`), so replaying `openRawLink(href, { pageId, target })` reopens files,
  archive entries, HTTP URLs and virtual links (folder views, boards, guides).
- **Toolbar placement.** `PageToolbarView` is used by the regular editors; Boards have their own `BoardToolbarView`,
  while the Browser has no editor toolbar. Back / Forward follow File Explorer in the regular and Board toolbars.
  They are hidden on Browser pages and unavailable in standalone board windows, which use a separate window header.
- **The Browser is not part of this.** A Browser page is not an editor a page navigates to or from (the UI cannot
  move a page into or out of the Browser), and it keeps its own webview history with `Alt+Left` / `Alt+Right`
  (`editors/browser/BrowserShortcutTable.ts:70-79`). This epic does not touch Browser code.

## Design

**Owner.** A new `PageHistory` class in `src/renderer/api/pages/PageHistory.ts` replaces `NavBackStack`: two stacks
(`back`, `forward`), a cap per stack, `snapshot()` / `seed()`, and a reactive `{ canGoBack, canGoForward }` mirrored
into page state. `PageModel` owns one per page (it already owns the Markdown stack; no new rule enters the god file
beyond swapping the field).

**Entry.** `{ filePath, target, title, sourceLink? }` — `filePath` is the leaving editor's logical path
(`editor.filePath ?? editor.sourceLink.url`), `target` its editor id so Back returns to the same view (Markdown
preview, Grid, a board), `sourceLink` its stored link (keeps HTTP and custom pipe configuration). Persisted as new
optional `historyBack` / `historyForward` arrays; the old `navBack` is migrated once. Additive, so no schema bump.

**Recording lives in `navigatePageTo` only.** Before step 1 it captures the current editor's entry; after a
successful fresh or reuse exit it pushes that entry on `back` and clears `forward`. Nothing is recorded for: a
same-file reveal, a cancelled save prompt, an interceptor "take", a page with no restorable link (an untitled page —
after the save prompt its text is gone), or a navigation to the same link. Editor switches (Monaco ↔ Grid ↔ preview)
and promoting a sidebar panel are not navigations.

**Replay.** `page.history.back()` / `forward()` rebuild the pipe with `pipeFromPersistedSource` (as
`PagesLifecycleModel.retryOpen` does) and call `pages.lifecycle.navigatePageTo` directly with a `historyMove` option.
The navigator, on success, moves the entry between stacks instead of recording a new one, and on failure (save
prompt cancelled) leaves both stacks untouched — so the stacks never move ahead of what the page shows. The link
pipeline (`openRawLink`, open handler, link data) is not touched. An entry's path is `editor.filePath ??
editor.sourceLink.url`, which covers plain and folder boards. A missing file is checked before replay: the entry is dropped with a
toast rather than letting `buildEditor` replace the page with an empty one (`PageNavigator.ts:133-141`).

**Surviving editors come back as they were.** A Link editor or Git Tree that survived the forward navigation as a
sidebar panel is promoted by the existing reuse steps (`reuseNavigationTarget`, `reuseEditorForFile`), so Back
restores that instance with its edits.

**UI.**
- Page toolbar: Back and Forward icon buttons right after the File Explorer button (`PageToolbarView` and the
  board's `BoardToolbarView`), acting on that toolbar's page, disabled when the stack is empty, tooltip naming the
  destination's title and shortcut.
- Shortcuts: `Alt+Left` / `Alt+Right` and mouse buttons 4/5, registered in `KeyboardService`.
- Browser pages are left alone: no Browser code changes, the page-history buttons are hidden while a Browser page is
  active, and the page-history shortcuts do nothing there, so the Browser's own `Alt+Left` / `Alt+Right` keep working
  unchanged.
- The Markdown toolbar Back button is removed; Markdown links simply record through `navigatePageTo`, and
  `MarkdownEditor.followLink` stops pushing.

**Object model.** `page.history`: `canGoBack`, `canGoForward`, `entries` (titles and hrefs), `back()`, `forward()`.
No board bridge change — boards already navigate through `openRawLink`, and their navigations are recorded like any
other. (A board-facing `history.back()` would need a `BOARD_BRIDGE_VERSION` bump; it is out of scope.)

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2003 | `PageHistory`: record in `navigatePageTo`, direct replay (`pipeFromPersistedSource` + `navigatePageTo`), persistence and dated `navBack` migration | Done (e2584077) |
| US-2004 | Back / Forward toolbar buttons after File Explorer, `Alt+Left/Right` and mouse buttons (inactive on Browser pages), remove the Markdown Back button, i18n | Done (f79a99d2; toolbar move e4c50e93) |
| US-2005 | Object model `page.history` and guides (scripting `page`, screens, ai-vision help) | Done (9897675e) |

Task folders were deleted at epic close; their plans are in git history.

US-2003 is the core and comes first; US-2004 and US-2005 both depend only on it.

## Concerns

1. **Untitled content is lost on navigation.** Going back to an untitled page cannot restore its text (the save
   prompt already ran). It gets no entry; the alternative — keeping the old editor alive as a hidden panel — costs
   memory per step and is not proposed.
2. **Board-internal navigation is not page navigation.** A board that changes what it shows without navigating the
   page (its own routing, a single-instance board receiving a queued source) records nothing. That is the board's
   history to keep.
3. **Scroll and cursor position** are not restored by Back in this epic (the Markdown stack does not restore them
   either). A later task can add a view-state snapshot to `NavEntry`.
4. **Pipes built by scripts** (`io.createPipe` with a custom provider config) may not be rebuildable from the URL
   alone. US-2003 checks whether replay should prefer the stored `pipeDescriptor`.
5. **Cap:** 50 entries per stack, as a tuning constant.

## Notes

### 2026-11-15
- Requested by the user: Back / Forward for the page in general, whatever navigated it (Explorer, links, boards,
  scripts).
- Initial header placement was changed after the user found the buttons read as tab navigation. Back / Forward now
  follow File Explorer in the editor toolbar; the Board toolbar has the same placement. Editors without these
  toolbars (Browser, MCP Inspector, Mneme config) have no buttons; the shortcuts still work there except on Browser pages.
- User confirmed: toolbar buttons after File Explorer and removal of the Markdown Back button. The Browser is a separate thing (not an editor a
  page navigates to or from) and this epic must not touch Browser logic.
