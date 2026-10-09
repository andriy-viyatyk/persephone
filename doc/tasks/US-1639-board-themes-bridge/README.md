# US-1639: themes board permission and persephone.themes bridge

**Epic:** [EPIC-123: Custom themes](../../epics/EPIC-123.md)  
**Status:** In progress; implementation follows the reviewed plan

## Implementation Progress

- [x] Permission normalization, trust-snapshot migration, and shared permission copy.
- [x] Renderer `themes.*` allowlist and Promise-based board shim surface.
- [x] Preview generation tracking and conditional frame cleanup.
- [x] Board bridge version and permission/API guide updates.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`; address reported issues.
- [x] Claude live verification with `themes: true` and `themes: false` scratch boards.

### Live verification (Claude, 2026-10-09)

Two scratch boards (`minBridgeVersion: "1.35.0"`, every flag off except `themes` on one of them),
trusted by the user through the normal trust flow; both were unregistered and the theme they saved
was deleted afterwards.

- **Grant snapshot:** `trustedBoards.json` recorded `themes: true` for the enabled board, and every
  pre-existing trust record still loaded (all other boards stayed trusted) — old records without
  `themes` migrate cleanly.
- **Enabled board:** `bridgeVersion` 1.35.0; `list` 11, `current()` returned the active theme,
  `derive` 77 colors, `contrast` ok, `fork` returned no `id`, `save` → `custom-bridge-test`,
  `rename` changed the name, `get("nope")` → `null`. Every result arrived as plain JSON.
- **Live palette:** after its own `preview`, the board's `onThemeChange` received the preview
  background (`#3a1030`).
- **Disabled board:** `list` (on boot), `preview` and `apply` all rejected with exactly
  `permission-denied: "themes" is not enabled in board-manifest.json`.
- **Narrow route:** on the enabled board, `persephone.call("settings.theme")` still rejected with
  the `appScripting` denial — the `themes` grant opens nothing else.
- **Cleanup by ownership:** a board-owned preview ended on board reload and on closing the board's
  page; a script preview made after the board's preview survived the board's reload.
- Not checked live: navigating the board frame to another document (the reload path exercises the
  same `handleLoad` cleanup), and the trust dialog's wording on screen (the user approved it; the
  label is in `board-permission-copy.ts`).

### Live Verification

Pending Claude's in-app verification. Codex completed the requested typecheck, lint, and production build; it cannot launch Persephone to exercise scratch boards.

## Goal

Expose the existing app.themes service to boards through a narrow, enforced themes permission and the persephone.themes.* bridge. A preview created by a board must be cleaned up when its board frame closes, reloads, or navigates away, without ending a preview that another board or script has since replaced.

## Background

### Permission model and trust snapshots

src/shared/board-manifest-utils.ts defines BoardPermissionFlags, normalizes object-form manifests in normalizePermissions(), allows all flags for legacy manifests in boardPermissionAllows(), and formats denials in boardPermissionError(). Object-form unknown or missing boolean flags normalize to false; adding themes: boolean there therefore makes it off by default. boardPermissionError("themes") produces the standard rejection text:

    permission-denied: "themes" is not enabled in board-manifest.json

EPIC-119 explicitly keeps legacy manifests (missing permissions or the historic array form) unrestricted for every permission except the existing special service rule. Therefore a legacy board can use the themes bridge without adding a flag; object-form boards need themes: true.

src/main/board-trust-service.ts persists each trusted root's normalized grant set in trustedBoards.json. createSnapshots() compares that stored grant with the live manifest, continues enforcing the stored snapshot, and requests re-trust for increases or other non-reduction changes; pure reductions reconcile silently. setTrust() records the reviewed grant. parseTrustRecords() currently validates every known boolean flag explicitly. When adding themes, it must accept old persisted records that lack the new property and migrate the stored grant to themes: false; otherwise one existing record would invalidate the trust file or appear changed merely because the app gained a flag. Missing themes in a live object manifest is also false.

src/renderer/editors/board/board-permission-copy.ts is the shared label source used by TrustBoardDialogView and Board Info. Add themes copy that says: **“Create, change, delete, and apply app themes.”** Preview is also available under this permission, but the label should describe the requested durable theme-management capability and match EPIC-123's wording. BoardInfoEditorFacade projects the same shared permission lines. The normal trust snapshot/change dialog then shows the newly requested line and requires re-trust when an already trusted object's manifest adds themes: true.

