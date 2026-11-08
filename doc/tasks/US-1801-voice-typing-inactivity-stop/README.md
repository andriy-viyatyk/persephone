# US-1801: Voice typing — stop on transcription inactivity, not only microphone silence

## Goal

Give voice typing a second auto-stop condition that watches the **provider's output** instead of the
microphone level, so a session ends promptly when nothing is being transcribed — including the case
where the user triggers the shortcut and never speaks, which the existing silence auto-stop cannot
end by design.

## Background

### Reported symptom

Voice typing (`Right Ctrl`) kept listening when the user said nothing and printed nothing. The user's
laptop has a loud cooling fan and assumed the fan was defeating silence detection.

### What the investigation found

Three independent causes, verified in `src/renderer/ui/voice-typing/VoiceTypingController.ts`:

**1. Auto-stop is off by default.** `voice-typing.auto-stop-silence-ms` defaults to `0`, and `0`
means disabled (`src/renderer/api/settings.ts:166`, `:221`). It was `0` on the reporting machine, so
no silence auto-stop ran at all. This alone explains the report and needs no code change.

**2. Even enabled, silence auto-stop cannot end a session in which the user never spoke.**
`checkAutoStop()` (`VoiceTypingController.ts:518`) returns early unless a committed segment exists
*and* a quiet threshold has been computed:

```ts
if (!duration || session.segmentCount === 0 || session.draftUtterances.size > 0 || threshold === undefined) {
    session.quietSince = undefined;
    return;
}
```

`session.quietThreshold` is only ever set by `recordSpeechBaseline()` (`:506`), which runs from the
`segment` handler. No speech → no segment → no threshold → no auto-stop. The only backstop is
`MAX_AUDIO_MS` (300 000 ms, `:18`), which cancels the session as `too-long` after five minutes. So
the session is not infinite, but it holds the microphone for five minutes.

**3. A loud environment can defeat the threshold even after speech.** "Quiet" is relative:
`quietThreshold = max(0.005, median(speechLevels) * 0.2)` (`:514`). A fan sitting above a fifth of
the speaker's median level never satisfies `this.level < threshold`, so `quietSince` never starts.

Causes 2 and 3 both disappear if the stop decision is driven by provider output rather than audio
level — which is what this task adds.

### The constraint that shapes the design

Both provider output handlers return early for non-live sessions
(`VoiceTypingController.ts:262` and `:271`):

```ts
} else if (value.type === "draft" && typeof value.text === "string") {
    if (!session.live) return;
...
} else if (value.type === "segment" && typeof value.text === "string") {
    if (!session.live) return;
```

`session.live` is `features.includes("live")` for the selected provider (`:181`, `:194`). A non-live
provider therefore emits **no `draft` and no `segment` at all** — its only text arrives as `result`
after `end` is sent. An output-inactivity timer that ignored this would fire immediately on every
non-live session and cut it off before the user had spoken a word. **The timer must run only when
`session.live === true`.**

Note also that `segmentCount` is only incremented from `queueSegment()`, called from the `segment`
handler, so cause 2 applies to *every* non-live session permanently: existing silence auto-stop can
never fire for a non-live provider. That is pre-existing behaviour and out of scope here.

### Files that need NO changes

- `src/renderer/ui/speech/*` — provider selection, channel and PCM capture are unaffected
- `src/main/*` — the shortcut, microphone state and text insertion paths are unchanged
- `boards/*` in `persephone-boards` — the provider board supplies transcription; the stop decision is
  entirely app-side
- `src/board-shim.ts`, `src/ipc/board-bridge-channels.ts`, `src/renderer/editors/board/BoardWebview.ts`
  — see Concerns: exposing this to dictation boards is deliberately out of scope

## Implementation Plan

### 1. `src/renderer/api/settings.ts`

Add the key to the settings union (after `"voice-typing.auto-stop-silence-ms"`, `:79`):

```ts
    | "voice-typing.auto-stop-inactivity-ms"
```

Add the description beside its sibling (`:166`):

```ts
"voice-typing.auto-stop-inactivity-ms": "Stop voice typing after this many milliseconds in which the transcription provider produced no new draft or committed text, measured from when recording started. Unlike the silence setting this ignores microphone level, so it still ends a session in a noisy room or one in which nothing was ever said. Only applies to providers that support live transcription. Allowed: 0 (off), 2000, 3000, 4000, 5000, 10000, 15000, 30000. Default: 0.",
```

Add the default (`:221`):

```ts
"voice-typing.auto-stop-inactivity-ms": 0,
```

Add a normalizer beside `normalizeVoiceTypingAutoStopSilence` (`:234`):

```ts
export function normalizeVoiceTypingAutoStopInactivity(value: unknown): number {
    return typeof value === "number" && [0, 2000, 3000, 4000, 5000, 10000, 15000, 30000].includes(value) ? value : 0;
}
```

Call it from both places the sibling is called — the `set` path (`:368`) and the load/migration path
(`:429`):

```ts
if (key === "voice-typing.auto-stop-inactivity-ms") value = normalizeVoiceTypingAutoStopInactivity(value);
```
```ts
newSettings["voice-typing.auto-stop-inactivity-ms"] = normalizeVoiceTypingAutoStopInactivity(newSettings["voice-typing.auto-stop-inactivity-ms"]);
```

### 2. `src/renderer/ui/voice-typing/VoiceTypingController.ts`

Add one field to `VoiceSession` (beside `quietSince`, `:47`):

```ts
    /** Wall clock of the last draft or segment from the provider; seeded when capture starts. */
    lastOutputAt?: number;
```

