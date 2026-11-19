# US-2133: Boards use the host data root

**Status:** Planned  
**Epic:** [EPIC-201](../../epics/EPIC-201.md)

## Goal

Update Translate, Agent Chat, Speech to Text, Text to Speech, and Wake Word so their Node-side persistent data uses the profile-scoped `PERSEPHONE_BOARD_DATA` supplied by Persephone, retaining each board's existing default-profile path when the variable is absent. Make Translate's model registry lazy and add source-derived Agent Chat agent-guide method examples.

## Background

This task is part of [EPIC-201](../../epics/EPIC-201.md), and follows its settled Decisions, especially Decision 1 (the `PERSEPHONE_BOARD_DATA` environment contract), Decision 3 (no migration or deletion of old data), and Decision 4 (Translate fetches its registry only when requested). US-2132 is implemented: every board service and process it starts receives `PERSEPHONE_BOARD_DATA=<root>/<board folder name>`, the absolute path to that board's own data folder; the host does not create it. In a test or named-profile instance, `<root>` is `<userData>/board-data`; the default-profile fallback remains `%LOCALAPPDATA%\Persephone\board-data\<id>` when the variable is absent. This matches `src/main/board-process-environment.ts` and `src/shared/board/board-data-id.ts`. Decision 3 means the resolver must never copy or remove old data.

The initial boards-wide source search (`rg -n -i --glob '!node_modules/**' --glob '!lib/**' --glob '!vendor/**' 'LOCALAPPDATA|board-data|homedir' boards`) found the requested data-root call sites in the five in-scope boards. It also found `homedir()` in `boards/agent-log-viewer/scripts/log-server.mjs` and Agent Chat provider-home/session paths; source inspection confirmed these serve separate user home/config/working-directory behaviors, not board-data paths.

## Implementation Plan

### Data-root resolver and consumers

The boards-wide re-grep found no additional `%LOCALAPPDATA%\Persephone\board-data` implementations beyond the five scoped boards. It found `homedir()` in `boards/agent-log-viewer/scripts/log-server.mjs` and Agent Chat provider/session code (`scripts/providers/claude.mjs`, `scripts/providers/codex.mjs`); these serve separate user home/config/working-directory behavior and are not board data-root storage. The Claude provider's explicit `childEnv` in `scripts/providers/claude.mjs` and Codex provider's copied environment in `scripts/providers/codex.mjs` inherit the service's `PERSEPHONE_BOARD_DATA`. Other service children and worker threads in these boards pass no explicit `env`, so Node inherits the parent environment. Agent Chat's `taskkill` children need no data root.

Add one board-local resolver per board, with no cross-board dependency. Each resolver accepts `PERSEPHONE_BOARD_DATA` only if it is absolute and not UNC; otherwise it derives the existing default-profile path. Keep existing fallback validation semantics: Translate, Speech to Text, Text to Speech, and Wake Word reject missing, non-absolute, and UNC `LOCALAPPDATA`; Agent Chat's current `GROUP_ROOT()`, `instructionsFile()`, and SDK installer validate that `LOCALAPPDATA` is absolute and the SDK path remains below it. Preserve that validation for fallback use. These are Node-side board-local filesystem rules; no Persephone source or bridge contract is part of this task.

| Board | Rule owner and existing helper to reuse | Consumers and process flow |
|---|---|---|
| Translate | `boards/translate/scripts/translation-assets.mjs`: extend existing `dataRoot(env)`; `BergamotRuntime` in `scripts/bergamot-runtime.mjs` already consumes it as the model/runtime root. | `TranslationAssets` places `registry/` and `models/` below this root. `scripts/service.mjs` constructs one runtime; `bergamot-runtime.mjs` and `language-detection.mjs` start workers with inherited env, without explicit `env` objects. |
| Agent Chat | Add `boards/claude-agent/scripts/data-root.mjs` as the sole board-local resolver; replace root construction in `scripts/service.mjs`'s `GROUP_ROOT()` and `instructionsFile()`, and make `scripts/sdk-install.mjs` reuse it. | `GROUP_ROOT()` owns `group-chat/`; `instructionsFile()` owns Claude/Codex instruction files; `sdk-install.mjs` owns the SDK folder. Preserve SDK path checks at lines 17, 65, and 81, but scope each containment base to the selected board root (SDK under `<board root>/sdk`). Provider child environments inherit the service environment. |
| Speech to Text | `boards/speech-to-text/scripts/downloads.mjs`: extend existing `dataRoot(env)`, consumed by `scripts/service.mjs`. | Runtime, model and server files use the root; whisper child processes and helper workers inherit env because their spawn options do not provide `env`. |
| Text to Speech | `boards/text-to-speech/scripts/downloads.mjs`: extend existing `dataRoot()`, reused by `installedRoot()` and download staging/install operations. | Engine/runtime and model install paths are rooted there; spawned install/runtime helpers inherit env. |
| Wake Word | `boards/wake-word/scripts/enrollments.mjs`: extend existing `dataRoot(env)`, reused by the enrollment JSON path. | Enrollment persistence uses `<root>/enrollments-v1.json`; service workers/children receive the inherited environment. |