### Existing app service and bridge route

US-1638 is implemented and staged. src/renderer/api/themes.ts exports the themes: IThemes service with list, get, current, derive, contrast, fork, save, rename, delete, apply, preview, and endPreview. It already returns cloned structural data; current is an app-side property and preview is synchronous. src/renderer/api/types/themes.d.ts defines the plain public types. The bridge should wrap and forward to this service rather than reimplement theme logic or storage.

The board bridge has two routes worth preserving:

- src/board-shim.ts defines the board-side window.persephone object. Its request/reply rpc() uses BoardRpcMethod, while call(path, options) sends the renderer-rooted AiVision board-call envelope.
- src/main/board-bridge.ts has the exhaustive boardRpcHandlers table and runRpc() enforcement for main-owned methods. It also runs board calls through the renderer's board_call endpoint and JSON-clones their results in jsonSafe().
- src/renderer/editors/board/BoardWebview.ts owns the per-frame boardMessageHandlers table, iframe generations, teardown, and frame reload handling. Its existing permission checks cover app-scripting/capability message paths.
- The current generic persephone.call() permission check is in src/renderer/api/mcp/board-call-command.ts:handleBoardCall(): every path presently requires appScripting. A narrow themes route must be explicitly recognized and require only boardTrust.allows(boardRoot, "themes"); it must not make other persephone.call() paths available. Resolve the supported method on app.themes in the renderer. On denial, propagate boardPermissionError("themes").message so the board Promise rejects with the standard text.

The proposed board namespace mirrors app-service intent but has an asynchronous transport. Expose persephone.themes.current() as a method returning Promise<ThemeDefinition> (mapping to the app.themes.current property); this is the one deliberate shape difference from app.themes, where current is a synchronous property. Document that difference explicitly in the prose bridge guides. All other names retain their app-side method names and return values. Each request argument and response crosses the boundary as plain JSON only: no functions, Error instances, renderer state, theme registry objects, or class instances. Return cloned JSON-safe service results.

### Board theme updates and preview ownership

src/renderer/editors/board/board-theme.ts:computeBoardThemePalette() resolves values from the active theme; ensureBoardThemeSubscription() subscribes to themeState with { id, isDark, revision } as its equality selector and pushes a fresh palette through api.updateBoardTheme(). src/board-shim.ts receives that palette and invokes onThemeChange callbacks. The subscription observes revision changes even when the theme id stays preview, so the Theme Editor board receives its own preview palette and sees edits live. The bridge's preview wrapper must not suppress or replace this existing channel.

Preview ownership is represented by the preview overlay's generation in src/renderer/theme/themes/index.ts, where the preview state itself lives. Add a private monotonically increasing generation and a small getter such as getPreviewGeneration(). Bump it every time the overlay is set or cleared by any path, including app.themes.preview(), app.themes.apply()/endPreview(), and direct registry selection from the Settings picker or theme cycling. The board bridge records the current generation immediately after its preview call succeeds and ends the preview on cleanup only when the current generation still equals that recorded value. A later board preview, script preview, explicit apply, Settings selection, cycle, or other overlay clearing changes the generation and makes stale cleanup a no-op. No service-side owner hook or separate board-theme-preview module is needed.

Lifecycle hooks verified in source:

- Closing/removing a board frame disposes BoardWebview in src/renderer/editors/board/BoardWebview.ts:onDispose(). Main-view branch removal flows through BoardEditorView.syncBranch()/SubtreeSwap; secondary-frame removal flows through BoardSecondaryView.disposeBoardWebview() and onDispose().
- The model reload action increments BoardEditorModel.state.reloadToken in reloadBoard() / runReloadAndWait(). BoardEditorView.syncBranch() and BoardSecondaryView.renderState() include that token in frame identity, replace the view, and dispose the old BoardWebview.
- A frame-level reload or same-frame navigation produces another iframe load event handled by BoardWebview.handleLoad(), which increments the frame generation and replaces the document's bridge state. Cleanup must run for subsequent document loads, not the initial first load.
- Navigating the host page away removes the editor/frame through the same view disposal path. BoardWebview.onDispose() is also the fallback for forced teardown; BoardEditorModel.dispose() has separate final teardown but should not be the primary UI hook.

