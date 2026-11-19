# US-2134: Network honesty: `network: false` and board services

## Goal

Make the board permission guides and Trust board dialog explain the boundary of `network`: it controls host-mediated network access from a board frame, not the network or filesystem access of a board service or a process the board starts. Audit published board startup paths and document any additional open-time server contact in the owning board README, subject to the EPIC-201 exclusions.

**Epic:** [EPIC-201 — Board data and network isolation](../../epics/EPIC-201.md), Decision 4 (settled: document, do not enforce).

## Background

EPIC-201 Decision 4 is the governing decision. The host will not attempt to sandbox a Node service's network access. The plan is disclosure in the guides, permission text and any affected published-board README.

Verified enforcement and UI behavior:

- `src/renderer/editors/board/board-fetch.ts` (`BoardFetchBridge.run`) checks `BoardGrant.networkMode()` before calling the host's existing `nodeFetch`; `network: false` rejects `persephone.fetch()` with the `network` permission denial. `src/renderer/editors/board/frame/content-open-bridge.ts` also denies an HTTP(S) `content.open()` when `network` is false, and `src/renderer/editors/board/model/BoardContentResources.ts` rejects an HTTP pipe under that policy.
- `src/main/board-protocol-service.ts` serves board frames with a CSP containing `connect-src 'self'` (the board's own `board://` origin). Direct browser `fetch()`/XHR connections from a board frame therefore do not become available by setting the manifest permission; the supported remote frame request goes through `persephone.fetch()`.
- `openExternal` is a separate grant. `src/main/board-aware-open-path.ts` checks it before an OS open. `src/main/board-host/rpc/app.ts` routes `openRawLink`; an HTTP(S) open without `openExternal` can fall back to Persephone's internal Browser under the configured link behavior. That Browser page is not a service process; its requests use the Browser session/network policy, not the board frame's `persephone.fetch()` grant. Explain this distinction without implying `openExternal` is a network sandbox.
- `src/main/module-service/process.ts` starts the declared entry as an Electron utility process running Node. The service environment is limited to an explicit set of ordinary OS environment variables plus Persephone variables, but the process is not sandboxed to the board's `fileSystem` or `network` grant. It can use Node filesystem and networking APIs under the user's OS account. `src/main/command-runner.ts` starts `executeNode()` with `process.env` and board-supplied overrides; the existing command runner similarly starts board processes with the user's process privileges. Consequently `fileSystem: false` does not restrict direct Node/OS filesystem access for a service or spawned process.
- The permission dialog omits false flags: `src/renderer/api/boards/board-permission-copy.ts` builds rows from `BoardGrant.items()`, so `network: false` creates no denied/offline line. `src/renderer/editors/board/board-permission-list.ts` renders the rows and their detail. `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` exposes the same permission rows through `dialogs[0].permissionLines`; `TrustBoardDialogView` renders them.

Published-board audit (startup paths inspected, including manifest service entries and page requests):

| Board | Verified open-time behavior | README/version action |
|---|---|---|
| Translate (`translate`) | Opening its management view reaches `selectedModels()` → `BergamotRuntime.discoverModels()` → remote registry at `firefox.settings.services.mozilla.com`, even before a model download. This is the registry fetch US-2133 removes. Model downloads are separate explicit actions. | Excluded here; US-2133 owns its README and release bump. Record the registry fetch as the sole additional open-time contact found. |
| Torrent Viewer (`torrent-viewer`) | Resolving/opening a source starts WebTorrent and DHT discovery in `scripts/service.mjs`; HTTP(S) `.torrent` source bytes are separately fetched through the board content pipe. US-2135 owns its README and the offline-inspect change. | Excluded here; US-2135 owns its README and release bump. Record source fetch and DHT as the open-time contacts found. |
| Agent Chat (`claude-agent`) | The declared service uses Node filesystem APIs and a local HTTP server for its group-chat feature. Remote provider/CLI work is initiated by user actions; no remote server request is made merely by opening the board. | No README edit or board version bump. |
| Speech to Text (`speech-to-text`) | The service checks local assets and creates a loopback inference server only when running the local engine. Model/runtime downloads are explicit user actions. | No README edit or board version bump. |
| Text to Speech (`text-to-speech`) | Service readiness checks local installed assets. Runtime/model downloads are explicitly started from the board UI; synthesis uses the installed local runtime. | No README edit or board version bump. |
| Wake Word (`wake-word`) | Service uses bundled model/runtime and local audio; no external startup request found. | No README edit or board version bump. |
| Agent Log Viewer (`agent-log-viewer`) and SQLite Viewer (`sqlite-viewer`) | Their `executeNode()` scripts serve local board operations; no network request on open found. | No README edit or board version bump. |

The six declared-service manifests and both `executeNode()` boards above were enumerated. Remaining `fetch()` matches inspected were local board assets, local service loopback calls, or vendored code; no other non-excluded board with an open-time server contact was found. No board README edits are planned, so this task does not change board versions or `WHATS-NEW.md`. If implementation discovers another open-time contact, check `git tag -l "<id>-v*"` against that board's `board-manifest.json` before planning its README release bump, following `C:\projects\persephone-boards\CLAUDE.md`.

Release-tag check against each audited service board's current manifest version: `translate-v1.0.1`, `claude-agent-v1.5.0`, `torrent-viewer-v1.10.0`, `speech-to-text-v1.5.0`, and `text-to-speech-v1.1.0` exist. `wake-word` is at `1.2.1` with no matching tag, confirming the EPIC-200 bump remains unreleased; no change is currently planned for it. This check is recorded for the conditional README/version decision; it does not propose editing any board release files.

## Implementation Plan

### 1. Explain the boundary in the guides

- [x] Update `assets/guides/agents/boards/permissions.md`. Preserve its current staged edits. Make the `network` rows and enforcement table explicit that the permission covers frame `persephone.fetch()` / host-mediated HTTP(S) `content.open()` and not direct service/child-process networking. State that a declared service and `execute`/`executeNode` process can access the user's files and network even when the board manifest sets `fileSystem: false` and `network: false`. Explain the separate frame CSP and that `openExternal` controls OS/browser launching rather than service egress.
- [x] Update `assets/guides/boards/trust-and-permissions.md` with the same user-facing disclosure adjacent to the service permission and network description. Explain that `network: false` does not mean the board's service is offline, and that `fileSystem: false` only gates host file APIs, not direct Node/OS file access in a service or child process.
- [x] Update `assets/guides/boards/bridge.md` at its declared-service and process sections: name the normal Node runtime and direct filesystem/network access, and cross-link the permission guide. Keep the distinction between the host's `service` permission (whether process starts) and the frame's `network`/`fileSystem` bridge permissions.
- [x] Update `assets/guides/agents/boards/services.md` with the service process privilege disclosure. Link to `permissions.md` and state that ordinary Node filesystem/network APIs are not sandboxed by frame grants. Keep the page below 20,000 characters.
- [x] Keep each edited guide below `doc/standards/guide-structure.md`'s 20,000-character page limit. These are existing pages; do not split them or add a hub. Use the project's existing relative guide links.

**Guide copy shape (before → after):**

```text
Before: `network: false` denies `persephone.fetch()`.
After:  `network: false` denies frame host-mediated requests such as `persephone.fetch()`; it does not block a declared service or a process started with `execute`/`executeNode`. Those ordinary Node/OS processes can access the user's files and network even when the board has `fileSystem: false` and `network: false`.
```

### 2. Clarify Trust board permission text and AI-Vision output

- [x] In `src/shared/i18n/en/board.ts`, add one English-only catalog entry, `permissionProcessAccessDetail`, for the explicit process privilege disclosure. Do not edit non-English packs; epic completion handles translation.
- [x] In `src/renderer/api/boards/board-permission-copy.ts`, make `BoardPermissionLine.detailKey` use `board.permissionProcessAccessDetail` for `execute` and `service`; keep `board.fullAccessDetail` for unrelated full-access rows.
- [x] In `src/renderer/api/boards/board-permission-copy.ts`, make `line()` produce canonical English `text` and optional `detail` with `englishMessage`, expose an English full-access label constant, and keep the visible list on its existing catalog keys with `t()`.
- [x] In `src/renderer/scripting/ai-vision/dialogs/trust-board.ts`, project canonical text/detail and full-access label, include detail for kept/added permission changes but omit it for removed lines, and disclose process file/network access in `TRUST_BOARD_HELP`.
- [x] In `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts`, use each line's canonical `text`/`detail` and full-access label. The renderer list already uses the same catalog keys.
- [x] Do not add denied-permission rows or change enforcement, CSP, bridge protocol, `window.persephone`, or `BOARD_BRIDGE_VERSION`.

**Trust text shape (before → after):**

```text
Before: service → “Run a background program while Persephone is open.” / generic Full access detail.
After:  service and execute → existing permission name plus “This process can access your files and the network regardless of the board's other permissions.”
```

### 3. Extend the existing trust-dialog integration assertion

- [x] Update `integration-test/tests/boards/permissions/permissions.test.mjs`, test `trust dialog lists the declared grants`, retaining the exact full-array `toEqual`. Keep the `Full access` label after the execute and network-full lines, replace only the execute detail string with the new process-access detail, and leave both network-full strings unchanged. Add a separate service-only fixture assertion with `network: false`, verifying the service row, `Full access` label and process-access detail appear without any denied/offline network row. Do not weaken or replace existing assertions.

**Existing exact array assertion (before → after; only the execute detail changes):**

```js
// Before
[
    "Run programs and scripts on this computer.",
    "Full access",
    "Can reach everything your user account can.",
    "Read and write files in this board's folder (including its own code) and files you pick in its dialogs.",
    "Connect to the internet, this computer, and your local network.",
    "Full access",
    "Can reach everything your user account can.",
    "Create, change, delete, and apply app themes.",
]

// After
[
    "Run programs and scripts on this computer.",
    "Full access",
    "This process can access your files and the network regardless of the board's other permissions.",
    "Read and write files in this board's folder (including its own code) and files you pick in its dialogs.",
    "Connect to the internet, this computer, and your local network.",
    "Full access",
    "Can reach everything your user account can.",
    "Create, change, delete, and apply app themes.",
]
```
- [x] Do not add unit tests or a harness outside `integration-test/`.

### 4. Audit board READMEs during implementation

- [x] Recheck every service and `execute`/`executeNode` startup path before claiming an open-time network request. The verified audit found no non-excluded board with a remote request merely from opening; the only such behaviors found are in Translate and Torrent Viewer, owned by US-2133 and US-2135.
- [x] Do not edit `boards/translate` or `boards/torrent-viewer`; US-2133 and US-2135 own those READMEs. Preserve these findings for their owners: Translate's on-open Mozilla Remote Settings registry lookup (removed by US-2133); Torrent Viewer source retrieval and WebTorrent DHT discovery when resolving a source (addressed by US-2135's offline inspect mode). No additional open-time server contact was found in either board.
- [x] Wake Word was already version-bumped by EPIC-200; no in-scope non-README change is needed.

