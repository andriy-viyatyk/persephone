# US-1641: Unsaved changes for plain board pages

## Goal

Let a board without `editorKind: "content-host"` (simple or stream-host) report whether it has unsaved work and register a save handler. Persephone will show the existing modified-tab indicator and protect that work with the standard Save / Don't Save / Cancel flow when the page is closed, navigated away from, or reloaded. Window/app close does not prompt; the board persists its own non-file draft. The first consumer is the simple Theme Editor board (persephone-boards BT-036); Save persists the custom theme and applies it.

## Background

### Existing modified-state and release flow

- `src/renderer/editors/base/EditorModel.ts`: `EditorStateBase.modified` and `EditorModel.modified` (getter) are the common state contract. `confirmRelease(_closing?)` defaults to `true`; text-bearing editors override it.
- `src/renderer/api/pages/PageModel.ts`: `PageModel.modified` aggregates `editors[].modified`; `PageModel.close()` checks modified panel editors and then the main editor, calling `confirmRelease()`. Returning false leaves the page attached. `PageModel.getDescriptor()` persists the modified bit for the session/window state summary, but restore does not reconstruct a live board frame's callback.
- `src/renderer/ui/tabs/PageTabView.ts` projects the current editor's `modified` field to `data-modified`; `src/renderer/ui/tabs/PageTab.css` displays the dot for `[data-modified]`. A board editor modified getter therefore feeds the existing tab dot without tab UI changes.
- `src/renderer/editors/text/TextFileActionsModel.ts`: `confirmRelease()` uses `ui.confirm(..., { title: "Unsaved Changes", buttons: ["Save", "Don't Save", "Cancel"] })`; Save returns the actual `saveFile()` result, Don't Save returns true, and Cancel returns false. `TextFileModel.confirmRelease()` delegates to this action. `src/renderer/editors/board/BoardContentEditorModel.ts` delegates dirty state and `confirmRelease()` to its composed content host, which is why content-host boards already participate in this protocol.
- `src/renderer/api/pages/PageNavigator.ts`: `navigatePageTo()` first calls `confirmLeaveCurrentEditor()`, which calls the old editor's unwrapped `confirmRelease()` unless that editor survives navigation. Editor switches are exposed by `PageModel.switchMainEditor()` and `src/renderer/scripting/ai-vision/page-editor-switches.ts`; page navigation and editor switching both need the release guard. `BoardEditorModel.survivesNavigation()` is currently true only while busy; content-host boards override it to false.
- `src/renderer/api/pages/PagesLifecycleModel.ts`: `closePage`, `closeToTheRight`, and `closeOtherPages` use `PageModel.close()`. Pinned pages are excluded from bulk-close paths (for example, `closeOtherPages`); direct close still follows the page close policy. `PageModel.close()` also removes the page after successful release, so it is specific to tab-close flows. Do not persist a board's runtime callback or dirty bit as a substitute for a live bridge registration.

### Window close and restore

- `src/renderer/api/internal/RendererEventsService.ts` handles `eBeforeQuit` by stopping/cancelling a recording, saving page state, and calling `signalReadyToQuit()`; it does not prompt for unsaved changes. Text pages follow the same convention: their unsaved content is kept by the autosave cache and session restore. Plain boards must not introduce a window/app-close prompt.
- This is a deliberate decision: on window/app close, persisting non-file work is the board's responsibility. BT-036 will store its unsaved Theme Editor draft in board-local storage and re-report `modified` when the restored board frame recovers that draft. This keeps window close consistent with text pages and avoids adding a main-process close-cancel handshake.
- `src/renderer/api/pages/PagesPersistenceModel.ts:restorePage()` rebuilds board editors and frames from descriptors. A restored board page starts clean until its new main frame reports modified. The restored board may then re-report dirty state after recovering its board-local draft; runtime bridge callbacks themselves are not restored.

### Board bridge and lifecycle

