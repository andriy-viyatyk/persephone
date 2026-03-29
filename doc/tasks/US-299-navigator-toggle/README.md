# US-299: Unify PageNavigator Toggle Button Across Editors

**Status:** Complete
**Epic:** EPIC-015 (Phase 3)
**Depends on:** US-297 (CategoryEditor) — in progress

## Goal

Replace the duplicated "File Explorer" toggle button logic in TextToolbar, PdfViewer, and ImageViewer with calls to `NavigationData.toggleNavigator()` and `NavigationData.canOpenNavigator()`. These methods were introduced in US-297 and centralize the logic for opening/closing the PageNavigator panel.

## Background

### Current state (duplicated logic)

The "File Explorer" button appears in three editors with identical copy-pasted logic:
- `src/renderer/editors/text/TextToolbar.tsx` (line ~78)
- `src/renderer/editors/pdf/PdfViewer.tsx` (line ~127)
- `src/renderer/editors/image/ImageViewer.tsx`

Each does:
```typescript
if (model.navigationData) {
    model.navigationData.pageNavigatorModel?.reinitIfEmpty(fpDirname(filePath), filePath);
    model.navigationData.ensurePageNavigatorModel().toggle();
} else {
    const navData = new NavigationData(fpDirname(filePath));
    const navModel = navData.ensurePageNavigatorModel();
    navModel.id = model.id;
    navModel.flushSave();
    model.navigationData = navData;
    model.state.update((s) => { s.hasNavigator = true; });
}
```

The button is only shown when `filePath` exists.

### New API (from US-297)

`NavigationData` now has:
- `toggleNavigator(pipe?, filePath?)` — handles all cases: existing provider, file pipe, filePath fallback
- `canOpenNavigator(pipe?, filePath?)` — returns whether the button should be shown

CategoryEditor already uses `toggleNavigator()` (no pipe/filePath needed — treeProvider always exists).

### What needs to change

The existing editors still need to handle the case where `model.navigationData` doesn't exist yet (first time opening navigator). Two options:

**Option A:** Move NavigationData creation into `toggleNavigator` as a static method or into PageModel.
**Option B:** Keep NavigationData creation in editors but simplify the toggle call.

Option B is simpler and keeps the existing pattern — editors create NavigationData when needed, then delegate to `toggleNavigator`.

## Implementation Plan

### Step 1: Update TextToolbar.tsx

Replace the inline toggle logic:
```typescript
// Before (inline logic)
if (model.navigationData) { ... } else { ... }

// After
if (!model.navigationData) {
    const navData = new NavigationData(fpDirname(filePath));
    navData.ensurePageNavigatorModel().id = model.id;
    navData.ensurePageNavigatorModel().flushSave();
    model.navigationData = navData;
    model.state.update((s) => { s.hasNavigator = true; });
}
model.navigationData.toggleNavigator(model.pipe, filePath);
```

Show button using: `model.navigationData?.canOpenNavigator(model.pipe, filePath) || filePath`

### Step 2: Update PdfViewer.tsx

Same pattern as Step 1.

### Step 3: Update ImageViewer.tsx

Same pattern as Step 1.

### Step 4: Verify ScriptPanel.tsx

`ScriptPanel.tsx` also creates NavigationData — check if it uses the same pattern and update.

### Step 5: Verify TextFileActionsModel.ts

`TextFileActionsModel.ts` creates NavigationData for "Open File Location" action — check if it needs updating.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/text/TextToolbar.tsx` | Use `toggleNavigator` / `canOpenNavigator` |
| `src/renderer/editors/pdf/PdfViewer.tsx` | Use `toggleNavigator` / `canOpenNavigator` |
| `src/renderer/editors/image/ImageViewer.tsx` | Use `toggleNavigator` / `canOpenNavigator` |
| `src/renderer/editors/text/ScriptPanel.tsx` | Review and update if needed |
| `src/renderer/editors/text/TextFileActionsModel.ts` | Review and update if needed |

## Files NOT Changed

- `src/renderer/ui/navigation/NavigationData.ts` — already has `toggleNavigator` and `canOpenNavigator` (from US-297)
- `src/renderer/editors/category/CategoryEditor.tsx` — already uses `toggleNavigator()` (from US-297)

## Acceptance Criteria

- [ ] TextToolbar uses `toggleNavigator` / `canOpenNavigator`
- [ ] PdfViewer uses `toggleNavigator` / `canOpenNavigator`
- [ ] ImageViewer uses `toggleNavigator` / `canOpenNavigator`
- [ ] ScriptPanel reviewed and updated if needed
- [ ] TextFileActionsModel reviewed and updated if needed
- [ ] No duplicated toggle logic remains
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
