# US-1441: Clipboard sidebar panel

Epic: [EPIC-104: Clipboard tracker](../../epics/EPIC-104.md)

Depends on: [US-1439: Main-process clipboard capture service, store and IPC](../US-1439-clipboard-capture-service/README.md), [US-1440: Clipboard settings](../US-1440-clipboard-settings/README.md)

## Goal

Add a fourth, persisted Clipboard panel to the Explorer secondary-view family. When
`clipboard.enabled` is on, the panel exposes the authoritative clipboard-history snapshot from
US-1439, supports copy-back, file navigation, remove, clear, and listener recovery, and reflects
service revisions and health changes without an application restart.

This task is deliberately limited to the renderer sidebar panel and its Explorer integration. It
does not implement or alter the watcher, the main-process capture service, settings, or IPC
contract.

## Background

### Settled product and service contracts

EPIC-104 decisions D5, D8, D9, D10, and D12 govern this panel:

- A duplicate primary payload is promoted to the top of the history instead of becoming a second
  item. A panel action must therefore wait for the service snapshot and must not optimistically
  reorder its own list.
- A selected row opens its primary payload through the ordinary `app.pages.openFile(path)` route.
  The panel does not add an editor or viewer.
- Clipboard is the fourth Explorer panel. Its open state is persisted like Boards, while its
  header icon is absent when the setting is off and updates live when the setting changes.
- Clear and per-item Remove are destructive controls. The panel owns the confirmation step and
  then delegates deletion to US-1439.
- An open panel owns health monitoring. Healthy listeners have no special badge; `deaf` and
  `error` states show a badge with a Restart action.

The US-1439 task document is the IPC source of truth. The panel consumes:

- `ClipboardHistorySnapshot { revision, items }`, where each item has `id`, `capturedAt`,
  `primary`, the index-provided `preview`, and primary/sibling payload paths.
- `eClipboardHistoryChanged`, which contains a revision and reason rather than the full list. The
  panel queries `getClipboardHistory()` after the signal.
- `eClipboardStatusChanged` and `getClipboardStatus()` for listener health.
- `removeClipboardItem`, `clearClipboardHistory`, `copyClipboardItem`,
  `setClipboardHealthMonitoring`, and `restartClipboard`.

The panel must never read payload bodies to construct the list. Payload paths are used only for
the D8 file-opening action; preview text comes from the history index.

### Verified Explorer composition

`src/renderer/editors/explorer/ExplorerEditorModel.ts` currently owns the canonical
`composeSecondaryView()` order: `explorer`, optional `search`, optional `boards`. The persisted
`boardsOpen` comment explicitly says that persistence lets Boards survive restart and page moves
between windows, while Search derives visibility from `searchState`. Clipboard needs the same
persisted flag because it is another sibling panel whose visibility is not derived from transient
search state.

`openBoards()` and `closeBoards()` update the persisted flag, recompute the complete secondary-view
list, and expand the relevant panel. Clipboard should use the same model methods and preserve its
open flag when the setting is disabled, so re-enabling the setting can restore the user's choice.
`getRestoreData()` already spreads the model state, so the new flag will persist through the
existing state path. `onPanelExpanded()` is model-owned and currently only performs Explorer tree
reveal work; Clipboard does not need a new model expansion branch because its view remains mounted
while collapsed under the secondary-view lifecycle.

The current checkout does not actually create, mount, and append `boardsButton` conditionally:
`ExplorerSecondaryView.createHeaderActions()` always creates and mounts it, and
`updateHeader()` always appends it. The Clipboard change will follow the requested conditional
lifecycle for its own button without refactoring the existing Boards behavior.

`secondaryViewRegistry` already supplies the required `SecondaryViewProps` (`model`, `panelId`,
`headerHost`, `iconElement`, and `expanded`). The registry dynamically imports a view, and
`SecondaryViewsView` keeps panel content mounted while collapsed. `SideBarPanelHeaderView` accepts
caller-owned icon, badge, title, and action nodes. These existing contracts mean no registry or
UIKit primitive change is required.

### Verified list and action precedents

`BoardsSecondaryView` is the structural precedent for a native secondary panel with a header and
row actions. `ListBoxView` already provides virtualized rows, browse selection, trailing content,
context menus, loading, and an empty message; `FileListView` demonstrates the same composition.
The panel will compose these existing views rather than add a new UIKit primitive or custom row
renderer unless implementation exposes a necessary layout gap.

