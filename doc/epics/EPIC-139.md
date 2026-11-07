# EPIC-139: Voice assistant — talk to an agent by name

## Status

**Status:** Paused (2026-11-07) — waiting for [EPIC-140](EPIC-140.md) (capabilities)
**Created:** 2026-11-06
**Redesigned:** 2026-11-07 (the assistant moves from the app into the Agent Chat board)
**Completed:** —

## Overview

You say the assistant's name ("Persy", "Luna", any name you enrolled). A beep, and everything you
say next is a request to an agent. The request ends after a pause or on a stop word. The agent
does the work through Persephone, for example:
- find a film or music on a site and play it;
- switch the video to full screen and back;
- search the web, tell a story.

The agent answers **by speaking**: it calls the Text to Speech board's `speak()` through
Persephone's object model, like any other thing it can do in Persephone. Saying the name again, or
the stop word, cuts the speech off at once.

The main use is a laptop connected to a TV and operated from the sofa.

### Where things live (redesign, 2026-11-07)

The first design put the assistant into Persephone itself (US-1786 implemented that core). The
user reversed it: Persephone should stay light and act as a **platform**, and the feature belongs
to boards:

| Part | Owner | Role |
|---|---|---|
| **Audio service** | Persephone | Captures the microphone and the computer's own sound, and plays audio, for board services and board pages. One clock for all streams. |
| **Capabilities** | Persephone | One registry of interfaces with declared methods. Boards and Persephone use `persephone.getCapability(...)`; agents use the `capabilities` branch of the `call` tree, e.g. `speak()`. No new MCP tools. |
| **Wake Word board** | persephone-boards | Recognizes enrolled names and stop words, including ignoring them when the computer itself says them (film suppression). Captures audio itself through the audio service. |
| **Text to Speech board** | persephone-boards | Speaks text through the audio service. Exposes `speak()` and `stop()` to agents and boards. |
| **Agent Chat board** | persephone-boards | The assistant: Wake mode, a session marked as the wake session, enrollment page, listening flow, interrupts. |

## Goals

- **Wake word in Agent Chat.** A **Wake mode** checkbox on Agent Chat's toolbar. While it is on and
  the board is open (it can be pinned as the right page), saying an enrolled name starts listening
  in the **wake session**, a session the user marked as such.
- **End of request.** After a configurable silence, or at once on an enrolled stop word. The stop
  word's audio is cut out before transcription.
- **Speaking replies.** The agent calls `speak()` on the `speech.synthesize` capability through
  the object model. What and how much it says is up to the instructions, which the user writes into
  `CLAUDE.md` / `AGENTS.md` in the wake session's working folder.
- **Interrupts.** While speech plays, the wake word stops the speech and starts a new request; the
  stop word stops the speech and the running agent turn.
- **TV-friendly.** A name said by the film playing on this computer does not wake the assistant
  (decision 4).
- **Private by default.** Wake mode is off by default. Detection is local only. Persephone shows when
  the microphone is captured.

## Non-goals

- Cloud speech services; storing audio or transcripts outside the agent session's own history.
- Listening while Agent Chat is closed, or while Persephone is closed to the tray.
- A Persephone-owned assistant, settings page, overlay or agent configuration. The wake session is
  an ordinary Agent Chat session.
- New MCP tools for speech. Agents use the existing `call` tree.
- Speaker identification beyond the enrolled person name that comes with a detection.

## Background (verified 2026-11-07)

- **Board services run headless.** `module-service-supervisor.ts` starts each board's service in its
  own `utilityProcess` (Node, no page). It cannot capture or play audio. Board **pages** can capture
  the microphone with the `microphone` permission (Agent Chat does, for speech to text), but no
  board can capture the computer's own sound: the loopback grant
  (`armTranscriptLoopbackGrant`, `src/main/permission-policy-service.ts:52`) is limited to
  Persephone's own main frame.
- **Board services are invisible to agents.** The `call` tree shows a board's object model only
  while its page is open (`pages[i].editor.app`, `assets/guides/agents/ai-vision.md`). Host service
  interfaces (`speech.transcribe`, `speech.wake`, `speech.synthesize`, `agent.session`,
  `text.translate`) are reachable only over service channels from app code or boards.
