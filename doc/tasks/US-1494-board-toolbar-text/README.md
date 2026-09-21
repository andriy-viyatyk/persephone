# US-1494: Board-settable toolbar text, with the board path as fallback

**Status:** Complete  ·  **Epic:** [EPIC-112](../../epics/EPIC-112.md)  ·  **Depends on:** [US-1492](../US-1492-board-toolbar-remove-switcher/README.md) (complete prerequisite); rebase on the current US-1493 toolbar-control host

## Goal

Let the main view of a trusted or bundled board replace the board toolbar's wide middle label with
transient text through `persephone.toolbar.setText(text)`. When the board has never supplied text, or
explicitly clears it with `""`, the slot must show the board root path; the path must remain available
through the slot's tooltip even while an override is displayed.

The slot remains a non-interactive plain text span. This task does not add a toolbar control, an agent
element address, persistence, or another board-to-host transport.

## Background

### D4 and the landed prerequisites

[EPIC-112 D4](../../epics/EPIC-112.md#d4--the-toolbar-text-slot-is-board-settable-with-the-board-path-as-fallback)
defines this as a dedicated text-slot API, separate from the `persephone.toolbar.set()` control
catalog. [D4a](../../epics/EPIC-112.md#d4a--the-paths-click-to-switch-popover-is-removed), implemented
by US-1492, removed the path click-to-switch popover and made the slot non-interactive. The current
`src/renderer/editors/board/BoardToolbar.ts` must be treated as the post-US-1492 and post-US-1493
source, not as the pre-removal implementation.

US-1493 already owns the adjacent `board-toolbar-controls` group, its fixed catalog, the
`board:setToolbarControls` / `board:updateToolbarControls` messages, dynamic control declarations,
and frame-generation cleanup. US-1494 only adds the text message and the existing path-label state
flow; it must not restore the switcher or disturb the control group.

### Current path slot and exact fallback location

In `src/renderer/editors/board/BoardToolbar.ts`, `BoardToolbarView` currently owns:

- `pathPanel`, a row panel with `flex: true`, `width: 0`, and `overflow: "hidden"`, so it is the
  toolbar's flexible squeeze point;
- `pathText`, created by `createTextElement()` as an `HTMLSpanElement` with `size: "sm"`, light
  color, and `truncate: true`;
- `sync()`, which reads `state.boardRoot`, assigns `pathText.textContent`, and reapplies
  `truncate: true` and `hoverUnderline: false`.

`onMount()` currently binds only `state.boardRoot` to `sync()`. The implementation must extend this
selector to include the new transient field and must make `sync()` the single visible fallback
decision:

```ts
// Current source
this.bind(this.model.state, (state) => ({ boardRoot: state.boardRoot }), this.sync);

private readonly sync = (): void => {
    this.boardRoot = this.model.state.get().boardRoot;
    this.pathText.textContent = this.boardRoot ?? "";
    applyTextAttributes(this.pathText, resolveTextAttributes({
        size: "sm", color: "light", truncate: true, hoverUnderline: false,
    }));
    // ... update-dot, Properties, and remaining toolbar synchronization
};
```

```ts
// Target shape
this.bind(
    this.model.state,
    (state) => ({ boardRoot: state.boardRoot, toolbarText: state.toolbarText }),
    this.sync,
);

private readonly sync = (): void => {
    const state = this.model.state.get();
    this.boardRoot = state.boardRoot;
    const displayText = state.toolbarText === "" || state.toolbarText === undefined
        ? this.boardRoot ?? ""
        : state.toolbarText;
    this.pathText.textContent = displayText;
    this.pathText.title = this.boardRoot ?? "";
    applyTextAttributes(this.pathText, resolveTextAttributes({
        size: "sm", color: "light", truncate: true, hoverUnderline: false,
    }));
    // ... retain the current update-dot, Properties, and remaining synchronization
};
```

The exact state history remains meaningful even though both clear cases render the same result:

| State | Meaning | Visible slot |
|---|---|---|
| `toolbarText === undefined` | The board has never set text, or lifecycle cleanup retired it. | `boardRoot` path. |
| `toolbarText === ""` | The board explicitly called `toolbar.setText("")` to clear a previous override. | `boardRoot` path; never a blank slot. |
| `toolbarText` is a non-empty string | The board supplied an override. | The supplied string. |

Preserve the string verbatim, including whitespace; only the exact empty string is the clear value.
The fallback must be decided in the toolbar view from model state, not by changing `boardRoot` or
the durable board title.

### Truncation and tooltip behavior

`src/renderer/uikit/Text/Text.css` implements `data-truncate` as block overflow, ellipsis, and
nowrap. `createTextElement()` and `applyTextAttributes()` do not set a native tooltip, and the
current `BoardToolbarView` has no `title` assignment. Therefore this task keeps the existing
truncation and flexible `pathPanel` behavior for both path and override text, but adds a native
`title` to the same span containing the full `boardRoot` path. The title is updated with the path
even when the visible text is overridden, satisfying D4's requirement that the path remains
discoverable. With no resolved board root, the title is empty as the current slot is empty.

The span remains styled with `hoverUnderline: false`; no pointer cursor, click handler, popover, or
new truncation rule is appropriate for board-provided text.

### Agent addressability decision

`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` publishes the static `BOARD_ELEMENTS`
entries for `board-toolbar-explorer`, `board-toolbar-reload`, `board-toolbar-log`,
`board-toolbar-properties`, and `board-trust`. US-1493 additionally publishes dynamic declarations
for actionable controls as `board-toolbar-control-${id}` with matching `data-name` selectors.
`assets/guides/editors/board.md` documents the published shell addresses, while
`assets/guides/agents/boards.md` and `assets/board-template/CLAUDE.md` document the dynamic control
contract.

The text slot is deliberately not added to `BOARD_ELEMENTS`: it is a label, not an operation an
agent can invoke, and D4a explicitly made it non-interactive. The existing `HTMLSpanElement` stays a
plain span without `data-name`. The agent can read the board's `boardRoot` property and visible
toolbar/snapshot text; adding an address would create a shell contract for a non-actionable value and
would not help with control operation. `BoardEditorFacade.ts`, `BoardToolbarControls.ts`, and the
published control declarations therefore need no changes in this task.

### `setStatusText()` precedent and its lifecycle gap

The semantic precedent is `persephone.setStatusText()`:

- `src/board-shim.ts` posts `{ __persephone: "board:setStatusText", statusText }` to
  `window.parent` with the boot-time `hostPostTarget`, swallowing a parent-gone exception;
- `src/ipc/board-bridge-channels.ts` carries the discriminator and optional `statusText` field in
  `BoardToHostMsg`;
- `src/renderer/editors/board/BoardWebview.ts` receives the already origin/source-validated message
  in `handleMessage()` and calls `BoardEditorModel.setStatusText()` for the main view;
- `BoardEditorModel.setStatusText()` stores a string in `BoardEditorState.statusText`, and
  `BoardEditorView` binds that field into the content-host footer; `getRestoreData()` strips it and
  `restore()` clears a stale persisted value.

The current `setStatusText()` implementation proves the intended transient state shape, but it does
not itself clear `statusText` on a reload, navigation teardown, or frame error. US-1494 must not copy
that omission: toolbar text is explicitly required to fall back after those events. The new
`toolbarText` field must be cleared by the live main `BoardWebview` lifecycle and by model restore/
disposal cleanup. Unlike a blanket status reset, each live-frame clear must match the generation that
owns the text.

### Current bridge and frame lifecycle

The current additive bridge version is `1.10.0` in `src/shared/board-bridge-version.ts`; US-1494
bumps it to `1.11.0`.

`src/renderer/editors/board/BoardWebview.ts` validates every window message before its switch using
`this.live`, the registered board host origin (`board://${host}`), and
`event.source === frame.contentWindow`. US-1493's toolbar cases then additionally require the main
view, the current `model.frames.get(BOARD_CDP_TAB)`, and `isBoardPermitted()`. The text case must
follow those checks and accept only the live main frame; a secondary frame must not set the singular
page-toolbar label.

The existing control lifecycle is the pattern to mirror:

- `handleLoad()` retires the old toolbar generation before accepting the new frame's declarations;
- `onDispose()` clears frame-scoped toolbar controls before releasing the iframe;
- `BoardEditorModel.reloadBoard()` increments `reloadToken`, and `BoardEditorView.syncBranch()` uses
  the token in its branch key, causing a fresh `BoardHostView`/`BoardWebview`;
- a busy board may keep its model and jobs alive through navigation, but the main host view is
  disposed and later recreated; it must not retain host-visible toolbar text while absent;
- `BoardEditorModel.dispose()` already clears live dynamic toolbar declarations and must also clear
  `toolbarText`.

The frame-error path is `BoardWebview.handleFrameError()`, which currently rejects pending
capability work and unregisters the capability frame but does not clear board toolbar state. It must
also retire the toolbar text, using the failing frame's generation, so a crashed board cannot leave
stale chrome behind while its path is still valid.

The model's existing `toolbarFrameGeneration` cannot be reused for this text owner. It is assigned by
`setLiveToolbarElementDeclarations()` only after the control catalog publishes its declarations, and
that method's early return at `BoardEditorModel.ts:537` means it is not a text-owner handshake and is
not populated when a board declares only text. Control declarations and text can also arrive in
different orders. Add a parallel `toolbarTextFrameGeneration?: number` field so text ownership is
independent of dynamic control declarations while still using the same numeric frame generation
passed by `BoardWebview`.

## Implementation Plan

1. **Add the public board-to-host text contract.**

   Update `src/ipc/board-bridge-channels.ts`:

   - Add `"board:setToolbarText"` to `BoardToHostMsg.__persephone`.
   - Add an optional `toolbarText?: string` payload field, documented as the transient toolbar text;
     `""` is an explicit clear value and is not a blank display value.
   - Do not add a second message union or route the text through `BoardToolbarSetMsg`; D4 keeps the
     label API separate from the control descriptor array.

   Update `src/board-shim.ts` in the existing `toolbar` namespace beside `set()` and `update()`:

   ```ts
   // Target public API
   setText(text: string): void {
       try {
           window.parent.postMessage(
               {
                   __persephone: "board:setToolbarText",
                   toolbarText: typeof text === "string" ? text : String(text ?? ""),
               },
               hostPostTarget,
           );
       } catch {
           // parent gone
       }
   },
   ```

   Add `setText()` to the existing `toolbar` object, alongside `set`, `update`, and `onAction`.
   Match `setStatusText()`'s `hostPostTarget`, string normalization, and safe-post behavior. Document
   the method as main-view-only, transient, path-fallback text; it is
   meaningful for plain and content-host boards because it targets the page toolbar rather than the
   content-host footer.

   Update `src/shared/board-bridge-version.ts` from `"1.10.0"` to `"1.11.0"`. No main-process
   bridge handler is needed: the existing host-frame `postMessage` path already carries these
   renderer messages.

2. **Own transient toolbar text in `BoardEditorModel`.**

   In `src/renderer/editors/board/BoardEditorModel.ts`:

   - Add `toolbarText?: string` and a parallel `toolbarTextFrameGeneration?: number` owner field to
     `BoardEditorState`, with comments that both are transient and
     cleared on frame lifecycle teardown, restore, and model disposal; it must never enter durable
     restore data.
   - Add `setToolbarTextForFrame(frameGeneration: number, text: string): void` that records the
     owning generation and stores the normalized string, preserving `""` as the explicit clear state
     so the state semantics remain distinguishable from `undefined`.
   - Add `clearToolbarTextForFrame(frameGeneration: number): void` that begins with a generation
     equality guard and clears both the owner field and `toolbarText` only on a match. Do not add or
     call an unscoped clear for live frame teardown; model restore and terminal model disposal may
     clear the field directly because no replacement frame can race those terminal paths.
   - In `getRestoreData()`, add `toolbarText: undefined` alongside `statusText: undefined`.
   - In `restore()`, clear `toolbarText` when it is present, using an `!== undefined` check so an
     old persisted empty value cannot survive either.
   - In `dispose()`, clear `toolbarTextFrameGeneration` and `toolbarText` with the existing live
     toolbar declaration cleanup before `super.dispose()` completes.

   Do not put this value in `sharedState`, `secondaryViewDefs`, `title`, `boardRoot`, or any
   persistence allowlist. No new facade property is needed: the value is page-chrome display state,
   not board data or an agent action.

3. **Receive and retire the text at the board-frame boundary.**

   Update `src/renderer/editors/board/BoardWebview.ts`:

   - Extend the `legacy` payload type with `toolbarText?: string`.
   - Add a `case "board:setToolbarText"` beside the current status-text case. Require the main
     frame, current `BOARD_CDP_TAB` iframe, and permitted board before calling
     `model.setToolbarTextForFrame(this.generation, ...)`; use the existing outer live/origin/source checks and warn through
     `appendLog("warn", ...)` for a rejected non-main/unavailable sender, matching the toolbar
     control cases. A non-string payload must become `""`, consistent with `setStatusText()`.
   - In `handleLoad()`, call `model.clearToolbarTextForFrame(retiredGeneration)` while retiring the
     previous generation, before the new frame can claim text. The generation guard is mandatory:
     if the replacement frame has already claimed its text, the retiring view's clear is ignored.
   - In `onDispose()`, call `model.clearToolbarTextForFrame(retiredGeneration)` before iframe
     teardown. The clear must be main-frame-scoped so a secondary board view cannot erase the page
     toolbar owned by the main view.
   - In `handleFrameError()`, call `model.clearToolbarTextForFrame(this.generation)` for the main
     frame before/alongside capability cleanup; a stale frame's error must not clear a replacement
     frame's text.
   - Keep the current `onToolbarClear`/control-generation behavior intact; the text reset is a
     parallel transient-state cleanup, not a replacement for control disposal.

   The resulting message path should be:

   ```text
   board shim toolbar.setText()
       → window.parent.postMessage(board:setToolbarText, hostPostTarget)
       → BoardWebview.handleMessage() live + origin + source checks
       → main/current-frame/permitted check
       → BoardEditorModel.setToolbarTextForFrame(generation, text)
       → BoardToolbarView state subscription
   ```

4. **Render the override, fallback, and tooltip without changing the shell composition.**

   Update only the text synchronization in `src/renderer/editors/board/BoardToolbar.ts`:

   - Extend the existing state selector from `boardRoot` to `boardRoot` plus `toolbarText`.
   - In `sync()`, choose the displayed string exactly as described above: non-empty override first,
     otherwise `boardRoot ?? ""`.
   - Set `pathText.title` to the full current `boardRoot` on every sync, regardless of whether the
     visible label is an override.
   - Retain `pathText` as the current `HTMLSpanElement`, retain `pathPanel`'s flex/width/overflow
     behavior, and retain `truncate: true`, light color, and `hoverUnderline: false`.
   - Do not add a click listener, popover state, switcher imports, `data-name`, or a new toolbar
     control. Preserve the current `boardControls` insertion point and all published Persephone
     control names.

   The before/after behavior is:

   ```ts
   // Before: the path is always visible in the slot.
   this.pathText.textContent = this.boardRoot ?? "";

   // After: only non-empty board state replaces the path; empty/unset restores it.
   this.pathText.textContent = state.toolbarText || this.boardRoot || "";
   this.pathText.title = this.boardRoot ?? "";
   ```

   The implementation may use explicit `=== ""` / `??` branches instead of the compact expression,
   but must preserve the table's `undefined` versus explicit-empty state semantics.

5. **Update maintained authoring documentation and verify the public contract.**

   Update these files to bridge `1.11.0` and the new API:

   - `assets/guides/agents/boards.md`: document `persephone.toolbar.setText(text)`, main-view
     availability, non-persistence, the empty-string path fallback, the path tooltip when overridden,
     and the reload/navigation/crash lifecycle. Keep the existing control catalog and its dynamic
     `data-name` rules unchanged.
   - `assets/board-template/CLAUDE.md`: update the bridge version and add a concise toolbar-text
     example/contract next to the existing host-rendered toolbar section.
   - `assets/guides/boards.md`: add the user-facing page-toolbar text behavior near the existing
     `setStatusText()` explanation, making clear that this is distinct from the content-host footer
     and that `""` returns to the board path.

   Do not update `doc/active-work.md`; the user owns the dashboard entry. Do not add this label to
   `assets/guides/editors/board.md`'s shell-address table or to `BOARD_ELEMENTS`.

6. **Verify the implemented change.**

   Check the completed change with targeted source searches and normal project validation:

   - `rg` confirms one public `toolbar.setText` API, one `board:setToolbarText` discriminator, and
     bridge version `1.11.0` in source and maintained guides.
   - The message reaches only the current permitted main frame and no secondary frame can overwrite
     the page label.
   - A board that never calls the method displays `boardRoot`; a non-empty call displays that text;
     a subsequent `toolbar.setText("")` displays `boardRoot` again and does not leave an empty slot.
   - Long path and override strings ellipsize through the existing `data-truncate` CSS, while the
     native title contains the full board path in both cases.
   - Reload, frame error, navigate-away/dispose, trust loss through branch replacement, restore, and
     model disposal clear only when the retiring/failing generation still owns the text; an old view
     must not erase text already claimed by a replacement frame, and a newly mounted frame must set
     it again.
   - `BoardEditor.elements` still contains the same static and dynamic action addresses, while no
     `board-toolbar-text` or path-label address is introduced.

## Concerns

- **Status-text precedent is incomplete for this requirement.** `setStatusText()` is the right
  precedent for a transient board-to-host string and restore-data omission, but current source only
  clears stale persisted status state. This task explicitly adds lifecycle clears for toolbar text so
  a reload, navigation-away, frame error, or board disposal cannot leave stale chrome. Every live
  teardown clear is generation-scoped, so an old view cannot erase text already claimed by a newer
  frame.
- **Empty string versus unset.** `undefined` means no call has supplied an override; `""` means the
  board intentionally cleared one. Both resolve to the board path, and neither renders a blank label.
  A non-empty string is the only value that replaces the path. Whitespace is preserved as supplied.
- **Tooltip ownership.** The existing path span truncates but has no tooltip. The new native `title`
  always carries `boardRoot`, including while an override is visible, so the path remains discoverable
  without making the label interactive. No custom tooltip component is justified.
- **Agent addressing.** Dynamic `data-name` addresses belong to actionable US-1493 controls. The
  board-settable text is a plain label, so adding a `BOARD_ELEMENTS` entry would promise an operation
  where none exists and would diverge from the documented shell contract.
- **Secondary frames.** The toolbar is singular and already belongs to the main frame. Secondary
  messages must be ignored; generation-matching main-frame disposal must clear the value, while a
  secondary-frame disposal must not clear main-toolbar state.
- **Current-worktree scope.** US-1492 and US-1493 changes are present in the working
  tree. The implementation must preserve their current `BoardToolbar.ts` composition, control
  lifecycle, bridge `1.10.0` wire pattern, and dynamic element declarations while taking the version
  to `1.11.0`.
- **No unresolved design questions remain.** The API name, message envelope, empty-string behavior,
  path tooltip, no-address decision, main-frame authority, and lifecycle clear points are resolved
  here for implementation.

## Acceptance Criteria

1. `src/board-shim.ts` exposes `persephone.toolbar.setText(text: string)` that
   posts `board:setToolbarText` through the existing `hostPostTarget` path and safely ignores a gone
   parent.
2. `src/ipc/board-bridge-channels.ts` types `board:setToolbarText` and its `toolbarText` payload in
   `BoardToHostMsg`; `src/shared/board-bridge-version.ts` and the maintained board-authoring guides
   report bridge version `1.11.0`.
3. Only a live, permitted main board frame can set the value. Messages from a secondary, stale,
   disposed, wrong-origin, or wrong-source frame do not alter the toolbar label.
4. `BoardEditorModel` owns `toolbarText` and its `toolbarTextFrameGeneration` as transient state.
   It is never persisted, is removed from restore data, and live-frame clears only remove text when
   their generation matches the recorded owner; restore and model disposal clear terminal state.
5. `BoardToolbarView.sync()` decides the visible text: `undefined` and `""` show `boardRoot`, while
   a non-empty string shows the board override. The path panel remains the current flexible,
   truncated slot, and `hoverUnderline` remains false.
6. The slot is still a plain `HTMLSpanElement` with no click behavior, popover, or new `data-name`.
   `BOARD_ELEMENTS` and US-1493's dynamic control declarations remain unchanged.
7. The slot has a native tooltip containing the complete `boardRoot` path even when the board's
   override is visible. Long values still use the existing ellipsis/truncation behavior.
8. Main-frame reload (`BoardWebview.handleLoad()`), frame disposal (`onDispose()`), frame error
   (`handleFrameError()`), navigate-away of a busy board, and trust/branch teardown clear the
   override only when the retiring/failing generation matches `toolbarTextFrameGeneration`; an old
   view cannot erase text already claimed by a replacement frame. Reuse requires the board to call
   the setter again; otherwise the path is shown.
9. `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, and
   `assets/guides/boards.md` describe the API, fallback, tooltip, and lifecycle consistently.

## Files Changed Summary

| File | Change |
|---|---|
| `src/board-shim.ts` | Add `persephone.toolbar.setText(text)` using the existing toolbar parent-posting/safe-post pattern. |
| `src/ipc/board-bridge-channels.ts` | Add the typed `board:setToolbarText` discriminator and `toolbarText` payload. |
| `src/shared/board-bridge-version.ts` | Bump the additive board bridge from `1.10.0` to `1.11.0`. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Add transient `toolbarText` plus parallel generation ownership, generation-guarded frame setter/clearer, restore-data omission, restore cleanup, and disposal cleanup. |
| `src/renderer/editors/board/BoardWebview.ts` | Validate and apply the main-frame text message; clear text on load, frame error, and disposal. |
| `src/renderer/editors/board/BoardToolbar.ts` | Render the transient override or path fallback and set the full-path native tooltip while preserving the plain span and current composition. |
| `assets/guides/agents/boards.md` | Document the API, fallback, tooltip, lifecycle, and bridge `1.11.0`. |
| `assets/board-template/CLAUDE.md` | Keep the template's API and bridge guidance aligned. |
| `assets/guides/boards.md` | Add the user-facing toolbar-text contract beside the existing status-text documentation. |
| `src/renderer/editors/board/BoardEditorView.ts` | No change; `BoardToolbarView` already receives the model and `BoardWebview` can update it directly. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | No change; the path/text label is not an actionable element, and existing static/dynamic toolbar addresses stay intact. |
| `src/renderer/editors/board/BoardToolbarControls.ts` | No change; US-1493 owns the adjacent control catalog and its lifecycle. |
| `src/renderer/editors/board/BoardToolbar.css` | No change; US-1493's board-control separator/layout is unrelated to the text fallback. |
| `src/renderer/uikit/Text/text-style.ts` and `src/renderer/uikit/Text/Text.css` | No change; reuse existing truncation and apply the native `title` directly to the span. |
| `src/renderer/editors/board/board-api.d.ts` | No required change; this legacy IntelliSense snapshot is not the maintained contract gate, matching US-1493. |
| `assets/guides/editors/board.md` | No change; it documents the published actionable shell addresses, and this non-interactive label gets no address. |
| `doc/active-work.md` | No change; dashboard ownership remains outside this task document. |
| `src/main/board-bridge.ts`, `src/main/board-protocol-service.ts`, build scripts, and tests/new harness | No change expected; the existing renderer host-frame path carries the additive message, and normal project validation is sufficient when implementation is authorized. |
