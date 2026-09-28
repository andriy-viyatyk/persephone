# US-1558: Remove deprecated `openBoard` intent inputs

## Goal

Remove `options.intent` from `app.boards.openBoard()` and `intent` from the `ILinkData` input shape, deleting the legacy named-board dispatch adapter and its dedicated open-handler plumbing. Preserve `app.boards.openBoard(boardRoot)` and route capability work through `app.capabilities.invoke()`.

## Background

EPIC-115 Phase 4 is the deprecated API removal phase. Its standing rules require a `BOARD_BRIDGE_VERSION` bump for changes visible to board code, and live invocation of each changed message path twice. US-1540 and US-1534 kept both deprecated inputs temporarily and routed them through a root-specific compatibility adapter after the user deferred the deletion decision. The user has now decided to remove them.

Current source has two entry routes to `invokeLegacyBoardIntent()`:

- `src/renderer/api/boards.ts:279-297` accepts `options.intent`, opens the board through `openRawLink`, then fire-and-forget dispatches the request.
- `src/renderer/content/open-handler.ts:7-13, 89-93` reads `data.intent` after opening content and dispatches it. `src/shared/link-data.ts:55-75` strips that field before persistence.
- `src/renderer/api/capabilities.ts:307-320` is the root-specific compatibility adapter. A repository search found no callers beyond those two entry routes.

The type is defined as `ILinkPipeline.intent` in `src/renderer/api/types/io.link-data.d.ts`, with a matching shipped copy in `assets/editor-types/io.link-data.d.ts`. Both also export `IBoardIntent`, which is only declared in those two copies and has no references elsewhere. The board API type in `src/renderer/api/types/boards.d.ts` and its shipped copy, `assets/editor-types/boards.d.ts`, currently accept the options object; the source type also imports `IntentEnvelope` for that option.

`src/renderer/api/pages/PageNavigator.ts` accepts the general `sourceLink?: ILinkData` for persistence/navigation context but does not read or branch on `intent`. `src/renderer/api/pages/PagesLifecycleModel.ts` also does not consume `ILinkData.intent`: `resolveBoardRootForOpen()` remains required by `openSingleInstanceBoard()`, and `openBoardHandlerPage()` remains the capability transport's page opener. These generic page paths should not be removed.

The capability bus's `IntentEnvelope` is a separate contract and stays. `src/renderer/api/board-capability-transport.ts` opens handler pages through `PagesLifecycleModel.openBoardHandlerPage()`; `src/ipc/board-bridge-channels.ts:262` includes the optional initial capability intent in `BoardPortInitMsg`; `BoardWebview.ts` takes and posts it; and `src/board-shim.ts` delivers that request to the board's `persephone.intent` API. This is the live capability route used by `app.capabilities.invoke()`, not the deprecated `ILinkData.intent` field.

The corresponding shipped documentation is limited to direct legacy-route descriptions in `assets/guides/boards.md:420-423` and `assets/guides/scripting/api/app.md:295`, plus the live ai-vision method descriptor in `src/renderer/scripting/ai-vision/namespaces/boards.ts:13`. `assets/guides/whats-new.md` has the current `Version 5.0.4 (Upcoming)` section. Searches of the other relevant scripting/event/io guides found no `ILinkData.intent` description. The `persephone.intent` sections in `assets/guides/boards.md` and `assets/guides/agents/boards.md` describe the board-side capability request API and must remain.

Sibling-repo audit: searching `../persephone-boards` outside vendored libraries, dependencies, and build output found no `openBoard(..., { intent })` or `ILinkData.intent` use. The only matching open instruction is `boards.openBoard` without an intent option in `boards/aivision-explorer/CLAUDE.md:60`.

### Before → after

```ts
// Before
openBoard(boardRoot: string, options?: { intent?: IntentEnvelope }): Promise<void>;

// After
openBoard(boardRoot: string): Promise<void>;
```

