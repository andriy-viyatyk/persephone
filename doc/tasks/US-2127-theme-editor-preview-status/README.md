# US-2127: Theme Editor: `previewStatus.pending` never settles

Epic: [EPIC-200](../../epics/EPIC-200.md) (Theme Editor)

## Goal

Make the Theme Editor model's `previewStatus.pending` return to `false` after a scheduled draft refresh finishes, and document the failure behavior of `revert()` when its saved custom source has been deleted.

## Background

The work is in the separate `persephone-boards` checkout on `develop`. The checkout was clean when investigated (`git status --short --branch` reported `develop...origin/develop`, and `git diff -- boards/theme-editor` was empty). The board is currently version `1.2.1` (`boards/theme-editor/board-manifest.json:7`), with `## 1.2.1` at the top of `boards/theme-editor/WHATS-NEW.md:3`. No earlier EPIC-200 change is pending in the checkout. Per the epic's version decision, this board should receive one patch bump for the epic's shipped changes: use `1.2.2` and one `## 1.2.2` heading, adding later EPIC-200 Theme Editor lines under that heading if another task has already created it by implementation time. Never hand-edit `boards-manifest.json` or `versions-manifest.json`.

In `boards/theme-editor/app.js`, state initializes `previewTimer` to `0` (`:76`). `queueDraftRefresh()` cancels a prior timer (`:1265-1271`), assigns a new timeout (`:1283`), then the callback updates `lastRefreshAt` and runs the serialized refresh (`:1284-1312`). The callback's `finally` clears `previewResolve` when it still owns that resolver and resolves the request (`:1308-1310`), but it does not clear `previewTimer`. The model calculates `pending` as `!!state.previewTimer || !!state.previewResolve || state.busy` (`:1667`), so the expired timeout's nonzero id keeps `pending` true. There is also a stale-id path before the callback: `queueDraftRefresh()` clears the current timer (`:1267`) and can return for an invalid draft (`:1273-1278`) without assigning another timer. The id is also read by `flushPendingPreview()` (`:1315-1319`), canceled by `loadSourceCore()` (`:1071-1082`), and canceled at page unload (`:1774-1778`).

The test already encodes the desired completion condition. `waitForPreview()` in `integration-test/tests/published-boards/theme-editor/theme-editor.test.mjs:29-39` waits until `value?.pending === false`; the "opens and derives a draft from base colors" case calls it at `:137`. The published-board registration helper copies the board from the boards checkout: `integration-test/tests/helpers/published-boards.mjs:6-10,17-18,49-54`; `integration-test/tests/published-boards/helpers.mjs:46-50` opens that registered copy. Once the timer callback clears its id, the existing resolver cleanup and idle state let this exact predicate succeed. Keep the assertion unchanged.

`revertDraftCore()` looks up a custom source using `persephone.themes.file(state.sourceId)` and throws `This saved theme was removed. Choose another starting theme.` if that lookup returns no file (`boards/theme-editor/app.js:1362-1372`). The `app.js` UI wrapper catches and reports the error (`:1400-1402`), while the exposed model method calls `revertDraftCore()` directly (`:1673`), so model callers receive a rejected call. The model's ai-vision `overview` and help text currently say that revert discards or restores the saved source without documenting this removed-source error (`:1591-1598`); its `revert` member summary also omits it (`:1624`). The board's `CLAUDE.md` explains normal Revert behavior in its save/preview section but does not mention the deleted-source case.

Invalid `setBaseColor()` values do not reach the invalid-draft early return: `mutateBaseColor()` throws on an unparseable CSS color before calling `onDraftChanged()` (`app.js:888-901`), and the model calls `queueDraftRefresh()` only after `mutateBaseColor()` returns (`:1668`). In contrast, the Details UI input path permits an invalid override via `mutateOverride(..., { allowInvalid: true })` and calls `onDraftChanged()` (`:903-906,908-920`); `queueDraftRefresh()` then reaches its invalid-draft early return (`:1273-1278`).

