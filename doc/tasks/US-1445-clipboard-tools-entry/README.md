# US-1445: "Clipboard" entry in Tools & Editors → Built-in

## Goal

Add an always-available, pinnable `Clipboard` tool to Tools & Editors → Built-in. Activating it
opens or focuses one dedicated sidebar-only page whose only panel is Clipboard, including a clear
Settings warning when clipboard history is disabled. The page lifecycle should generically close any
page with no main editor when its previously non-empty panel set becomes empty, so closing the only
Clipboard panel closes this dedicated page without Clipboard-specific page-close logic.

## Background

### Existing Built-in entry and pinning flow

`src/renderer/ui/sidebar/tools-editors-registry.ts:43-177` defines the `staticItems` array of
`CreatableItem` records. The existing `Open Folder` record at `:45-57` is the closest creation
precedent: it is a `category: "tool"` item and calls `pagesModel.addEmptyPageWithNavPanel(folder)`
after the folder dialog returns. `getCreatableItems()` at `:183-194` returns all static items plus
browser-profile items without consulting `clipboard.enabled`.

`src/renderer/ui/sidebar/BuiltinEditorsListView.ts:58-106` refreshes only for
`browser-profiles` and `pinned-editors`, removes already-pinned IDs from the list, and creates the
same generic pin button for every remaining `CreatableItem`. Therefore the new item must be added to
`staticItems` with no setting gate, and it must not be added to `DEFAULT_PINNED_EDITORS` unless a
future product decision changes the default pin set. No Built-in-list special case is needed.

The existing `open-folder`, `open-file`, and `open-url` entries are the non-editor tool siblings;
the new record should use the same `category: "tool"` shape and a stable ID such as
`"clipboard"`.

### Explorer-backed sidebar lifecycle

`src/renderer/api/pages/PagesLifecycleModel.ts:273-284` currently creates a `PageModel`, constructs
an `ExplorerEditor` from `getDefaultExplorerEditorState()` with `rootPath` replaced by the supplied
folder, attaches and restores it, ensures the sidebar model, and adds the page with no main editor.
The default state is defined in `src/renderer/editors/explorer/ExplorerEditorModel.ts:47-55` with
`title: "Explorer"` and `rootPath: ""`.

`ExplorerEditor.composeSecondaryView()` at
`src/renderer/editors/explorer/ExplorerEditorModel.ts:149-158` currently starts with
`"explorer"`, then conditionally adds Search, Boards, and Clipboard. Clipboard is currently
conditional on both `clipboardOpen` and `settings.get("clipboard.enabled")`. The model persists
`clipboardOpen` in `ExplorerEditorState` (`:31-44`), and `openClipboard()` / `closeClipboard()` are
at `:217-226`.

The setting is the `clipboard.enabled` key in
`src/renderer/api/settings.ts:23-38`, with a default of `false` at `:131-146`. The Explorer
header creates the Clipboard action with `icon: "paste"` at
`src/renderer/editors/explorer/ExplorerSecondaryView.ts:187-196`, and its setting subscription
removes that action while disabled at `:86-96`. That discoverability behavior is already correct
for this task and must remain unchanged.

The Clipboard panel is registered in
`src/renderer/editors/register-editors.ts:34-39` as `id: "clipboard"`, with `icon: "paste"`, and
loads `ClipboardSecondaryView`. The view casts `props.model` to `ExplorerEditor` and calls
`model.closeClipboard()` at `src/renderer/editors/explorer/ClipboardSecondaryView.ts:37-85`; it
also uses `model.page?.id` for same-page navigation at `:312-330`. The host therefore must remain
an `ExplorerEditor`, even when the Explorer panel itself is absent.

### Question 1 decision: explicit flag, not an empty-root heuristic

Use a persisted `hideExplorer?: boolean` (or equivalently named explicit dedicated-view flag) on
`ExplorerEditorState`. The new page will use `rootPath: ""`, `hideExplorer: true`, and
`clipboardOpen: true`. `composeSecondaryView()` will omit Explorer, Search, and Boards when this
flag is set, but will still include Clipboard whenever `clipboardOpen` is true, regardless of the
setting:

```ts
// Before — ExplorerEditorModel.ts:151-157
const ids = ["explorer"];
if (this.searchState) ids.push("search");
const state = this.state.get();
if (state.boardsOpen) ids.push("boards");
if (state.clipboardOpen && settings.get("clipboard.enabled")) ids.push("clipboard");
return ids;

// After — explicit dedicated-page state
const state = this.state.get();
const ids = state.hideExplorer ? [] : ["explorer"];
if (!state.hideExplorer && this.searchState) ids.push("search");
if (!state.hideExplorer && state.boardsOpen) ids.push("boards");
if (state.clipboardOpen) ids.push("clipboard");
return ids;
```

An empty `rootPath` cannot safely carry this meaning. The verified current construction paths are:

| Path | Evidence and current root guarantee |
| --- | --- |
| `src/renderer/content/resolvers.ts:132-140` | The directory resolver calls `addEmptyPageWithNavPanel(data.url)` only after `stat(data.url).isDirectory`; this is a real directory path. |
| `src/renderer/content/tree-context-menus.ts:49-60` | The folder context menu passes `item.href` only for a directory item. |
| `src/renderer/editors/text/ScriptPanel.ts:312-332` | The direct `ExplorerEditor` construction uses the truthy `scriptPanelDir`; the fallback call is also inside `else if (scriptPanelDir)`. |
| `src/renderer/editors/toolset/ToolsetEditorModel.ts:125-129` | `openFolder()` calls the helper only under `if (root)`. |
| `src/renderer/ui/sidebar/MenuBarView.ts:421-433` | `openFolderPathInTab()` returns before calling the helper when `folderPath` is missing. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:481-489` | Archive handling derives a non-empty `archiveRoot` from the requested archive path before calling the helper. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:45-57` | Open Folder returns when the folder dialog has no selection and passes the selected folder otherwise. |
| `src/renderer/editors/explorer/page-explorer.ts:42-53,68-82` | Both automatic Explorer provisioning paths return when the derived root is empty before constructing the editor. |
| `src/renderer/api/pages/PagesPersistenceModel.ts:170-186,229-234` | Restore constructs Explorer directly from the persisted `fileExplorer` state; future clipboard pages will legitimately restore with an empty root. |

Thus no current folder/navigation route legitimately creates an empty-root Explorer, but the new
clipboard route must. A `rootPath === ""` test would silently remove the required host editor's
panel list for this page and would also make the meaning of any restored empty-root descriptor
ambiguous. The explicit flag is required.

The flag also requires two lifecycle-condition updates in
`ExplorerEditorModel.ts:393-403`: `restore()` and `setPage()` currently compose panels only when
`rootPath` is truthy. They must compose when the state represents the dedicated Clipboard page
(the flag or `clipboardOpen` is set), so a newly created and a restored Clipboard page both expose
the panel. `openClipboard()` must expand Clipboard regardless of the setting. `closeClipboard()`
continues to only clear `clipboardOpen`; the generic page lifecycle below closes a sidebar-only page
when that change removes its last panel.

### Generic empty-sidebar page lifecycle

The close rule should be general: a page with no main editor closes itself when its panel set makes
the transition from non-empty to empty. It must not be a state predicate that closes every page
observed in an empty state. `PagesLifecycleModel.addEmptyPageWithNavPanel()` attaches its
`ExplorerEditor` before `restore()` at `:273-284`, so construction passes through no main editor and
no composed panels. `PagesPersistenceModel.restorePage()` also attaches restored editors one at a
time. A state-only check would therefore close a page during construction or restore before its
panels have been composed.

The existing seam is `PageModel._enforceMandatoryOpen()` at `PageModel.ts:583-596`, called after
attach at `:285`, detach at `:318`, and `onEditorPanelsChanged` at `:403`. It calls
`_enforceActivePanelExpanded()` at `:606-621`, whose full panel enumeration already returns early
at `:612` when `panels.length` is zero. Implement the close rule as a sibling helper called from
`_enforceMandatoryOpen()` after that active-panel enforcement, reusing an extracted full-panel
enumeration helper if needed. Keeping it sibling to `_enforceActivePanelExpanded()` preserves that
method's existing no-op meaning while using the same exact empty-panel detection.

