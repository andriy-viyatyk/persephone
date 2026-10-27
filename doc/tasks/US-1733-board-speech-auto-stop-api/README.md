# US-1733: Board API for the speech auto-stop setting

## Goal

Expose the app-wide speech auto-stop silence duration as a read-only board-page bridge value with live change notifications. Persephone voice typing and boards that take dictation, including Agent Chat, will read the same setting so one user choice controls both.

## Background

### Verified current behavior

- `src/renderer/api/settings.ts` declares `voice-typing.auto-stop-silence-ms`, defaults it to `0`, normalizes it to `0`, `2000`, `3000`, `5000`, or `10000`, and publishes app setting changes through `settings.onChanged` as `{ key, value }`.
- `VoiceTypingController.checkAutoStop()` in `src/renderer/ui/voice-typing/VoiceTypingController.ts` reads that setting while capture is active. It does not stop when the value is `0`, before a segment has been committed, while a draft utterance is pending, or before a quiet threshold is known; otherwise it stops after the configured quiet interval.
- The setting UI is `VoiceTypingSettingsSectionView` in `src/renderer/editors/settings/sections/SettingsSections.ts`. Its label/help come from `src/shared/i18n/en/settings.ts`; `src/renderer/editors/settings/settings-catalog.ts` also has a human-readable `purpose`, and `src/renderer/api/settings.ts` has the key description.
- The board iframe has no direct app settings access. `persephone.settings` in `src/renderer/editors/board/board-api.d.ts` reads settings declared by that board, and the `settings` bridge implementation is board-root/manifest scoped in `src/renderer/api/board-settings/board-settings-bridge.ts`.

### Bridge patterns to follow

- `persephone.page.visible` is initialized from `BoardPortInitMsg` in `src/ipc/board-bridge-channels.ts`; `BoardWebview` sends subsequent `page:visibility` messages to the board iframe with `postMessage()`; `src/board-shim.ts` stores the live value and `persephone.page.onVisibilityChange()` immediately calls subscribers and returns an unsubscribe function.
- Board setting updates provide the closest subscription-lifecycle precedent: `BoardWebview.installSettingsSubscription()` listens to `subscribeBoardSettings()`, pushes `settings:changed`, and removes its subscription when the board frame is disposed or replaced. The `settings` bridge itself is deliberately board-scoped and is not the source for this app-level preference.
- `BoardWebview.onDispose()` marks the frame inactive and clears owned subscriptions before removing the iframe and disposing its board port. The new app-setting subscription must follow this ownership and stale-frame/generation checks.
- US-1729 (`doc/tasks/US-1729-board-service-locale/README.md`) exposed the resolved app locale to **board module services** through the sanitized utility-process environment and a host-only process message. It deliberately did not change the board-frame API or bridge version. This task is a board-page API and should follow the page `postMessage` bridge instead.
- Current host bridge version is `1.43.0` in `src/shared/board-bridge-version.ts`; the version comment in `src/renderer/editors/board/board-api.d.ts` also says `1.42.0` and must be corrected as part of the required bump.

### API decision

Add `persephone.voiceTyping.autoStopSilenceMs` as a read-only live getter and `persephone.voiceTyping.onAutoStopSilenceChange(callback)` as its subscription. The `voiceTyping` namespace names the setting's behavior and avoids implying that it is a board-owned setting or a speech provider/service capability. The value is `0` when auto-stop is off and otherwise a duration in milliseconds. The callback receives the current value immediately, then receives each changed effective value; it returns an unsubscribe function, matching `persephone.page.onVisibilityChange()`.

The host renderer can read the existing app setting directly, so this needs no main-process IPC and no manifest permission. It is app-level preference information, like the existing page visibility and board locale bridge values. The current `persephone.settings` API is not being widened or repurposed.

## Implementation Plan

1. [x] **Declare the board API and version.** In `src/renderer/editors/board/board-api.d.ts`, add a `PersephoneVoiceTypingApi` interface with readonly `autoStopSilenceMs: number` and `onAutoStopSilenceChange(callback: (milliseconds: number) => void): () => void`, and add `readonly voiceTyping: PersephoneVoiceTypingApi` to `PersephoneBoardApi`. Document that `0` means auto-stop is off, otherwise the value is a duration in milliseconds, and subscription immediately reports the current value. Update the current bridge comment and version example from `1.42.0` to `1.44.0`, noting that `1.44.0` adds the live voice-typing auto-stop setting API. In `src/shared/board-bridge-version.ts`, change `BOARD_BRIDGE_VERSION` from `"1.43.0"` to `"1.44.0"` (mandatory).

