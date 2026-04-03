# US-332: Simplify pageNavigatorModel

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 4, Task 4.1)

## Goal

Remove unused `rootPath` and navigation methods from `PageNavigatorModel`. After US-329 moved Explorer state to `ExplorerEditorModel`, PageNavigatorModel retains dead code: `rootPath` in state, `navigateUp()`, `makeRoot()`, `reinitIfEmpty()`. Simplify it to a pure sidebar layout container with only `open`, `width`, `toggle()`, `close()`, `setWidth()`.

## Background

### Current PageNavigatorModel

**File:** [src/renderer/ui/navigation/PageNavigatorModel.ts](../../src/renderer/ui/navigation/PageNavigatorModel.ts)

```typescript
interface PageNavigatorState {
    open: boolean;
    width: number;
    rootPath: string;    // ← UNUSED since US-329
}

class PageNavigatorModel {
    state: TComponentState<PageNavigatorState>;
    constructor(rootPath: string);      // ← rootPath always "" now
    setStateQuiet(s: Partial<PageNavigatorState>);
    setWidth(width: number);
    toggle();
    close();
    navigateUp();      // ← UNUSED — moved to ExplorerEditorModel
    makeRoot(newRoot);  // ← UNUSED — moved to ExplorerEditorModel
    reinitIfEmpty(rootPath); // ← UNUSED — removed in US-329
    dispose();
}
```

### What's still used

| Method/Field | Used by | Keep? |
|---|---|---|
| `state.open` | Pages.tsx (line 31), TextFileActionsModel (line 42) | Yes |
| `state.width` | Pages.tsx (line 31, 42) | Yes |
| `state.rootPath` | — | **Remove** |
| `toggle()` | PageModel.toggleNavigator (line 264), TextFileActionsModel (line 43) | Yes |
| `close()` | ExplorerSecondaryEditor (line 121) | Yes |
| `setWidth()` | Pages.tsx (line 42) | Yes |
| `setStateQuiet()` | PageModel.restoreSidebar (line 428) | Yes (simplified) |
| `navigateUp()` | — | **Remove** |
| `makeRoot()` | — | **Remove** |
| `reinitIfEmpty()` | — | **Remove** |
| `constructor(rootPath)` | PageModel.ensurePageNavigatorModel (line 242) — passes `""` | Simplify (no rootPath param) |

### Key files

- **PageNavigatorModel:** [src/renderer/ui/navigation/PageNavigatorModel.ts](../../src/renderer/ui/navigation/PageNavigatorModel.ts) — target
- **PageModel:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts) — creates it, calls `setStateQuiet`
- **Pages.tsx:** [src/renderer/ui/app/Pages.tsx](../../src/renderer/ui/app/Pages.tsx) — reads `open`/`width`
- **TextFileActionsModel:** [src/renderer/editors/text/TextFileActionsModel.ts](../../src/renderer/editors/text/TextFileActionsModel.ts) — calls `toggle()`
- **ExplorerSecondaryEditor:** [src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx](../../src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx) — calls `close()`

## Implementation Plan

### Step 1: Simplify PageNavigatorState and class

**File:** [src/renderer/ui/navigation/PageNavigatorModel.ts](../../src/renderer/ui/navigation/PageNavigatorModel.ts)

```typescript
// Before:
export interface PageNavigatorState {
    open: boolean;
    width: number;
    rootPath: string;
}

// After:
export interface PageNavigatorState {
    open: boolean;
    width: number;
}
```

Remove constructor `rootPath` parameter:

```typescript
// Before:
constructor(rootPath: string) {
    this.state = new TComponentState<PageNavigatorState>({
        open: true,
        width: DEFAULT_WIDTH,
        rootPath,
    });
}

// After:
constructor() {
    this.state = new TComponentState<PageNavigatorState>({
        open: true,
        width: DEFAULT_WIDTH,
    });
}
```

Remove `navigateUp()`, `makeRoot()`, `reinitIfEmpty()`. Remove `const path = require("path")` import (only used by `navigateUp`/`makeRoot`).

Simplify `setStateQuiet()`:

```typescript
// Before:
setStateQuiet(s: Partial<PageNavigatorState>): void {
    const current = this.state.get();
    this.state.set({
        open: s.open ?? current.open,
        width: s.width ?? current.width,
        rootPath: s.rootPath ?? current.rootPath,
    });
}

// After:
setStateQuiet(s: Partial<PageNavigatorState>): void {
    const current = this.state.get();
    this.state.set({
        open: s.open ?? current.open,
        width: s.width ?? current.width,
    });
}
```

### Step 2: Update PageModel constructor call

**File:** [src/renderer/api/pages/PageModel.ts:242](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before:
this.pageNavigatorModel = new PageNavigatorModel("");

// After:
this.pageNavigatorModel = new PageNavigatorModel();
```

### Step 3: Update PageModel.restoreSidebar setStateQuiet call

**File:** [src/renderer/api/pages/PageModel.ts:428](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before:
navModel.setStateQuiet({
    open: saved.open ?? true,
    width: saved.width ?? 240,
});

// After (unchanged — already doesn't pass rootPath):
navModel.setStateQuiet({
    open: saved.open ?? true,
    width: saved.width ?? 240,
});
```

Already correct — no change needed.

## Concerns

None. This is a straightforward dead-code removal.

## Acceptance Criteria

- [ ] `rootPath` removed from `PageNavigatorState`
- [ ] `navigateUp()`, `makeRoot()`, `reinitIfEmpty()` removed
- [ ] `require("path")` removed from PageNavigatorModel
- [ ] Constructor takes no parameters
- [ ] All existing sidebar functionality works (open/close/width/toggle)
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/ui/navigation/PageNavigatorModel.ts` | Remove rootPath, navigateUp, makeRoot, reinitIfEmpty, path import |
| `src/renderer/api/pages/PageModel.ts` | Update constructor call (remove `""` arg) |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/ui/app/Pages.tsx` | Only reads `open`/`width` — not affected |
| `src/renderer/editors/text/TextFileActionsModel.ts` | Only calls `toggle()` — not affected |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Only calls `close()` — not affected |