## Implementation Plan

1. **Add the permission flag with least-privilege defaults.** In src/shared/board-manifest-utils.ts, add themes: boolean to BoardPermissionFlags and normalize it with source.themes === true. Keep boardPermissionAllows() unchanged in policy: legacy grants continue to allow all flags except service unless that legacy array contains service. Keep boardPermissionError()'s shared error format.

   Before:

       notifications: boolean;

   After:

       notifications: boolean;
       themes: boolean;

2. **Preserve and snapshot older grants safely.** In src/main/board-trust-service.ts:parseTrustRecords(), tolerate a serialized flag record from an earlier bridge version without themes, normalize the missing member to false, and retain all other stored grant values. Ensure the normalized/migrated snapshot is persisted through the existing atomic write path. Keep createSnapshots(), permissionReduction(), getGrantedPermissionsFromSnapshot(), and allows() enforcing the trusted snapshot rather than the live manifest. Verify a live manifest change from false/missing to true remains a permission increase and is shown for re-trust; legacy fallback remains unrestricted per EPIC-119.

3. **Add the user-facing permission label.** In src/renderer/editors/board/board-permission-copy.ts, add themes to FLAG_COPY with “Create, change, delete, and apply app themes.” The trust dialog (src/renderer/ui/dialogs/TrustBoardDialogView.ts) and Board Info (src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts) already render shared boardPermissionLines(), so do not add duplicate label maps there. Confirm the permissions-changed list includes the added themes row.

4. **Add the narrow renderer service bridge.** In src/renderer/api/mcp/board-call-command.ts:handleBoardCall(), recognize only the supported themes namespace and methods (list, get, current, derive, contrast, fork, save, rename, delete, apply, preview, endPreview). Require boardTrust.allows(boardRoot, "themes") for those calls, then forward to app.themes in the renderer; current() reads app.themes.current. Keep all other paths behind the existing appScripting requirement. Propagate the standard board permission error string. Do not expose this route through main-process BoardRpcMethod handlers or expand arbitrary AiVision access. After preview succeeds, record getPreviewGeneration() from src/renderer/theme/themes/index.ts for this board frame.

   Board-side surface in src/board-shim.ts should have the shape:

       Before: no narrow themes namespace exists; callers have generic persephone.call(path, options?).
       After: persephone.themes.list() / get(id) / current() / derive(base, isDark?) / contrast(input)
              persephone.themes.fork(id) / save(draft) / rename(id, name) / delete(id) / apply(id)
              persephone.themes.preview(draft) / endPreview()

   Keep persephone.call() semantics unchanged. In src/board-shim.ts, expose themes as a namespace of Promise-returning methods over the existing board-call transport. For every method, validate/forward only JSON-shaped arguments and results. Update src/ipc/board-bridge-channels.ts only if a distinct envelope or type is needed; prefer the existing BoardCallRequest path transport with a narrow themes dispatcher. Keep the renderer-side dispatch allowlist exact.

5. **Track preview generation and clean up conditionally.** In src/renderer/theme/themes/index.ts, add a private monotonically increasing preview generation, bump it every time the preview overlay is set or cleared, and expose a small internal getter such as getPreviewGeneration(). Ensure every path that clears or replaces the overlay goes through the generation-bumping operation; this includes explicit applyTheme() selection used by ThemeSection and cycleTheme(), not only calls through app.themes. After a board preview resolves in src/renderer/api/mcp/board-call-command.ts, store that generation on the owning BoardWebview/frame. In BoardWebview.onDispose(), request cleanup for that frame before dropping its identity; in handleLoad(), do so on each subsequent load/navigation but skip the initial load. Call app.themes.endPreview() only if the current generation still equals the frame's recorded generation.

       if (getPreviewGeneration() === framePreviewGeneration) {
           await app.themes.endPreview();
       }
       // Any later set or clear increments the generation, making stale cleanup a no-op.