2. [x] **Carry the initial value and live updates to every board iframe.** Add host-to-board message typing in `src/ipc/board-bridge-channels.ts` for the auto-stop duration, and add the initial duration to `BoardPortInitMsg` so the shim starts with a value before board author code runs. In `src/renderer/editors/board/BoardWebview.ts`, read the already-normalized value from `settings.get("voice-typing.auto-stop-silence-ms")` when constructing port-init data. Install a `settings.onChanged` subscription for each `BoardWebview` instance alongside `installSettingsSubscription()`, after port transfer; filter that exact key and post the value to that instance's own iframe using the existing host-to-frame `postMessage()` path. This applies to main and secondary board frames: each instance owns its iframe, so use the same captured frame, generation, and `model.frames` ownership guard as `installSettingsSubscription()` rather than routing only to the main frame. Clear the subscription in `onDispose()` and in the frame-retirement path where the generation is bumped (around `BoardWebview.ts:638`). Do not add an IPC channel: the renderer owns this setting and already owns the iframe transport.

3. [x] **Expose the live value in the board shim.** In `src/board-shim.ts`, initialize local voice-typing auto-stop state from `BoardPortInitMsg`, handle the new host update message, and expose `persephone.voiceTyping.autoStopSilenceMs` as a getter plus `onAutoStopSilenceChange(callback)`. Accept any finite integer greater than or equal to zero and ignore other incoming values; do not hard-code the current Settings UI choices into the bridge. Call new subscribers immediately with the current value; notify them on each effective value change; isolate callback errors consistently with other shim subscriptions; and return an unsubscribe closure that removes only that callback. Keep this read-only: do not expose settings mutation or a general `app.settings` surface.

4. [x] **Describe the bridge contract to board authors and consumers.** In `assets/guides/agents/boards.md`, update the existing sentence that identifies version `1.43.0` as the version in this build to `1.44.0`, then add a `1.44.0` note in the same paragraph and style as the existing `1.43.0` note. Document the `persephone.voiceTyping` getter, that `0` means off and any other value is milliseconds, the immediate callback and unsubscribe behavior, and feature detection on apps that predate bridge `1.44.0`. In `assets/guides/agents/speech-transcribe.md`, add a short consumer note that dictation boards may opt into the shared app auto-stop duration and must feature-detect the API before using it; older apps do not expose it. State that the app's configured value is the one shared with voice typing and that board-specific behavior remains the responsibility of the consumer.

5. [x] **Clarify the setting's scope without changing its key.** In `src/shared/i18n/en/settings.ts`, reword `voiceTypingAutoStopLabel` and `voiceTypingAutoStopHelp` to make clear the duration applies to voice typing and boards that take dictation (for example, Agent Chat). Update the matching purpose in `src/renderer/editors/settings/settings-catalog.ts` and the key description in `src/renderer/api/settings.ts`. Keep `voice-typing.auto-stop-silence-ms`, its allowed values, and default unchanged.

6. [x] **Track the task; keep board consumer implementation separate.** Add the US-1733 row to the Linked Tasks table in `doc/epics/EPIC-134.md` and add the specified linked `[ ]` item under EPIC-134's **Active** block in `doc/active-work.md`. Reference **BT-068 (persephone-boards)** as the separate Agent Chat microphone consumer task; BT-068 reads and feature-detects the API and stops its live recording using the shared value. Do not include BT-068 board-side code changes in this task.

### Before → after API example

Current board code has no app-level setting API; `persephone.settings` only addresses settings declared by the calling board:

```js
// No current board-frame API for voice-typing.auto-stop-silence-ms.
```

After this task, a consumer such as Agent Chat can use the live value and clean up its listener:

```js
const stopListening = persephone.voiceTyping?.onAutoStopSilenceChange;
if (typeof stopListening === "function") {
  const unsubscribe = stopListening.call(persephone.voiceTyping, (milliseconds) => {
    // 0 means off; otherwise milliseconds is the current shared silence duration.
    setAutoStopDuration(milliseconds);
  });
  // Call unsubscribe when this board consumer no longer needs the setting.
}
```

