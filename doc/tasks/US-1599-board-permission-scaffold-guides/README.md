# US-1599: Scaffold all-false manifest; board guides and agent instructions

Epic: [EPIC-119: Board permissions](../../epics/EPIC-119.md)

## Goal

Make every Persephone-created board start with the enforced object-form permission manifest and teach board-authoring agents to request only the grants their code uses. Update the bundled demo board to declare its actual needs and point out user-guide changes for `/userdoc` at EPIC-119 close.

## Background

### Verified creation and permission behavior

- `src/renderer/editors/board/board-scaffold.ts:scaffoldBoard()` recursively copies the selected bundled template. `createBoardFromTemplate()` then calls `ensureBoardManifest()`, reads the manifest, fills `name` and the configured default author, writes it, and auto-trusts this Persephone-created board. The template-copy failure path reaches the same `ensureBoardManifest()` fallback.
- `assets/board-template/board-manifest.json` currently has no `permissions` or `minBridgeVersion`. `src/renderer/editors/board/board-manifest.ts:defaultBoardManifest()` likewise creates only schema, name, and author. Both the copied manifest and fallback factory must therefore change for the all-false rule to hold on every path.
- Explorer `BoardsSecondaryView` routes “New board” and “Demo board” to `createBoardFromTemplate()` through `CreateBoardDialog`. `src/renderer/api/boards.ts:createBoard()` and `createDemoBoard()` use that same funnel, and `src/renderer/scripting/ai-vision/namespaces/boards.ts` describes those APIs. `src/renderer/api/tools/tool-scaffold.ts` and the tool commands scaffold toolsets, not boards; no separate board scaffold is present there.
- The default template's `assets/board-template/app.js` invokes `persephone.execute()` when its only “Run example” button is clicked. `execute` is denied when false, so the default interaction must become a local, ungated example. The template's starter page and its `CLAUDE.md` should still teach `execute()` as an optional capability and identify the permission required before an agent uses it.
- The normalized flags are defined in `src/shared/board-manifest-utils.ts:BoardPermissionFlags` and default to false for object manifests. Legacy absent permissions and old arrays normalize to `{ kind: "legacy" }` and remain Unrestricted except that service starts only when the old array contains `"service"` (`normalizePermissions()`, `boardPermissionAllows()`). The exact rejected-call form is `permission-denied: "<flag>" is not enabled in board-manifest.json` (`boardPermissionError()`; `board-fetch.ts`, `board-call-command.ts`, and the main board bridge use it).
- `src/shared/version-utils.ts:getBoardCompatibility()` requires object-form boards to have `minBridgeVersion >= OBJECT_PERMISSION_BRIDGE_VERSION`. The fixed first-support threshold is `1.30.0`; the current `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` is `1.31.0`. Recommend scaffolds write the fixed object-form threshold (`1.30.0`), not the bridge version at scaffold time: later bridge releases that only change unrelated behavior should not invalidate the manifest, while the compatibility gate already rejects builds older than object-form support. Export/reuse the fixed constant in the fallback factory; keep the JSON template at the same value.
- US-1598's approved user-facing wording is the source for the guide's permission table. It defines the object-form introduction, `No permissions requested.`, the legacy **Unrestricted** explanation, each flag's line, and the **Full access** secondary text. Do not invent a second wording set.
- US-1598 checks permission changes on open/reload. Added permissions or raised levels prompt for re-approval; a pure reduction is applied silently, while legacy-to-object migration prompts once. Tell the user when changing a board's permissions and explain that its next open/reload reconciles the manifest. Agents must never accept/click **Trust Board** unless the user explicitly asked them to trust that board; `TrustBoardDialogAdapter.click()` already documents that authority rule.
- US-1596 defines `fileSystem: false` as blocking bridge file methods and dialogs, while the hosted document and the board's own `board://` assets remain available. It explicitly recommends `fetch("board://<host>/data.json")` or `fetch("./data.json")` for own assets when `fileSystem` is false. `persephone.fetch()` is separately governed by `network`.
- EPIC-118 F7, carried into EPIC-119 and US-1596, identifies injected hostile documents as the viewer threat: `fileSystem: "board"` lets a viewer rewrite its own board code and persist an injection. Viewer boards rendering untrusted documents should declare `fileSystem: false` and `network: false` and must not receive `execute` or `appScripting`; own board assets and the user-opened document still render without those grants.

### Verified guide and demo scope

