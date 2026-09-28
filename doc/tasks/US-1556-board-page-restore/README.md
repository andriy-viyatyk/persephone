# US-1556: Board Info pages are dropped on restore

## Goal

Restore every persisted Board Info editor regardless of whether its descriptor contains a folder path or a content host. Keep its stable editor/page identities and let `BoardInfoEditorModel.restore()` rebuild properties, install, and optional host state as it already does.

## Background

Board Info was introduced as an editor in US-864 and gained properties mode in US-867. `BoardInfoEditorModel.getRestoreData()` persists its durable state (`title`, `catalogId`, `boardRoot`, `filePath`, `folderPath`, `installDir`) and an optional host descriptor. Its `applyRestoreData()` reads the state from `descriptor.state`, stages a host when present, and `restore()` rebuilds the host and recomputes the install/properties view.

`PagesPersistenceModel.restorePage()` currently has a Board Info special case gated on `state.folderPath` being a string. It is followed by the generic `d.host` case. A plain board, a simple or stream-host board with only `filePath`, or the hub's `openBoardInfoPage()` descriptor with only `catalogId`/`boardRoot` matches neither branch. `board-info` is not in `NO_HOST_EDITOR_IDS`, so the descriptor falls through to the unrecognized-editor warning; with a sidebar the page can remain as an editor-less tab, and without one it is discarded.

This is pre-existing since Board Info was introduced (EPIC-045 / US-864), not a regression in tonight's commits. `git show da7ea15b` confirms that US-864 introduced Board Info while its persistence restore only recognized `d.host` for registry editors. US-1432 later added the `folderPath`-only special case (`git show 89125ae1`), without widening it to the other durable Board Info shapes. `git blame` attributes that narrow branch to US-1432.

The restore-mode checks against current code resolve the supported shapes:

| Persisted shape | Existing `BoardInfoEditorModel.restore()` behavior |
|---|---|
| `catalogId` only | No `boardRoot` means install mode; ensure the install directory and reconcile catalog matches. The catalog id remains available to matching. |
| `boardRoot` only | Properties mode; load the board properties. If the board folder no longer exists, `isBoardFolder()` returns false and `loadProperties()` sets `props.missing`, which is the not-found view. |
| `boardRoot` + `filePath` | Properties mode as above; the file path remains the host-less source for switch matching and navigation. |
| `boardRoot` + `folderPath` | Properties mode as above; `folderPath` remains the folder source used by switch matching. |
| optional `host` | `applyRestoreData()` stages the host descriptor. `restore()` reconstructs the text host in a guarded block, then recomputes properties/install mode; host restoration failure is notified without aborting Board Info restoration. |

No inspected consumer assumes every restored Board Info has a host. The `board-info` case in `editor-switch.ts` is handled before generic file/folder switching; `PageModel` keeps page id and main editor id by descriptor and uses normal editor title state; file-path lookup tolerates a host-less editor; and `openBoardInfoPage()` creates a new page directly without host-based deduplication. No Board Info page deduplication behavior changes here.

## Implementation plan

- [x] Verify all persisted Board Info state fields and the existing restore behavior in `src/renderer/editors/board-info/BoardInfoEditorModel.ts` (`getRestoreData()`, `applyRestoreData()`, and `restore()`).
- [x] Verify the restore branch ordering and history in `src/renderer/api/pages/PagesPersistenceModel.ts` with `git blame` and commit history.
- [x] Check editor-switch, PageModel identity/title and file-path lookup, and the Board Info open helpers for host assumptions.
- [x] In `src/renderer/api/pages/PagesPersistenceModel.ts`, import `BOARD_INFO_EDITOR_ID` from `src/renderer/editors/board-info/board-info-id.ts` and replace the `folderPath`-gated condition with a condition keyed only on `d.editorId === BOARD_INFO_EDITOR_ID`. Retain the existing `editorRegistry.createEditor(d.editorId, d.id)`, `applyRestoreData(d)`, and `restore()` sequence. Keep this branch after the content-host board case but before generic `if (d.host)` so every Board Info descriptor uses its own model, whether host-less or host-bearing.
- [x] Run `npm run typecheck` and `npm run lint`; resolve reported errors. Do not run production build or add tests/test harnesses.