Trailing Copy buttons must stop event propagation so they do not also select the row. The row
selection handler opens the primary payload path. Remove is supplied by the ListBox row context
menu. No operation mutates the local item array optimistically; each mutation waits for the
revision signal and authoritative snapshot.

### Verified formatting and confirmation precedents

`src/renderer/components/git-tree/git-date.ts` establishes the developer-facing local timestamp
format `YYYY-MM-DD HH:mm`, zero-padded and 24-hour with no seconds. Clipboard rows will use that
format. `LogEntryContent.ts` uses a 200-character preview boundary, so text previews will be
normalized to one line, capped at 200 characters, and given an ellipsis when truncated.

Destructive actions use confirmation in the existing UI: the log view confirms clearing, board
deletion uses a title, explicit permanent-deletion message, and `Delete`/`Cancel`, and settings
profile deletion follows the same pattern. Clipboard Clear and Remove will use the same
confirmation-dialog style because deleting stored payload files is irreversible. The API is
`showConfirmationDialog` from `src/renderer/ui/dialogs/ConfirmationDialog`. Use the dynamic-import
form already used by `src/renderer/api/board-install.ts:130-131` and
`src/renderer/api/board-updates.ts:128-129`; the return value is the selected button label.
Reconstructible recent-file entries are not a relevant precedent.

## Implementation Plan

### 1. Extend Explorer model state and composition

Update `src/renderer/editors/explorer/ExplorerEditorModel.ts`:

- Add `clipboardOpen?: boolean` beside `boardsOpen`, with a comment stating that it is persisted
  so the Clipboard sibling survives restart and page moves between windows. The flag is retained
  while `clipboard.enabled` is off.
- Import the renderer `settings` API and subscribe to `settings.onChanged` using the existing
  subscription pattern. On `clipboard.enabled`, recompute `secondaryView` from the canonical
  composition. This removes the panel when disabled and re-adds it when enabled, without restart.
  Dispose the subscription with the model.
- Extend `composeSecondaryView()` to append `clipboard` after Boards only when both
  `state.clipboardOpen` and `settings.get("clipboard.enabled")` are true. The display order is
  therefore `explorer`, `search` when active, `boards` when open, then `clipboard` when enabled
  and open.
- Add `openClipboard()` and `closeClipboard()` matching `openBoards()`/`closeBoards()`: update the
  persisted flag, assign the complete composition, and expand `clipboard` or return to
  `explorer`. `openClipboard()` should not expose a panel while the setting is off.
- Leave `restore()`, `setPage()`, `getRestoreData()`, navigation survival, and
  `onPanelExpanded()` on their existing paths; they will pick up the new composition/state
  automatically.

Before:

```ts
boardsOpen?: boolean;

private composeSecondaryView(): string[] {
    const ids = ["explorer"];
    if (this.searchState) ids.push("search");
    if (this.state.get().boardsOpen) ids.push("boards");
    return ids;
}
```

After:

```ts
boardsOpen?: boolean;
/** Persisted like Boards so the Clipboard sibling survives restart and page moves. */
clipboardOpen?: boolean;

private composeSecondaryView(): string[] {
    const ids = ["explorer"];
    if (this.searchState) ids.push("search");
    const state = this.state.get();
    if (state.boardsOpen) ids.push("boards");
    if (state.clipboardOpen && settings.get("clipboard.enabled")) ids.push("clipboard");
    return ids;
}
```

The exact subscription callback should follow the existing `settings.onChanged.subscribe(({ key })
=> ...)` convention used by live settings views. The setting subscription must update composition
but must not clear `clipboardOpen`; disabling the feature is a visibility change, not a request to
forget the user's panel state.

### 2. Add the live-gated Explorer header button

Update `src/renderer/editors/explorer/ExplorerSecondaryView.ts`:

- Add a `clipboardButton?: IconButtonView` field.
- Subscribe to `settings.onChanged` during mount. When `clipboard.enabled` becomes true, create
  and mount the button exactly once; when it becomes false, release/dispose it and clear the field
  so the button is not merely hidden. Run `updateHeader()` after either transition. Initialize
  the button only when the setting is already enabled.
- Use the existing `IconButtonView` with the registered `paste` icon, `size: "sm"`, title
  `Clipboard`, and a click handler that stops propagation and calls `model.openClipboard()`.
- Add the button to the header action spread only when the field exists. Keep it after the Boards
  action so it follows the model's panel order.
