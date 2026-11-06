# US-1772: Remove editor state storage

## Goal

Remove the unused named-state abstraction from text hosts. Epic: [EPIC-137](../../epics/EPIC-137.md); research: [US-1770](../US-1770-editor-architecture-simplification/README.md).

## Background

`src/renderer/editors/base/EditorStateStorage.ts` defines an interface whose sole implementation is `TextFileModel.stateStorage`; no current code reads it. `src/renderer/editors/text/ScriptPanel.ts` and `src/renderer/editors/board/BoardEditorModel.ts` access cache files directly. The separate `getEditorState`/`setEditorState` slot and `mirrorHostSettings` remain in use.

## Implementation Plan

- [x] Delete `src/renderer/editors/base/EditorStateStorage.ts` and its type export from `src/renderer/editors/base/index.ts`.
- [x] In `src/renderer/editors/text/TextEditorModel.ts`, remove its type import and property, retaining `appFs` where otherwise used:

```ts
// Before
readonly stateStorage: EditorStateStorage = {
    getState: async (id, name) => appFs.getCacheFile(id, name),
    setState: async (id, name, state) => { await appFs.saveCacheFile(id, state, name); },
};
// After: property removed
```

- [x] Remove the obsolete member from `doc/architecture/editors.md` and `doc/architecture/diagrams/4-class-hierarchy.mmd`, and the file from `doc/architecture/folder-structure.md`.
- [ ] Search for both names; run the project typecheck/build and lint. Check script-panel and board cached state still restores.

## Concerns

Independent of US-1773 to US-1776. Historical `doc/epics/EPIC-121.md` is a historical account and needs no change. No matching API in scripting, MCP handlers, board bridge or `assets/editor-types/` was found.

Files needing no change: `src/renderer/editors/text/ScriptPanel.ts`, `src/renderer/editors/board/BoardEditorModel.ts`, `src/renderer/editors/base/IContentHost.ts` (it does not declare this property), and `doc/epics/EPIC-121.md`.

## Acceptance Criteria

- [ ] No live `EditorStateStorage` or `stateStorage` references remain; direct cache and editor-settings mechanisms still work.
- [ ] Architecture documentation reflects the removed property; checks pass.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/base/EditorStateStorage.ts` | Delete |
| `src/renderer/editors/base/index.ts` | Remove export |
| `src/renderer/editors/text/TextEditorModel.ts` | Remove import and property |
| `doc/architecture/editors.md`, `doc/architecture/diagrams/4-class-hierarchy.mmd`, `doc/architecture/folder-structure.md` | Remove obsolete descriptions |

## Implementation notes

No deviations. Typecheck, lint, production build and removed-symbol search passed. Script-panel and board cached-state restoration still require a running app; acceptance checks remain pending.
