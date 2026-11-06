# EPIC-139: Voice assistant — talk to Persephone and let an agent act

## Status

**Status:** Active
**Created:** 2026-11-06
**Completed:** —

## Overview

You say the assistant's name ("Persephone" or "Persy" by default). Persephone beeps and listens.
Everything you say next is the request. It stops listening after a pause, or when it hears a
configurable stop word, and sends the text to an agent. The agent does the work through
Persephone's MCP, for example:
- find a film or music on a site and play it;
- switch the video to full screen and back;
- search the web.

The agent answers by **speaking**, through a `voice.say` tool that keeps replies short unless you
asked for an explanation.

The main use is a laptop connected to a TV and operated from the sofa. So the design favors:
- working without the keyboard and screen;
- not mishearing the TV as a request;
- short spoken answers.

Persephone itself owns the conversation: the wake word, the listening, the agent session and the
spoken reply. The engines stay in boards and are reached through service interfaces, as EPIC-133
decided for speech to text. Any installed board that provides the interfaces works.

## Goals

- **Wake word.** With the assistant enabled, saying one of its names starts a request with an
  audible beep. The names are configurable, defaulting to `persephone, persy`.
- **End of request.** The request ends after a configurable silence or on a configurable stop word.
  The text goes to an agent session that keeps context between requests, so "make it full screen"
  works after "play …".
- **Agent choice.** The provider, model, effort and extra instructions are Persephone settings.
  The provider list comes from installed `agent.session` boards.
- **Spoken replies.** The agent speaks through `voice.say`. Text over a configurable limit is
  rejected with an error that tells the agent to shorten it. An `explanation` mode allows longer
  speech when the user asked for detail.
- **TV-friendly.** Persephone's own media is muted while it listens, so the film doesn't drown out
  the request. A visible indicator shows the state: listening, thinking or speaking. "Persy, stop"
  interrupts speech or the running turn.
- **Private by default.** The feature is off by default. Wake-word listening is processed only on
  this machine, and the microphone indicator is visible whenever it is on.

## Non-goals

- Cloud speech services, and always-on recording or transcript storage.
- Phone or remote-microphone input. The laptop's (or a USB/Bluetooth) microphone only.
- Speaker identification ("only my voice").
- A new agent runtime. The agent is an `agent.session` provider (Agent Chat today).

## Background (verified 2026-11-06)

### What already exists

- **`speech.transcribe` v1, with `live`.** The contract is `assets/guides/agents/speech-transcribe.md`.
  The Speech to Text board (whisper.cpp, local) sends `segment` messages at each pause (EPIC-134).
  Voice typing already consumes it from the **app**, not from a board:
  - `src/renderer/ui/speech/SpeechTranscriptionProvider.ts` calls `api.connectHostServiceChannel(...)`;
  - `src/renderer/ui/voice-typing/VoiceTypingController.ts` captures the microphone in the
    renderer;
  - an auto-stop-after-silence setting already exists (`voice-typing.auto-stop-silence-ms`,
    `src/renderer/api/settings.ts:78`).
- **Host service channels are allow-listed per interface** in `HOST_SERVICE_CHANNEL_POLICIES`
  (`src/main/module-service-supervisor.ts:65-68`). Today the list has `speech.transcribe@1`
  (prefix `voice-typing:`) and `text.translate@1`. `agent.session@1` is **not** on it, so the app
  cannot open an agent session yet.
- **`agent.session` v1.** The contract is `assets/guides/agents/agent-session.md`. Agent Chat
  (persephone-boards `boards/claude-agent`, v1.3.3) provides it for Claude and Codex.
  - An open takes `model`, `effort`, `instructions` (caller layer, ≤ 32 KiB), `permissionMode`,
    `mcp: { persephone: true }` and `resume`.
  - The provider issues a private Persephone MCP endpoint per session, so the agent has the full
    `call` tree: browser pages, `pages.*`, site-extension actions, and so on.
- **Permission ceiling.** Each provider has a `cross-board-permission-ceiling` setting, default
  `read-only`.
  - In `read-only`, Agent Chat's `hookDecision` **denies every MCP tool** (`classifyTool` →
    `"mcp"`; `boards/claude-agent/scripts/agent-session-protocol.mjs`).
  - So an agent at the default ceiling cannot drive the browser. With `ask`, MCP calls arrive as
    `approval-request` events that the consumer answers.