- Clear the field during disposal and let the owned setting subscription clean up with the view.

Before:

```ts
private boardsButton: IconButtonView | undefined;

this.headerActions?.replaceChildren(
    ...(this.searchButton ? [this.searchButton.root] : []),
    ...(this.boardsButton ? [this.boardsButton.root] : []),
    // ...
);
```

After:

```ts
private boardsButton: IconButtonView | undefined;
private clipboardButton: IconButtonView | undefined;

this.headerActions?.replaceChildren(
    ...(this.searchButton ? [this.searchButton.root] : []),
    ...(this.boardsButton ? [this.boardsButton.root] : []),
    ...(this.clipboardButton ? [this.clipboardButton.root] : []),
    // ...
);
```

This is separate from the model's panel gating: the model controls whether the panel id exists,
while the Explorer view controls whether the header action node exists. Both react to the same
setting so neither a stale icon nor a stale panel remains after disable.

### 3. Register the Clipboard secondary view

Update `src/renderer/editors/register-editors.ts` with the existing lazy registry pattern:

```ts
secondaryViewRegistry.register({
    id: "clipboard",
    label: "Clipboard",
    icon: "paste",
    loadView: () => import("./explorer/ClipboardSecondaryView"),
});
```

`paste` is already an available icon name and is the closest existing semantic glyph; no new icon
asset is needed. The registry remains the sole panel-id-to-view registration mechanism.

### 4. Implement the native Clipboard panel view

Create `src/renderer/editors/explorer/ClipboardSecondaryView.ts` as the module's **default** export:
`export default class ClipboardSecondaryView extends VanillaView<SecondaryViewProps>`. This is
required by `SecondaryViewDefinition.loadView`'s default-export shape and follows
`src/renderer/editors/explorer/BoardsSecondaryView.ts:106`, which declares
`export default class BoardsSecondaryView extends VanillaView<SecondaryViewProps>`.
Keep panel-specific async state in this view because the authoritative state is an IPC snapshot,
not a reusable editor-domain model. Do not introduce a new UIKit primitive or a second payload
cache.

On mount:

1. Build the header with the supplied `headerHost` and `iconElement`, a `Clear` action, and the
   current health badge. The Clear action is omitted when `expanded` is false, following the
   secondary-view header rule for conditional actions.
2. Build a `ListBoxView<ClipboardHistoryItem>` body with `variant: "browse"`, a loading state,
   an empty message, a row trailing Copy button, and a row context menu.
3. Register `eClipboardHistoryChanged` and `eClipboardStatusChanged` subscriptions and own both
   lifetimes.
4. Call `api.setClipboardHealthMonitoring(true)`, then query status and the initial history. The
   view owns the monitoring registration while mounted and calls
   `api.setClipboardHealthMonitoring(false)` during disposal.

Row presentation:

- Timestamp: local `YYYY-MM-DD HH:mm` from `capturedAt`.
- `primary === "text"`: use the index `preview`, collapse whitespace to a single line, cap it at
  200 characters, and append `…` only when truncation occurred.
- `primary === "image"`: show `Image`.
- `primary === "html"`: show `HTML`.
- `primary === "files"`: show the index-provided file-list label, expected from US-1439 to be a
  count such as `N file(s)`; do not parse the `.json` payload in the renderer.

Render each row as the existing ListBox label combining the timestamp and preview label, with an
`IconButtonView` using the `copy` icon in the trailing slot. Existing ListBox ellipsis/layout
behavior handles the available width, and all colors remain supplied by existing tokenized UIKit
components.

Interaction behavior:

- Selection checks the primary path and calls `void app.pages.openFile(path)`. If the path is
  absent, show a user-visible failure and wait for the next authoritative snapshot; do not open a
  fabricated link.
- Copy stops propagation, calls `api.copyClipboardItem(item.id)`, and does not reorder or remove
  the row locally. A successful service-side self-copy will produce a normal clipboard revision
  and D5 will promote the item in the returned snapshot.