Record a private `hadPanels` transition flag only after a non-empty composed panel list has been
observed. When a later lifecycle pass sees no panels, no main editor, and `hadPanels` is true,
queue the close and re-check both conditions before acting; reset or leave the queue harmlessly if
a panel returns first. Defer the actual `void this.close()` through the existing `afterDispatch`
import at `PageModel.ts:2`, as used by the deferred cleanup precedent at `:365`, so state-update
dispatches are not re-entered. `PageModel.close()` at `:694` retains its normal modified-editor
`confirmRelease()` checks and `onClose` callback; cancellation returns false and leaves the page
open. No `pagesModel` reference or import cycle is needed: `PagesLifecycleModel.closePage()` at
`:518-522` only resolves a page and delegates to that same `page.close()`.

The rule is explicitly gated by the absence of a main editor. A Monaco page that loses its last
sidebar panel remains open. Check `setMainEditor()` (`PageModel.ts:427-475`), which establishes the
replacement main editor before detaching the old one, `promoteSecondaryToMain()` (`:506-507`), and
the non-main auto-detach in `onEditorPanelsChanged()`; none may close a page while a main editor is
present. Only a prior non-empty panel set followed by an empty set on a main-editor-less page is a
close transition.

### The dedicated page and singleton behavior

The new page should have a fixed ID, for example `"clipboard-page"`, and be opened through a
dedicated `showClipboardPage()` lifecycle helper. The helper should first focus an existing page
with that ID; otherwise it should create the sidebar-only `PageModel`, attach the flagged
`ExplorerEditor`, restore it, ensure the sidebar, and expand Clipboard.

This follows the singleton pattern used by Mneme: `showMnemeConfigPage()` calls
`showEditorPage()` with the fixed `MNEME_CONFIG_PAGE_ID` at
`src/renderer/api/pages/PagesLifecycleModel.ts:803-831`, and `addPage()` focuses an existing page
with the same ID at `:240-253`. `showMcpInspectorPage()` at `:849-867` intentionally creates a
fresh page without a fixed page ID, so it is not the right model for a single Clipboard view.
Repeated activation should therefore focus the existing Clipboard page and reopen/expand its
panel if the user previously closed the panel.

The page is intentionally sidebar-only, so `PageModel.title` at
`src/renderer/api/pages/PageModel.ts:236-239` returns `"Empty"` and `PageTabView` keeps the
standard empty-page tab when there is no main editor. This is the intended design and must not be
changed for US-1445. Leave `src/renderer/ui/tabs/PageTabView.ts` untouched, and leave
`ExplorerEditor.getIconElement` as its unconditional `createFolderIconElement()` panel icon.
The Clipboard panel header already overrides that owner icon with `icon: "paste"` in the secondary
view registration, so no dedicated-page icon change is needed. The Explorer state title is internal
model state only here; it must not be described as producing a Clipboard tab title.

### Disabled-state banner and panel behavior

The panel must remain renderable when `clipboard.enabled` is false. The minimal model change is to
make Clipboard composition depend on `clipboardOpen` only. The Explorer header's existing
`setClipboardButton(settings.get("clipboard.enabled"))` behavior remains the only discoverability
gate, so disabling the setting hides the Explorer-header shortcut but does not remove an already
open or explicitly created Clipboard panel.

`ClipboardSecondaryView` currently creates `unavailableNotification` at
`src/renderer/editors/explorer/ClipboardSecondaryView.ts:407-442` only when the history is empty
and the listener is deaf/error, then passes its DOM node as `ListBoxView.emptyMessage` at `:283-292`.
That cannot show a disabled warning above existing rows. Promote this one notification to a real
top-of-panel child mounted before the ListBox, and stop using it as `emptyMessage`; keep the list's
empty message as the plain `"No clipboard history yet."` text. Reuse the same notification instance
for the mutually exclusive states:

- `status.enabled === false` / health `disabled`: warning copy such as
  `Clipboard history is disabled in Settings.` and an explicit `Open Settings` action;