## Implementation Plan

1. In `C:/projects/persephone-boards/boards/theme-editor/app.js`, clear `state.previewTimer` immediately after every `clearTimeout(state.previewTimer)`: in `queueDraftRefresh()` (`:1267`), `loadSourceCore()` (`:1077`), and the unload handler (`:1776`). This prevents a cancelled timer id from keeping `previewStatus.pending` true, including when `queueDraftRefresh()` returns early for an invalid draft without scheduling a replacement. In the timeout callback, clear the id only if it still owns the field: capture the returned timeout id in a local variable and compare it with `state.previewTimer`. This protects a newer timer from being cleared if an older callback has already been queued. Preserve the other reads and writes: initialization (`:76`), flush condition (`:1317`), `previewStatus.pending` (`:1667`). The field should be nonzero only while a scheduled callback has not fired.

   Before (`queueDraftRefresh()`, around `:1267`):

   ```js
   clearTimeout(state.previewTimer);
   if (state.previewResolve) {
       state.previewResolve();
       state.previewResolve = null;
   }
   ```

   After:

   ```js
   clearTimeout(state.previewTimer);
   state.previewTimer = 0;
   if (state.previewResolve) {
       state.previewResolve();
       state.previewResolve = null;
   }
   ```

   Before (`loadSourceCore()`, around `:1077`):

   ```js
   clearTimeout(state.previewTimer);
   if (state.previewResolve) {
   ```

   After:

   ```js
   clearTimeout(state.previewTimer);
   state.previewTimer = 0;
   if (state.previewResolve) {
   ```

   Before:

   ```js
   state.previewTimer = setTimeout(async () => {
       state.lastRefreshAt = Date.now();
       state.previewChain = state.previewChain.then(async () => {
   ```

   After:

   ```js
   let timerId;
   timerId = setTimeout(async () => {
       if (state.previewTimer === timerId) state.previewTimer = 0;
       state.lastRefreshAt = Date.now();
       state.previewChain = state.previewChain.then(async () => {
           // existing serialized refresh work
       });
   }, delay);
   state.previewTimer = timerId;
   ```

   Keep the existing serialized refresh body in place. The callback cannot run until the current JavaScript stack yields, so `timerId` and `state.previewTimer` are assigned before the ownership comparison. This prevents an old callback from clearing a newer timer's id.

2. In the inline ai-vision model in `app.js`, update the model overview/help and the `revert` member summary (`:1591-1598,1624`) to state that reverting a custom draft whose saved source was deleted rejects with `This saved theme was removed. Choose another starting theme.` Preserve the existing description of successful revert behavior. This is the board's ai-vision model; the checkout has no separate ai-vision model file.

   Before:

   ```js
   "Changes preview live; there is no separate apply step. Revert restores the saved theme.",
   // ...
   { name: "revert", kind: "method", signature: "revert()", summary: "Discard draft edits, restore the saved source, and end this board's live preview only if it still owns it." , caution: "Discards the current draft immediately." },
   ```

   After (wording may be integrated into the existing help/member text):

   ```js
   "Changes preview live; there is no separate apply step. Revert restores the saved theme. If a saved custom source was deleted, revert rejects with `This saved theme was removed. Choose another starting theme.`",
   // ...
   { name: "revert", kind: "method", signature: "revert()", summary: "Discard draft edits and restore the saved source; rejects with `This saved theme was removed. Choose another starting theme.` if that custom source was deleted.", caution: "Discards the current draft immediately." },
   ```

3. In `C:/projects/persephone-boards/boards/theme-editor/CLAUDE.md`, update the saved-theme/Revert documentation to explain that Revert throws `This saved theme was removed. Choose another starting theme.` after its selected saved custom theme has been deleted. The precise insertion point is the existing Revert/save behavior paragraph in the Rules section.