- Remove adds a context-menu item labelled `Remove`, confirms with a message that the stored
  payload is permanently deleted, then calls `api.removeClipboardItem(item.id)`. The exact shape is:

  ```ts
  const { showConfirmationDialog } = await import("../../ui/dialogs/ConfirmationDialog");
  const confirmed = await showConfirmationDialog({
      title: "Remove clipboard item",
      message: "Remove this clipboard item? Its stored payload will be permanently deleted.",
      buttons: ["Remove", "Cancel"],
  });
  if (confirmed === "Cancel" || !confirmed) return;
  await api.removeClipboardItem(item.id);
  ```

  `Remove` is distinguished from `Cancel` by the returned button label; a cancelled or dismissed
  dialog must not call IPC. This follows `BoardsSecondaryView.deleteBoard()` at
  `src/renderer/editors/explorer/BoardsSecondaryView.ts:432-438`.
- Clear is a header action. When there are items, confirm with a title such as `Clear clipboard
  history`, explain that all captured payload files will be permanently deleted, and offer
  `Clear`/`Cancel`; then call `api.clearClipboardHistory()`. Use the same dynamic import and
  returned-label check:

  ```ts
  const { showConfirmationDialog } = await import("../../ui/dialogs/ConfirmationDialog");
  const confirmed = await showConfirmationDialog({
      title: "Clear clipboard history",
      message: "Clear all clipboard history? Stored payload files will be permanently deleted.",
      buttons: ["Clear", "Cancel"],
  });
  if (confirmed !== "Clear") return;
  await api.clearClipboardHistory();
  ```

  Here only the `Clear` return value is destructive; `Cancel`, dismissal, and any falsy result do
  nothing. This uses the same API and button-return convention as the Boards confirmation above.
  With no items, the action is disabled or omitted and must not show a pointless confirmation.
- Copy, Remove, and Clear all wait for the service event/query cycle instead of mutating local row
  order. Operation failures remain visible through the existing notification/error UI pattern.

### 5. Refresh and race handling

Implement one snapshot-application path used by initial load and every history revision:

- Track the newest applied revision and a request generation. Ignore a snapshot older than the
  current revision, and ignore results from a superseded/disposed request.
- On `eClipboardHistoryChanged`, query the full snapshot; the event itself is not treated as a
  list update.
- On `eClipboardStatusChanged`, replace the local status and refresh the header/body state without
  touching the item order.
- Do not add a self-copy suppression window, an optimistic promotion, or an optimistic removal.
  The service's queued mutation and D5 promotion are authoritative, including after Copy causes a
  new clipboard event.
- If a user selects a row while a Copy request is in flight, opening the path and copying the
  selected item are independent IPC actions. The row remains valid until the service publishes a
  revision; any resulting promotion is then rendered from the snapshot. Stopping propagation on
  the Copy button prevents accidental simultaneous row selection from the same pointer event.

### 6. Health, empty, disabled, and failure states

Use existing `TagView`, `ButtonView`, `NotificationView`, and tokenized panel/text components; do
not hardcode colors or add a new badge primitive.

- Setting off: the Clipboard panel id and header button are absent. No Clipboard panel view is
  mounted, so it does not register health monitoring.
- Setting on, initial query pending: show the existing ListBox loading state.
- Setting on, healthy/running listener, no items: show `No clipboard history yet.`
- Setting on, `deaf` or `error`, with items: keep the last authoritative list visible and show a
  health badge with a `Restart` action. Include the service error text as the badge tooltip or
  adjacent existing notification content when present.
- Setting on, `deaf` or `error`, with no items: show a distinct unavailable message such as
  `Clipboard listener is unavailable. No new items will be captured.` and retain the Restart
  action. This distinguishes a failed watcher (including a missing dev-build helper) from normal
  empty history.
- Restart calls `api.restartClipboard(normalizeClipboardMaxItems(settings.get("clipboard.max-items")))`.
  It updates status and waits for normal history/status events; it does not locally clear or
  reorder items. Healthy status removes the badge as required by D12.

### 7. Verification before implementation handoff

No unit tests or test harnesses are to be added. Before implementation is considered complete,
manually verify the panel with the service contract for: setting toggles with and without restart,
persisted open state, empty history, text/HTML/image/file-list rows, long text preview, selection,
Copy promotion, Remove, confirmed Clear, revision races, collapsed headers, healthy status,
missing-helper/error status, deaf status, and Restart recovery. Confirm that closing the panel
unregisters health monitoring and that disabling the setting removes both the panel and button.

## Concerns / Open questions (resolved)

1. **What does each row show? — Resolved.** Use local `YYYY-MM-DD HH:mm`. Text uses the
   index-provided preview, whitespace-normalized and capped at 200 characters with an ellipsis on
   truncation. Image and HTML rows show `Image` and `HTML`; file-list rows show the index-provided
   count label. The panel never reads payload bodies.