- **Agent Chat** (persephone-boards `boards/claude-agent`) already consumes `speech.transcribe`
  from its page with its own microphone capture, has a Configure dialog with two pages, and owns
  its sessions, models, working folders and turn interruption. Its own sessions are **not** bound
  by the cross-board permission ceiling (that ceiling only applies to other boards opening
  sessions through `agent.session`).
- **Done and kept:** the `speech.wake` and `speech.synthesize` v1 contract guides (US-1784), the
  Text to Speech board (BT-082, Supertonic 3) and the Wake Word board (BT-083, enrollment-based,
  with the `start` field added in US-1786). Both contracts are unreleased, so they are revised in
  place, not versioned.
- **To be removed from the app:** the US-1786 core (`src/renderer/ui/voice-assistant/`, the
  Settings section, the microphone-owner election and its IPC). Its capture pieces (loopback gate,
  capture timestamps, stop-word cut) move into the audio service and the boards.

## Design decisions

### Kept from the first design (research results)

1. **Wake and stop words are enrolled in the user's own voice** *(user decision 2026-11-06, from
   US-1783 measurements)*.
   - Each person records the name about 5 times. Detection compares live audio with those
     recordings (speech embeddings and template matching), not text keyword spotting.
   - Text-based spotters failed on the user's Ukrainian pronunciation (sherpa-onnx caught 0–1 of
     ~10; Vosk Ukrainian worked but costs ~9% of a core). Enrollment works for any language, accent
     and name at ~5% of a core.
   - **The calling intonation is a feature.** "Persy", "Persephone" and "Luna" called out triggered
     every time; the same words in ordinary speech did not (verified by the user, 2026-11-07).
   - Every family member enrolls; the detection names the matched person.
   - Licence: the embedding backbone comes from Google's Apache-2.0 `speech_embedding` release,
     exported by us; openWakeWord's packaged copies are CC-BY-NC-SA.
2. **Our own Text to Speech board** *(user decision: no Windows voices, not even as a fallback)*.
   Supertonic 3 (int8, 141 MB) through `sherpa-onnx-node`, English and Ukrainian, ~0.15× real time
   on 2 CPU threads, first audio ~0.4 s, per-sentence streaming, default voice 0 (US-1789).
3. **Stop words** end a request at once; their audio is cut before transcription (detections carry
   `start`). The silence timeout remains the fallback.
4. **Ignore the name when the computer itself says it** *(user idea)*. The spotter runs on the
   microphone **and** the computer's own sound. A microphone detection with a matching computer
   detection from 1.5 s before to 0.3 s after it came from the computer and is ignored. The
   assistant's own speech is suppressed the same way. Starting values; tuned on the user's TV.

### New (2026-11-07, user decisions on redesign)

5. **Persephone audio service** — a platform capability for boards.
   - Persephone captures in a **hidden audio window** it owns: created when the first consumer
     opens a stream, closed after the last one leaves. No window is "the microphone owner", and
     closing or switching windows does not interrupt capture.
   - Sources: `microphone` (optional device id) and `computer` (Windows loopback, level-gated so
     silence costs nothing). One capture per source and device, shared by all consumers.
   - Output: 16 kHz mono `pcm-s16le` chunks, each stamped on **one shared clock** across sources.
     The shared clock is what makes decision 4 and the stop-word cut work across boards.
   - **Playback:** a consumer can play PCM (the Text to Speech format, `pcm-f32le` at its rate) and
     stop it; playback ends are reported. Playing sound needs no permission.
   - Available to board **services** (the utility process) and board **pages** as the `audio`
     capability (decision 6), registered by Persephone itself.
   - Permissions: the existing `microphone` permission, and a new `computerAudio` permission
     (shown in the trust dialog). Persephone shows that the microphone is in use while any capture
     runs (tray/title indicator).