4. For this board's one EPIC-200 release bump, change `version` in `C:/projects/persephone-boards/boards/theme-editor/board-manifest.json` from `1.2.1` to `1.2.2`, and add a single `## 1.2.2` heading with concise changelog lines to `C:/projects/persephone-boards/boards/theme-editor/WHATS-NEW.md`. If another EPIC-200 Theme Editor task has already added that heading on `develop`, add this task's changelog line under it without another bump. Do not modify generated catalog/version manifests.

5. Keep `C:/projects/persephone/integration-test/tests/published-boards/theme-editor/theme-editor.test.mjs` unchanged for this fix. Its existing `waitForPreview()` predicate is the regression assertion: `value?.pending === false` (`:38`), called by the draft derivation test (`:137`); that test covers valid edits, not the invalid-draft early return. Do not add a model-call assertion for invalid `setBaseColor()`: `mutateBaseColor()` throws before `queueDraftRefresh()` is called, so it does not exercise the stale cancelled id or early-return path. The Details override UI can reach that early return, but the requested conditional for a model-path assertion does not apply. The timer-id resets make `pending` false after cancellation/invalid early return; after a scheduled refresh completes, `previewResolve` is cleared in the existing `finally` (`app.js:1308-1310`) and no busy operation remains. Run the existing published-board integration test after implementation using the repository's documented web-app test host in `C:/projects/persephone/assets/guides/agents/web-app-tests.md`; do not weaken or replace the assertion.

## Concerns

- The timer callback must clear the field immediately when it fires, including when bridge refresh work is still queued or running; otherwise `previewStatus.pending` reports a scheduled timer for work that has already started.
- Revert's deleted-source behavior is already implemented; this task only makes it discoverable in the model documentation and board author notes.
- Version handling must account for a possible intervening EPIC-200 task on `develop`: one board patch bump and one changelog heading for all shipped changes in the epic.

## Acceptance Criteria

- `previewStatus.pending` can become `false` after a valid queued preview refresh finishes; the timer id is cleared when its callback fires.
- After an invalid draft edit reaches `queueDraftRefresh()`'s invalid-draft early return, `previewStatus.pending` is `false`; invalid CSS passed to model `setBaseColor()` rejects before reaching that path, while the Details override UI can reach it.
- All existing `previewTimer` cancellation and read sites retain their intended behavior.
- The ai-vision model help/summary and the board `CLAUDE.md` explain the rejected `revert()` result after the custom source theme has been deleted, including its error text.
- The existing Theme Editor published-board test continues to assert `pending === false` and passes after the fix; no assertion is weakened and no test-file change is needed.
- The board has one EPIC-200 patch version bump and a matching `WHATS-NEW.md` heading; generated manifests are left to the publish tooling.

## Files Changed

| File | Planned change |
|---|---|
| `C:/projects/persephone-boards/boards/theme-editor/app.js` | Clear the fired preview timer id; document deleted-source `revert()` behavior in inline ai-vision help/summary. |
| `C:/projects/persephone-boards/boards/theme-editor/CLAUDE.md` | Document deleted-source Revert behavior. |
| `C:/projects/persephone-boards/boards/theme-editor/board-manifest.json` | One patch version bump for the epic, unless an earlier EPIC-200 task already made it. |
| `C:/projects/persephone-boards/boards/theme-editor/WHATS-NEW.md` | Matching epic version heading and concise change entries. |
| `C:/projects/persephone/integration-test/tests/published-boards/theme-editor/theme-editor.test.mjs` | **No change.** Existing assertion at `:38` covers valid-refresh completion, not invalid drafts. Model `setBaseColor()` rejects invalid CSS before reaching the queue early return, so the conditional for adding a model-path assertion does not apply. |
| `C:/projects/persephone/integration-test/tests/helpers/published-boards.mjs` | **No change.** `registerPublishedBoard()` copies the checkout board into the test fixture. |
| `C:/projects/persephone-boards/boards/theme-editor/versions-manifest.json` | **No change.** Generated by publishing; never hand-edit. |
| `C:/projects/persephone-boards/boards-manifest.json` | **No change.** Generated by publishing; never hand-edit. |