### 5. Verify

- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`; run `node --check integration-test/tests/boards/permissions/permissions.test.mjs`.
- [ ] Run `npm run guides:check` again in an environment where esbuild can spawn its worker; this run stopped with `spawn EPERM` before checking guide content.
- [ ] Claude completes the specified live trust-dialog check; this task does not launch Persephone or run `integration-test/run.mjs`.
- [x] Update only the trust-dialog integration assertion described above; do not launch Persephone or run `integration-test/run.mjs` as part of this documentation task plan.

## Concerns

- `network: false` does deny the board frame's `persephone.fetch()` and HTTP(S) `content.open()` paths, and the frame CSP blocks direct remote `connect-src`. The disclosure must not suggest that these controls are absent; it must scope the warning to ordinary service and child processes.
- `openExternal` governs OS/browser opening separately. Keep copy precise: external launch is not a network permission, and a Browser page follows its own session/network settings.
- `fileSystem: false` is type/bridge-level denial only; do not describe it as an OS sandbox for Node processes.
- Decision 4 is settled in EPIC-201. Do not propose enforcement, additional process sandboxing, or a bridge version change.

## Acceptance Criteria

- [x] Agent and user-facing board permission guides clearly define what `network` gates and state that a service/execute process retains user file and network access regardless of `network` and `fileSystem` flags.
- [x] Guides distinguish `persephone.fetch()`, frame CSP, `openExternal`, and internal Browser navigation without claiming that `network: false` makes a board service offline.
- [x] Trust dialog service and execute descriptions say the process can use the user's files and network despite other board permissions; the AI-Vision permission lines and `$help` communicate the same facts.
- [x] No denied `network: false` line is presented as an offline guarantee.
- [x] The permission integration test keeps its exact full-array equality; only the expected execute detail changes, the Full access labels and both network-full strings remain unchanged, and a separate exact assertion covers the service detail. No assertion is weakened.
- [x] Board startup audit is recorded. Every in-scope board with an open-time remote request has a README sentence and required release bump, or the verified audit confirms none; Translate and Torrent Viewer remain owned by US-2133/US-2135.
- [ ] `npm run guides:check`, `npm run typecheck`, and `npm run lint` pass; Claude completes the specified live trust-dialog check.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2134-network-honesty/README.md` | This verified implementation plan. |
| `assets/guides/agents/boards/permissions.md` | Clarify network, service, execute and file access boundaries; preserve existing staged edits. |
| `assets/guides/boards/trust-and-permissions.md` | Add user-facing service/process privilege explanation. |
| `assets/guides/boards/bridge.md` | Explain service runtime access and link to permission semantics. |
| `assets/guides/agents/boards/services.md` | Clarify service process access at the existing permission explanation. |
| `src/shared/i18n/en/board.ts` | Add English-only process-access detail key. |
| `src/renderer/api/boards/board-permission-copy.ts` | Assign the process detail to execute/service lines. |
| `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` | Project detail keys and clarify `$help`. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Project permission-specific detail in AI-Vision output. |
| `integration-test/tests/boards/permissions/permissions.test.mjs` | Extend existing trust-dialog text assertion without weakening it. |
| `C:\projects\persephone-boards\boards\claude-agent\README.md`; `C:\projects\persephone-boards\boards\speech-to-text\README.md`; `C:\projects\persephone-boards\boards\text-to-speech\README.md`; `C:\projects\persephone-boards\boards\wake-word\README.md` | No changes: verified startup audit found no open-time remote request requiring disclosure. |
| `C:\projects\persephone-boards\boards\translate\README.md`; `C:\projects\persephone-boards\boards\torrent-viewer\README.md` | No changes here; the related README work belongs to US-2133 and US-2135. |

**Verified no-change files:** `src/main/board-protocol-service.ts`, `src/renderer/editors/board/board-fetch.ts`, `src/renderer/editors/board/frame/content-open-bridge.ts`, `src/renderer/editors/board/model/BoardContentResources.ts`, `src/main/module-service/process.ts`, `src/main/command-runner.ts`, `src/renderer/editors/board/board-permission-list.ts` (existing enforcement/rendering is reused); `src/shared/board/`, board registries, protocol files, `BOARD_BRIDGE_VERSION` and its history; `assets/guides/boards/services-and-capabilities.md`; `doc/active-work.md`; `doc/epics/EPIC-201.md`; all non-English i18n packs; all board manifests and changelogs; `boards-manifest.json` and `versions-manifest.json` always.