6. **Capabilities** *(user decision 2026-11-07)*: one registry that boards, agents and Persephone
   all use the same way.
   - **A capability is a registered interface with declared methods.** A board registers it in its
     manifest (extending today's provided service interfaces): the interface id, and per method a
     name, one-line summary, arguments and a timeout. Persephone itself registers capabilities the
     same way (the audio service, decision 5, is `capabilities.audio`).
   - **Boards and Persephone code:**
     ```js
     const speech = await persephone.getCapability("speech.synthesize");
     if (speech) await speech.speak("Hello");
     ```
     `getCapability` returns `undefined` when nothing provides it. A method call opens a service
     channel to the provider with a standard request message and resolves with its JSON reply.
     Methods that stream (Wake Word `listen`, audio capture) return a handle with events and
     `close()`.
   - **Agents:** a `capabilities` branch at the root of the `call` tree, next to `pages`. It lists
     every registered capability and its providers, `$help` is generated from the declarations,
     and request/reply methods are called like any other path:
     `capabilities["speech.synthesize"].speak("Hello", { lang: "en" })`. Streaming methods are
     listed but not callable from `call`.
   - **Several providers:** the capability resolves to the first installed, trusted provider;
     `providers` lists them and a specific one can be chosen.
   - Only declared methods are reachable. Trust and permissions stay as they are.
   - This replaces the planned `voice.say`: no new MCP tools, and any board can offer methods to
     agents the same way.
7. **Text to Speech operations.** `speak(text, { lang?, voice?, speed? })` plays through the audio
   service and resolves `{ status: "finished" | "interrupted" }` when playback ends; `stop()` stops
   all its current speech. Without `lang`, Cyrillic text is spoken as Ukrainian, otherwise English.
   No length limit in the operation: brevity is the instructions' job.
8. **Wake Word captures for itself.**
   - `listen` takes the **phrases to report** and the sources (`microphone`, `computer`); the
     provider captures through the audio service and applies decision 4 internally. The consumer
     only receives accepted detections: `{ phrase, kind, person, score, time, start }`, times on
     the audio service clock.
   - **Phrases are named by the consumer** (Agent Chat uses `agent-wake` and `agent-stop`), so
     other boards can enroll their own words without clashing.
   - Enrollment, list and delete stay; enrollment can also record through the audio service.
9. **Agent Chat is the assistant.**
   - **Wake mode** checkbox on the toolbar, off by default, remembered. Works only while the board
     is open; one open copy listens at a time.
   - The user **marks one session as the wake session**. Requests go to it as ordinary turns,
     prefixed with the speaker (`person`) from the detection. Model, effort and working folder are
     that session's own.
   - **Configure → third page "Wake words":** enroll the wake and stop words per person, see each
     sample's match, delete; sensitivity; silence timeout; microphone.
   - **Flow:** waiting → (wake detected) beep → listening (request audio from the audio service,
     transcribed with `speech.transcribe`) → (silence or stop word) → sent → agent runs → waiting.
     The board shows the state and the live request text.
   - **Interrupts:** a wake detection while speech plays calls Text to Speech `stop()` and starts
     a new request; a stop detection calls `stop()` and interrupts the running turn.
10. **Instructions are the user's files.** The wake session's working folder holds a `CLAUDE.md` /
    `AGENTS.md` the user writes: answer by calling `capabilities["speech.synthesize"].speak(...)`, keep it
    to one or two sentences unless asked for more, prefer site-extension actions for media. Agent
    Chat's guide ships a sample. Persephone sends no instruction layer.
11. **Echo cancellation in the audio service** *(user decision 2026-11-07)*. The microphone
    stream takes an `echoCancel` option, on by default, so every board gets a clean microphone
    without its own processing. Playback goes through the same hidden audio window that captures,
    so Chromium's built-in canceller (`echoCancellation: true`) removes the assistant's own speech.
    US-1790 measures whether it also removes other computer sound (a film in a browser tab or a
    player). If it doesn't, a canceller that uses the `computer` stream as its reference is a
    separate, later task, measured on the user's TV. Decision 4 stays in Wake Word as the safety
    net for what the canceller leaves.
    **Measured 2026-11-07 (US-1790):** on the user's speakers, a tone played through `audio.play`
    fell from RMS 0.0248 to 0.00014 with cancellation. A tone played by another Persephone page
    fell from 0.00385 to 0.00015. Both ended below the room floor, so Chromium cancels all
    Persephone audio, not only the audio window's. Sound from other apps is **not** cancelled:
    with YouTube playing in Firefox, the microphone measured 0.075 with cancellation off and 0.082
    with it on. Film sound from other apps therefore needs the loopback-referenced follow-up ([US-1798](../tasks/US-1798-loopback-echo-canceller/README.md), outside this epic), and
    until then decision 4 is the only defence for it.

## Linked Tasks

| Task | Repo | Title | Status |
|------|------|-------|--------|
| US-1783 | persephone | Research: wake-word engine and the microphone-plus-loopback rule | Done (pending epic review) |
| US-1789 | persephone | Research: local text-to-speech model and voices (English, Ukrainian) | Done (pending epic review) |
| US-1784 | persephone | Reserve `speech.synthesize` and `speech.wake` and publish their v1 contract guides | Done (pending epic review); revised in BT-084 / BT-085 |
| BT-082 | persephone-boards | Text to Speech board — `speech.synthesize` provider | Done (pending epic review) |
| BT-083 | persephone-boards | Wake Word board — `speech.wake` provider | Done (pending epic review) |
| US-1785 | persephone | `agent.session@1` host service channel and an app-side session client | Removed 2026-11-07 (no consumer after the redesign; user decision) |
| US-1786 | persephone | Voice assistant core in the app | Superseded; removed by US-1790 |
| US-1787 | persephone | Agent turn wiring in the app | Superseded (planned only) |
| US-1788 | persephone | TV polish in the app | Superseded |
| [US-1790](../tasks/US-1790-audio-service/README.md) | persephone | Audio service: hidden capture window, shared clock, playback, the `audio` capability, `computerAudio` permission; remove the US-1786 core | Done (pending epic review) |
| US-1791 | persephone | Capabilities: manifest method declarations, `persephone.getCapability()`, `capabilities` branch in the `call` tree; `speech.wake` / `speech.synthesize` contract revisions | Replaced by [EPIC-140](EPIC-140.md); the `speech.*` contract revisions move to BT-087 / BT-084 / BT-085 |
| BT-084 | persephone-boards | Text to Speech: play through the audio service; `speak` / `stop` operations | Implemented, awaiting user test |
| BT-085 | persephone-boards | Wake Word: capture through the audio service, phrase filter, consumer-named phrases, film suppression | Planned |
| BT-086 | persephone-boards | Agent Chat: Wake mode, wake session, Wake words page, listening flow, interrupts, sample instructions | Planned |

**Order:** EPIC-140 (capabilities) → US-1790 (audio, registered as a capability) → BT-084 and BT-085 in parallel → BT-086. Board releases follow the
normal merge to `main`; the boards need the Persephone version that ships EPIC-140 and US-1790 (bump
their `minAppVersion`).

## Concerns

- **False triggers from the TV.** Decision 4 removes the common case (a film from this laptop). The
  TV's own channels and a phone are not covered; the calling intonation keeps those rare
  (decision 1). Fallback: a two-word name.
- **The opposite failure.** If the user calls the name while the film says it too, the user is
  ignored. Rare; they call again.
- **Always-on microphone.** Wake mode is off by default, visible on the toolbar, and Persephone
  shows when any capture runs. Detection is local only.
- **Agent access is triggered by voice.** A false wake starts a turn with whatever access the wake
  session has. The protections: decision 4, the request text shown in Agent Chat, the stop word.
  The user accepted this trade-off.
- **Capability methods are a new surface.** Only methods a provider declares are callable, and only
  from contexts that already have the `call` tree (agents with Persephone MCP, boards with
  `appScripting`).
- **The board must be open.** Pinning Agent Chat as the right page keeps it alive; this must be
  verified in BT-086 (an inactive board page must keep its timers and audio channels running).
- **Session growth.** The CLIs compact on their own; the user can start a new wake session.

## Notes

### 2026-11-06
- The idea came from the user: speak to Persephone by name, have an agent act, and get short
  spoken answers, mainly on a TV-connected laptop.
- First design: Persephone owns the assistant; boards provide engines (see git history of this
  file for the full original decisions).

### 2026-11-07 — redesign
- US-1786 (the app core) was implemented and the user confirmed wake detection and live
  transcription work. US-1787 was planned (app-side agent session and `voice.say`).
- The user then reversed the placement: keep Persephone light, make it a platform, and put the
  assistant in Agent Chat, which already uses speech to text. A session is marked as the wake
  session; Wake mode lives on the toolbar; enrollment becomes a Configure page.
- Film suppression belongs to the Wake Word board, since recognizing the name properly is its job.
  Board services cannot capture audio, so Persephone provides an **audio service** to boards
  (user decision: Persephone is the platform and should provide such basics).
- The agent should speak by calling the Text to Speech board through Persephone's object model,
  not through a new MCP tool, with instructions in the wake session's own `CLAUDE.md` /
  `AGENTS.md`. Speech must be interruptible by the wake or stop word (e.g. stopping a long story).