Keep the resolver deliberately small and local to its board. The same environment selection must be used by every persistent path in that board. Do not add a host protocol, a new shared Persephone board rule, or a `window.persephone` member; therefore no protocol change, bridge-version bump, import-zone exception, or roadmap §2.3 god-file growth is planned. No `await import()` or import wrapper is needed.

~~~js
// Before: current fallback only
const local = env.LOCALAPPDATA;
if (typeof local !== "string" || !path.isAbsolute(local) || local.startsWith("\\\\")) throw new Error("LOCALAPPDATA is unavailable or invalid.");
return path.resolve(local, "Persephone", "board-data", "<board-id>");

// After: host root first, otherwise preserve the current fallback check/path
const configured = env.PERSEPHONE_BOARD_DATA;
if (typeof configured === "string" && path.isAbsolute(configured) && !configured.startsWith("\\\\")) {
  return path.resolve(configured);
}
const local = env.LOCALAPPDATA;
if (typeof local !== "string" || !path.isAbsolute(local) || local.startsWith("\\\\")) throw new Error("LOCALAPPDATA is unavailable or invalid.");
return path.resolve(local, "Persephone", "board-data", "<board-id>");
~~~


### Translate registry loading

`boards/translate/app.js` calls `openManagement()` immediately at module startup (the last line). That opens a `{ type: "management" }` service channel; `scripts/service.mjs` registers it and immediately calls `managementSnapshot()`. `managementSnapshot()` calls `selectedModels()`, which calls `BergamotRuntime.discoverModels()` and then `TranslationAssets.discover()`; `TranslationAssets.discover()` calls Firefox Remote Settings for server capabilities and registry records (`translation-assets.mjs:147-172`). Thus opening Translate reaches the network even when the manager dialog is closed.

Keep management-channel setup available on open, but make its initial snapshot local-only and side-effect-free with respect to network. The `app.js` initial state is `pairs: []`, `codes: []`; `renderPairs()` displays no language rows, and only the literal English options/codes are available until a `snapshot` arrives. `open-models` currently only opens the dialog; the **Refresh** button sends `{ type: "refresh" }`; a pair's **Download** button sends `{ type: "download" }`. Use the existing management channel and `managementCommand()` as the owner of explicit discovery requests: discovery should occur when the user opens the Language models dialog (to populate it) or requests a download; refresh remains an explicit forced refresh. Cached `selectionCache` / `TranslationAssets.readSnapshot()` data may populate a local snapshot without fetching. Show installed pairs/models from local manifests when registry data is unavailable, preserving support for installed models and management actions.

The local-only paths must cover the service channel operations and `text.translate.translateText` capability. Currently `describe()` obtains registry selection to list available pairs; `detect` obtains registry language codes; `prepareTranslation()` obtains the registry before route resolution for `translate` and `translateText`; and `explicitDownload()` requires registry model metadata. `translateText` is registered in `scripts/service.mjs` and routes to `translateOneText()`. The runtime already has local `inspectInstalled()` and `getInstalledPair()` helpers, but `inspectInstalled()` itself calls `discover()` (and tries network before its cached snapshot), and installed manifests are verified against registry metadata. Plan the change in `scripts/translation-assets.mjs` / `scripts/bergamot-runtime.mjs` so installed routes are found from verified local model metadata without calling registry discovery; reuse `inspectInstalled()`, `getInstalledPair()`, and `resolveInstalledRoute()` with a local selection rather than adding a second verification scheme. Preserve current rejection/error behavior when no model or route is installed: `translateText` reports a rejected unsupported/not-installed route, channel `translate` reports `not-ready` when a supported route lacks installed model files, and `describe` must represent the local installed state without needing remote registry results. Keep detection local through the existing `LanguageDetection` / CLD2 worker and do not perform registry discovery just to detect text.