- enabled but `deaf`/`error`, with no rows: preserve the existing unavailable/error message;
- otherwise: remove the notification.

This is preferable to adding a second notification: one top-level warning avoids duplicate status
messages, remains visible when stored rows exist, and avoids trying to put the same DOM node in both
the panel and a ListBox empty-state slot. `NotificationView` already supports a clickable/action
surface, but use a keyboard-accessible `ButtonView` labeled `Open Settings` alongside the promoted
notification, following `src/renderer/editors/mneme-config/MnemeConfigView.ts:30-40`, which calls
`pagesModel.showSettingsPage()`. The existing Settings entry point is also
`src/renderer/ui/sidebar/MenuBarView.ts:567-570`.

Both the notification and the header badge are currently gated through `isUnavailable()`:
`ClipboardSecondaryView.ts:491-493` only returns true for `health === "deaf" || health === "error"`.
Adding a disabled message only to the text is insufficient: the implementation must add a separate
`isDisabled()`/`status.enabled === false` branch to the notification visibility calculation and to
the badge/header calculation, otherwise neither will render while the tracker is disabled. Keep
disabled separate from listener-unavailable so Restart remains an enabled-error action only.

Disabled is not a broken listener. While disabled:

- Clear remains available when stored rows exist and continues to delete all stored history. The
  existing header placement rule still applies: the Clear button is included only when
  `this.items.length > 0` and `props.expanded !== false` (`ClipboardSecondaryView.ts:467-481`),
  regardless of whether the tracker is disabled; its `disabled` property remains tied to an empty
  item list.
- Remove remains available on row context menus and deletes the selected stored payload.
- Copy remains available for stored rows and writes the payload back to the OS clipboard. It must
  not leave the current `selectNextCapture` follow-up armed when the listener is disabled, because
  no capture event will arrive to consume it.
- The health badge must say `Disabled` with `tone: "default"` (the verified TagView tone union is
  `"default" | "error" | "warning" | "success"` at `src/renderer/uikit/Tag/TagView.ts:32`),
  never `Error` or `Deaf`. Restart must not be offered as an error recovery action while disabled;
  it remains available for the enabled `deaf`/`error` states where it is meaningful.
- Opening a stored item continues to navigate the host page using the existing `pageId` route.

### Icon

Use the existing `paste` icon: it is the exact `icon: "paste"` override in the Clipboard secondary
view registration at `src/renderer/editors/register-editors.ts:34-39` and the Explorer header
button's `icon: "paste"` at `src/renderer/editors/explorer/ExplorerSecondaryView.ts:187-196`.
The Built-in item should call `createIconElement("paste")`, so the entry, Clipboard panel header,
and Explorer affordance share the same registry icon.

## Implementation Plan

1. **Create the dedicated page lifecycle.**

   - Add a fixed Clipboard page ID and a `showClipboardPage()` helper in
     `src/renderer/api/pages/PagesLifecycleModel.ts`. Use the existing `addPage()` fixed-ID
     deduplication path, but check/focus the existing page before constructing a replacement model.
   - Build the new page as a sidebar-only `PageModel` containing an `ExplorerEditor` with
     `rootPath: ""`, `hideExplorer: true`, and `clipboardOpen: true`. Keep the default Explorer
     state title and folder `getIconElement()`; the tab remains the standard `Empty` tab and the
     Clipboard panel header supplies its own `paste` icon.
   - Restore the editor, ensure the secondary-views model, and set/expand Clipboard without
     attempting to select an Explorer panel on the dedicated page. `closeClipboard()` must only
     clear `clipboardOpen`; when that removes the last panel, the generic transition rule in
     `PageModel` closes this sidebar-only host. Ordinary rooted Explorer pages retain their
     Explorer panel and remain open.
   - Add the internal delegate in `src/renderer/api/pages/PagesModel.ts` so the registry can call
     `pagesModel.showClipboardPage()`. Do not add a new script-facing `app.pages` API for this
     Built-in-only action.

