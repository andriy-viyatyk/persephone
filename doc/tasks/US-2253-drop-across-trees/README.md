# US-2253: Drop across trees

[EPIC-218](../../epics/EPIC-218.md) · Planned · Depends on [US-2251](../US-2251-chunked-provider-writes/README.md) and [US-2252](../US-2252-tree-transfer-engine/README.md)

## Goal

Route supported cross-tree and OS-file drops through `TreeTransfer`, with target confirmation, conflict choices, cancellable progress and per-item failure reporting.

## Background

`src/renderer/components/tree-provider/drop-dispatch.ts:getTraitDropAction` resolves `LINK`, compares `getSourceId` with target `sourceUrl`, and refuses board-owned schemes in its same-source branch. Otherwise it prefers `importLinks`, then `FILE_LINK` and `importFiles`. `TreeProviderView.ts` invokes it twice and routes via `TreeProviderViewModel.ts`; it enables OS drops only for `importFiles`. `CategoryViewModel.ts` uses the dispatcher with link import disabled for its local-file-only folder view and receives the native `DragEvent`. Both consumers must handle the new action.

`TreeProviderView.ts:getDragData` calls `model.dragItemsFor` and returns `{ items, sourceId: provider.sourceUrl }`; the model delegates selection to `provider-item-controller.ts`. `LinkDragData` in `src/renderer/core/traits/linkTraits.ts` carries only those fields; `core-bootstrap.ts` and `content/tree-providers/mnemeLinkTraits.ts` expose them via `LINK`. The factory's `TreeProviderDescriptor` carries type, root, optional URL and config; the factory does not track instances. `tree-provider-identity.ts:boardTreeSourceIdentity` includes stable serialized type, config and root. `ProxyTreeProvider` retains private validated href-to-path maps and private config, and `dispose()` ends its lifetime. Reconstructing from `sourceUrl` is unsafe and risks exposing configuration. US-2252 fixes the live-provider caller API, capability, conflict callback, progress and result shapes; use those contracts unchanged.

Trait drags are accepted only in the originating document (`core/traits/dnd.ts` nonce). Local file-tree drags instead use native OS drag and return as `OsFile` drops, including directories. `TreeDndModel.onDrop` receives a `DragEvent` but calls `onTraitDrop(target, payload, level)` without it. `CategoryViewModel.onDrop` already receives it. Hover sees types only: `TreeDndModel` and `CategoryViewModel` advertise file copy / trait move; `setTraitDragData` sets `effectAllowed = "move"`. No drop handler currently selects an action using modifiers. OS drag data does not identify its source tree.

`tree-drop-actions.ts` provides `moveItemsInto`, `importFilesInto` and `dropOsFilesInto`. The last handles local targets, offers Move/Copy and calls `copyPathsInto`, falling back to byte import for pathless items. `moveItemsInto` handles catalog moves, local batch moves and single-item `rename`; it is not a general board multi-item move. Engine targets require provider list paths, not opaque board hrefs.

`ui.createProgress` delegates to `uikit/Progress/progressModel.ts`; `ProgressOverlayView.ts` projects the first progress item after notifications and has no button. `ConfirmationDialog` accepts custom buttons but no checkbox. `LibrarySetupDialog` / `LibrarySetupDialogView` demonstrate `showDialog`, view registration and `CheckboxView`; reuse those plus `DialogView`, `DialogContentView` and `ButtonView`. English UI text belongs in `src/shared/i18n/en/`; translate at epic close per `doc/standards/localization.md`.

## Implementation Plan