2. **Does Clear confirm? — Resolved: yes.** Existing destructive actions confirm irreversible
   deletion with a specific title/message and destructive-button/Cancel choices. Clipboard payload
   files are not reconstructible, so Clear uses `Clear`/`Cancel`; Remove uses the matching
   `Remove`/`Cancel` confirmation.

3. **What do empty and failed-watcher states show? — Resolved.** Normal empty history shows
   `No clipboard history yet.`. A `deaf`/`error` status shows the health badge and Restart; with
   no items it additionally shows an unavailable-listener message, while existing items remain
   visible. The setting-off state removes the panel entirely.

4. **Can selection and Copy conflict? — Resolved.** Copy stops propagation, and both actions use
   the immutable item snapshot/path available at dispatch time. The view does not perform local
   reorder/removal. It accepts the next revision snapshot from US-1439, applying revision and
   request-generation guards so stale queries cannot undo an authoritative promotion or deletion.

## Acceptance Criteria

- [ ] Explorer composition includes `clipboard` after Boards only when `clipboardOpen` is true and
      `clipboard.enabled` is true; the persisted open flag survives restart and page moves.
- [ ] Toggling `clipboard.enabled` live removes/re-adds the panel and creates/removes the header
      button without an application restart. The button is not created while the setting is off.
- [ ] The panel is registered through `secondaryViewRegistry` and implemented as a native
      `VanillaView` using existing tokenized UIKit components.
- [ ] Rows are newest-first from US-1439's snapshot and show the resolved timestamp and
      flavor-specific preview without reading payload bodies.
- [ ] Selecting a row calls `app.pages.openFile()` with its primary payload path.
- [ ] Copy uses `copyClipboardItem`, stops propagation, and renders service-authoritative
      promotion after the revision signal without optimistic reordering.
- [ ] Each row has a confirmed Remove context-menu action; the header has a confirmed Clear
      action that delegates to US-1439 and waits for the authoritative snapshot.
- [ ] History and status events are subscribed to on mount, stale snapshots cannot overwrite newer
      revisions, and all subscriptions/async view work are cleaned up on dispose.
- [ ] The view registers health monitoring on mount and unregisters it on dispose. Healthy status
      has no special badge; `deaf` and `error` show Restart, including the missing-helper case.
- [ ] Empty history and watcher failure are visibly distinct, and Restart uses the normalized
      configured cap without changing local history optimistically.
- [ ] No implementation, task document, epic, or `doc/active-work.md` belonging to US-1438,
      US-1439, or US-1440 is modified by this task.

## Files that need **NO changes**

- `doc/active-work.md`, `doc/epics/EPIC-104.md`, and the US-1438, US-1439, and US-1440 task
  documents.
- US-1439 implementation and IPC contract files: `src/main/clipboard-service.ts`,
  `src/main/sidecar-process.ts`, `src/main/main-setup.ts`, `src/ipc/clipboard-ipc.ts`,
  `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/renderer/renderer-events.ts`,
  `src/ipc/main/core-handlers.ts`, and `src/renderer/api/app.ts`.
- US-1440 settings files: `src/renderer/api/settings.ts`,
  `src/renderer/editors/settings/sections/ClipboardSection.ts`, and
  `src/renderer/editors/settings/sections/ClipboardSectionModel.ts`.
- Existing secondary-view infrastructure and precedents:
  `src/renderer/ui/secondary-views/secondary-view-registry.ts`,
  `src/renderer/ui/secondary-views/SideBarPanelHeaderView.ts`,
  `src/renderer/ui/secondary-views/SecondaryViewsView.ts`,
  `src/renderer/editors/explorer/BoardsSecondaryView.ts`, and the existing ListBox, IconButton,
  Tag, Button, Notification, and panel primitives under `src/renderer/uikit/`.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | Add persisted Clipboard open state, live setting-gated composition, and open/close methods. |
| `src/renderer/editors/explorer/ExplorerSecondaryView.ts` | Add the live-created/live-removed Clipboard header button and conditional action append. |
| `src/renderer/editors/register-editors.ts` | Register the lazy `clipboard` secondary view with the existing `paste` icon. |
| `src/renderer/editors/explorer/ClipboardSecondaryView.ts` | New native panel: authoritative snapshot list, timestamp/flavor preview, selection, Copy, Remove, Clear, health badge, Restart, and lifecycle cleanup. |