- `assets/guides/agents/boards.md` contains multiple obsolete statements that permissions are disclosure/lifecycle only, including the service, content-provider, capability-handler, custom-editor, and manifest discussions. Its permission examples still use old arrays. The guide describes `execute`, file APIs, `persephone.fetch`, `persephone.call`, dialogs, and service behavior; annotate those examples with the relevant flag and current behavior.
- `assets/guides/agents/board-review.md` says trust is one unrestricted switch and that declarations are disclosure only. Its bridge-capability table and grep checklist need to describe enforced grants and compare object flags to actual calls.
- `assets/board-template/CLAUDE.md` has the same obsolete manifest, service, content-provider, and capability disclosure text, plus teaching sections for `execute`, `persephone.call`, files, and `persephone.fetch`. Update every permission/disclosure claim and show the new manifest shape.
- `assets/guides/agents/ai-vision.md` teaches publishing/driving app models but does not currently describe the board bridge permission on `persephone.call`; add that board-origin calls require `appScripting` and use the exact denial/fix guidance.
- `src/renderer/scripting/ai-vision/namespaces/boards.ts` describes board creation and trust lifecycle; update its create summaries/help to say new board scaffolds start all-false and that creating/auto-trusting does not mean every capability is granted. `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` already exposes readable proposed permissions, changes and the no-self-trust warning; extend its `$help` with the denied-call repair and re-approval workflow while retaining its click authority rule.
- A repo search of `assets/guides/agents`, the template guide, demo, and AiVision descriptors also finds `assets/guides/agents/scripting.md`, `tools.md`, `index.md`, AiVision `fs.ts`, `proc.ts`, `tools.ts`, `root.ts`, and `clipboard.ts`. These discuss general app scripts/tools or non-board APIs and contain no board-manifest permission claim to rewrite. Recheck board-related hits during implementation, especially descriptions reached through `$help`.
- The demo manifest at `assets/demo-board/board-manifest.json` is currently legacy `permissions: ["service", "contentProviders", "capabilities"]`. Its code calls `execute()` / `executeNode()`, service operations, `persephone.call()` and capability invocation, board-scoped open/save/folder dialogs, internal `openRawLink()`, and same-origin `fetch()` of board/stream resources. It does not call `persephone.fetch()`, `readFile()` / `writeFile()`, external OS launch, clipboard reads, or device/notification APIs. Its minimal declared flags are therefore `execute: true`, `service: true`, `fileSystem: "board"` (the file-picker demonstrations are gated), and `appScripting: true`; the remaining flags are false. Provider registration is service-owned, not a permission flag. Migrate it here because it is the bundled template selected by the app's “Demo board” creation flow, rather than deferring an app-shipped board to the external `persephone-boards` catalog task US-1600.
- Current user-facing guide hits needing a future `/userdoc` pass include `assets/guides/boards.md` (trust, manifest and capability wording), `assets/guides/editors/board.md` (permission behavior alongside the trust gate), and `assets/guides/whats-new.md` (legacy trust/disclosure statements and current feature descriptions). These are recorded for epic-close `/userdoc`; do not edit them in US-1599.

## Implementation Plan

1. [x] **Make both default-manifest paths object-form.** In `assets/board-template/board-manifest.json`, include `minBridgeVersion: "1.30.0"` and an object with every flag explicitly false:

   ```json
   "permissions": {
     "execute": false,
     "service": false,
     "fileSystem": false,
     "openExternal": false,
     "appScripting": false,
     "network": false,
     "clipboardRead": false,
     "camera": false,
     "microphone": false,
     "geolocation": false,
     "notifications": false
   }
   ```

   Export the fixed `OBJECT_PERMISSION_BRIDGE_VERSION` from `src/shared/version-utils.ts` and use it in `src/renderer/editors/board/board-manifest.ts:defaultBoardManifest()` so the copy-failure/missing-manifest fallback has the same min version and all-false flags. Do not set the scaffold to `BOARD_BRIDGE_VERSION` (`1.31.0`): `1.30.0` is the compatibility floor for object-form enforcement, and unrelated bridge increments should not raise a fresh board's minimum.

   **Before → after manifest shape:**

   ```json
   // Before: no permission object; normalization treats this as legacy Unrestricted.
   { "schemaVersion": 1, "name": "", "author": "" }

   // After: enforced object form; every capability is explicitly off.
   {
     "schemaVersion": 1,
     "minBridgeVersion": "1.30.0",
     "permissions": {
       "execute": false, "service": false, "fileSystem": false,
       "openExternal": false, "appScripting": false, "network": false,
       "clipboardRead": false, "camera": false, "microphone": false,
       "geolocation": false, "notifications": false
     }
   }
   ```