- [ ] **Source identity and lifetime — new `src/renderer/components/tree-provider/tree-drag-source.ts`, `TreeProviderView.ts`, `src/renderer/core/traits/linkTraits.ts`, `src/renderer/api/core-bootstrap.ts`, `src/renderer/core/traits/dnd.ts`.** Own an in-document, drag-scoped mapping of opaque random tokens to actual source providers; never serialize config or parse `sourceUrl`. Add an optional token to `LinkDragData`, exposed by an optional `LINK` accessor implemented by the ILink trait. Register only on host trait drag start; clear on drag end, deferred drop, abandoned drag and source-view disposal, without clearing a newer drag. Reuse nonce gating. Resolve synchronously at drop before deferred cleanup and retain the provider reference for the operation. Check capability and source usability; disposal or invalid mapping must fail safely, without reconstructing credentials or falling through to an unsafe move. The registry does not own or dispose providers. Mneme's trait remains without the token; US-2252 verifies selected links using its adapter.

  ```ts
  // Before: { items, sourceId: provider.sourceUrl }
  // After:  { items, sourceId: provider.sourceUrl, treeDragToken }
  // Resolve token to the exact live provider at drop time.
  ```

- [ ] **Classification — `drop-dispatch.ts`.** Add `{ kind: "transfer", sourceProvider, items }` for supported different-source `LINK` drags and same-tree board copy requests, with a resolved provider and US-2252 transfer capabilities on both ends, gated by a writable target. Pass the captured operation into classification so a same-tree copy is not classified as a move. Consult capability rather than scheme or type guesses; board hrefs are opaque and mapped by the source adapter. Preserve catalog `importLinks` priority and unsupported Mneme/archive/link and ordinary `FILE_LINK` imports. Never route board hrefs to local path operations. Replace the board-scheme blanket refusal for same-source moves with capability-aware handling using validated provider paths and `rename`; retain self/descendant protection via the adapter, not opaque href prefixes. Existing non-transfer providers retain their guards. A missing source for a transfer attempt gets a localized explanation and cannot become a destructive fallback.

  ```ts
  // Before: same source -> move; otherwise import links/files.
  // After: same-source move -> move; same-tree board copy -> transfer;
  //        catalog -> import links; supported different trees -> transfer; otherwise file import.
  ```

- [ ] **Events and operation — `src/renderer/uikit/Tree/types.ts`, `TreeDndModel.ts`, `TreeProviderView.ts`, `CategoryViewModel.ts`, `src/renderer/core/traits/dnd.ts`, new `src/renderer/components/tree-provider/tree-drop-mode.ts`.** Pass native drop modifiers as an additional trailing callback argument, preserving existing callbacks; `CategoryViewModel` forwards its event. `tree-drop-mode.ts` owns mode selection: default cross-tree copy, same-tree move; Ctrl requests copy and Shift requests move on Windows/Linux, Shift taking precedence when both are held. Capture flags synchronously at drop. Opt tree trait drags into `copyMove` without changing unrelated traits. Align hover feedback where source/mode is knowable; protected payloads prevent precise source-dependent hover decisions. Preserve native OS `effectAllowed` restrictions. Local OS drops retain their explicit Move/Copy choice because their source tree is unknowable; board-target OS drops default to copy and Shift requests move. Local same-tree copy uses `copyPathsInto` with `move: false`; never turn a copy request into a move. Ctrl-drop for a supported same-tree board copy calls `TreeTransfer` with the same live provider as source and target and `move: false`; its containment guard refuses a folder copied into itself or its subtree. Same-tree board moves retain `rename`. Route the category view's `transfer` action and refresh after it.

- [ ] **Target resolution and refresh — `TreeProviderView.ts`, `tree-drop-actions.ts`, existing `tree-provider-path.ts` / `tree-provider-node.ts`.** Extract a focused collaborator for target folder and list path from a tree node and its parent, reusing `treeItemListPath` and existing parent lookup. A folder targets itself; a file targets its parent. Route `transfer` and real OS-file drops to shared actions with provider, `{ path, title }` and captured mode. Refresh after any attempted operation, including partial failure or cancellation; refresh source as appropriate without relying on a disposed view. Do not grow roadmap §2.3 `TreeProviderViewModel.ts`; relocate existing wrappers if necessary. Enable `acceptsFileDrop` for writable transfer-capable targets even without `importFiles`, retaining existing import behavior for other providers.