- **Site extensions (US-1777)** give agents one-call actions on known sites ("play this video").
  That is the reliable route for the TV use case.
- **No text-to-speech anywhere** in the app or the boards.
- **Computer-audio capture exists.** The text editor's Transcript button (EPIC-134, phases 3–4)
  captures what the computer plays. The main process grants Chromium loopback audio through
  `session.setDisplayMediaRequestHandler(..., { audio: "loopback" })`, and the app keeps it as a
  stream separate from the microphone.
- **Platform-reserved interface ids:** `PLATFORM_SERVICE_INTERFACE_IDS` in
  `src/shared/board-manifest-utils.ts:5`.

### Why wake-word detection is the hard part

- **Cost and false triggers.** Running Whisper on everything the microphone hears means running
  it all the time a film plays: constant GPU/CPU load, and the film's dialogue is transcribed
  continuously. A film character saying something close to the name would trigger it.
- **Pause detection precedent.** An earlier live-transcription proof of concept failed on
  segmentation (EPIC-134, US-1726). That epic succeeded by starting with research.
- **Outcome (US-1783):** enrollment-based detection, decision 2a. The candidate list below is
  what was evaluated.
- **Not Whisper (user decision).** A small keyword spotter costs far less. Candidates to measure:
  - **Vosk** with a grammar restricted to the names. Apache-2.0, small models, and new words need
    no training. The vocabulary limits are unverified.
  - **openWakeWord.** Apache-2.0, ONNX. A custom name needs a training run.
  - Porcupine is excluded: proprietary, with an access key.
  - Whisper, gated by voice activity, is excluded by user decision: it would keep a heavy model
    running all the time.
- **Echo.** The assistant's own speech, and the TV, reach the microphone. Chromium's echo
  cancellation only knows about audio Chromium plays itself.

## Design decisions (2026-11-06, proposed by Claude — reasons recorded)

1. **Persephone owns the assistant; boards provide engines.**
   - Settings, the state machine, beeps, the indicator, media muting, the agent session and
     `voice.say` are app features.
   - Wake detection, transcription, speech synthesis and the agent are service interfaces.
   - This mirrors voice typing, which is an app consumer of a board provider. Any board that
     implements the interfaces can replace ours.
2. **New interfaces.**
   - **`speech.synthesize` v1** (new, platform-reserved): text in, audio chunks out (PCM or Opus),
     plus `describe` (voices, languages, `local`). Persephone plays the audio, so it knows when
     speech ends and can stop it.
   - **`speech.wake` v1** (new, platform-reserved), decided by US-1783: **enrollment-based** wake
     and stop words (see decision 2a). Operations:
     - `enroll`: a short recorded clip plus `{ phrase, kind: "wake" | "stop", person }`. The
       provider returns the sample's quality and its match to the phrase's earlier samples.
     - `list` / `delete`: the enrolled phrases and samples.
     - `listen`: streamed audio in; `wake` / `stop` events out, each with the matched phrase,
       person, score and time.
     - `describe`: `local`, features, and the default threshold.

     The provider stores the enrollments in its own board data. Persephone's settings drive them
     through the interface and never hold the voice data themselves.
2a. **Wake and stop words are enrolled in the user's own voice** *(user decision 2026-11-06, from
    US-1783 measurements)*.
    - Each person records the name about 5 times in Settings → Voice assistant → **Enroll**.
      Detection compares live audio with those recordings: speech embeddings and template
      matching (query-by-example), not text keyword spotting.
    - **Why.** Text-based keyword spotters failed on the user's Ukrainian pronunciation:
      sherpa-onnx caught 0–1 of ~10. Vosk Ukrainian recognized the names but costs ~9% of a core
      continuously. Enrollment works in any language and accent, for any name, at ~5% of a core.
    - **The calling intonation is a feature.** In the user's tests, a called "Луна!" / "Persy!"
      triggered every time, while the same name mentioned in an ordinary sentence mostly did not.
      People can talk *about* the assistant without waking it.
    - Several names, and several people, can be enrolled; a hit on any of them wakes the
      assistant. Every family member must enroll: other voices did not match one person's samples.
    - **Stop words are enrolled the same way** (kind `stop`). While listening, a stop word ends
      the request at once instead of waiting for the silence timeout. Its audio is cut from the
      request before transcription, so the agent never sees the stop word. The silence timeout
      remains the fallback.
    - Licence: the embedding backbone must come from Google's Apache-2.0 `speech_embedding`
      release, exported by us. openWakeWord's packaged copies are CC-BY-NC-SA.