When the user opens Language models or downloads, perform registry discovery then; retain the cached-snapshot fallback for offline UI where a registry was previously saved. Preserve installed-model display, download/cancel/remove/progress behavior, and explicit discovery capability. No new English strings are necessary unless source inspection during implementation shows the no-registry UI cannot express its state; if added, add English only to the board's `lang/en.json` under its board-specific language-pack rules.

The no-data frame state is concrete in `app.js` and `index.html`: `state.pairs` and `state.codes` start empty; before any snapshot, `#languages` is empty, the language selects have no options, and `#error` is hidden. The planned local-only startup snapshot must call `renderPairs()`, which then fills the selects with English only and keeps `#languages` empty. Clicking Translate with a non-English route not in the list shows the existing `test.missingModels` text. Keep that local state usable offline; do not query the registry automatically at board open. Opening `#open-models` should explicitly request registry discovery and then render cached/installed data or the offline empty/error state.

~~~text
Before: frame startup -> management channel -> managementSnapshot() -> selectedModels() -> registry fetch
After:  frame startup -> management channel -> local installed/cached snapshot only
        user opens Language models -> snapshot/discovery; Refresh forces it; Download discovers as needed
~~~



`describe()` currently sends `{ type: "description", engine, model, pairs, features }`; pairs come from the registry and each has `from`, `to`, `installed`, and `sizeBytes`. With no model installed it currently returns the registry's advertised pairs marked `installed: false`. The new describe path must not fetch; use cached registry data when already available and otherwise report the local installed inventory (empty when none) while preserving the existing outer result fields. `translateText` currently rejects with code `rejected` when there is no supported route or when required models are not installed; keep that failure contract and message intent. Channel `translate` uses `unsupported-language-pair` for unsupported pairs and `not-ready` when the route exists but model files are not installed. Detection uses the local CLD2 worker; preserve its raw/canonical language result and candidate shape without requiring registry discovery.

### Agent Chat guide and versions

The intended new path is `boards/claude-agent/guides/agent.md`; verify its front matter against existing mounted guides such as `boards/chess/guides/agent.md`. Add `"guides": "guides"` to Agent Chat's `board-manifest.json`, following Chess, Word Viewer, and Force Graph. The model's `aiVision.members` allow-list exposes exactly these methods (`app.js:1328-1342`): `send`, `messages`, `waitIdle`, `create`, `update`, `duplicate`, and `delete`. Use one source-derived example for each method, with synthetic values and placeholders only. `createProfile()` defaults are verified in `app.js:1208`; it returns the saved profile at `app.js:1212`:

~~~text
send("<session-id>", "<prompt>", { wait: false }) -> { status: "sent", reply: "" }  // app.js:1289
messages("<session-id>", { limit: 1 }) -> [{ role: "assistant", text: "<short synthetic reply>" }]  // app.js:1306
waitIdle("<session-id>") -> { status: "idle", reply: "" }  // app.js:1310; idle result from waitSession at :1257
create({ name: "Example profile", roleTitle: "Reviewer", instructions: "<synthetic instructions>", summary: "<synthetic summary>" })
  -> { id: "<generated id>", name: "Example profile", roleTitle: "Reviewer", instructions: "<synthetic instructions>", summary: "<synthetic summary>", provider: "claude", model: "opus", effort: "medium", permissionMode: "read-only", color: "" }  // app.js:1212
update("<profile-id>", { summary: "<synthetic summary>" }) -> saved profile object  // app.js:1222
duplicate("<profile-id>") -> saved profile object with service-generated id/name  // app.js:1228
delete("<profile-id>") -> "<profile-id>"  // app.js:1236
~~~

Do not document `sessions`, `profiles`, provider lists, or other `aiVision` properties as methods. US-2136 separately changes Agent Chat by adding a `cliAvailable` provider field and a no-CLI start message under the same `1.5.1` `WHATS-NEW.md` heading; coordinate that shared heading, with no further planning here.

For the READMEs, replace each user-data location claim with “the Persephone profile's board data folder” and that board's default-profile path example: `%LOCALAPPDATA%\Persephone\board-data\translate`, `claude-agent`, `speech-to-text`, `text-to-speech`, or `wake-word`. Agent Chat has separate instruction, group-chat, and SDK paths below its id; keep each suffix while clarifying that the containing folder is profile-scoped. Preserve its existing SDK consent and network explanation.

~~~text
Before: stored under %LOCALAPPDATA%\Persephone\board-data\<id>
After:  stored in the Persephone profile's board data folder
        (default profile example: %LOCALAPPDATA%\Persephone\board-data\<id>)