2. **Add the always-listed Built-in item.**

   In `src/renderer/ui/sidebar/tools-editors-registry.ts`, add a static item beside the existing
   tool entries:

   ```ts
   // Before — staticItems has Open Folder, Open File, Open URL, then editor items.

   // After
   {
       id: "clipboard",
       label: "Clipboard",
       icon: createIconElement("paste"),
       create: () => { void pagesModel.showClipboardPage(); },
       category: "tool",
   },
   ```

   Do not read `clipboard.enabled`, filter in `getCreatableItems()`, add a
   `BuiltinEditorsListView` settings subscription, or add a pinning special case. The generic
   `getCreatableItems()`/`BuiltinEditorsListView` flow must list and pin the item in both setting
   states.

3. **Make Explorer composition explicit and setting-independent for an open Clipboard panel.**

   In `src/renderer/editors/explorer/ExplorerEditorModel.ts`:

   - Add the persisted `hideExplorer` state field and implement the explicit composition shown
     above.
   - Update `restore()` and `setPage()` so the flagged empty-root state composes its panels.
   - Make `openClipboard()` expand Clipboard without checking the setting.
   - Make `closeClipboard()` only set `clipboardOpen` to false. On the dedicated page that makes
     composition return no panels, so the generic `PageModel` transition rule closes the host;
     on an ordinary rooted page, Explorer remains composed and the page stays open.
   - Leave `getIconElement` as the existing unconditional `createFolderIconElement()`.

4. **Close a main-editor-less page after its last panel is removed.**

   In `src/renderer/api/pages/PageModel.ts`, make the existing `_enforceMandatoryOpen()` seam
   observe the full composed panel list on every attach, detach, and panel-state change. Keep a
   private `hadPanels` flag that becomes true only after a non-empty list has been observed; this
   distinguishes the construction/restore no-panel moments from a real non-empty-to-empty
   transition. Use a sibling helper after `_enforceActivePanelExpanded()` rather than putting a
   page-close side effect into that method's existing `if (!panels.length) return` branch.

   When `hadPanels` is true, the page has no main editor, and the current list is empty, schedule
   `void this.close()` through `afterDispatch`, rechecking that there is still no main editor and no
   panel. This preserves `PageModel.close()`'s modified-editor confirmation and `onClose` behavior
   without re-entering a state update. Do not schedule it for a page with a main editor: the
   `setMainEditor()` replacement ordering, `promoteSecondaryToMain()`, and the non-main auto-detach
   path in `onEditorPanelsChanged()` must leave such pages open even when their last panel closes.

   In `PageModel.detach()`, replace the unconditional `this.activePanel = "explorer"` fallback at
   `:305-315` with the first currently composed panel key. If no panel remains, use the empty active
   panel sentinel and let the transition rule close only a main-editor-less page. This is the same
   invariant as the restore fallback below: a page must never name a panel it does not compose.

5. **Restore an active panel that exists on the page.**

   In `src/renderer/api/pages/PagesPersistenceModel.ts:265-279`, retain the current generic
   validation: a restored panel is valid when its parsed ID belongs to the restored editor's
   composed `secondaryView` list. Change only the invalid fallback so it chooses the first composed
   panel instead of assuming Explorer:

   ```ts
   // Before
   page.activePanel = valid ? panel : "explorer";

   // After — use the first rendered/composed panel, if one exists
   const firstPanel = page.panelEditors
       .flatMap((editor) => editor.secondaryView ?? [])[0] ?? "";
   page.activePanel = valid ? panel : firstPanel;
   if (!firstPanel) nav.setStateQuiet({ open: false, activePanel: "" });
   ```

   Use the actual composed/registered panel sequence used by the page when selecting
   `firstPanel`; the important contract is that a Clipboard-only page falls back to `clipboard`,
   never `explorer`. If no panel is composed, leave the active-panel sentinel empty and close the
   restored sidebar so it does not point at a panel that is not rendered.