- [ ] **OS paths — `tree-drop-actions.ts` and new `src/renderer/components/tree-provider/tree-drop-os-source.ts`.** `dropOsFilesInto` retains local `copyPathsInto` and byte-only import behavior. For a transfer-capable non-local target, require real `filePath` values, construct a temporary file provider via `createTreeProvider`, list each source parent for actual `ILink`s as US-2252 requires, then invoke the engine. Use a common valid root; partition paths without a common root (e.g. different Windows volumes) into independent batches, aggregate results and share apply-to-all choices. Report pathless or unresolvable entries rather than silently dropping them or buffering bytes. Dispose temporary providers when supported. Cancellation prevents starting further batches; already completed batches cannot be rolled back. Each batch has US-2252's copy-before-delete semantics; never delete in UI code.

- [ ] **Confirmation, conflict and results — `tree-drop-actions.ts`, new `src/renderer/api/dialogs/TreeTransferConflictDialog.ts`, `src/renderer/ui/dialogs/TreeTransferConflictDialogView.ts`, `src/renderer/ui/dialogs/register-dialog-views.ts`.** Confirm copy/move with destination `provider.displayName`, folder title and item count before touching data. Implement US-2252's `onConflict({ source, destinationPath, sourceKind, destinationKind })` returning overwrite, skip or keep-both plus apply-to-all. Reuse `showDialog`, `TDialogModel`, `DialogView`, `DialogContentView`, `ButtonView`, `CheckboxView` and the `LibrarySetupDialog` lifecycle/registration pattern. Close/Escape/cancel aborts the controller; it is not skip or an apply-to-all choice. Engine owns choice caching and kind validation within each batch. Present failed, copied-not-deleted, skipped and cancelled outcomes distinctly with each item and nested failure. `tree-drop-actions.ts` and `os-clipboard.ts` currently show `copyPathsInto` errors in `ui.notify`, capped at five plus a remaining count; that notification alone cannot show every failure. Reuse the existing `src/renderer/api/dialogs/TextDialog.ts:showTextDialog` and `src/renderer/ui/dialogs/TextDialogView.ts` read-only, word-wrapped, scrollable text presentation for the complete summary; no new result dialog is needed. Reuse `errMessage` for unexpected exceptions. Do not promise rollback.

- [ ] **Progress — `src/renderer/uikit/Progress/progressModel.ts`, `ProgressOverlayView.ts`, `Progress.css`.** Extend internal `createProgress(label, options?)` with opt-in cancel and a handle `signal` backed by an `AbortController`. No options means existing behavior and no button. Project the displayed progress item's own identity, cancellation state and callback, so a concurrent item cannot be cancelled accidentally; preserve notification/lock ordering, 300 ms delay, settlement and cleanup. Cancel once, disable the button while cleanup settles and keep the overlay until `show` settles. Supply a localized accessible label. Pass `signal` to `TreeTransfer.transfer`; format `filesDone/filesTotal?`, `bytesDone/bytesTotal?` and `currentName` without inventing totals. Do not change public `app.ui.createProgress` merely for this internal feature; use the internal factory if import zones permit. Check the direct story, `showProgress`, `os-clipboard.ts`, `plural-actions.ts`, both existing `tree-drop-actions.ts` calls, `ui.ts` wrapper and script declarations: existing callers remain unchanged with cancel hidden. Verify concurrent items, rejection, quick completion and notification projection.

  ```ts
  // Before: const progress = createProgress(label);
  // After:  const progress = createProgress(label, { cancelLabel: t("dialogs.buttonCancel") });
  //         await progress.show(transfer({ signal: progress.signal, /* callbacks */ }));
  ```