```ts
// Before: ILinkPipeline has `intent?: IntentEnvelope` and cleanForStorage removes it.
await app.events.openRawLink.sendAsync(io.createLinkData(href, { intent }));

// After: open the board normally, or invoke a capability through its owning API.
await app.boards.openBoard(boardRoot);
const result = await app.capabilities.invoke(capabilityId, payload);
```

## Implementation Plan

- [x] **Remove the `openBoard` overload and adapter route.** In `src/renderer/api/boards.ts`, remove the `IntentEnvelope` type import, drop the `options` parameter and post-open `invokeLegacyBoardIntent()` branch from `boards.openBoard`, and preserve board validation plus the existing encoded `openRawLink` call. In `src/renderer/api/types/boards.d.ts`, remove the `IntentEnvelope` import and change `IBoards.openBoard` to accept only `boardRoot: string`. Mirror that signature in `assets/editor-types/boards.d.ts`. Keep `openBoard(root)` behavior and its `Promise<void>` return.
- [x] **Remove the `ILinkData` route and its only-use cleanup.** In `src/renderer/api/types/io.link-data.d.ts`, remove the unused `IBoardIntent` alias, the orphaned “One-shot capability request metadata” comment, and `ILinkPipeline.intent`. Apply the same change to `assets/editor-types/io.link-data.d.ts`. In `src/shared/link-data.ts`, stop destructuring `intent` in `cleanForStorage()` because that property is no longer a supported `ILinkData` field.
- [x] **Delete the legacy event handler and compatibility adapter.** In `src/renderer/content/open-handler.ts`, delete `invokeLegacyIntent()`, its `errMessage` import, and the post-open call that resolves a board root and reads `data.intent`; keep page opening, source-link persistence, and `data.handled = true`. In `src/renderer/api/capabilities.ts`, delete `invokeLegacyBoardIntent()` after verifying the two legacy call sites are gone; retain `IntentEnvelope` and other capability-bus types used by the actual capability implementation.
- [x] **Update live and shipped public descriptions.** In `src/renderer/scripting/ai-vision/namespaces/boards.ts`, change the `openBoard` signature/summary to describe only `openBoard(boardRoot: string)` and remove the legacy route text. In `assets/guides/boards.md`, replace the deprecation paragraph at the capability section with a concise statement that scripts should use `app.capabilities.invoke()` for capability calls; retain adjacent board-side `persephone.intent` authoring instructions. In `assets/guides/scripting/api/app.md`, document `openBoard(boardRoot)` without `options?` or the removed behavior. Add a removal note under `Version 5.0.4 (Upcoming)` in `assets/guides/whats-new.md`, matching the current bullet style and directing capability callers to `app.capabilities.invoke()`.
- [x] **Check related guide and type surfaces.** Confirm `assets/guides/scripting/api/index.md`, `assets/guides/scripting/api/events.md`, `assets/guides/scripting/api/io.md`, `assets/guides/agents/boards.md`, `assets/guides/agents/pages.md`, and `assets/guides/agents/scripting.md` contain no remaining description of the removed option or field. Keep the general board-opening and board capability-envelope material intact. Re-run the focused searches in the app repo and `../persephone-boards` for `openBoard` intent options, `ILinkData.intent`, and `IBoardIntent`.
- [x] **Update developer docs.** Remove the deprecated-route notes at `doc/architecture/capability-bus.md` (the "Deprecated `app.boards.openBoard(boardRoot, { intent })`" paragraph, ~line 83) and `doc/architecture/scripting.md` (~line 295); state that scripts call `app.capabilities.invoke()` and that the option and `ILinkData.intent` were removed in US-1558. In `doc/tasks/US-1540-capability-request-lifecycle/README.md`, mark the "Needs user decision" item as resolved: the user decided to remove the option, done in US-1558. In `doc/tasks/US-1534-capability-handler-open/README.md` (no such section), append "Later removed by user decision in US-1558." to the "Public intent overload" Concerns bullet (~line 79).
- [x] **Verify the runtime behavior and bridge decision.** Verify `app.boards.openBoard(root)` still opens the board via the existing generic link pipeline and `app.capabilities.invoke(id, payload)` still resolves board handlers through the capability bus. No board-visible message path changes, so the EPIC-115 “invoke every changed message path twice” rule does not trigger. Do not bump `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts`.