3. **Our own Text to Speech board** in persephone-boards provides `speech.synthesize`
   *(user decision: no Windows voices, not even as a fallback)*.
   - It uses a local neural model, downloaded on first use with a Mneme-style model panel, like
     Speech to Text.
   - **Engine: Supertonic 3** (int8, 141 MB) through `sherpa-onnx-node`, decided by US-1789. One
     model speaks English and Ukrainian from raw text, with no GPL phonemizer, at ~0.15× real time
     on 2 CPU threads; first audio ~0.4 s. **Default voice 0** *(user choice 2026-11-06)*.
   - Streaming is per sentence: the provider splits the text and sends each sentence's PCM as soon
     as it is ready. Requests must set `enableExternalBuffer: false` (Electron utility process).
   - Without the board installed, the assistant cannot speak. It shows its replies as text in the
     indicator and the settings page says what to install.
3a. **Ignore the name when the computer itself says it** *(user idea)*.
   - The wake spotter runs on **two** streams: the microphone and the computer's own audio output
     (loopback).
   - If the name is detected on the microphone **and** on loopback within a short window, the
     sound came from the computer (the TV is playing the laptop's output), so it is ignored. Only a
     microphone-only detection wakes the assistant.
   - The window allows for the delay from loopback to the microphone (HDMI and TV processing plus
     the distance through the room). Phase 0 measures that delay. The starting guess is ±1.5 s.
   - The same rule covers the assistant hearing **its own voice**. Synthesized speech plays
     through the computer, so it appears on loopback too.
   - It does not cover sound the computer isn't playing: the TV's own channels or apps, or a
     phone. Phase 0 checks how often the film-only case still slips through. A two-word phrase
     ("hey Persy") stays available as a setting.
   - Loopback spotting runs only while the computer is actually playing sound. A level gate keeps
     the second spotter idle in silence.
4. **One request = one turn on one long-lived session.**
   - Persephone opens one `agent.session` with `resume`, so context survives between requests and
     restarts.
   - "Persy, new conversation" (or a settings button) starts a fresh session.
   - The session's `cwd` is a dedicated folder under Persephone's data directory.
5. **Permissions: full access, no setting in v1** *(user decision 2026-11-06)*.
   - Persephone opens the session with `permissionMode: "full-auto"`: Persephone MCP, shell
     commands and files, the same as Agent Chat's own page.
   - **Why there is no "Persephone only" level.** Persephone's MCP itself gives the agent
     `script.execute`, which runs in a renderer with Node access. A Persephone-only agent could
     still read and write files and start processes, so a separate level would look like a
     boundary without being one. A real restriction would need its own design and is out of
     scope for v1.
   - No voice approvals, and no approval buttons. If an `approval-request` arrives anyway (the
     provider lowered the mode), Persephone denies it and says in the indicator why the agent
     could not act.
   - **The ceiling still applies.** Agent Chat's cross-board ceiling defaults to `read-only`. The
     user raises it once to `full-auto` in Agent Chat's settings. Persephone never changes another
     board's settings and never bypasses the ceiling.
   - Persephone reads the effective mode from `session-started`. If it is lower than `full-auto`,
     the settings page and the indicator say so and explain where to raise the ceiling.
6. **`voice.say` is a node in the `call` tree.**
   - Signature: `voice.say(text, { mode?: "short" | "explanation" })`.
   - It works only while a voice session is active and is listed in `$help` with its limits.
   - It rejects text over `voice.max-chars` (default 300) or, in `explanation` mode, over
     `voice.explanation-max-chars` (default 2000). The error tells the agent to shorten the text
     or use `explanation` mode.
   - It resolves once speech has finished or been interrupted, and says which.
   - **Fallback when the agent never calls it:** if a turn ends with no `voice.say`, Persephone
     speaks the final reply when it fits the short limit. Otherwise it says "Done — details are on
     the screen".
7. **Instructions.**
   - Persephone sends a default caller-instruction layer: you are a voice assistant; speak only
     through `voice.say`; one or two sentences; no Markdown or lists; use explanation mode only
     when asked; prefer site-extension actions and the browser for media.
   - The user's own instruction setting is appended after it.
8. **State machine and feedback.**
   - States: `off` → `waiting for name` → (beep) `listening` → `thinking` → `speaking` →
     `waiting for name`.
   - The indicator is a small overlay in the active window: microphone state, the live request
     text as it is transcribed, then the spoken reply as text.
   - Two short Web Audio tones: a rising one for "listening" and a falling one for "sent". No
     sound files.
   - While `listening`, every Persephone web page's audio is muted (`webContents.setAudioMuted`)
     and restored afterwards. Settings choose mute, pause or nothing.
9. **Interrupts.** In `thinking` or `speaking`, the wake word plus "stop" (or the stop word alone,
   configurable) cancels speech and the agent turn.
10. **Who owns the microphone.**
    - One owner per process: the first normal window's renderer, as voice typing does today.
    - If that window closes, ownership moves to the next normal window.
    - With no visible normal window (closed to tray), the assistant **stops listening**: no
      microphone, no loopback capture. It resumes when a window is shown again *(user decision
      2026-11-06)*.
    - Listening from the tray is out of scope. If it is wanted later, it becomes a separate
      task.
11. **Settings** (a new "Voice assistant" section):
    - enable;
    - **Enroll** wake names and stop words, per person: record, see each sample's match, delete;
    - silence timeout (reusing the voice-typing default);
    - microphone;
    - wake sensitivity (the match threshold, default from the provider's `describe`);
    - agent provider, model and effort (lists from `describe`);
    - extra instructions;
    - short and explanation limits;
    - voice and speed (from the `speech.synthesize` description);
    - media behavior while listening;
    - "new conversation" button.

## Phases

0. **Research and measurement**, two tasks (gate: the user agrees with each recommendation).
   - **US-1783, wake word:**
     - engine choice (not Whisper);
     - CPU, latency and misses for both names in English and Ukrainian;
     - false triggers with a film playing, with and without the loopback rule (decision 3a);
     - the measured loopback-to-microphone delay through the TV;
     - whether the assistant's own speech ever wakes it.
   - **US-1789, speech synthesis:**
     - a survey of local text-to-speech models (licence, size, speed on CPU and GPU, English and
       Ukrainian voices);
     - listening samples for the user to choose from;
     - streaming support, so speech starts before the whole reply is synthesized.
1. **Engines (persephone-boards):**
   - the wake feature or interface provider;
   - the Text to Speech board.

   Contracts are written first, in persephone.
2. **Assistant core (persephone):**
   - `agent.session@1` host channel;
   - settings, state machine, indicator and beeps;
   - agent session lifecycle, `full-auto` mode and the lowered-mode warning;
   - `voice.say`.
3. **TV polish:**
   - media muting;
   - voice interrupts;
   - the default instructions tuned against real requests ("play …", "full screen", "search …");
   - guides.

## Linked Tasks

| Task | Repo | Title | Status |
|------|------|-------|--------|
| US-1783 | persephone | Research: wake-word engine and the microphone-plus-loopback rule | Done (pending epic review) |
| US-1789 | persephone | Research: local text-to-speech model and voices (English, Ukrainian) | Done (pending epic review) |
| US-1784 | persephone | Reserve `speech.synthesize` and `speech.wake` and publish their v1 contract guides | Planned (documented) |
| BT-082 | persephone-boards | Text to Speech board — `speech.synthesize` provider | Planned |
| BT-083 | persephone-boards | Wake Word board — `speech.wake` provider: enrollment, template matching, stop words | Planned |
| US-1785 | persephone | `agent.session@1` host service channel and an app-side session client | In progress |
| US-1786 | persephone | Voice assistant core: settings, state machine, beeps, indicator, microphone owner | Planned |
| US-1787 | persephone | Agent turn wiring: session lifecycle, instructions, `full-auto` mode, `voice.say` | Planned |
| US-1788 | persephone | TV polish: media muting, voice interrupts, guides | Planned |

**Order:** US-1783 and US-1789 run in parallel. Then US-1784, then BT-082, BT-083 and US-1785 in
parallel, then US-1786 → US-1787 → US-1788.

BT-082 depends only on US-1789 and US-1784. BT-083 measures film triggers on the microphone only:
a board cannot capture the computer's own audio (the loopback grant is limited to the app's main
frame). The two-stream measurements for decision 3a (film on both streams, film plus voice, the
loopback-to-microphone delay) and the rule itself (matching detections from the two streams in
time) live in the app (US-1786), so any wake provider gets them.

US-1785 and US-1786 can start before the boards exist. The core can be built against
`speech.transcribe` live (without a wake word, using a shortcut as a stand-in) and a
`speech.synthesize` stub.

## Concerns

- **False triggers from the TV.** This is the biggest product risk.
  - The loopback rule (decision 3a) removes the common case: a film playing from this laptop.
  - Phase 0 measures what remains: the TV's own sources, and a loopback detection missed while
    the microphone detection succeeds. If that is too frequent, a two-word wake phrase ("hey Persy")
    or a confirmation beep is the fallback.
- **The opposite failure.** If the user says the name while the film also says it, the rule
  ignores the user. That is rare and acceptable: they say it again.
- **Always-on microphone.**
  - The feature is off by default. Its state is always visible (indicator, tray).
  - No audio or text is stored outside the agent session's own transcript.
  - Wake detection must be `local: true`. A non-local provider is refused for wake detection.
- **Latency.** Transcription (~1–2 s) plus an agent turn (several seconds), and synthesis on top.
  The defaults should prefer a fast model and low effort, and the indicator must show "thinking"
  at once, so silence doesn't read as failure.
- **The permission ceiling is a user setting in another board.** The provider default is
  `read-only`, which makes the assistant useless. The settings page must detect the effective mode
  from `session-started` and explain how to raise it, without changing it for the user.
- **Agent access is triggered by voice.** A false wake word starts a turn of an agent with full
  access. The protections:
  - the microphone-only rule (decision 3a);
  - the request text shown in the indicator while the turn runs;
  - "Persy, stop".
  The user accepted this trade-off.
- **Session growth.** A long-lived session accumulates context. The CLIs compact on their own, and
  "new conversation" resets it. An idle reset (e.g. after 2 hours) is an optional setting.
- **Several windows.** Only one microphone owner, and the indicator follows the active window.
  Board-mode windows (EPIC-136) never own the microphone.

## Notes

### 2026-11-06
- The idea came from the user: speak to Persephone by name, have an agent act through Persephone,
  and get short spoken answers. The main setting is a TV-connected laptop: finding and playing
  films or music, switching full screen, searching the web.
- The user suggested building on the Speech to Text and Agent Chat boards, or any boards with
  matching capabilities, plus a speech board for the `speak` tool. The design follows that.
  Persephone owns the assistant itself, as it already owns voice typing.
- User decisions on review:
  - Text-to-speech is our own board with a carefully chosen local model. No Windows voices, not
    even as a fallback; Windows speech quality is well below Whisper's.
  - The wake word does not use Whisper.
  - The user proposed the microphone-plus-loopback rule (decision 3a): ignore the name when the
    computer's own audio says it too.
  - Both research tasks are part of this epic, and so is the new Text to Speech board.
  - No listening while Persephone is closed to the tray. If it is needed later, it is a separate
    task.
  - Permissions: full access (`full-auto`) and no access setting in v1. Persephone's own MCP
    already lets an agent run scripts with Node access, so a "Persephone only" level would not
    be a real boundary. The user raises Agent Chat's cross-board ceiling once.
  - Wake and stop words are **enrolled in the user's own voice** in Persephone's settings
    (decision 2a), after the US-1783 tests. Calling intonation triggers and ordinary mentions do
    not, which the user considers a feature. Stop-word enrollment ends a request without waiting
    for the silence timeout.