2. [x] **Keep the default starter usable at all-false.** Update `assets/board-template/app.js` and `assets/board-template/index.html` so loading the template and its default button exercise local UI logic without calling a gated API. Keep backend/`execute()` authoring examples in the guide, each labeled `execute: true`; do not silently add a grant to the default manifest. Preserve the template's unused backend example file only if its README/guide clearly says the author must enable `execute` before wiring it.

3. [x] **Migrate the bundled demo board.** In `assets/demo-board/board-manifest.json`, replace the legacy array with the minimal object-form set inventoried above and set `minBridgeVersion` to `1.30.0`. Explicitly include false for `openExternal`, `network`, `clipboardRead`, `camera`, `microphone`, `geolocation`, and `notifications`; retain true `execute`, `service`, `appScripting`, and `fileSystem: "board"`. Update the demo's `assets/demo-board/index.html` permission/disclosure text and examples so the demo identifies which interactions require each permission and that same-board asset fetches are not `persephone.fetch()`.

4. [x] **Teach the permission model in agent-facing docs.** Update `assets/guides/agents/boards.md`, `assets/guides/agents/board-review.md`, `assets/board-template/CLAUDE.md`, and `assets/guides/agents/ai-vision.md`. Replace every claim that permissions are disclosure-only, trust alone grants every API, or a declaration is merely lifecycle hygiene. Use the US-1598 exact copy/table and document:

   | Permission | Grant level and capability to teach |
   |---|---|
   | `execute` | `true`: run programs/scripts; Full access. |
   | `service` | `true`: run a background program; Full access. |
   | `fileSystem` | `false`: no bridge file APIs/dialogs; `"board"`: board folder plus this board's picked files/folders; `"full"`: any accessible file, Full access. Hosted document and own `board://` assets work at false. |
   | `openExternal` | `true`: allow final OS/browser/application launch; opening links/pages inside Persephone remains available. |
   | `appScripting` | `true`: `persephone.call`, capabilities, app scripts/agent tools; Full access. |
   | `network` | `false`: deny `persephone.fetch`; `"internet"`: public services, local/private blocked; `"full"`: internet, this computer and LAN, Full access. |
   | `clipboardRead` | `true`: read clipboard; clipboard writes remain available. |
   | `camera`, `microphone`, `geolocation`, `notifications` | `true`: grant only that board-frame browser device/API. |

   Use the approved US-1598 copy verbatim:

   - Object-form introduction: **“This board can do only what is listed below. Without any permission it can still show its own pages, work with the document you open in it, copy to the clipboard, and open links inside Persephone.”**
   - All-false summary: **“No permissions requested.”**
   - Legacy label and explanation: **“Unrestricted”** — **“This board uses an older manifest without permission settings, so it can do anything you can: read and write your files, run programs, and use the network.”** Do not imply legacy `service` is enabled unless the old array contains `"service"`.
   - Full-access badge: **“Full access”** with **“Can reach everything your user account can.”** as secondary text.

   | Enabled declaration | Approved user-facing line |
   |---|---|
   | `execute: true` | “Run programs and scripts on this computer.” — Full access |
   | `service: true` | “Run a background program while Persephone is open.” — Full access |
   | `fileSystem: "board"` | “Read and write files in this board's folder (including its own code) and files you pick in its dialogs.” |
   | `fileSystem: "full"` | “Read and write any file you can access.” — Full access |
   | `openExternal: true` | “Open links or files in your browser or another app.” |
   | `appScripting: true` | “Control Persephone: run app scripts, open and change pages, use agent tools.” — Full access |
   | `network: "internet"` | “Connect to public internet services; local and private network addresses are blocked.” |
   | `network: "full"` | “Connect to the internet, this computer, and your local network.” — Full access |
   | `clipboardRead: true` | “Read the contents of your clipboard.” |
   | `camera: true` | “Use your camera.” |
   | `microphone: true` | “Use your microphone.” |
   | `geolocation: true` | “Read this device's location.” |
   | `notifications: true` | “Show desktop notifications.” |
   | `fileSystem: false`, `network: false`, or any other false boolean | No permission line; the flag is disabled. |

   Tell the agent to enable only permissions actually used. Explain that `fetch("./data.json")` or `fetch("board://<host>/data.json")` reads the board's own assets while `fileSystem: false`; `persephone.fetch()` needs `network`. Document the exact rejection form `permission-denied: "<flag>" is not enabled in board-manifest.json` (for example, `permission-denied: "appScripting" is not enabled in board-manifest.json`) and the fix: inspect the source call, add only its required flag/level, then tell the user that an added grant prompts for approval at the board's next open/reload. Pure reductions are reconciled silently under US-1598. Never click **Trust Board** unless the user expressly asks. Explain object-form `minBridgeVersion >= 1.30.0`; legacy manifests remain Unrestricted until migrated.

   Add the EPIC-118 F7 viewer paragraph in the board-authoring and review guidance: viewer boards that render untrusted documents should retain `fileSystem: false` and `network: false`, and never request `execute` or `appScripting`, because injected document script otherwise could persist by rewriting viewer code or reach outward. Keep the board's document-display path and `board://` asset reads working.

