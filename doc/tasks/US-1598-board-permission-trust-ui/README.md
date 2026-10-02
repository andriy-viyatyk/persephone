# US-1598: Trust dialog and Board Info show granted permissions; re-trust on change

Epic: [EPIC-119: Board permissions](../../epics/EPIC-119.md)

## Goal

Show boards' effective permission grants in plain language in the trust dialog and Board Info, using the main-owned grant snapshot and clearly describing changes from the live manifest. Re-trust when a trusted board requests broader permissions, preserve the stored grant on decline, and safely apply permission reductions.

## Background

### Verified project decisions and current implementation

- EPIC-119 makes permissions enforced and off by default for object-form manifests. Trust records store the normalized set granted at trust time; enforcement uses that stored set until re-trust, never the live manifest or the union. Missing permissions and old arrays remain historically unrestricted, except `service` runs only when an old array contains `"service"`. Any bridge behavior change requires a `BOARD_BRIDGE_VERSION` bump. (EPIC-119, Decisions; US-1593, Background and Enforcement identity and process ownership.)
- The normalized object flags are `execute`, `service`, `fileSystem: false | "board" | "full"`, `openExternal`, `appScripting`, `network: false | "internet" | "full"`, `clipboardRead`, `camera`, `microphone`, `geolocation`, and `notifications`. Object fields normalize to false by default. (`src/shared/board-manifest-utils.ts`, `BoardPermissionFlags`, `normalizePermissions()`.)
- The US-1593 Transitive grants section classifies `execute`, `service`, and `appScripting` as dangerous and implying full access through processes or renderer script execution. EPIC-119 defines `fileSystem: "full"` as any path and `network: "full"` as reaching local/LAN services as well as public network services. This UI will explicitly label all five requested high-impact cases as full access: `execute`, `service`, `appScripting`, `fileSystem: "full"`, and `network: "full"`.
- `BoardTrustService.createSnapshots()` already computes `manifestChanged` by comparing `normalizePermissions(liveManifest.permissions)` with the stored `TrustedBoardGrant.permissions`. It publishes `permissions` as the GRANTED set and `manifestChanged` through `getBoardPermissionGrants`. It does not currently include the live normalized permissions or a per-flag diff in that IPC result. (`src/main/board-trust-service.ts`, `createSnapshots()` and `getPermissionGrants()`; `src/ipc/main/board-handlers.ts`, `Endpoint.getBoardPermissionGrants`; `src/ipc/module-service-channels.ts`, `TrustedBoardSnapshotEntry`.)
- Renderer `BoardTrust.refreshGrants()` currently retains only each entry's `permissions`, dropping `manifestChanged`; `BoardTrust.getGrantedPermissions()` reads this cache. `BoardWebview` already subscribes to grant changes, recreates its iframe when its granted permissions change, and sets `iframe.allow` before navigation because Chromium reads that policy on navigation. (`src/renderer/api/board-trust.ts`, `refreshGrants()`; `src/renderer/editors/board/BoardWebview.ts`, `onMount()`, `createIframe()`, and `refreshIframeGrant()`; US-1597.)
- Initial trust currently reads a normalized manifest in the renderer and passes `boardTrustDisclosure()` into `showTrustBoardDialog()`. `requestBoardTrust()` returns immediately for an already-trusted root, so it does not currently prompt on a permission change. The trust dialog currently prints `Permissions: <raw flag names and levels>` or `Permissions: Unrestricted`; its warning also says trusting grants full user privileges. (`src/renderer/editors/board/request-board-trust.ts`; `src/renderer/editors/board/board-manifest.ts`, `boardTrustDisclosure()`; `src/renderer/ui/dialogs/TrustBoardDialog.ts`; `src/renderer/ui/dialogs/TrustBoardDialogView.ts`.)
- Board Info currently reads the live normalized manifest in `BoardInfoEditorModel.loadProperties()` and presents its permissions as raw-name chips in `BoardInfoEditorView`. The main-owned grant snapshot is not yet its display source. The scripting facade is `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` (the task scope's `BoardInfoEditorFacade.ts` is not located under `editors/board-info/`).
- `TrustBoardDialogAdapter` exposes the dialog's `permissions` property and currently exposes `buttons: ["Cancel", "Trust Board"]`. Its `click()` can return `true` when an agent clicks the exact visible `Trust Board` button; its descriptor warns that the agent must never choose trust on its own judgment and may do so only at the user's direction. The adapter currently has no change/diff property. Keep this accept authority rule unchanged while exposing the permission list and pending change. (`src/renderer/scripting/ai-vision/dialogs/trust-board.ts`.)
- `parseTrustRecords()` currently returns `null` for the entire JSON store when any individual record has a malformed root or permission shape. `BoardTrustService.init()` interprets `null` as a reason to read and migrate `trustedBoards.txt`, which can discard otherwise valid JSON records. Change the parser to skip and log malformed records while retaining valid ones. (`src/main/board-trust-service.ts`, `parseTrustRecords()` and `init()`.)
- The board bridge already watches `boardTrust.subscribeGrants()` for main-owned grant updates, but no source inspection found a watcher of `board-manifest.json` that specifically compares permissions with the granted snapshot. `BoardEditorModel` documents manual Reload board and `pages[i].editor.reload()` as remount paths. A change during an open session is therefore only noticed when a permission-grant refresh occurs; the plan below adds an explicit check on board open/reload and does not promise an immediate prompt on file-save. (`src/renderer/editors/board/BoardWebview.ts`; `src/renderer/editors/board/BoardEditorModel.ts`; `src/renderer/editors/board/BoardToolbar.ts`; source search for manifest watcher.)
- The UI and trust-store parser work changes no board-visible bridge API or bridge protocol behavior. The current `BOARD_BRIDGE_VERSION` is `1.31.0`; no bump is required for US-1598. (`src/shared/board-bridge-version.ts`; US-1597.)

### Proposed permission wording (approved copy)

Replace the existing broad trust warning with this object-form introduction: **"This board can do only what is listed below. Without any permission it can still show its own pages, work with the document you open in it, copy to the clipboard, and open links inside Persephone."** For an object-form manifest with all flags false, show **"No permissions requested."** The introduction already describes the baseline.

For legacy manifests show one label and one line: **Unrestricted** — **"This board uses an older manifest without permission settings, so it can do anything you can: read and write your files, run programs, and use the network."** Do not mention the legacy `service` exception in this copy. Board Info may show `Service: declared` as a secondary detail only when the board actually declares a service.

Use one plain-language line for each enabled object-form flag. `fileSystem` and `network` include their levels. The exact Full access badge text is **"Full access"**; its tooltip or secondary text is **"Can reach everything your user account can."** Render that badge and secondary text once beside each marked permission line using existing UIKit text/badge styling, theme tokens, and components; add no primitive.

| Enabled flag / level | Exact line | Badge |
|---|---|---|
| `execute: true` | **Run programs and scripts on this computer.** | Full access |
| `service: true` | **Run a background program while Persephone is open.** | Full access |
| `fileSystem: false` | No line; this level is disabled. | — |
| `fileSystem: "board"` | **Read and write files in this board's folder (including its own code) and files you pick in its dialogs.** | — |
| `fileSystem: "full"` | **Read and write any file you can access.** | Full access |
| `openExternal: true` | **Open links or files in your browser or another app.** | — |
| `appScripting: true` | **Control Persephone: run app scripts, open and change pages, use agent tools.** | Full access |
| `network: false` | No line; this level is disabled. | — |
| `network: "internet"` | **Connect to public internet services; local and private network addresses are blocked.** | — |
| `network: "full"` | **Connect to the internet, this computer, and your local network.** | Full access |
| `clipboardRead: true` | **Read the contents of your clipboard.** | — |
| `camera: true` | **Use your camera.** | — |
| `microphone: true` | **Use your microphone.** | — |
| `geolocation: true` | **Read this device's location.** | — |
| `notifications: true` | **Show desktop notifications.** | — |

The Full access badge uses the exact one-line secondary text above. Board Info uses the same wording. A legacy display stays **Unrestricted** and is not expanded into an invented list of object-form flags.
### Change prompt and grant decisions

- Main supplies both the stored GRANTED set and a normalized live-manifest set to the renderer. Compute an explicit per-flag diff from those two main-owned values: added grants, removed grants, and level changes (`fileSystem` / `network` old level → new level). For the initial trust dialog, the proposed set is the current normalized manifest; for an already trusted board, the proposed set and diff come from the main snapshot, not a renderer-authored permission object.
- On app start, main computes `manifestChanged` as it already does. Do not show a burst of dialogs for every trusted board at startup; prompt when that board is opened/restored, and again when the user reloads it. A permission edit while a board remains open does not prompt immediately because there is no dedicated manifest-permission watcher; the change is checked at the next open or board reload. The grant remains enforced until the check, so a manifest edit cannot widen access while the current snapshot is active.
- When the change adds a permission or raises a level, open the trust dialog before loading/reloading the board frame. Accept calls the main-owned `setTrust(boardRoot, true)` path, which reads and stores the current normalized manifest grant, then the board trust grant notification causes `BoardWebview` to recreate its iframe so the new `allow` list is applied at navigation. Decline keeps the old grant and lets the board continue under that grant. Remember the declined proposed permission set per normalized board root in renderer memory for the rest of this app session: automatic open/reload does not prompt again for that same proposed set, while a different proposed set prompts. App restart clears this memory. The explicit Board Info review action always opens the dialog again.
- Bind acceptance to the exact proposed set shown in the dialog: main rereads and normalizes the manifest when handling acceptance, compares that value with the proposed snapshot, and persists only the main-read value when they still match. If the manifest changed while the dialog was open, refresh the diff and require a new explicit accept; never grant unseen flags from a stale dialog.
- A pure reduction (flags removed or `fileSystem` / `network` level lowered) applies silently and is logged to the board log, because it cannot widen access. Compare permissions by the normalized schema and define the level order as `false < "board" < "full"` and `false < "internet" < "full"`. A transition from legacy **Unrestricted** to object form is a special migration case: show a one-time change dialog displaying **"Unrestricted ->"** followed by the proposed object-form list (or the all-false explanation), even when it only reduces access. US-1601 explicitly expects each migrated board to show its re-trust dialog once.
- Board Info always labels the GRANTED set. If the board is not trusted and has no grant snapshot, show **"Not trusted — no permissions granted"** and label the live manifest list **"Proposed permissions"**. If a trusted board's live manifest differs, show a separate pending-change block with added/removed/level-changed lines and the same Unrestricted-to-object transition. Include a **"Review permission change"** button in that block; it opens the same change dialog and uses the same acceptance validator. An unresolved increase is not described as granted until accepted.

## Implementation Plan

- [x] Extend the main-owned permission-grant response (`src/ipc/module-service-channels.ts`, `src/main/board-trust-service.ts`, `src/ipc/main/board-handlers.ts`, `src/ipc/api-types.ts`, and `src/ipc/renderer/api.ts`) to include the normalized current manifest permissions alongside the stored `permissions` grant and `manifestChanged`. Keep the stored grant authoritative for enforcement. Ensure every grant refresh rebuilds the snapshot before publishing it; retain malformed-record diagnostics while loading `trustedBoards.json`.
- [x] In `src/main/board-trust-service.ts`, change `parseTrustRecords()` to validate records independently, skip each malformed record, and log the bad record/root and reason. Preserve all valid records; use `trustedBoards.txt` migration only when the JSON document itself cannot be parsed or its top-level `boards` container is invalid, not when one row is malformed.
- [x] In `src/renderer/api/board-trust.ts`, cache both stored grant and live normalized manifest state from the main response; keep a renderer-memory map of declined proposed sets keyed by normalized board root and normalized proposed permissions, cleared on app restart and after acceptance. Expose the difference data to `request-board-trust.ts`, Board Info, and the AiVision dialog adapter; notify grant subscribers when either authoritative grant or change state changes. Keep `getGrantedPermissions()` returning only the GRANTED value for enforcement.
- [x] In `src/renderer/editors/board/request-board-trust.ts`, `src/renderer/editors/board/BoardEditorView.ts`, `src/renderer/editors/board/BoardEditorModel.ts`, and `src/renderer/editors/board/BoardTargetModel.ts`, check trusted-board permission state before mounting the board and on manual/API reload. `BoardToolbar.ts` invokes `BoardEditorModel.reloadBoard()`; route that existing action through the same preflight. For changed permissions, render the old GRANTED list, the proposed list, and the added/removed/level-change diff in `TrustBoardDialog`. On acceptance call the existing `boardTrust.trust(boardRoot)` → `setTrust(boardRoot, true)` flow with an expected proposed-set validator; main rereads the manifest and persists only if its normalized value still matches the set shown. Otherwise refresh the diff and require another explicit accept. Then await refreshed grants and remount. On decline return to the existing trusted board under its old grant. Keep first-time untrusted-board trust and namespace-collision behavior intact.
- [x] Implement silent reductions in main-owned trust reconciliation, using the explicit level ordering above, and append a board-log entry with `append()` from `src/main/board-log.ts` identifying removed flags or lowered levels. Do not silently convert legacy to object form; show the migration dialog once. Ensure main and renderer grant snapshots refresh and open board iframes are recreated after a reduction.
- [x] In `src/renderer/ui/dialogs/TrustBoardDialog.ts` and `src/renderer/ui/dialogs/TrustBoardDialogView.ts`, replace the raw `Permissions: …` line with a readable one-line-per-enabled-flag list using the exact wording table above. Include the empty-object explanation, legacy **Unrestricted** label and explanation, change diff, and visible Full access emphasis. Use existing UIKit `Panel`, `Text`, `Dialog`, and button components, existing theme color tokens, and component spacing props; do not add hardcoded colors or a new primitive. Use the exact object-form and legacy introductions above. Remove the legacy service-exception copy from the trust dialog; only Board Info may show `Service: declared`, and only when declared.
- [x] In `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, read both the GRANTED set and current manifest set from `boardTrust`'s main-owned snapshot. When a board has no grant, show **"Not trusted — no permissions granted"** and label its live declaration **"Proposed permissions"**. In `BoardInfoEditorView.ts`, render the shared permission wording and pending-change diff, with a **"Review permission change"** button inside the pending block that opens the shared change dialog. In `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts`, project the grant and change details and expose an action that opens the same dialog only; it must not accept the dialog.
- [x] In `src/renderer/scripting/ai-vision/dialogs/trust-board.ts`, expose the effective permission lines and pending change through read-only properties and update summaries/help for the new flow. Keep `buttons` and `click()` semantics unchanged: an agent may click the visible trust button only when the user has asked it to trust the board; never infer consent from the permission diff. The Board Info facade review action only opens the dialog and cannot accept it.
- [x] Keep all board bridge method contracts and board-visible behavior unchanged. Do not bump `BOARD_BRIDGE_VERSION` for this UI, trust-store parsing, and main-owned metadata change.

### Before → after

```ts
// Before: trusted boards return without comparing the current manifest to their stored grant.
await boardTrust.load();
if (boardTrust.isTrusted(boardRoot)) return true;

// After: load the main-owned grant and live-manifest comparison before opening/reloading.
const state = await boardTrust.getPermissionState(boardRoot);
if (state.trusted && !state.requiresPrompt) return true;
// Ask for added grants / level increases; retain old grant if declined.
```

```ts
// Before: trust records are discarded as a whole if any one record is malformed.
if (invalidRecord(item)) return null;

// After: preserve sound rows and report each rejected row.
if (invalidRecord(item)) {
    console.warn("[BoardTrustService] Skipping malformed trusted board record", index);
    continue;
}
```

## Concerns

- A file save while a board remains open will not prompt immediately under this plan; it is detected on next open/reload. An immediate prompt needs a dedicated `board-manifest.json` watcher and a safe debounce/read path, which current source does not provide.
- A declined increase leaves the old grant active. The dialog must distinguish the proposed set from GRANTED state so neither the UI nor AiVision implies that the new permissions are active.
- Acceptance must not race a second manifest edit: the main process must verify the displayed proposed set still matches its own current manifest read before replacing the grant.
- Legacy-to-object migration deliberately prompts even when the new object only removes access, matching the EPIC-119 migration note that each US-1601 board shows a re-trust dialog once. US-1601 will show one dialog per migrated board (the user has 33 registered boards); this is expected by EPIC-119 and needs no batching in this task.
- Silent reduction and its log entry must update the main-owned trust record and notify renderers; changing only the displayed manifest would leave enforcement on the broader old grant.
- The trust-record fallback distinction matters: malformed individual rows should not cause otherwise valid JSON trust records to be discarded in favor of the older path list.
- UIKit guidance requires native views and existing tokens/components; preserve dialog focus behavior and existing spacing/color tokens. Do not add a new component or hardcoded CSS color for this list.
- No unit tests are part of the requested task-document work, per the project rule supplied for this task.

## Acceptance Criteria

- [ ] Trust dialog and Board Info show each enabled object-form permission as one plain-language line, with `fileSystem` and `network` levels stated explicitly and exact approved copy recorded above.
- [ ] `execute`, `service`, `appScripting`, `fileSystem: "full"`, and `network: "full"` each show one **Full access** badge and its one-line text **"Can reach everything your user account can."**
- [ ] An object manifest with all flags false says **"No permissions requested."** The exact introduction explains the baseline abilities.
- [ ] Legacy manifests show **Unrestricted** with the exact approved one-line explanation. The old `service` exception stays in code; Board Info may show `Service: declared` only when the board declares a service.
- [ ] Board Info identifies the stored GRANTED set from the main-owned snapshot and separately shows live-manifest changes; the renderer cannot choose or supply a new grant set.
- [ ] For an untrusted board with no grant snapshot, Board Info says **"Not trusted — no permissions granted"** and labels manifest permissions as proposed.
- [ ] Added flags and raised levels prompt on open/reload. Acceptance stores the new manifest-derived grant through `setTrust` only after main verifies it still matches the set shown, then recreates board frames. Decline leaves the previous grant enforced and the board running; automatic open/reload remembers the declined proposed set for this session, while the explicit Board Info review action reopens the same dialog. App restart clears declined-set memory.
- [ ] The pending-change block has a **"Review permission change"** button. Board Info's AiVision/facade action opens the same dialog and cannot accept it; dialog acceptance retains the existing user-directed rule.
- [ ] Pure reductions apply without a prompt, update the main-owned grant and renderer snapshot, recreate affected frames, and write a board-log entry. Legacy-to-object migration prompts once with **Unrestricted ->** new-list wording.
- [ ] Detection triggers are explicit: snapshot comparison at app start, prompt on board open/restore and manual/API reload, no immediate prompt on manifest save while open without a dedicated watcher.
- [ ] AiVision can read the readable permissions and proposed change; its ability to accept remains exactly the current user-directed rule.
- [ ] `parseTrustRecords()` skips and logs malformed individual records while retaining valid records; fallback to `trustedBoards.txt` remains for invalid whole-file/top-level JSON.
- [ ] No board-visible bridge behavior changes; `BOARD_BRIDGE_VERSION` is unchanged.
- [ ] No unit tests or commit are included in this implementation.
## Files requiring no changes

| File | Reason |
|---|---|
| `src/shared/board-manifest-utils.ts` | The normalized permission schema, levels, legacy marker, and permission error are already defined. |
| `src/main/board-bridge.ts` | US-1598 changes trust presentation and stored-grant reconciliation; it does not change board RPC authorization. |
| `src/renderer/editors/board/BoardWebview.ts` | It already applies the main-owned grant to `iframe.allow`, subscribes to grant changes, and recreates the frame on snapshot changes; consume the expanded snapshot through `boardTrust`. |
| `src/shared/board-bridge-version.ts` | No board-visible bridge contract or behavior changes. |
| `src/renderer/uikit/` | Existing UIKit components and tokens suffice; do not add a new reusable primitive. |
| `src/renderer/editors/board/board-manifest.ts` | Existing parsing/disclosure helpers can supply initial untrusted-board metadata; trusted change decisions must use main-owned current and granted snapshots. |
| `src/main/board-log.ts` | The existing `append()` function is the board-log writer; this task only calls it to record automatic permission reductions. |

## Files Changed

| File | Planned change |
|---|---|
| `src/main/board-trust-service.ts` | Return both GRANTED and current manifest permissions; skip/log bad trust records; reconcile silent reductions; support safe trust refresh and frame notifications. |
| `src/ipc/module-service-channels.ts`, `src/ipc/main/board-handlers.ts` | Extend the main-owned permission-grant response with live normalized permissions and change details. |
| `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts` | Extend the trust mutation request with the displayed-set validator and expose current/granted snapshot metadata. |
| `src/renderer/api/board-trust.ts` | Cache current and granted permission states, compute/publish changes, retain a grant-only enforcement accessor. |
| `src/renderer/editors/board/board-permission-copy.ts` | Share the approved plain-language permission lines, Full access text, and pending-change wording. |
| `src/renderer/editors/board/request-board-trust.ts`, `src/renderer/editors/board/BoardEditorView.ts`, `src/renderer/editors/board/BoardEditorModel.ts` | Check for changes on open and reload; prompt for expansions and retain old grant on decline. |
| `src/renderer/editors/board/BoardTargetModel.ts`, `src/renderer/editors/board/BoardToolbar.ts` | Route API and toolbar reload actions through the permission-change preflight. |
| `src/renderer/ui/dialogs/TrustBoardDialog.ts`, `src/renderer/ui/dialogs/TrustBoardDialogView.ts` | Render approved permission copy, unrestricted/all-false descriptions, Full access badges with secondary text, and changes using existing UIKit components. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, `src/renderer/editors/board-info/BoardInfoEditorView.ts`, `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Show the main-owned grant, shared wording, pending-change diff, and dialog-opening review action in the view and facade. |
| `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` | Expose readable permissions and changes while preserving the user-directed accept rule. |
| `doc/active-work.md`, `doc/epics/EPIC-119.md` | Link US-1598 to this task document and retain `[ ]` status. |
