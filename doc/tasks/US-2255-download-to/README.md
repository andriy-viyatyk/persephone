# US-2255: Download to…

[EPIC-218](../../epics/EPIC-218.md) | Planned | Depends on [US-2251](../US-2251-chunked-provider-writes/README.md), [US-2252](../US-2252-tree-transfer-engine/README.md), [US-2253](../US-2253-drop-across-trees/README.md), and [US-2254](../US-2254-paste-across-trees/README.md)

## Goal

Offer a board-tree context-menu action to copy selected files and folders to a user-chosen local folder using the shared transfer workflow.

## Background

`src/renderer/components/tree-provider/provider-item-controller.ts:onItemContextMenu` builds file/folder menus with `item-menus.ts`, or a plural menu with `plural-actions.ts:buildMultiItemMenuItems`; it preserves a selection only when the right-clicked row is selected, then sends `linkContextMenu` with the clicked item. The controller serves Explorer and folder pages. `src/renderer/editors/explorer/ExplorerSecondaryView.ts:treeProps` enables multi-select; `src/renderer/editors/category/CategoryEditor.ts:categoryViewProps` currently enables it only for local files, and US-2254 extends the gate for board transfer capability. `ProxyTreeProvider` uses private href/path mappings; the US-2252 source capability validates selected links and transfers file and folder trees, including read-only sources. Root rows are synthetic, not listed children.

The existing picker is `api.showOpenFolderDialog({ title })` from `src/ipc/renderer/api`, as used by `src/renderer/api/menu-folders.ts:addWithDialog`; `src/main/native-dialogs.ts:showOpenFolderDialog` returns a `string[] | undefined`, with cancellation returning undefined and directory selection remembered. `src/renderer/content/tree-providers/tree-provider-factory.ts:createTreeProvider({ type: "file", rootPath })` constructs a local provider. US-2252's fixed `TreeTransfer.transfer` accepts live source and target providers, selected `ILink`s and target provider list path; US-2253 already plans target confirmation, conflict dialog, cancellable progress and complete result presentation. Reuse those collaborators without redesigning them.

## Implementation Plan

- [x] **Availability and menus - `src/renderer/components/tree-provider/provider-item-controller.ts`, `item-menus.ts`, `plural-actions.ts`, `src/renderer/content/tree-providers/tree-provider-capabilities.ts`.** Use US-2254's explicit transfer source classification/capability (`board`, readable) at the capability boundary, never `provider.type`, URL or scheme matching. Offer localized **Download to…** for supported board files and folders, including read-only boards, and once for a multi-selection; do not offer it on local, archive, Mneme, link or unsupported providers. Hide it for a synthetic board root that the fixed US-2252 contract cannot validate as a listed source. Reuse the controller's selected/right-click behavior and validated transfer capability for nested selections; do not prune opaque board hrefs by string prefix. Wire single and plural callbacks to the same action, preserving Copy Href and `linkContextMenu` subscribers. US-2254 enables board multi-selection in the folder page; verify both tree and folder view. Recheck source capability at click time.

  ```ts
  // Before: board item menu has Copy Href and provider edit actions.
  // After:  a readable board transfer source also offers Download to… for the selected items.
  ```

- [x] **Picker and transfer - new `src/renderer/components/tree-provider/tree-download-actions.ts`, `provider-item-controller.ts`, US-2253 `tree-drop-actions.ts`.** This collaborator owns picker sequencing and temporary target lifetime. Call `api.showOpenFolderDialog({ title: t(...) })` once, return without side effects on cancellation or empty result, and use its first chosen folder as both `rootPath` and `folderPath`. Create `createTreeProvider({ type: "file", rootPath: folder })` only after selection. Pass the source provider and selected links, temporary target and `move: false` to US-2253's shared transfer action, which invokes the US-2252 `TreeTransfer` API and provides its existing destination confirmation, conflict, progress/cancel and result UI. Do not copy bytes or delete sources in this action. Dispose the temporary local provider in `finally`, including failure and cancellation. Refresh any open local target views through existing provider watch/refresh behavior; do not claim a refresh of a view this action does not own. If the source page closes or provider is disposed while the picker or transfer is open, fail visibly without a destructive fallback; use the independently owned source capability from US-2254 when retaining across the asynchronous picker, rebuild selected parent mappings and release it in `finally` so page closure does not invalidate an otherwise usable operation. Never silently use stale/missing items.

  ```ts
  // Before: no remote-to-local folder action.
  // After:  pick folder -> createTreeProvider({ type: "file", rootPath: folder })
  //         -> shared transfer({ provider: source, items }, { provider: local, folderPath: folder }, { move: false }).
  ```

- [x] **Text and validation - `src/shared/i18n/en/menus.ts`, `src/shared/i18n/en/dialogs.ts`.** Add Download to… and picker title (plus only necessary failure text); reuse US-2253 messages for confirmation, conflicts, progress and results. English only now; translations at epic close. Run `npm run typecheck` and `npm run lint`. No unit tests. US-2256 UI tests: single file, nested folder and mixed multi-selection; Explorer and folder views, right-click outside selection; read-only board source and no action for unsupported/local sources or synthetic root; picker cancellation and invalid/inaccessible destination; source page closed during picker, missing/unavailable source; overwrite/skip/keep-both and apply-to-all; cancel during multi-chunk transfer, partial/error summary and no source deletion; local file bytes and target refresh.

## Concerns / Open questions

OS drag-out remains outside scope. Board root rows are not listed source items and remain unavailable until the US-2252 capability can validate them. Service loss or source changes can make a chosen item unavailable; report the shared per-item failure and retain all sources. A cancelled or partly successful copy can leave completed files, as specified in US-2252/2253.

No new protocol, board rule outside `src/shared/board/` and board registries, or `window.persephone` change is planned. If a bridge change becomes necessary, bump `BOARD_BRIDGE_VERSION` and add its history line. Do not add logic to roadmap section 2.3 `TreeProviderViewModel.ts`; do not use `await import()` or a wrapper to bypass import zones. Strict-folder changes must pass typecheck.

## Acceptance Criteria

- Download to… appears on supported board files/folders and selected sets, including read-only sources, based on capability and with the root limitation stated above; it is absent for unsupported trees.
- Folder picker cancellation does nothing; selection copies via a temporary local tree provider and the shared US-2253 UI, handles conflicts, cancellation and failures, and disposes owned providers. Source items are never deleted.
- Both Explorer tree and board folder-page multi-selection work. English text is catalogued; lint/typecheck pass and US-2256 covers the listed cases.

## Files Changed Summary

| Path | Planned responsibility |
|---|---|
| `src/renderer/components/tree-provider/tree-download-actions.ts` | New picker, owned providers and shared transfer invocation. |
| `src/renderer/components/tree-provider/provider-item-controller.ts`, `item-menus.ts`, `plural-actions.ts` | Single/multi menu action and callback. |
| `src/renderer/components/tree-provider/tree-drop-actions.ts` | Expose/reuse US-2253 transfer UI if needed. |
| `src/shared/i18n/en/menus.ts`, `src/shared/i18n/en/dialogs.ts` | Action, picker and necessary failure messages. |
| `doc/active-work.md`, `doc/epics/EPIC-218.md` | Plan links. |

**No changes:** US-2251/2252/2253 plans; `TreeTransfer.ts` and provider wire/bridge contracts; `TreeProviderViewModel.ts`; folder picker implementation; `assets/languages/` or unit-test files. US-2254 owns the capability, independent source lifetime and board folder multi-select prerequisites.