~~~


Release comparison from manifests, release tags, and changelogs: Translate is 1.0.1 with translate-v1.0.1, so target 1.0.2. Agent Chat is 1.5.0 with claude-agent-v1.5.0, so target 1.5.1; this task adds guide documentation and changes storage location selection without changing the service contract, so a patch bump is sufficient. Speech to Text is 1.5.0 with speech-to-text-v1.5.0, so bump to 1.5.1. Text to Speech is 1.1.0 with text-to-speech-v1.1.0, so bump to 1.1.1. Wake Word manifest is already 1.2.1 and its latest tag is wake-word-v1.2.0; EPIC-200 already bumped its manifest/changelog to 1.2.1, so add one line beneath its existing top heading and do not bump again. Follow each board CLAUDE.md and README release rules; add one terse WHATS-NEW.md line per board and edit only board-manifest.json and WHATS-NEW.md, never generated manifests.

### Verification plan

Codex runs `node --check` on every edited `.mjs` script, then loads each service entry from a clean location outside the board checkout, as required by the boards authoring guide for vendored runtimes, to catch package and path assumptions. Claude runs the Persephone integration tests described below. Do not add non-integration unit tests or harnesses.

Existing published-board coverage: speech-to-text/speech-to-text.test.mjs covers “renders the uninstalled runtime and model state without downloading” and “transcribeFile rejects without an installed engine or model”; text-to-speech/text-to-speech.test.mjs covers “renders the missing runtime state and install control without downloading” and “speak rejects without an installed runtime or model”; wake-word/wake-word.test.mjs covers “opens with fake microphones and no enrollments” and “listening without an enrollment reports no-enrollments and opens no capture”. Each uses openPublishedBoard() and declares launch plus published-board-checkout. The shared helper at integration-test/tests/published-boards/helpers.mjs:46-58 registers the board, opens its direct page, verifies the editor belongs to that root, activates it, waits for frameReady, and supports closePublishedSample() cleanup.

Add `integration-test/tests/published-boards/translate/translate.test.mjs` with the same required tags and helper/cleanup pattern. Open Translate with no installed board data; after the management snapshot has rendered, assert `frameReady`, hidden `#error`, English-only selectors, and an empty `#languages` list. Also derive the registry file as `path.join(await ctx.app.main.runtime.paths.userData, "board-data", "translate", "registry", "translations-models-v2.json")` and assert `await ctx.app.fs.exists(registryFile)` is false. `translation-assets.mjs:144,172` writes that cache file on each successful registry fetch, so this observable assertion works on an online test machine; do not require running offline. Opening Language models is explicit discovery and outside this startup assertion. Do not use a fixture model or personal data. Agent Chat tests belong to US-2136.

## Concerns

- EPIC-201 Decisions are settled and are constraints, not open questions. The task must not add a service protocol or change `window.persephone`; if implementation later requires a bridge change, that would contradict Decision 1 and require revisiting the epic outside this task.
- No migration is planned. A named profile starts empty; existing default-profile data remains at its current path.
- The Persephone worktree has extensive unrelated staged and unstaged changes. This task document is the only permitted edit; do not alter `doc/active-work.md`, `doc/epics/EPIC-201.md`, or any other existing change.
- Translate currently validates installed model files against registry metadata and derives language codes from the registry. `inspectInstalled()` calls `discover()` and `#verifiedManifest()` each time it inspects; `#verifiedManifest()` reads every model file and checks its size and SHA-256, so the current implementation rehashes on each inspection rather than caching verification. The planned local scan should read the on-disk manifest written by `getPair()`, validate its safe paths and shape, and cache successful size/hash verification once per service process, invalidating it on download or removal. Reuse the existing `sha256()` helper. Cached registry records remain usable when present. This is a source-grounded implementation detail, not an open question or a reason to change EPIC-201 decisions.

## Acceptance Criteria