Before:

```typescript
const persistedBoardInfoFolder =
    (d.state as { folderPath?: unknown }).folderPath;
if (
    d.editorId === "board-info"
    && typeof persistedBoardInfoFolder === "string"
) {
    const { editorRegistry } = await import("../../editors/base");
    const editor = await editorRegistry.createEditor(d.editorId, d.id);
    editor.applyRestoreData(
        d as unknown as Parameters<typeof editor.applyRestoreData>[0],
    );
    await editor.restore();
    return editor;
}
if (d.host) {
    // generic host restore
}
```

After:

```typescript
if (d.editorId === BOARD_INFO_EDITOR_ID) {
    const { editorRegistry } = await import("../../editors/base");
    const editor = await editorRegistry.createEditor(d.editorId, d.id);
    editor.applyRestoreData(
        d as unknown as Parameters<typeof editor.applyRestoreData>[0],
    );
    await editor.restore();
    return editor;
}
if (d.host) {
    // generic host restore
}
```

## Concerns

- **Missing installed board:** resolved by the existing `loadProperties()` behavior: absent board manifest yields `props.missing`, not a thrown restore error.
- **Host-bearing Board Info:** the dedicated branch still passes the full descriptor to `applyRestoreData()` before `restore()`, preserving the optional host reconstruction path.
- **Simple/stream-host/file-associated Board Info:** these shapes require no separate reconstruction because their durable `filePath`, `folderPath`, `boardRoot`, and `catalogId` are already restored by `applyRestoreData()` and consumed by existing `restore()`/source-selection logic.
- **Board bridge compatibility:** no `BOARD_BRIDGE_VERSION` bump is needed. This changes only renderer session restoration; no board-facing API, bridge contract, or board-visible behavior changes.
- **Scope:** keep the code fix in `src/renderer/api/pages/PagesPersistenceModel.ts`. Do not edit `doc/active-work.md` or `doc/epics/EPIC-115.md` as the user is updating those entries.

## Acceptance criteria

- A `board-info` descriptor is restored via its registered editor model regardless of whether `folderPath` and/or `host` are absent.
- Install mode with only `catalogId`, properties mode with only `boardRoot`, properties mode with `boardRoot` plus `filePath` or `folderPath`, and a host-bearing descriptor all reach `BoardInfoEditorModel.restore()` with persisted values applied.
- A deleted/missing `boardRoot` displays Board Info's existing not-found state without throwing.
- Existing page id, main editor id, and title behavior remain intact; no consumer gains a requirement for a Board Info host.
- `npm run typecheck` and `npm run lint` complete successfully. No unit tests/test harnesses or production build are added/run.
- No `BOARD_BRIDGE_VERSION` bump and no edits to `doc/active-work.md` or `doc/epics/EPIC-115.md`.

## Verification

Live verification after the fix confirmed that Board Info pages opened via **Board properties**
from a plain board view, a simple board on a file, and a stream-host board on a file all restored
as Board Info in properties mode. This held across two single renderer reloads, two bursts of two
renderer reloads spaced three seconds apart, and two full quit-and-restart cycles, with no
`[restore]` warning. From the restored simple-board Board Info page, **Open board** returned to the
board on the same file.

## Files Changed

| File | Change |
|---|---|
| `doc/tasks/US-1556-board-page-restore/README.md` | Record verified cause, restore-shape evidence, design decisions, and acceptance criteria. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Restore all Board Info descriptors through the dedicated registry branch before generic host restoration. |

## Files intentionally unchanged

| File | Reason |
|---|---|
| `doc/active-work.md` | Existing dashboard entry is maintained by the user. |
| `doc/epics/EPIC-115.md` | Existing epic row is maintained by the user. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Existing durable fields and restore behavior cover the verified shapes. |
| `src/renderer/editors/board-info/open-board-info.ts` | Open paths already persist the required durable fields. |
| `src/renderer/editors/base/editor-switch.ts` | Board Info has a dedicated host-tolerant switch path. |
| `src/renderer/api/pages/PageModel.ts` | Page identity, title, and file lookup do not require a Board Info host. |
| `src/shared/constants.ts` | No board-facing bridge/API change; no bridge version bump. |