5. [x] **Add a grant-to-call review step.** In `assets/guides/agents/board-review.md`, add a checklist item that compares every enabled manifest flag/level with the actual bridge/browser calls and finds both missing grants and unused grants. Include this starting recipe, then require manual inspection of hits and aliases:

   ```sh
   rg -n '(persephone|\bP)\.(execute|executeNode|service|readFile|writeFile|openFileDialog|saveFileDialog|openFolderDialog|call|fetch|capabilities\.invoke)|navigator\.clipboard\.read|navigator\.mediaDevices|getCurrentPosition|new Notification|fetch\(' .
   ```

   For each call, map it to the permission table; inspect `persephone.call()` paths individually (board calls need `appScripting`) and distinguish native same-origin `fetch()` from `persephone.fetch()`. Do not treat a text hit as proof of runtime reachability or completeness.

6. [x] **Update board-related descriptor help.** In `src/renderer/scripting/ai-vision/namespaces/boards.ts`, adjust `createBoard` / `createDemoBoard` summaries and `$help` to describe all-false default manifests and the fact that auto-trust does not widen their grants. In `src/renderer/scripting/ai-vision/dialogs/trust-board.ts`, explain proposed grants, the exact `permission-denied` fix, that permission increases prompt for explicit re-approval at next open/reload, and the user-only accept rule; never suggest the agent accept it. In `assets/guides/agents/ai-vision.md`, state `appScripting: true` is required for a board to use `persephone.call()` and include the exact denial/fix note.

7. [x] **Leave bridge behavior version unchanged.** No enforcement, bridge method, or wire-protocol behavior changes are planned; current enforcement and errors already exist. Keep `BOARD_BRIDGE_VERSION` at `1.31.0`. The manifest's `minBridgeVersion: 1.30.0` is the fixed object-form support threshold, not a requested bridge bump.

8. [x] **Record deferred user-guide edits only.** Do not edit non-agent guides. The “For `/userdoc` at EPIC-119 close” handoff is recorded under Background: `assets/guides/boards.md`, `assets/guides/editors/board.md`, and `assets/guides/whats-new.md` need their permission wording and legacy explanations reconciled after the epic's review.

9. [x] Update the US-1599 row in `doc/active-work.md` to a relative link while preserving `[ ]`, and link the US-1599 row in `doc/epics/EPIC-119.md` to this task.

## Concerns

- The app auto-trusts Persephone-created boards at creation. That trust is only the run-board gate; all-false object permissions still deny gated bridge capabilities. Keep the starter interaction ungated and make the demo's intentional grants explicit.
- `execute`, `service`, and `appScripting` each imply Full access in the US-1598 wording even if a board also has narrower flags. The demo is deliberately an API showcase and its declared set should not be presented as a sandbox against arbitrary code running under those grants.
- `fileSystem: "board"` allows the demo to exercise file dialogs and permits editing its own code. It is suitable for this interactive developer demo, not for a viewer that renders hostile documents.
- Legacy manifests are still Unrestricted (except the existing legacy service rule); this task changes the template and bundled demo, not the external catalog or registered user boards. Their migrations remain US-1600 and US-1601.
- Permission expansions and level increases trigger the US-1598 re-trust dialog at open/reload; pure reductions are applied silently. No immediate manifest-save watcher is part of this task.
- No unit tests are planned or requested. Do not implement or commit as part of this task-document task.

## Acceptance Criteria