6. **Keep board theme notifications live.** No behavior change is expected in src/renderer/editors/board/board-theme.ts, src/board-shim.ts:onThemeChange(), or src/renderer/theme/theme-state.ts: verify the theme-state revision notification sends each new preview palette to all live boards, including the board that requested it. The Theme Editor board is US-1640; do not change its files.

7. **Bump the bridge contract version.** In src/shared/board-bridge-version.ts, make the minor bump 1.34.0 to 1.35.0. Update the current-version statements and new API reference in assets/guides/boards.md, assets/guides/agents/boards.md, and assets/board-template/CLAUDE.md. Add the themes flag to every scaffold-manifest example in assets/board-template/CLAUDE.md, and add "themes": false to assets/board-template/board-manifest.json. Keep unrelated historical minBridgeVersion examples at their original minimum; a board that calls persephone.themes.* must declare minBridgeVersion: "1.35.0".

   assets/board-template/index.html is the visual starter page, not an API reference: it currently mentions execute permission only. Keep its demo behavior unchanged and confirm its wording does not imply the themes bridge is available to the default all-false board.

8. **Update the prose bridge references and permission guides.** Update the permission table and bridge method reference in assets/guides/boards.md and assets/guides/agents/boards.md; update the permission table/call guidance in assets/guides/agents/board-review.md; keep the scaffold's assets/board-template/CLAUDE.md reference pointed at the canonical guide and update its sample permission objects. Document the bridge signatures, permission requirement, standard denial string, JSON-only contract, preview restoration behavior, generation-based cleanup, and minBridgeVersion: 1.35.0. Explicitly state that persephone.themes.current() is a Promise-returning method because the board transport is asynchronous, while app.themes.current is a synchronous property.

9. **Live verification by Claude only.** Codex cannot run Persephone. Claude should open a minimal scratch board with themes: true and minBridgeVersion: 1.35.0, then a second scratch board with themes: false. Verify list/get/current, derive/contrast/fork, preview/apply/save/rename/delete, JSON-only round trips, and the exact standard denial rejection on the false board. Verify preview palette updates arrive live through onThemeChange, then verify cleanup after close, reload, and navigation away. Replace a board preview with a second board preview and with a script preview before closing the first board; the newer preview must remain active. Record observations in a Live Verification section when implementation begins. Do not add unit tests or a test harness.

10. **Keep US-1640 out of scope.** Do not edit the Theme Editor implementation in persephone-boards; its manifest will need themes: true and the 1.35.0 minimum when US-1640 is implemented.

## Concerns / Open Questions

- **Persisted-grant migration is required.** parseTrustRecords() validates a fixed set of keys today. Missing themes in old grant snapshots must become false without discarding the rest of the records. This is an implementation requirement, not an unresolved policy question.
- **Legacy is intentionally broad until US-1609.** EPIC-119's legacy fallback means old manifests without permissions gain the themes capability too. New scaffolded/object-form manifests remain off by default.
- **Do not accidentally grant appScripting.** persephone.call() currently opens the broad renderer object model only with appScripting. The narrow themes dispatcher must check a finite path/method allowlist and the themes grant separately.
- **Generation must cover every overlay path.** The preview generation belongs in src/renderer/theme/themes/index.ts alongside the overlay. Every set or clear, including direct applyTheme() selections, must increment it so the board can distinguish its still-active preview from a replacement or clear.
- **JSON boundary behavior must be explicit.** BoardCallRequest accepts unknown; the new themes surface must reject non-JSON arguments and return only JSON-safe plain values, while preserving method rejection messages.
- **Navigation can be a same-frame load.** handleLoad() also handles first load and must distinguish it from later reload/navigation before triggering cleanup.

## Acceptance Criteria