## Concerns

- **Capability envelope versus deprecated input — resolved:** delete only `options.intent`, `ILinkData.intent`, their adapter, and plumbing exclusive to those routes. Keep `IntentEnvelope`, `BoardPortInitMsg.intent`, `BoardWebview` initial-intent delivery, board-shim intent handling, and the `persephone.intent` bridge because the capability bus still uses them.
- **Board bridge version — no bump.** The changed public surfaces are the renderer `app` scripting API and the renderer link-pipeline input. They do not change the board-visible handshake or bridge API: `BoardPortInitMsg.intent` continues carrying the capability bus envelope, `src/board-shim.ts` retains the same board-facing request behavior, and `src/shared/board-bridge-version.ts` is currently `1.24.0`. Therefore this plan does not change `BOARD_BRIDGE_VERSION`.
- **Page navigation/lifecycle — no dedicated legacy plumbing.** `PageNavigator` only carries `ILinkData` as its generic source-link metadata. `PagesLifecycleModel.resolveBoardRootForOpen()` is still used by its single-instance board opener; its capability `openBoardHandlerPage()` remains in use by `board-capability-transport.ts`. Do not remove either method or alter capability-page creation as part of this deletion.
- **IntelliSense exception — resolved:** do not edit `src/renderer/editors/board/board-api.d.ts`, per the user's rule. The requested app API copies are `src/renderer/api/types/boards.d.ts` and `assets/editor-types/boards.d.ts`.
- **EPIC live verification rule — resolved:** this removal changes no board-visible message path. Verify the renderer scripting API behavior, but no repeated board-frame message-path invocation is needed for this task.
- No open questions remain. The dashboard entry and EPIC-115 row already exist and are out of scope for edits.

## Acceptance Criteria