- [ ] **Localization and validation — `src/shared/i18n/en/menus.ts`, `src/shared/i18n/en/dialogs.ts`.** Add complete sentences, plural forms, placeholders and translator notes for confirmation, conflict, progress, unsupported operations and results; reuse existing button keys. Follow flat `<area>.<entry>` keys. Run `npm run typecheck` and `npm run lint`. Do not plan unit tests. US-2256 UI coverage: local↔board and board↔board copy/move; folder and file targets, multiple selection and mixed OS paths; same-tree fast paths, Ctrl-copy within a board tree, containment refusal and modifiers; target tree named in confirmation; nested conflicts and apply-to-all; cancellation during transfer and conflict, partial results and no uncommitted chunk file; per-item failures and source retention; unsupported, read-only, missing and disposed sources; repeated drag lifetimes; old progress callers, concurrent overlays and keyboard cancel; multi-chunk files and refresh after partial completion.

## Concerns / Open questions

- **Native local drags (decision):** OS payloads contain paths, not a source tree ID. Local targets retain the explicit Move/Copy choice for OS drops; board targets use the mode rules above.
- Source providers may be disposed or become unavailable during async work; report failures safely. Hover cannot inspect protected trait payloads and native OS drags may constrain effects.
- No protocol or `window.persephone` change is planned. If the bridge changes, bump `BOARD_BRIDGE_VERSION` and add its history line. Board rules stay in `src/shared/board/` and board registries. No import-zone bypass, `await import()` cycle workaround or wrapper to evade zones; fix dependency direction. No new logic in `TreeProviderViewModel.ts`.

## Acceptance Criteria

- Supported board/file cross-tree trait drops and real OS-file drops into writable board trees reach `TreeTransfer` with correct providers, links, list path, action and signal. Unsupported and unavailable sources fail safely; existing catalog and file imports work.
- Confirmation names the target tree; conflicts offer all specified choices and apply-to-all. File and byte progress and accessible Cancel work; per-item failure, cancellation and copied-but-not-deleted outcomes are visible. Completed work is not described as rolled back.
- Same-tree moves and local-to-local operations retain existing fast paths; Ctrl-drop on a board tree copies using `TreeTransfer` with the same provider and never moves the source. Existing progress users show no Cancel. UI code never deletes sources.
- Lint/typecheck pass; US-2256 covers the scenarios above. New UI text is in the English catalog, with translations deferred to epic close.

## Files Changed Summary

| Path | Planned change |
|---|---|
| `src/renderer/core/traits/linkTraits.ts`, `src/renderer/api/core-bootstrap.ts`, `src/renderer/core/traits/dnd.ts` | Opaque source token, trait accessor and drag lifetime/effects. |
| `src/renderer/components/tree-provider/tree-drag-source.ts`, `tree-drop-mode.ts`, `tree-drop-os-source.ts` | New source registry, mode policy and OS source preparation collaborators. |
| `src/renderer/components/tree-provider/drop-dispatch.ts`, `tree-drop-actions.ts` | Classification, routing and transfer UI. |
| `src/renderer/components/tree-provider/TreeProviderView.ts`, `CategoryViewModel.ts` | Route actions, modifiers, target resolution and refresh. |
| `src/renderer/uikit/Tree/types.ts`, `TreeDndModel.ts` | Forward drop event and effect feedback. |
| `src/renderer/uikit/Progress/progressModel.ts`, `ProgressOverlayView.ts`, `Progress.css` | Opt-in cancellable progress. |
| `src/renderer/api/dialogs/TreeTransferConflictDialog.ts`, `src/renderer/ui/dialogs/TreeTransferConflictDialogView.ts`, `src/renderer/ui/dialogs/register-dialog-views.ts` | Conflict dialog and registration; reuse the existing `TextDialog` for the complete result summary. |
| `src/shared/i18n/en/menus.ts`, `src/shared/i18n/en/dialogs.ts` | Localized UI messages. |
| `doc/active-work.md`, `doc/epics/EPIC-218.md` | Link this plan. |

**No changes:** `TreeProviderViewModel.ts` must not grow; `tree-provider-factory.ts` and `tree-provider-identity.ts` already provide construction and identity. US-2251 and US-2252 documents and their contracts remain untouched. `assets/languages/` and guides are handled at epic close; no unit-test or protocol files are planned.