- `src/board-shim.ts` builds the public `window.persephone` object. There is no existing `persephone.page` property or namespace. `persephone.page` is a suitable home for this API because it describes this board frame's own hosted page and keeps lifecycle state page-scoped. Existing event registration patterns include `persephone.onThemeChange(cb)` and `persephone.host.onContentChange(cb)`, both returning unsubscribe functions; `host.setContent()` posts `board:setContent`, while `host.save()` posts `board:save`. `host` is reserved for content/stream-host operations and its content methods reject on plain boards, so the new generic dirty-state API should not be placed under `host`.
- `src/renderer/editors/board/BoardWebview.ts` owns the main and secondary iframe instances, message routing, and the frame generation. `src/renderer/editors/board/BoardEditorModel.ts` owns the editor-level `modified` state and reload methods. `reloadBoard()` and `reloadAndWait()` currently bump `reloadToken` directly; the toolbar action and the MCP/script facade both reach these paths, so put the release guard at the model/reload entry point rather than only in the toolbar.
- Board state must be page-level and sourced from the **main frame only**. Secondary views are additional `board://` frames sharing the same `BoardEditorModel`; allowing every frame to report dirty state or register competing save handlers would make prompt ownership ambiguous. Ignore/reject dirty/save registrations from secondary frames.
- Verified US-1639 cleanup path: `BoardWebview.onDispose()` and the subsequent main-frame `load` call `endOwnedThemePreview()`. It takes the board's preview generation and ends the preview only if it still owns the current generation. The board reload's remount unloads/disposes the old main `BoardWebview`, so Don't Save on reload/close will still execute this cleanup. Preserve this teardown ordering.
- `src/shared/board-bridge-version.ts` declares `BOARD_BRIDGE_VERSION = "1.35.0"`. EPIC-123 treats 1.35.0 as unreleased and already bumped for US-1639; ship this API under 1.35.0 and do not bump it again.
- No new manifest permission is needed: dirty state and save callbacks only affect the board's own page lifecycle. They grant no file access, cross-page access, or app-wide control. The Theme Editor still separately requires the existing `themes: true` permission to use `persephone.themes.*`.

### Script and agent surfaces

- `src/renderer/scripting/api-wrapper/PageWrapper.ts` already exposes `pages[i].modified`, and `PageCollectionWrapper.ts` includes it in page summaries. `pages[i].editor` is a typed editor facade; `BoardEditorFacade` currently describes board metadata, busy state, frame controls, and `reload()`, not generic page dirtiness. Prefer the existing `pages[i].modified` property; do not add a duplicate editor-level `modified` property unless implementation reveals a concrete facade need.
- `assets/guides/agents/boards.md` documents `pages[i].editor.reload()` as the board iteration path. It needs to say reload can prompt, cancellation/rejection behavior, and recommend the board's `pages[i].modified` status for inspection.
- The canonical user guide is `assets/guides/boards.md`; the board authoring template is `assets/board-template/CLAUDE.md`. Update both with the plain-board API and contrast it with content-host file saving.
- No new `src/renderer/scripting/ai-vision` page facade appears necessary because `src/renderer/scripting/api-wrapper/PageWrapper.ts` already exposes modified state and its AiVision descriptor; update that descriptor/help only if needed for discoverability.

## Implementation Plan

1. **Define the smallest board API and its types only in `src/board-shim.ts`**; document the public contract in prose guides.
   - Add `persephone.page.setModified(modified: boolean)` (or an equally page-scoped name) for the current main board frame, idempotently reporting state to its own `BoardEditorModel`.
   - Add `persephone.onSaveRequest(handler: () => void | boolean | Promise<void | boolean>): () => void`. Registration returns an unsubscribe, consistent with existing `on*` APIs. Save succeeds when the current handler resolves without returning `false`; rejection or `false` is shown through the existing app error notification/log path and keeps the page open. A missing handler on a dirty page is an error, not implicit success. After success Persephone clears its page dirty state, matching the existing text-file save flow; the board may also clear it after its own manual save.
   - If multiple handlers are registered by the same main frame, define the latest active registration as authoritative and make unsubscribe generation-safe; secondary frames cannot register. The board may clear dirty state after a manual save; the guarded release path clears it centrally after the handler reports success.

   Before:

   ```js
   persephone.themes.preview(draft);
   ```

   After (Theme Editor board):

   ```js
   persephone.page.setModified(true);
   persephone.onSaveRequest(async () => {
     const saved = await persephone.themes.save(draft);
     await persephone.themes.apply(saved.id);
   });
   ```

