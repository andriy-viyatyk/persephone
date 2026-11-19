# US-2128: Audio Player playlist `next()`, light-mode model, `previous()`

## Status

**Status:** Planned  
**Priority:** High  
**Epic:** [EPIC-200](../../epics/EPIC-200.md)  
**Started:** 2026-11-19

## Goal

Make Audio Player model navigation preserve the queue the user is already playing, expose a model `previous()` method that follows the UI Previous control, and clearly document that plain audio files opened directly do not expose `editor.app` in light mode.

## Background

The board source is `C:\projects\persephone-boards`, branch `develop`. The repository guide requires board changes on `develop`, a matching `WHATS-NEW.md` heading and `board-manifest.json` version, and prohibits hand-editing `boards-manifest.json` or any `versions-manifest.json` (`C:\projects\persephone-boards\CLAUDE.md`, "Branches", "Releasing a board version", and "Rules"). The board checkout was clean when investigated (`git status --short --branch` reported `develop...origin/develop`; `git diff -- boards/audio-player` was empty). Its manifest is at version `1.0.5` (`boards/audio-player/board-manifest.json:7`), with `1.0.5` as the newest changelog heading (`boards/audio-player/WHATS-NEW.md:3`). Therefore this board needs one `1.0.6` patch bump for this epic, unless an earlier EPIC-200 task has made that bump by the time implementation begins; in that case add this task's line under the existing heading without another bump.

The published model's `next()` advances `ctx.queue` and then calls `ctx.play(item)` (`boards/audio-player/ai-vision.js:222`). `app.js` supplies `playModelItem` as `ctx.play` (`boards/audio-player/app.js:309-312`). For a queue item already present in the catalog, `playModelItem` replaces the active catalog queue with all catalog links and switches to catalog mode (`app.js:122-128`); for an item not in the catalog, such as an imported M3U entry, it calls `queue.enqueue(null, item.href)`, replacing the source queue with a one-item queue (`app.js:129-130`). The UI Next button instead calls `changeTrack(queue.next())` directly (`app.js:340`). That is why model `next()` loses the imported playlist and why UI Previous cannot return to its first entry.

The source queue already implements `next()` and `previous()` against the active queue (`boards/audio-player/source-queue.js:80-82`). The model should use those methods, then play the selected item through the same `changeTrack(item)` path used by the UI. Keep `play(trackIdOrHref)` on its existing intentional selection behavior, which may select a catalog track or enqueue a standalone href.