6. **Render and explain the disabled state in the Clipboard panel.**

   In `src/renderer/editors/explorer/ClipboardSecondaryView.ts`:

   - Mount the existing `NotificationView` before the list as a real top-of-panel banner, with
     disabled state taking precedence over listener-unavailable state.
   - Add an accessible `Open Settings` button that calls `pagesModel.showSettingsPage()` and is
     present with the disabled warning.
   - Remove the notification DOM node from `ListBoxView.emptyMessage`; retain a plain empty-list
     message for the no-history case.
   - Add a disabled branch to both the top-banner gate and the header-badge gate; the current
     `isUnavailable()` only recognizes `deaf`/`error`, so merely changing its message will not make
     a disabled banner or badge render. Show `Disabled` with `tone: "default"`, suppress Restart
     while disabled, and preserve Restart for enabled listener failures.
   - Preserve Clear, Remove, Copy, selection, and stored-item navigation while disabled. Ensure
     the Copy flow does not wait for a capture event when the tracker is disabled.

7. **Verify only the requested behavior.**

   Manually verify that the entry remains in Built-in with both values of `clipboard.enabled`, can
   be pinned, opens one Clipboard-only page, focuses that page on repeat activation, and restores
   with the standard `Empty` tab plus the Clipboard panel header/icon after a renderer restart.
   Verify both empty and non-empty stored history while disabled, the Settings action, the enabled
   listener-error recovery path, and that the Explorer header shortcut remains hidden while
   disabled. Do not add unit tests or a test harness for this task.

## Concerns

- **Empty-root semantics:** Resolved with `hideExplorer`, because `rootPath` is a real Explorer
  target for all current folder/navigation creation routes but must be empty for Clipboard.
- **Restore:** The generic Explorer restore path already merges persisted `d.state` into
  `getDefaultExplorerEditorState()` at `PagesPersistenceModel.ts:170-186` and persists the full
  Explorer state through `ExplorerEditor.getRestoreData()` at `ExplorerEditorModel.ts:357-368`.
  No special Clipboard branch is needed; the lifecycle-condition fix above is required so the
  restored empty-root flagged state composes `clipboard`.
- **Active panel persistence:** `PagesPersistenceModel.ts:238-264` validates a restored panel
  against the restored editor's `secondaryView` list, so a restored `clipboard` panel remains
  valid once composition is setting-independent. No new special validation branch is needed for
  validation, but the current invalid-panel fallback at `PagesPersistenceModel.ts:279` is the
  literal `"explorer"`, which is absent on the dedicated page. Change the fallback to the first
  composed panel ID from `page.panelEditors`/their `secondaryView` lists. If that list is empty,
  set `activePanel` to the empty sentinel and close the restored sidebar (`open: false`) so the page
  never points at a non-existent panel.
- **Empty sidebar-only pages:** The generic `PageModel` rule must close a page only on a
  non-empty-to-empty panel transition when it has no main editor. Record that transition through
  the existing `_enforceMandatoryOpen()` lifecycle seam, after the full panel list has previously
  been non-empty, and defer `void this.close()` with `afterDispatch`. Construction and sequential
  restore attachment therefore do not self-close, while a dedicated Clipboard page closes when
  `closeClipboard()` removes its last panel. A rooted Explorer page remains open because its
  Explorer panel is still composed.
- **Detach fallback:** `PageModel.detach()` has the same literal `"explorer"` fallback at
  `:305-315` as the restore path had at `PagesPersistenceModel.ts:279`. Replace it with the first
  composed panel, or the empty sentinel when none remains, so a Clipboard-only page never points at
  an absent Explorer panel. The generic transition rule handles the resulting empty panel set.
- **Setting transitions:** Turning the setting off must not remove `clipboard` from an already open
  page. Turning it on must not be required to make a page restored from `clipboardOpen` render.
  Only the Explorer header shortcut remains setting-gated.
- **Existing worktree changes:** This task document is planned against the current source and does
  not include or modify the pre-existing uncommitted clipboard-service, Clipboard view, header, or
  styling changes in the worktree.

## Acceptance Criteria

- Tools & Editors → Built-in always contains `Clipboard` regardless of `clipboard.enabled`.
- The item is a `category: "tool"` item, uses the `paste` icon, and participates in generic pin and
  unpin behavior without a special case.
- First activation opens a sidebar-only page whose empty content area has only the Clipboard panel:
  no Explorer, Search, or Boards. Its tab is the standard `Empty` tab because the page has no main
  editor; it does not acquire a Clipboard tab title or tab icon.