2. **Connect bridge messages to board state** in `src/renderer/editors/board/BoardWebview.ts` and `src/renderer/editors/board/BoardEditorModel.ts`. Bind registrations and pending save requests to `boardId` plus frame generation, reject stale replies after reload/dispose, and expose a board `confirmRelease(closing?)` override that uses the standard dialog wording/button order. Save invokes the registered callback and resolves true only on success; false/rejection/timeout returns false and displays an error. Don't Save resolves true and lets normal disposal/remount happen; Cancel resolves false. Keep content-host behavior delegated to its host.

3. **Guard reload at the editor model** in `BoardEditorModel.reloadBoard()` / `reloadAndWait()`, covering the toolbar (`BoardToolbar.ts`), the public facade (`BoardEditorFacade.reload()` / `BoardTargetModel.reload()`), and MCP `pages[i].editor.reload()`. User-triggered reload must prompt when dirty. Agent-driven reload uses the same prompt. Add the descriptor caution `unsaved changes prompt the user`, matching `pages.closePage`, because reload can discard a board draft. A `ui.confirm()` does not hold the MCP transport call open: `resolveWithAttention()` returns `{ path, pending: true, attention }` after the dialog remains open for the 250 ms grace period, while the underlying reload action continues. The agent can answer the confirmation in a concurrent call with `dialogs[0].click("Save")`, `dialogs[0].click("Don't Save")`, or `dialogs[0].click("Cancel")`. Direct facade callers receive the eventual result; extend `IBoardReloadResult` in `src/renderer/api/types/board-editor.d.ts` so choosing Cancel returns `{ refreshed: false, cancelled: true, pageId, frameReady, renderState }`, where `frameReady` reflects the still-mounted frame. A regular MCP `call` has no retained result handle after its pending response, so after answering the dialog the agent should inspect the page/frame state rather than replay reload automatically. Save failure rejects with a readable error and does not remount. Preserve the existing wait-for-frame-ready behavior after approval.

4. **Handle frame loss and timeouts** in `BoardWebview` / `BoardEditorModel`. Use a 30-second timeout, matching the existing built-in board remote-call fallback in `src/shared/ai-vision-timeout.ts`; a never-settling save handler fails closed, keeps the page open, and reports that the board did not finish saving. On explicit Don't Save followed by teardown/reload, clear the old frame's dirty bit as its generation is retired. On unexpected frame crash, retain dirty state so it is not silently discarded; a Save attempt without a live handler fails with an actionable error, while Don't Save remains available. A new frame may explicitly restore/clear dirty state after recovering its draft.

5. **Keep persistence and pinning coherent** in `src/renderer/api/pages/PageModel.ts`, `PagesLifecycleModel.ts`, and `PagesPersistenceModel.ts`: runtime dirty state is not restored from a stale descriptor; pinned pages retain existing bulk-close exclusion; direct tab close still prompts; session restore registers fresh handlers only after the main board frame handshakes. Only the main board frame counts for a page, regardless of how many secondary frames exist. Do not add release confirmation to the window/app close path.

6. **Update public documentation and board consumer**:
   - `assets/guides/boards.md`: API table/reference, example, prompt behavior, permissions rationale, and 1.35.0 version note.
   - `assets/guides/agents/boards.md`: API, `pages[i].modified`, reload prompt and error behavior.
   - `assets/board-template/CLAUDE.md`: authoring API and registration/cleanup pattern.
   - `persephone-boards` BT-036 Theme Editor: mark modified on unsaved edits; Save saves and applies the custom theme, then clears modified; reload/close uses that handler.
   - Keep `src/renderer/scripting/api-wrapper/PageWrapper.ts` and `PageWrapper` AiVision page members on existing `pages[i].modified`; adjust help text only if necessary. Do not add a separate `pages[i].editor.modified`.

7. **Verify behavior live over MCP with Claude**: dirty indicator; tab close/reload/navigation/editor switch; Save success, Save rejection/false, missing or timed-out handler; Don't Save and Cancel; pinned/bulk close; session restore and board-local draft recovery; main versus secondary frames; board crash; MCP pending dialog response and cancellation; and US-1639 preview cleanup on accepted teardown. There are no unit tests or test harnesses; behavior checks are done live over MCP by Claude.

### Before → after contract