- [ ] The bundled blank manifest and `defaultBoardManifest()` fallback contain every permission key explicitly false and `minBridgeVersion: "1.30.0"`; `getBoardCompatibility()` accepts the object-form requirement on supported bridges.
- [ ] Every current board-creation surface is traced to the same manifest-producing path: Explorer blank/demo actions, `CreateBoardDialog`, `app.boards.createBoard()`, and `app.boards.createDemoBoard()`. No new board path emits legacy/missing permissions.
- [ ] A freshly created blank board loads its template JavaScript and its default example interaction without any permission-denied call; the default manifest remains all false.
- [ ] Agent docs replace all disclosure-only/trust-is-unrestricted claims and teach the complete US-1598 flag table, levels, full-access implications, baseline, legacy Unrestricted behavior, exact permission-denied text/fix, own-file `fetch()` route, minBridgeVersion floor, re-approval/user-only trust rule, and viewer safety guidance.
- [ ] `board-review.md` includes the bridge-call/declared-grant comparison step and a usable grep recipe, including a manual check for aliases and `persephone.call()` paths.
- [ ] `assets/demo-board/board-manifest.json` uses object form, the fixed min bridge version, and only the minimum flags needed by verified demo calls; its demo guide no longer describes permissions as disclosure-only.
- [ ] AiVision board creation and trust-dialog help accurately describe all-false defaults, `appScripting` for `persephone.call()`, proposed permissions, and user-only trust acceptance.
- [ ] No board bridge contract or behavior changes; `BOARD_BRIDGE_VERSION` remains `1.31.0`.
- [ ] The task records non-agent guide changes for `/userdoc` at epic close; no non-agent guide is edited here.
- [ ] `doc/active-work.md` and `doc/epics/EPIC-119.md` link to this task; dashboard checkbox remains `[ ]`.
- [ ] No tests, implementation work outside the documented planned scope, or commit are included in authoring this task document.

## Files requiring no changes in this task

| File | Reason |
|---|---|
| `src/renderer/api/tools/tool-scaffold.ts`, `src/renderer/api/mcp/tool-commands.ts` | These scaffold toolsets and expose tool operations; source search found no board creation path in them. |
| `src/renderer/ui/dialogs/CreateBoardDialog.ts`, `src/renderer/editors/explorer/BoardsSecondaryView.ts`, `src/renderer/api/boards.ts` | They already route blank/demo board creation to `createBoardFromTemplate()`; the manifest is supplied/normalized by the template and default-manifest factory. |
| `src/renderer/editors/board/board-scaffold.ts` | It is the common copy/name/author/trust funnel and need not fork permission policy if the bundled manifest and `defaultBoardManifest()` both carry the new object form. Revisit only if implementation finds a route bypassing these sources. |
| `src/shared/board-manifest-utils.ts`, `src/renderer/editors/board/board-fetch.ts`, `src/renderer/api/mcp/board-call-command.ts`, `src/main/board-bridge.ts` | The schema, enforcement gates, `fileSystem` checks, and exact permission errors already exist; this task documents and initializes them without changing bridge behavior. |
| `src/shared/board-bridge-version.ts` | No bridge behavior or wire contract changes; preserve current `1.31.0`. |
| `assets/guides/boards.md`, `assets/guides/editors/board.md`, `assets/guides/whats-new.md` | User-facing changes are deferred to `/userdoc` at EPIC-119 close. |

## Files Changed

| File | Planned change |
|---|---|
| `assets/board-template/board-manifest.json` | Add the all-false object permission map and `minBridgeVersion: 1.30.0`. |
| `src/shared/version-utils.ts` | Export the fixed object-form support version for the default manifest factory to reuse. |
| `src/renderer/editors/board/board-manifest.ts` | Make `defaultBoardManifest()` match the template's object-form false defaults and fixed min bridge version. |
| `assets/board-template/app.js`, `assets/board-template/index.html` | Make the default example run locally without a gated bridge call. |
| `assets/board-template/CLAUDE.md` | Replace legacy permission claims; teach the flag model, safe authoring defaults, and opt-in `execute`/bridge usage. |
| `assets/guides/agents/boards.md` | Rewrite disclosure claims and annotate board capabilities with their required grants and behavior. |
| `assets/guides/agents/board-review.md` | Add permission-to-call verification, grep recipe, permission-denied repair, and viewer safety guidance. |
| `assets/guides/agents/ai-vision.md` | Document `appScripting` requirement for board `persephone.call()` and its refusal/fix path. |
| `assets/demo-board/board-manifest.json` | Migrate from legacy array to minimal explicit object grants, with fixed min bridge version. |
| `assets/demo-board/index.html` | Correct demo permission/disclosure explanations for enforced permissions. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Explain all-false scaffolds and distinguish creation trust from capability grants. |
| `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` | Align descriptor help with proposed grants and user-directed acceptance. |
| `doc/active-work.md` | Link US-1599 to this task while retaining `[ ]`. |
| `doc/epics/EPIC-119.md` | Link the US-1599 row to this task document. |