- A second activation focuses the existing Clipboard page instead of creating a second one.
- The page's `ExplorerEditor` host remains attached, so same-page item navigation continues to work.
  `closeClipboard()` only clears its open state: the generic page rule closes the host when that
  leaves a no-main-editor page with no panels, while ordinary rooted Explorer close behavior is
  unchanged.
- A page with no main editor closes only after its panel set has transitioned from non-empty to
  empty; construction and sequential restore attachment do not close it, and a page with a main
  editor stays open when its last sidebar panel disappears.
- `clipboardOpen` and the explicit no-Explorer flag survive page persistence, renderer restart,
  page duplication/transfer through `PagesPersistenceModel`, and setting changes.
- Clipboard remains rendered when disabled and shows a top warning that clipboard history is
  disabled in Settings, including when stored rows are present.
- The disabled warning offers an accessible path to `pagesModel.showSettingsPage()`.
- Stored rows remain usable while disabled: Clear, Remove, Copy, and opening an item retain their
  intended behavior; Copy does not wait forever for a capture that cannot occur.
- Disabled status is not presented as listener `Error`/`Deaf`, and Restart is reserved for enabled
  listener failures.
- The Explorer header Clipboard shortcut remains hidden while disabled and is not changed into a
  second entry gate.
- No source implementation, unit test, test harness, or commit is made as part of this planning
  task.

## Files Changed

### This planning task

| File | Change |
| --- | --- |
| `doc/tasks/US-1445-clipboard-tools-entry/README.md` | Investigation, decisions, implementation plan, concerns, and acceptance criteria. |
| `doc/active-work.md` | Active dashboard link under `*(no epic)*`. |

### Planned implementation touch set

| File | Planned responsibility |
| --- | --- |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Always-listed, pinnable Clipboard `CreatableItem`. |
| `src/renderer/api/pages/PagesModel.ts` | Internal `showClipboardPage()` delegate. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Fixed-ID Clipboard page construction and focus/reopen behavior. |
| `src/renderer/api/pages/PageModel.ts` | Generic close-on-transition rule for empty sidebar-only pages and first-panel active fallback on detach. |
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | Explicit no-Explorer state, setting-independent Clipboard composition, lifecycle restore, and close behavior. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | First-composed-panel fallback for invalid restored active panels, including the empty-list case. |
| `src/renderer/editors/explorer/ClipboardSecondaryView.ts` | Top disabled banner, Settings action, disabled status/actions. |

### Explicitly unchanged

- `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` — its existing generic refresh and pin logic
  already covers the new static item; no `clipboard.enabled` subscription belongs there.
- `src/renderer/editors/register-editors.ts` — the Clipboard secondary view is already registered
  with `icon: "paste"`.
- `src/renderer/editors/explorer/ExplorerSecondaryView.ts` — its existing Clipboard header action
  must remain hidden while the setting is disabled.
- `src/renderer/ui/tabs/PageTabView.ts` — the `Empty` tab for sidebar-only pages is intentional
  and must remain unchanged.
- `src/renderer/editors/explorer/ExplorerEditorModel.ts`'s `getIconElement` — keep the existing
  unconditional `createFolderIconElement()`; the Clipboard panel registration supplies `paste`.
- `src/renderer/api/settings.ts`, `src/renderer/api/app.ts`, `src/main/clipboard-service.ts`,
  `src/ipc/clipboard-ipc.ts` — this task consumes the existing setting/status/history contracts and
  does not change clipboard storage or service behavior.
- `src/renderer/content/resolvers.ts`, `src/renderer/content/tree-context-menus.ts`,
  `src/renderer/editors/text/ScriptPanel.ts`, `src/renderer/editors/toolset/ToolsetEditorModel.ts`,
  `src/renderer/ui/sidebar/MenuBarView.ts`, and archive handling in
  `src/renderer/api/pages/PagesLifecycleModel.ts` — investigated construction routes; none should
  be changed to create the Clipboard page.
- Test files and test harnesses — explicitly out of scope.