| Flow | Before | After |
|------|--------|-------|
| Plain board modified state | `BoardEditorModel` default `modified: false`; board cannot report a dirty state | Main frame calls `persephone.page.setModified(true/false)`; existing tab dot and page summaries reflect it |
| Dirty page close/navigation | No board prompt because plain board stays clean | Standard Save / Don't Save / Cancel; Save awaits board handler; failed Save or Cancel keeps page open |
| Board reload | Toolbar and facade remount frames directly | Same release guard runs before both user and MCP/script reload |
| Window/app close | `eBeforeQuit` saves session state without prompting | Board persists its own draft and re-reports modified after restore |

## Concerns / Open questions

- Window/app close deliberately does not ask the board to save. This matches text pages' autosave-cache/session-restore convention and avoids a main-process close-cancel handshake; BT-036 must persist and recover its own draft.
- The MCP `call` for reload returns a pending attention result when its confirmation stays open beyond the dialog grace period. The action continues and can be answered concurrently through `dialogs[0].click(...)`; a regular MCP `call` does not expose a later result handle.
- Preserve dirty state after an unexpected frame crash. There is no live callback to Save until the frame is recovered; the Save button must fail visibly and keep the page open, rather than silently treating a missing handler as success.
- Secondary views share the model and can display the same board state, but only the main frame should own dirty state and Save registration. This keeps prompt behavior deterministic.
- Theme save/apply must be atomic from the board's dirty-state perspective: clear dirty only after both required operations resolve successfully. If persistence succeeds but apply fails, report the error and leave the page dirty so the user can retry.
- Agent-driven reload intentionally prompts. The agent should inspect `pages[i].modified` and handle cancellation or save errors; it must not bypass the user's unsaved board work.

## Acceptance Criteria

- A board without a content host can report clean/dirty state; a dirty tab displays the standard unsaved dot and clears it after a successful Save, when the board reports clean after a manual save, or when its work is explicitly discarded.
- Closing a dirty board tab, navigating/switching the page away, or reloading from toolbar or `pages[i].editor.reload()` shows the standard Save / Don't Save / Cancel choices.
- Save awaits the main frame's registered handler. Resolve success proceeds; false, rejection, absent handler, crash, or timeout keeps the page open and surfaces a readable error. Don't Save proceeds and tears down the frame; Cancel aborts. Cancelled facade reload returns `{ refreshed: false, cancelled: true, pageId, frameReady, renderState }`, with `frameReady` reflecting the current frame.
- Window/app close does not prompt. The Theme Editor persists its own unsaved draft in board-local storage and re-reports modified after restore; `eBeforeQuit` continues to save page/session state without a board release prompt.
- Pinned pages keep their existing bulk-close behavior; direct close still prompts. Restored pages have no stale handler/dirty runtime state, and secondary frames cannot create competing registrations.
- Accepted board teardown/reload still executes US-1639 preview cleanup through `BoardWebview.endOwnedThemePreview()`.
- Theme Editor BT-036 saves and applies the custom theme through the Save handler and clears dirty state only after successful completion.
- The API ships as board bridge **1.35.0**; `BOARD_BRIDGE_VERSION` receives no additional bump for this task. No manifest permission is added.
- The three board guides/template and scripting help accurately describe the API, dirty state, and reload behavior.

## Task-document files produced

| File | Change |
|------|--------|
| `doc/tasks/US-1641-board-unsaved-changes/README.md` | This investigation and implementation contract |
| `doc/epics/EPIC-123.md` | Add US-1641 task row and scope section |
| `doc/active-work.md` | Add linked task beneath EPIC-123 |

### Planned implementation files

| File | Planned change |
|------|----------------|
| `src/board-shim.ts` | Public dirty-state and save-request bridge API and types |
| `src/renderer/editors/board/BoardWebview.ts`, `BoardEditorModel.ts`, `BoardContentEditorModel.ts`, `BoardToolbar.ts`, `BoardTargetModel.ts` | Main-frame message routing, modified/release behavior, guarded reload, frame-generation cleanup |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`, `src/renderer/api/types/board-editor.d.ts` | Add reload caution and explicit cancelled reload result shape |
| `src/renderer/api/pages/PageModel.ts`, `PagesLifecycleModel.ts`, `PageNavigator.ts`, `PagesPersistenceModel.ts` | Tab release, navigation, editor switch, and restored-board integration; preserve no-prompt window close |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` (only if help needs adjustment) | Retain/use existing page `modified` property; no duplicate editor dirty property |
| `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md` | Public and authoring reference updates |
| `persephone-boards` Theme Editor BT-036 | Register Save handler and report/clear dirty state after save+apply |