- `IBoards.openBoard` and the runtime `boards.openBoard` accept a board root only; `app.boards.openBoard(root)` still uses the existing encoded link pipeline and opens the board.
- `ILinkData` has no `intent` input, both editor-type copies match the source shape, and no `IBoardIntent` alias remains.
- The legacy `invokeLegacyBoardIntent()` adapter, the open-handler bridge to it, and the public `openBoard` option branch are removed. The capability bus continues to invoke board declarations through `app.capabilities.invoke()`.
- User-facing and ai-vision descriptions no longer mention the removed `openBoard` option or `ILinkData.intent`; the upcoming release notes record the removal. Board-side `persephone.intent` docs remain.
- `../persephone-boards` has no matching use of the removed option/field.
- `src/renderer/api/pages/PageNavigator.ts`, the generic single-instance/lifecycle behavior in `PagesLifecycleModel`, and `src/renderer/editors/board/board-api.d.ts` are not changed for this work.
- No board-visible handshake/message/API changes are made and `BOARD_BRIDGE_VERSION` remains unchanged.
- `doc/active-work.md` and `doc/epics/EPIC-115.md` are not edited.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1558-remove-openboard-intent/README.md` | Record source findings, scope, decisions, and implementation checklist. |
| `src/renderer/api/boards.ts` | Remove the `options.intent` runtime parameter/dispatch branch; retain root-only opening. |
| `src/renderer/api/types/boards.d.ts` | Remove `IntentEnvelope` dependency and make `openBoard` root-only. |
| `assets/editor-types/boards.d.ts` | Mirror the root-only `openBoard` contract. |
| `src/renderer/api/types/io.link-data.d.ts` | Remove `IBoardIntent` and `ILinkPipeline.intent`. |
| `assets/editor-types/io.link-data.d.ts` | Mirror the `ILinkData` type removal. |
| `src/shared/link-data.ts` | Remove the now-obsolete `intent` omission from `cleanForStorage()`. |
| `src/renderer/content/open-handler.ts` | Remove legacy dispatch helper, import, and call. |
| `src/renderer/api/capabilities.ts` | Delete root-specific `invokeLegacyBoardIntent()` adapter. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Remove deprecated option from the live boards descriptor. |
| `assets/guides/boards.md` | Remove obsolete deprecation text while retaining capability guidance. |
| `assets/guides/scripting/api/app.md` | Update `openBoard` signature and description. |
| `assets/guides/whats-new.md` | Record the removal in Version 5.0.4 (Upcoming). |
| `doc/architecture/capability-bus.md`, `doc/architecture/scripting.md` | Drop the deprecated-route notes. |
| `doc/tasks/US-1540-capability-request-lifecycle/README.md`, `doc/tasks/US-1534-capability-handler-open/README.md` | Mark the "Needs user decision" item resolved (removed in US-1558). |

## Files intentionally unchanged

| File or area | Reason |
|---|---|
| `src/renderer/api/pages/PageNavigator.ts` | It has no intent-specific behavior; it carries generic `sourceLink` metadata. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | `resolveBoardRootForOpen()` serves single-instance opens, and `openBoardHandlerPage()` serves the capability transport. Neither is exclusive to the removed inputs. |
| `src/renderer/api/board-capability-transport.ts` | Capability requests still open/reuse handler pages through the bus-owned route. |
| `src/ipc/capability-bus-channels.ts` | `IntentEnvelope` remains the shared capability request contract. |
| `src/ipc/board-bridge-channels.ts`, `src/renderer/editors/board/BoardWebview.ts`, `src/board-shim.ts` | Initial capability intents remain part of the board bridge. |
| `src/shared/board-bridge-version.ts` | No board-visible contract changes; current version is `1.24.0`. |
| `src/renderer/editors/board/board-api.d.ts` | Explicitly excluded by user rule. |
| `assets/guides/agents/boards.md` | Describes board-side `persephone.intent`, which remains supported. |
| `assets/guides/scripting/api/index.md`, `assets/guides/scripting/api/events.md`, `assets/guides/scripting/api/io.md`, `assets/guides/agents/pages.md`, `assets/guides/agents/scripting.md` | Checked references describe root-only board opening, generic link events, or board-side capability intents; they do not document the removed input. |
| `../persephone-boards` | The sibling-repo search found no legacy option/field use; only a root-only `boards.openBoard` instruction matched. |
| `doc/active-work.md`, `doc/epics/EPIC-115.md` | Existing dashboard and epic entries are already present and were explicitly excluded. |

## Verification

- `npm run typecheck`, `npm run lint` and `node scripts/build-prod.mjs` pass.
- Live, in the dev app against the trusted `US1534Demo` scratch board:
  - `app.boards.openBoard(root)` called twice: each call opened the board (the page opens a
    new tab per call, as before this change).
  - `app.capabilities.invoke("demo.greet", …)` called twice: the first call opened the handler
    page and returned the greeting; the second reused the same page id and returned its greeting.
  - `app.boards.openBoard(root, { intent })` from an untyped script, called twice: opened the
    board, returned `undefined`, raised no error; the extra argument is ignored.
- Typings: a scratch TypeScript file against `assets/editor-types/boards.d.ts` and
  `io.link-data.d.ts` reports `TS2554` for `openBoard(root, { intent })` and `TS2353` for
  `{ intent }` on `ILinkData`.
- `BOARD_BRIDGE_VERSION` is unchanged at `1.24.0`; no board-visible message changed.

## Not verified

- That the ignored `{ intent }` is never delivered to the board page is established by code
  removal only; the demo board does not log received requests, so it was not observed live.
- `/review` note (not acted on): an untyped script that still passes `intent` inside link data
  now has it kept in the generic `sourceLink` metadata, because `cleanForStorage()` no longer
  strips it. It is inert — nothing reads it — so no special-case strip was kept for a removed field.
