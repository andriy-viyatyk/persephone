# US-1771: Board toolbar breadcrumb control

**Status:** Implemented; live verification pending  
**Epic:** [EPIC-137: Notebook moves to a published board](../../epics/EPIC-137.md)

## Goal

Add a host-rendered `breadcrumb` toolbar control to the board bridge so boards can move path navigation into the page toolbar. The Notebook board can subsequently move its breadcrumb, search and Add Note controls there; its changes are outside this task.

## Background

- `src/ipc/board-bridge-channels.ts` defines the six existing types, descriptor union, broad patch type, and action message. `src/board-shim.ts` forwards `set`/`update` and explicitly checks action types before invoking `onAction` subscribers. `src/renderer/editors/board/BoardWebview.ts` gates messages, normalizes them and logs warnings to `ui.log`; it forwards actions through the existing frame channel.
- `src/renderer/editors/board/BoardToolbarControls.ts` validates IDs/types and fields, ignores invalid or duplicate descriptors with warnings, counts accepted controls toward the eight-control cap, merges patches, owns/mounts views and publishes live element declarations. An older host's `CONTROL_TYPES` rejects an unknown `breadcrumb` descriptor with an invalid-descriptor warning; its other valid descriptors still render. A manifest requiring 1.49.0 is subject to the existing version compatibility gate, so a board that needs fallback on older hosts must choose its manifest and feature detection accordingly.
- `src/renderer/editors/board/BoardToolbar.ts` places Explorer, the non-shrinking start button/menu group, a flexible text panel, normal board controls, the host menu and editor switch in that order. The text panel is **empty by default**, not a displayed file path: `setText()` fills it, and its tooltip contains the board root only while text is present. The path remains available in Board properties and Copy Board Path.
- `src/renderer/uikit/Breadcrumb/BreadcrumbView.ts` renders root and segments, ignores clicks on the current item, and emits `""` for a non-current root. `separators` is a set of individual separator characters, not a delimiter string: `splitWithSeparators()` trims segments and drops empty ones; ancestor values are rejoined using the first separator character. The view defaults to `/\\`, so the bridge must explicitly pass `/` for its own default. `clipStart` reverses DOM order and CSS layout to keep the current end visible. The view has no disabled prop; its native rest props are applied only at construction, not updated.
- The built-in `NotebookBreadcrumbView` in `src/renderer/editors/notebook/index.ts` uses `size: "sm"`; for tags it uses `separators: ":"` and `trailingParentSeparator: true`. The proposed bridge does not expose that latter option: tag ancestor events will lack the trailing `:`. The Notebook board must adapt its own navigation when migrated. It is not part of this task.
- `publishDeclarations()` exposes named control roots through `BoardEditorModel.getLiveToolbarElementDeclarations()` and `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` `elements`, subject to main-frame, trust and lifetime gates. `src/renderer/editors/board/board-api.d.ts` does not declare toolbar types. `assets/board-template/CLAUDE.md` independently enumerates them; `assets/demo-board` demonstrates segmented controls but does not enumerate the type catalog.

## Implementation Plan

- [x] Extend `src/ipc/board-bridge-channels.ts`: add `"breadcrumb"` to `BoardToolbarControlType`, add the descriptor and `rootLabel`/`separators` patch fields. Keep the shared action value type string-compatible. Contract:

  ```ts
  // Before: "button" | "toggle" | "menu" | "select" | "segmented" | "input"
  // After: the same union plus "breadcrumb", with this descriptor:
  { id: string; type: "breadcrumb"; rootLabel: string; value: string;
    separators?: string; title?: string; disabled?: boolean }
  ```

  `rootLabel` and `value` must be strings (empty is valid); `separators`, when supplied, must be a nonempty string. Default it to `/`. Allow `update()` to change `value`, `rootLabel`, `separators`, `title`, and `disabled`: separators can change when the same navigation control switches domains (as in Notebook categories/tags), and updating it together with the value avoids replacing the catalog. Validate invalid patch fields consistently with existing patches and re-normalize merged descriptors; reject incompatible fields with the existing warning pattern. Do not allow `type` changes or placement patches.