The consumer must feature-detect the API because older Persephone versions do not expose `persephone.voiceTyping`. The example intentionally makes no minimum bridge requirement: it remains compatible when the optional API is absent.

## Concerns

- No unresolved design choice: the new surface is `persephone.voiceTyping.autoStopSilenceMs` plus `onAutoStopSilenceChange()`, delivered on the existing board iframe `postMessage` channel and owned by `BoardWebview` lifecycle.
- No new manifest permission is required. This is a read-only app preference, available to any board frame in the same way as page visibility; the API must not expose unrelated app settings.
- The app setting's allowed values and voice typing's existing stop guards remain unchanged. BT-068 owns Agent Chat's recording lifecycle and should handle the disabled value (`0`) as no auto-stop.
- The setting UI should describe the value as applying to voice typing and dictation-taking boards; no key rename or migration is part of this task.
- No unit tests or harnesses are planned or requested for this task document.

## Acceptance Criteria

- A board page can synchronously read the current `persephone.voiceTyping.autoStopSilenceMs` duration in milliseconds, including `0` for off.
- `persephone.voiceTyping.onAutoStopSilenceChange(callback)` immediately calls the callback with the current value, reports later setting changes, and returns a working unsubscribe function.
- Board frame disposal/replacement releases the host renderer's app-setting subscription; stale messages are not delivered to a replaced iframe.
- The app-facing bridge is read-only, uses the existing host-to-frame message transport, adds no IPC endpoint, and requires no new manifest permission.
- `BOARD_BRIDGE_VERSION` is `1.44.0`, and `board-api.d.ts` documents the same current version and addition.
- Settings label, help, catalog purpose, and setting description explain that auto-stop applies to voice typing and boards that take dictation; the setting key, default, and allowed values are unchanged.
- `assets/guides/agents/boards.md` documents the API and old-app feature detection; `assets/guides/agents/speech-transcribe.md` explains the optional shared consumer behavior.
- Consumer code checks that the API exists before using it. BT-068 (persephone-boards) is referenced as separate Agent Chat work and is not implemented here.
- US-1733 is linked under EPIC-134 in `doc/epics/EPIC-134.md` and under EPIC-134 Active in `doc/active-work.md`.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/editors/board/board-api.d.ts` | Declare the voice-typing bridge API; update current bridge version comments to 1.44.0. |
| `src/shared/board-bridge-version.ts` | Bump `BOARD_BRIDGE_VERSION` from 1.43.0 to 1.44.0. |
| `src/ipc/board-bridge-channels.ts` | Type the initial and live host-to-board auto-stop value messages. |
| `src/renderer/editors/board/BoardWebview.ts` | Each instance reads and subscribes to the app setting for its own iframe, including secondary frames; send initial/live values and dispose the subscription at `onDispose()` and frame generation retirement. |
| `src/board-shim.ts` | Expose the getter and immediate live subscription with unsubscribe. |
| `src/shared/i18n/en/settings.ts` | Reword the auto-stop label and help to include dictation boards. |
| `src/renderer/editors/settings/settings-catalog.ts` | Update the auto-stop setting purpose. |
| `src/renderer/api/settings.ts` | Update the existing setting description, preserving the key/default/values. |
| `assets/guides/agents/boards.md` | Document the 1.44.0 bridge API and feature detection. |
| `assets/guides/agents/speech-transcribe.md` | Document optional use of the shared auto-stop setting by consumers. |
| `doc/epics/EPIC-134.md` | Add US-1733 to the linked tasks table. |
| `doc/active-work.md` | Add the linked US-1733 entry under EPIC-134 Active. |
| `persephone-boards/boards/claude-agent/app.js` (BT-068) | **No change in this task**; separate board repository/task consumes the optional API and stops Agent Chat recording. |
| `src/renderer/api/board-settings/board-settings-bridge.ts` | **No change**; this bridge remains scoped to manifest-declared board settings. |
| Main-process IPC handlers/channels | **No change**; app setting and iframe both live in the renderer and use existing `postMessage` transport. |
| Board manifest permissions | **No change**; this read-only preference requires no capability grant. |
| `assets/guides/boards.md` | **No change**; API reference for board agents and speech consumers is maintained in the two agent guides listed above. |
| Unit tests and harnesses | **No change**; none are requested for this task document. |