- [ ] Every in-scope board uses a small, board-local resolver with identical semantics: accept `PERSEPHONE_BOARD_DATA` only when absolute and non-UNC; otherwise use the current board-specific `%LOCALAPPDATA%` fallback with the validation behavior recorded from that board's existing code.
- [ ] Existing path-containment protections in Agent Chat's SDK installer remain effective relative to the selected base.
- [x] Translate opens without fetching the registry; registry requests occur only from explicit model discovery/download actions, and cached model information remains usable where present.
- [ ] Agent Chat's agent guide gives accurate examples for every exposed agent-facing model method covered by the implementation, based on actual return shapes.
- [ ] README data-location wording says “the Persephone profile's board data folder” and gives the default-profile path as an example; existing documented download/trust behavior remains accurate.
- [ ] Board versions and one-line `WHATS-NEW.md` entries follow the Boards release rules and the EPIC-200 Wake Word exception.
- [ ] The plan names each rule's owning module and the existing helper it reuses, adds no board rule outside `src/shared/board/` and board registries, adds no protocol code or roadmap §2.3 god-file growth, and includes no import-zone workaround.
- [ ] Codex runs the board-side `node --check` checks and clean-copy service loads documented by the boards repository. Claude runs the Persephone integration tests: the plan identifies existing speech-board published tests and the proposed Translate published-board test with the registry-cache assertion. Agent Chat integration coverage remains with US-2136.

## Files with no planned changes

| Repository | File or area | Reason |
|---|---|---|
| `C:\projects\persephone` | `doc/active-work.md`, `doc/epics/EPIC-201.md` | Explicitly user-owned for this run. |
| `C:\projects\persephone` | `src/shared/board/`, board registries, `src/shared/board-bridge-version.ts`, `window.persephone` surface | Host contract is supplied by US-2132; no new board rule or bridge member is required. |
| `C:\projects\persephone` | `integration-test/tests/published-boards/claude-agent/` | Agent Chat test coverage belongs to US-2136. |
| `C:\projects\persephone-boards` | `boards-manifest.json`, all board `versions-manifest.json` files | Machine-generated; never hand-edit. |
| `C:\projects\persephone-boards` | Agent Log Viewer `homedir()` paths; Agent Chat Claude config, session store, and provider home/working-directory behavior | Re-grep confirmed these do not compute the scoped board-data root. |
| Both repositories | Unit tests or test harnesses outside `integration-test/` | User prohibits them; only the requested published-board Translate test is planned. |

## Files Changed

| Repository | File | Planned change |
|---|---|---|
| `C:\projects\persephone` | `doc/tasks/US-2133-boards-use-data-root/README.md` | This plan only; no source implementation in this task. |
| `C:\projects\persephone` | `integration-test/tests/published-boards/translate/translate.test.mjs` | Add the no-model startup and registry-cache assertion during implementation. |
| `C:\projects\persephone-boards` | `boards/translate/scripts/translation-assets.mjs`, `boards/translate/scripts/service.mjs`, `boards/translate/scripts/bergamot-runtime.mjs`, `boards/translate/app.js` | Resolve host data root and separate local startup/installed-model paths from explicit registry discovery. |
| `C:\projects\persephone-boards` | `boards/translate/README.md`, `boards/translate/board-manifest.json`, `boards/translate/WHATS-NEW.md` | Clarify profile data location; bump to 1.0.2 and add one changelog line. |
| `C:\projects\persephone-boards` | `boards/claude-agent/scripts/data-root.mjs`, `boards/claude-agent/scripts/service.mjs`, `boards/claude-agent/scripts/sdk-install.mjs` | Add/reuse board-local resolver and keep SDK containment checks relative to it. |
| `C:\projects\persephone-boards` | `boards/claude-agent/guides/agent.md`, `boards/claude-agent/board-manifest.json`, `boards/claude-agent/README.md`, `boards/claude-agent/WHATS-NEW.md` | Mount source-derived result examples; clarify profile data location; bump to 1.5.1 and add one changelog line. |
| `C:\projects\persephone-boards` | `boards/speech-to-text/scripts/downloads.mjs`, `boards/speech-to-text/README.md`, `boards/speech-to-text/board-manifest.json`, `boards/speech-to-text/WHATS-NEW.md` | Resolve host data root; clarify profile data location; bump to 1.5.1 and add one changelog line. |
| `C:\projects\persephone-boards` | `boards/text-to-speech/scripts/downloads.mjs`, `boards/text-to-speech/README.md`, `boards/text-to-speech/board-manifest.json`, `boards/text-to-speech/WHATS-NEW.md` | Resolve host data root; clarify profile data location; bump to 1.1.1 and add one changelog line. |
| `C:\projects\persephone-boards` | `boards/wake-word/scripts/enrollments.mjs`, `boards/wake-word/README.md`, `boards/wake-word/board-manifest.json`, `boards/wake-word/WHATS-NEW.md` | Resolve host data root; clarify profile data location; add one line under existing 1.2.1 heading without another version bump. |