- [x] In `src/renderer/editors/board/BoardToolbarControls.ts`, add the type to `CONTROL_TYPES`; add a breadcrumb branch before the final input branch in `normalizeToolbarControl`, extend `normalizeToolbarControlPatches` and `mergePatch`, and ensure invalid or empty separators cannot reach the view. Keep IDs, duplicates, cap and catalog lifecycle consistent with other controls.
- [x] Add `BreadcrumbView` to `ToolbarRecordView` and `ToolbarControlRecord` creation/update/disposal. Pass `name: board-toolbar-control-<id>`, `rootLabel`, `value`, `separators: descriptor.separators ?? "/"`, `size: "sm"`, `clipStart: true`, and an `onChange` callback. Handle `title` and disabled state on the root on **every** update (rest props alone do not update). Block all click actions while disabled, reflect the state with `aria-disabled` and a scoped disabled visual/cursor treatment; re-enable on patch. No new host text is expected; any introduced user-visible string belongs in `src/shared/i18n/en/` per `doc/standards/localization.md`.
- [x] On ancestor click, emit `{ id, type: "breadcrumb", value }` through the existing `BoardToolbarView` → `BoardWebview.sendToolbarControl` route and update the record's value/view immediately, matching the existing host-owned uncontrolled select/segmented behavior. Root emits `""`; current root or final segment emits nothing. The board may subsequently patch the value. In `src/board-shim.ts`, admit `"breadcrumb"` in the `toolbar:control` type guard (the explicit `data.type !==` chain in the `onHostMessage` handler) and add it to the `PersephoneToolbarActionEvent` type, preserving its string value for subscribers.
- [x] In `src/renderer/editors/board/BoardToolbarControls.ts` and `src/renderer/editors/board/BoardToolbar.ts`, place breadcrumbs in a flexible start region **after** existing `placement: "start"` buttons/menus and before normal controls. Keep start buttons/menus in declaration order. When one or more breadcrumbs exist, hide the `setText()` text panel but retain its state; restore it when the last breadcrumb is removed. Thus breadcrumbs take the flexible width, and multiple breadcrumbs share it equally in their declaration order, each shrinkable with `min-width: 0`. Keep Explorer and host actions visible. Adjust container flex/shrink/overflow styles (including `src/renderer/editors/board/BoardToolbar.css` if needed), and update `publishDeclarations()` location text and visibility bookkeeping for the new region. Changing a catalog, reloading or clearing the frame must update layout and declarations together.

  ```text
  Before: Explorer | start buttons/menus | flexible setText slot | controls | host actions
  After:  Explorer | start buttons/menus | flexible breadcrumb(s) | controls | host actions
          (without breadcrumbs the existing setText slot is shown)
  ```

- [x] In `src/shared/board-bridge-version.ts`, bump `1.48.0` → `1.49.0`. Update `assets/guides/agents/boards.md` version history and Host-rendered board toolbar section, including fields, update behavior, path normalization, placement, disabled behavior, action example and compatibility. Update its `setText` description for the hidden-but-retained slot. Update the equivalent version history, type catalog and text-slot description in `assets/board-template/CLAUDE.md`; add a concise entry in `assets/guides/whats-new.md`. Update the board-toolbar and bridge-version descriptions in `doc/architecture/key-files.md`, and the bridge version in `doc/architecture/overview.md`; check `doc/architecture/folder-structure.md` toolbar description for accuracy.
- [x] Run `npm run typecheck`, `npm run lint` and `npm run build-prod` and fix what they report. Do not add unit tests or test harnesses (this project does not use them). Live verification on a trusted test board through the Persephone MCP (set/update, root/ancestor/current clicks, separators, disabled, narrow width, reload, `BoardEditor.elements`) is done by Claude after implementation; record any check you could do yourself.


Checks: `npm run typecheck`, `npm run lint`, and `npm run build-prod` passed. The production build emitted dynamic-import and chunk-size warnings. Live trusted-board scenarios remain for Claude.

## Concerns