- Object-form board manifests recognize themes as a boolean flag, default it to false, display the approved trust/Board Info label, and require the user to re-trust when it is newly granted.
- Old persisted trust records load with themes: false; enforcement continues to use the main-owned grant snapshot and never widens from a changed live manifest before re-trust.
- Legacy manifests with no permissions remain unrestricted for themes under EPIC-119's legacy rule; historical array service semantics remain unchanged.
- persephone.themes exposes list, get, current, derive, contrast, fork, save, rename, delete, apply, preview, and endPreview; calls forward to the existing renderer app.themes service, with current() returning the app.themes.current value.
- Every bridge call is gated by themes; denied calls reject with exactly permission-denied: "themes" is not enabled in board-manifest.json. The exception cannot invoke arbitrary persephone.call() paths or grant app scripting.
- Only plain JSON data crosses the themes bridge boundary; results do not expose renderer objects, prototypes, functions, or mutable registry references.
- A board-owned preview ends on frame disposal, reload, or navigation away only when src/renderer/theme/themes/index.ts reports the same preview generation recorded after that board's preview call. A later preview or clear from another board, script, Settings selection, cycle, or apply increments the generation and survives stale cleanup.
- Theme preview revisions continue to reach board-theme.ts and persephone.onThemeChange(), so the board sees its own edited preview palette live.
- BOARD_BRIDGE_VERSION is 1.35.0; current bridge-version documentation, API references, permission tables, and template flag lists describe the themes API and its required minimum version.
- Claude's live verification uses scratch boards with themes: true and themes: false, and records results. No unit tests or harness are added. US-1640 files remain untouched.

## Files Changed Summary

| File | Planned change |
|---|---|
| doc/tasks/US-1639-board-themes-bridge/README.md | This implementation-ready task document. |
| doc/active-work.md | Link the US-1639 active task entry to this document. |
| doc/epics/EPIC-123.md | Link the US-1639 row to this document and reflect task start. |
| src/shared/board-manifest-utils.ts | Add normalized themes boolean flag. |
| src/main/board-trust-service.ts | Migrate old grant snapshots with themes: false; preserve snapshot/re-trust rules. |
| src/renderer/editors/board/board-permission-copy.ts | Add approved themes permission label. |
| src/renderer/editors/board/board-manifest.ts | Default newly created board permissions to themes: false. |
| src/renderer/ui/dialogs/TrustBoardDialogView.ts | No code change expected; it consumes shared permission lines. |
| src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts | No code change expected; it consumes shared permission lines. |
| src/renderer/api/mcp/board-call-command.ts | Add narrowly allowlisted themes dispatch and permission enforcement. |
| src/board-shim.ts | Add the Promise-based persephone.themes wrapper. |
| src/renderer/editors/board/BoardEditorModel.ts | Associate preview generations with individual board transports. |
| src/ipc/board-bridge-channels.ts | Change only if a dedicated envelope/type is required; existing board-call transport is preferred. |
| src/main/board-bridge.ts | No change expected if existing BoardCallRequest route is reused; retain JSON result projection. |
| src/renderer/editors/board/BoardWebview.ts | Record the post-preview generation for its frame and conditionally clean it up on disposal/subsequent load. |
| src/renderer/theme/themes/index.ts | Add preview generation, bump it on every overlay set/clear path, and expose a small internal getter. |
| src/renderer/api/themes.ts | No changes; keep the implemented US-1638 service contract unchanged. |
| src/shared/board-bridge-version.ts | Bump 1.34.0 to 1.35.0. |
| src/renderer/editors/board/board-api.d.ts | No changes - unwired, not maintained; board-surface documentation belongs in prose guides. |
| assets/board-template/board-manifest.json | Add themes: false to the scaffold permission list. |
| assets/board-template/CLAUDE.md | Update current bridge version, permission examples/table/reference. |
| assets/board-template/index.html | No behavior change expected; verify starter bridge/permission guidance remains accurate. |
| assets/guides/boards.md | Add permission row and bridge reference; update current bridge version. |
| assets/guides/agents/boards.md | Add permission row and bridge API reference; update current bridge version. |
| assets/guides/agents/board-review.md | Document themes as the narrow theme-management grant and include it in permission review. |
| src/renderer/editors/board/board-theme.ts | No change expected; revision subscription already pushes live preview palettes. |
| src/renderer/theme/theme-state.ts | No change expected; preview revision is already observable. |
| src/renderer/api/types/themes.d.ts, src/renderer/api/themes.ts public contract, US-1638 guides | No changes; implemented/staged in US-1638. |
| persephone-boards Theme Editor files / US-1640 | No changes; separate task. |
| Unit-test directories / test harness | No changes; live verification only. |