### Files verified as no-change candidates

| File | Reason |
|------|--------|
| `src/shared/board-bridge-version.ts` | Already declares 1.35.0; this unreleased epic version absorbs the API |
| `src/renderer/ui/tabs/PageTabView.ts`, `src/renderer/ui/tabs/PageTab.css` | Existing editor `modified` projection already renders the dot |
| `src/renderer/editors/text/TextFileActionsModel.ts` | Existing standard prompt and Save/Don't Save/Cancel behavior is the pattern to reuse |
| `src/renderer/editors/board/BoardContentEditorModel.ts` | Existing content-host dirty/save delegation should remain unchanged; revisit only if base-class routing requires it |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` page member contract | `pages[i].modified` already exists; no new page-level surface required |

## Files Changed Summary

| File | Change |
|------|--------|
| `doc/tasks/US-1641-board-unsaved-changes/README.md` | Add the verified investigation, design recommendations, implementation plan, concerns, and acceptance criteria |
| `doc/epics/EPIC-123.md` | Link US-1641 and record its scope/version contract |
| `doc/active-work.md` | Add the linked US-1641 entry under EPIC-123 |

## Implementation progress

- [x] Add `persephone.page.setModified()` and `persephone.onSaveRequest()` to the board shim.
- [x] Route main-frame dirty reports and save callbacks through generation-bound board messages.
- [x] Reuse the standard release prompt for page close, navigation/editor switching, and reload.
- [x] Guard toolbar and facade reloads; report facade cancellation and reject failed saves.
- [x] Keep runtime dirty state and save callbacks out of restored descriptors; preserve crash dirty state.
- [x] Document the API and release behavior in the in-repo user, agent, and board-template guides.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod` successfully.
- [ ] Verify live prompt and lifecycle behavior over MCP.
- [ ] Update Theme Editor BT-036 in `C:/projects/persephone-boards` (explicitly out of scope for this task).

## Live verification (2026-10-09, by Claude over MCP, scratch board in the session scratchpad)

- `persephone.page.setModified(true)` → `pages[id].modified === true` and the tab gets `data-modified` (unsaved dot).
- Tab close (`pages.closePage`) on a dirty board shows **Unsaved Changes** with Save / Don't Save / Cancel.
- Save with a handler that throws → error toast with the board's message; close returns `false`; page stays open and dirty.
- Save with a handler that returns `false` → "The board reported that saving failed."; page stays open and dirty.
- Save with a handler that resolves → reload proceeds and the page is clean.
- Don't Save → page closes (`true`).
- `pages[id].editor.reload()` on a dirty board → MCP returns "Pending: the action is waiting on a dialog"; the agent answers with `dialogs[0].click(...)`. Cancel left the frame untouched (its in-memory state survived).
- Not verified live: the 30-second handler timeout, navigation/editor-switch prompt, and US-1639 preview cleanup on Don't Save (checked with the Theme Editor in BT-036).

### Fixes made during verification (by Claude)

- **Save handler lost on every load.** A board registers `onSaveRequest` while its script runs, but `BoardWebview.handleLoad` retires the previous generation afterwards and cleared that registration, so Save always failed with "The board has no active Save handler". `handleLoad` now posts `board:saveHandlerSync` to the main frame, and the shim re-announces its active registration under the current generation (`BoardSaveHandlerSyncMsg` in `src/ipc/board-bridge-channels.ts`).
- A handler returning `false` reported "The board did not finish saving." (timeout wording); it now reports "The board reported that saving failed."

### Added during BT-036 verification: `persephone.onDiscardRequest(handler)`

A board that keeps an unsaved draft in `pageState` for app restarts had no way to know the user chose **Don't Save**, so the reloaded board restored the discarded draft. Don't Save now sends `board:saveRequest` with `discard: true` (3-second budget, best effort) before teardown; the shim runs the handlers registered with `persephone.onDiscardRequest(handler)` (returns an unsubscribe) and replies. Requires an `onSaveRequest` registration (the host only learns about a board's save support through it). Verified live with the Theme Editor: Don't Save → theme reverted, board clean after reload.