`app.js` determines light mode when a plain source URL is neither a catalog nor a playlist (`app.js:284-289`). It creates and exposes the AiVision model only inside `if (!light)` (`app.js:309-317`), so directly opened audio files have no `editor.app`. The current model description reads localized `aiVision.summary`, `aiVision.overview`, and `aiVision.help` values (`ai-vision.js:163-167`); the English values are in `lang/en.json:132-134`, and all 18 language packs have model summary/help text. Update the summary and help (and each locale's overview where present) so the availability boundary is visible in `$help` and the summary in every shipped language.

The existing regression is `integration-test/tests/published-boards/audio-player/audio-player.test.mjs:153-202`, test "imports an M3U queue and moves between its WAV entries". It already checks two imported WAVs, advances with `app.next()`, then uses `[data-name="previous-track"]` and asserts a return to the first path. Preserve every current assertion, add an `app.previous()` round-trip, and retain the UI Previous-button step as a separate coverage of the control. The test helper registers a copied board checkout before opening it (`integration-test/tests/published-boards/helpers.mjs:13-39`; copy logic is in `integration-test/tests/helpers/published-boards.mjs:6-9,12-56`). The web-app test host and supported test context are described in `assets/guides/agents/web-app-tests.md`.

## Implementation Plan

1. In `C:\projects\persephone-boards\boards\audio-player\ai-vision.js`, update the `next()` descriptor summary (currently line 190) to say it moves within the current queue like the UI Next button and does not replace that queue. Add a `previous()` descriptor beside it and add its implementation alongside `next()` (currently line 222). Describe `previous()` as returning `{moved: false, reason: "start-of-queue"}` at the first item without restarting the current track. The UI `#previous` handler calls `changeTrack(queue.previous())` (`app.js:340`), and `source-queue.js:81` returns `null` when the cursor is at index 0; it does not restart the current item. Both model navigation methods must advance or retreat the active `ctx.queue` and call a callback wired to `changeTrack(item)`; do not route either method through `playModelItem`. Preserve the no-item result shape for `next()`; include current playback data in the `previous()` result only if needed to match established board conventions.

   **Before** (current descriptor summaries):

   ```js
   { name: "next", kind: "method", signature: "next()", summary: "Select and play the next item in the active source or catalog queue, if one exists.", caution: "Changes the active queue cursor and starts the next track." },
   ```

   **After (intended descriptors):**

   ```js
   { name: "next", kind: "method", signature: "next()", summary: "Move to and play the next item in the current queue, like the UI Next button; this does not replace the queue.", caution: "Changes the active queue cursor and starts the next track." },
   { name: "previous", kind: "method", signature: "previous()", summary: "Move to and play the previous item in the current queue, like the UI Previous button. At the first item returns {moved: false, reason: 'start-of-queue'} without restarting the current track.", caution: "Changes the active queue cursor and starts the previous track when one exists." },
   ```

   **Before** (`ai-vision.js:222`):

   ```js
   next() { const item = ctx.queue.next(); if (!item) return { advanced: false, reason: "end-of-queue", nowPlaying: nowPlaying() }; ctx.play(item); return { advanced: true, href: item.href, mode: ctx.queue.mode }; },
   ```

   **After (intended behavior):**

   ```js
   next() { const item = ctx.queue.next(); if (!item) return { advanced: false, reason: "end-of-queue", nowPlaying: nowPlaying() }; ctx.playQueueItem(item); return { advanced: true, href: item.href, mode: ctx.queue.mode }; },
   previous() { const item = ctx.queue.previous(); if (!item) return { moved: false, reason: "start-of-queue" }; ctx.playQueueItem(item); return { moved: true, href: item.href, mode: ctx.queue.mode }; },
   ```

   The final shape may be adjusted to match existing board conventions, but both methods must preserve and operate on the current active queue.

2. In `C:\projects\persephone-boards\boards\audio-player\app.js`, supply the model's queue-item playback callback that calls `changeTrack(item)` (`app.js:309-314`). This is the same playback path used by UI Next and Previous (`app.js:340`). Leave the existing `play: playModelItem` callback in place for explicit `play()` selection semantics.

3. In `C:\projects\persephone-boards\boards\audio-player\ai-vision.js` and all 18 locale files, update the localized model summary and help (and each locale's overview where present) to say the model is available on full player pages and is not published for a plain audio file opened directly in light mode. The files are `lang/be.json`, `lang/de.json`, `lang/en.json`, `lang/es.json`, `lang/et.json`, `lang/fr.json`, `lang/hu.json`, `lang/it.json`, `lang/ja.json`, `lang/ko.json`, `lang/lt.json`, `lang/lv.json`, `lang/pl.json`, `lang/pt-BR.json`, `lang/ro.json`, `lang/sk.json`, `lang/uk.json`, and `lang/zh-CN.json`, each under `C:\projects\persephone-boards\boards\audio-player\`. The implementer must write the 17 non-English translations themselves; do not use a machine-translation service, translation API, or network request. Make every non-ASCII edit with `apply_patch` (PowerShell or `node -e` piping can replace non-ASCII characters with `?`). After editing, check that each locale file parses as JSON and contains neither `?` replacement characters nor mojibake. Keep the information concise and accurate; do not imply that no model exists for playlist/catalog or no-source full pages. Ensure the English locale and all other locale packs remain aligned.

4. In `C:\projects\persephone-boards\boards\audio-player\CLAUDE.md`, add this model-availability distinction under "Full and light pages" or "AiVision model": the trusted board exposes `pages[pageId].editor.app` only in full mode; opening a plain audio file directly creates a light page without that model. Existing light-mode navigation behavior at lines 67-71 remains useful context.

5. In the Persephone repository at `C:\projects\persephone`, edit `integration-test\tests\published-boards\audio-player\audio-player.test.mjs` (not in the boards repository). Extend the existing M3U regression after the `app.next()` assertion: call `app.previous()`, wait for `app.getNowPlaying()` to return `firstPath`, and assert the same-path result. Then use UI Next to return to `secondPath` before the existing UI Previous click and assertions, so both model `previous()` and `[data-name="previous-track"]` are tested from a valid second-item position. Retain every existing assertion and do not weaken conditions. Board code, board documentation, locale, changelog, and board version edits in steps 1-4 and 6 belong in `C:\projects\persephone-boards`.

   **Before** (existing sequence, `audio-player.test.mjs:186-198`):

   ```js
   await app.next();
   // assert secondPath
   await handle.editor.click('[data-name="previous-track"]');
   // assert firstPath
   ```

   **After (intended sequence; preserve the existing `second` and `returned` assertions):**

   ```js
   await app.next();
   // existing wait and assertion that now-playing href is secondPath
   await app.previous();
   const returnedByModel = await ctx.waitFor(
       () => app.getNowPlaying(),
       (state) => state !== null && samePath(state.href, firstPath),
   );
   ctx.expect(samePath(returnedByModel.href, firstPath)).toBe(true);
   await handle.editor.click('[data-name="next-track"]');
   const secondAgain = await ctx.waitFor(
       () => app.getNowPlaying(),
       (state) => state !== null && samePath(state.href, secondPath),
   );
   ctx.expect(samePath(secondAgain.href, secondPath)).toBe(true);
   await handle.editor.click('[data-name="previous-track"]');
   // existing wait and assertion that now-playing href is firstPath
   ```

6. Add one concise changelog line under `## 1.0.6` in `C:\projects\persephone-boards\boards\audio-player\WHATS-NEW.md` and bump only `version` in `C:\projects\persephone-boards\boards\audio-player\board-manifest.json` from `1.0.5` to `1.0.6`. Recheck `git -C C:\projects\persephone-boards diff` against HEAD before choosing the version: if another EPIC-200 task already created the `1.0.6` heading and bump on `develop`, add this task's line under that heading and do not bump again. Do not edit either generated manifest.

## Concerns

- The model's current `next()` return result is not awaited against actual playback. Keep its established return shape unless the test or call contract requires a small addition; tests should verify the resulting `getNowPlaying()` state.
- Light-mode source navigation uses `persephone.source.navigate()` through `changeTrack()` (`app.js:98-115`), while AiVision is intentionally not created in light mode. The documentation should describe model availability, not suggest model navigation operates in light mode.
- Localized strings exist in 18 language packs. Update all packs with equivalent meaning so the feature description does not depend on the selected language.
- The task document is tracked in Persephone. Per EPIC-200 Notes/Decisions, implementation belongs in the boards checkout, and Persephone-side changes are limited to the existing published-board integration test. The EPIC-200 row is already linked to this document; do not alter `doc/active-work.md` or `doc/epics/EPIC-200.md`.

## Acceptance Criteria

- [ ] `editor.app.next()` advances the current source/catalog queue exactly as the UI Next control does and does not replace an imported M3U queue.
- [ ] `editor.app.previous()` is documented and moves to the previous item in the current queue like the UI Previous control; at the start it leaves the queue unchanged.
- [ ] The existing M3U integration test keeps all existing assertions, checks `app.previous()`, and continues to check the UI Previous control after moving back to the second item.
- [ ] Board `CLAUDE.md` and the localized model summary/help describe that directly opened plain audio files use light mode without `editor.app`.
- [ ] The board has one patch version bump and one changelog heading for all EPIC-200 changes to this board; generated manifests remain untouched.
- [ ] The existing published-board integration suite passes for the M3U navigation case after implementation.

### Files that need no change

- `C:\projects\persephone\doc\active-work.md` and `C:\projects\persephone\doc\epics\EPIC-200.md` — the user says the dashboard and epic are already updated; the epic already links US-2128.
- `C:\projects\persephone-boards\boards-manifest.json` and `C:\projects\persephone-boards\boards\audio-player\versions-manifest.json` — generated by the publish script and must not be hand-edited.
- `C:\projects\persephone\integration-test\tests\published-boards\helpers.mjs` and `C:\projects\persephone\integration-test\tests\helpers\published-boards.mjs` — they already register, copy, trust, and open the published board from the boards checkout.
- `C:\projects\persephone\assets\guides\agents\web-app-tests.md` — the host guide already documents the existing test harness and test context used by this regression.
- `C:\projects\persephone-boards\boards\audio-player\source-queue.js` — it already implements active-queue `next()` and `previous()`; the defect is the model playback callback after selecting the item.

## Files Changed

| File | Planned change |
|---|---|
| `C:\projects\persephone-boards\boards\audio-player\ai-vision.js` | Describe the light-mode model boundary; add `previous()` and route `next()` / `previous()` through active-queue playback. |
| `C:\projects\persephone-boards\boards\audio-player\app.js` | Wire a model callback to the existing `changeTrack(item)` playback path while retaining `playModelItem` for explicit `play()`. |
| `C:\projects\persephone-boards\boards\audio-player\CLAUDE.md` | Explain full-mode model availability and the lack of `editor.app` on directly opened plain audio files. |
| `C:\projects\persephone-boards\boards\audio-player\lang\be.json`, `lang\de.json`, `lang\en.json`, `lang\es.json`, `lang\et.json`, `lang\fr.json`, `lang\hu.json`, `lang\it.json`, `lang\ja.json`, `lang\ko.json`, `lang\lt.json`, `lang\lv.json`, `lang\pl.json`, `lang\pt-BR.json`, `lang\ro.json`, `lang\sk.json`, `lang\uk.json`, `lang\zh-CN.json` | Keep localized model summary/help/overview availability text aligned. |
| `C:\projects\persephone-boards\boards\audio-player\WHATS-NEW.md` | Add this change under the board's single EPIC-200 patch heading. |
| `C:\projects\persephone-boards\boards\audio-player\board-manifest.json` | Bump `version` once for the EPIC-200 board changes, subject to the develop-branch check above. |
| `C:\projects\persephone\integration-test\tests\published-boards\audio-player\audio-player.test.mjs` | Extend the M3U regression with a model `previous()` round-trip while retaining the UI Previous step and all current assertions. |