Seed it when capture begins, so the interval is measured from the start of recording rather than
from epoch. In `startCapture()` (`:310`), after `startedAt: Date.now()` is assigned to the capture,
set `session.lastOutputAt = Date.now();` — place it immediately before `return capture;` (`:339`) so
it is only seeded once the pipeline actually started.

Record output in `observeChannel()` (`:255`). In the `draft` branch, inside the existing
`if (utterance !== undefined && !session.finished && !session.cancelled)` block (`:264`), and in the
`segment` branch immediately before `this.queueSegment(session, value.text);` (`:284`):

```ts
session.lastOutputAt = Date.now();
```

Both branches already returned early for non-live sessions, so this records only real live output.

Add the check, called from the same 150 ms timer that already calls `checkAutoStop` (`:149`):

```ts
            this.checkAutoStop(session);
            this.checkInactivityStop(session);
```

```ts
    // Driven by provider OUTPUT, not microphone level, so it still ends a session in a room too
    // noisy for the quiet threshold, and in one where nothing was ever said -- which checkAutoStop
    // cannot do, because it requires a committed segment before it will arm.
    private checkInactivityStop(session: VoiceSession): void {
        if (session.finished || session.cancelled || session.stopRequested || !session.capture) return;
        // A non-live provider sends neither draft nor segment, only a final result after `end`, so an
        // output timer would fire on every such session before a word was spoken.
        if (!session.live) return;
        const duration = settings.get("voice-typing.auto-stop-inactivity-ms");
        if (!duration || session.lastOutputAt === undefined) return;
        if (Date.now() - session.lastOutputAt >= duration) this.stopSession(session.id);
    }
```

`stopSession()` (`:356`) is the same entry point the silence auto-stop uses: it sets
`stopRequested`, moves the overlay to `transcribing` and flushes the channel, so any text already
transcribed is still inserted.

### 3. `src/renderer/editors/settings/sections/SettingsSections.ts`

Add a second select row in the Voice Typing section, modelled exactly on the existing
`silenceSelect` (see `:625` and `:638` for the current one): same control type, options `0 / 2000 / 3000 / 4000 / 5000 / 10000 / 15000 / 30000`, and the same `settings.onChanged` re-render guard, keyed on
`"voice-typing.auto-stop-inactivity-ms"`. Register it in the section's `elements` list beside
`voice-typing.auto-stop-silence-ms` so `settings.highlight()` can point at it.

### 4. `src/shared/i18n/en/`

Add the label and option strings for the new row in the same file and key style as the existing
auto-stop-silence row. Per `doc/agents-common.md`, translating them into every pack is part of task
completion, verified with `npm run i18n:check`.

### 5. Verification commands

`npm run typecheck`, `npm run lint`, `npm run build-prod`.

## Concerns / Open Questions

- **Default is `0` (off), matching the sibling setting.** Voice typing is a press-to-start /
  press-to-stop feature and both auto-stops are opt-in conveniences; turning one on by default would
  change behaviour for every existing user to fix a setting that was simply never switched on. The
  reporting user should set *both* values. If the project later decides auto-stop should be on out of
  the box, that is a deliberate product change covering both settings, not a side effect of this task.
- **Non-live providers get nothing from this.** They emit no incremental output, so neither auto-stop
  can end their sessions; `MAX_AUDIO_MS` remains their only backstop. Ending those would need a
  different signal (for example elapsed capture time with no `result`), and is not attempted here.
- **Deliberately not exposed to dictation boards.** `voice-typing.auto-stop-silence-ms` is forwarded
  to boards through `BoardWebview.ts:812`/`:827`, `board-bridge-channels.ts:377` and
  `board-shim.ts:2067` as `persephone.voiceTyping.autoStopSilenceMs`. Adding a sibling there means a
  bridge version bump and a matching change in every dictation board, so it is left for a follow-up
  once this has proven itself in the app.
- **A fan loud enough to trigger the provider's own VAD would defeat this too.** If the provider
  emits drafts for background noise, output never goes idle. That is a provider-side concern — the
  same class of problem solved in the Wake Word board by gating on speech probability rather than
  level — and it is not addressed here.
- **Interaction with the silence auto-stop is additive.** Both may be enabled; whichever condition is
  met first calls `stopSession()`, which is idempotent (`:358` returns when `session.finished`).

## Acceptance Criteria

- [ ] With the setting off (`0`), behaviour is byte-for-byte unchanged
- [ ] With it set, pressing the shortcut and saying nothing stops the session after the chosen
      interval instead of holding the microphone until the five-minute `too-long` cancel
- [ ] Speaking continuously does not trigger it — each draft or segment resets the timer
- [ ] Speaking and then stopping ends the session, and the transcribed text is still inserted
- [ ] A non-live provider is unaffected: the timer never fires for it
- [ ] Both auto-stops enabled together behave sanely; no double-stop error
- [ ] `npm run typecheck`, `npm run lint`, `npm run build-prod` pass
- [ ] `npm run i18n:check` reports every pack complete

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/settings.ts` | New key, description, default, normalizer, two normalize call sites |
| `src/renderer/ui/voice-typing/VoiceTypingController.ts` | `lastOutputAt` on the session, seeded at capture start, updated on draft/segment; `checkInactivityStop()` on the existing 150 ms timer |
| `src/renderer/editors/settings/sections/SettingsSections.ts` | Second select row in the Voice Typing section |
| `src/renderer/editors/settings/settings-catalog.ts` | Catalog entry so `settings.highlight()` can point at the new row |
| `src/shared/i18n/en/settings.ts` | `voiceTypingInactivityLabel` / `voiceTypingInactivityHelp` |
| `assets/languages/*.lang.json` (17 packs) | Translations plus their `source` hashes |

## Notes

Investigated 2026-11-08 against `upcoming-v5.0.19`. All line references above were read from source
on that branch, not inferred.
