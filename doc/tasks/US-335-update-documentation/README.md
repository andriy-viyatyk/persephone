# US-335: Update documentation for EPIC-019

**Status:** Done
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 4, Task 4.3)

## Goal

Review and update all architecture documentation, diagrams, and CLAUDE.md to reflect EPIC-019 changes.

## Changes Made

### pages-architecture.md
- Fixed "Rendering in PageNavigator" section: PageNavigator no longer has inline Explorer/Search panels — all panels render through secondary editor registry
- Fixed "Auto-expand" section: replaced `expandSecondaryPanel` event reference with `page.expandPanel(panelId)` direct method

### folder-structure.md
- Fixed PageNavigatorModel description: removed `rootPath` (no longer a field)

### 6-page-architecture.mmd
- Added `selectionState` to ZipEditorModel subgraph (added in US-331)

### Checked and found current
- `editors.md` — `secondaryEditor: string[]` already correct
- `overview.md` — no stale references
- `state-management.md` — no stale references
- `CLAUDE.md` — no stale references
- All other diagrams (1-*, 2-*, 3-*, 4-*, 5-*) — not affected by EPIC-019