- `BreadcrumbView` treats a separator string as a character set, strips whitespace around segments and empty segments, and joins returned ancestors with its first character; it does not preserve mixed separators. The bridge contract documents this rather than implying byte-for-byte path prefixes. Nonempty separators prevent an ambiguous empty join character.
- The proposed event intentionally omits Notebook's tag-specific trailing separator. The board migration must append it when its category/tag model requires it; do not silently change the bridge event contract or built-in Notebook here.
- A breadcrumb masks rather than clears `setText()` while present. Existing text and board-root tooltip return when breadcrumbs are removed. Multiple breadcrumbs share available width; verify narrow layouts still let regular controls and host actions work.
- UIKit breadcrumb segments are spans, and its click handler has no disabled support. Implement disabled behavior explicitly and verify pointer/action suppression and accessible disabled state; do not assume native `disabled` works on a div. `clipStart` changes DOM order, which automation should account for.
- No unresolved design questions block implementation. Notebook board changes in `persephone-boards/boards/notebook` and built-in Notebook removal (US-1769) are excluded.

## Acceptance Criteria

- [ ] A trusted main-frame board can declare up to eight total controls including breadcrumbs, update supported fields, and receive the specified ancestor/root actions; current and disabled items send none.
- [ ] Default `/` and custom nonempty separator character sets work as documented, including an updated separator; malformed controls/patches are safely handled with warnings and unknown types on an older host are ignored with a warning.
- [ ] Breadcrumbs use the existing small `BreadcrumbView`, clip the start on overflow, occupy the flexible start area after start buttons/menus, share space when multiple are declared, and preserve ordinary controls and host actions.
- [ ] `setText()` is hidden while breadcrumbs exist and restored, with its tooltip, when they are removed; no board path appears as default text.
- [ ] Each breadcrumb has `data-name="board-toolbar-control-<id>"`, appears in `BoardEditor.elements` under the existing trust/frame rules, and disappears when its catalog or frame is retired.
- [ ] Bridge version is 1.49.0; user and developer documentation describe the contract and compatibility; relevant checks and manual scenarios pass. No Notebook implementation or commit is included.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/ipc/board-bridge-channels.ts` | Descriptor, patch and type union |
| `src/board-shim.ts` | Accept breadcrumb action type |
| `src/renderer/editors/board/BoardToolbarControls.ts` | Validation, patching, view, actions, layout region and declarations |
| `src/renderer/editors/board/BoardToolbar.ts`, `src/renderer/editors/board/BoardToolbar.css` | Flexible region, text-slot coexistence and styling as needed |
| `src/shared/board-bridge-version.ts` | Bridge 1.49.0 |
| `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, `assets/guides/whats-new.md` | Board author documentation and release note |
| `doc/architecture/key-files.md`, `doc/architecture/overview.md`, `doc/architecture/folder-structure.md` | Update affected architecture descriptions |

**No changes expected:** `src/renderer/editors/board/board-api.d.ts` (no toolbar declarations); `src/renderer/editors/board/BoardWebview.ts`, `BoardEditorModel.ts`, `BoardEditorView.ts`, and `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` (existing transport and declaration pipeline); `src/renderer/uikit/Breadcrumb/BreadcrumbView.ts` (use its existing API); `src/renderer/editors/notebook/`, `persephone-boards/boards/notebook/` and `assets/demo-board/` (out of scope or no exhaustive type list). Revisit only if implementation evidence requires it.

## Live verification (Claude, 2026-11-06)

Checked in a separate window with the Notebook board (persephone-boards, minBridgeVersion 1.49.0) on a disposable copy of the demo notebook:

- `breadcrumb`, `input` and text `button` controls render in the host toolbar and appear in `BoardEditor.elements` as `board-toolbar-control-path`, `-search`, `-add`.
- Parent segment click sent the ancestor path (`Development`), root click sent `""`; tag path `env:prod` with `separators: ":"` rendered All notes › env › prod and the `env` click selected the `env:` group.
- Search input and Add Note actions reached the board; Add Note's state reset cleared the host input through `update()`.
- No warnings in the board `ui.log`.

**Fix applied after implementation:** `BoardToolbar.css` stretched the breadcrumb (`flex: 1 1 0`); with `clipStart` (`row-reverse`) that pinned a short path to the right edge, next to the board's controls. The breadcrumb is now content-sized (`flex: 0 1 auto; min-width: 0`) inside the flexible region, so a path that fits sits at the left and a long one shrinks and clips its start.

Not exercised live: `disabled` breadcrumb, multiple breadcrumbs, narrow window widths.
