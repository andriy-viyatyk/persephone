# US-326: EPIC-017 Post-Refactor Bug Fixes

**Epic:** [EPIC-017](../../epics/EPIC-017.md) — Page/Editor Architecture Refactor
**Status:** Done

## Goal

Fix bugs discovered during manual testing after EPIC-017 Phases 1–4 were implemented. These are all consequences of the page/editor identity split (page ID ≠ editor ID) and the new `mainEditor` lifecycle.

## Bugs Fixed

### 1. File Explorer first-click does nothing
**File:** `src/renderer/api/pages/PageModel.ts`
**Cause:** `PageNavigatorModel` defaults to `open: true`, but `toggleNavigator()` called `.toggle()` after creation, flipping it to `false`.
**Fix:** Don't call `.toggle()` when creating a new navigator — the default `open: true` is already correct.

### 2. Explorer file click doesn't navigate (PageNavigator pageId)
**File:** `src/renderer/ui/navigation/PageNavigator.tsx`
**Cause:** `pageId = page.mainEditor?.id ?? page.id` used editor ID for navigation metadata. After EPIC-017, `navigatePageTo` looks up by page ID.
**Fix:** Changed to `pageId = page.id`.

### 3. PageContent doesn't re-render on navigation
**File:** `src/renderer/ui/app/Pages.tsx`
**Cause:** `PageContent` reads `page.mainEditor` but never subscribed to state changes. In the old architecture, the `PageModel` was replaced in the array. In the new architecture, only `mainEditor` changes inside a stable `PageModel`.
**Fix:** Subscribe to `page.state.use((s) => s.mainEditorId)` to detect editor swaps.

### 4. Conditional hook crash (compareMode)
**File:** `src/renderer/ui/app/Pages.tsx`
**Cause:** `editor.state.use()` was called conditionally (only for TextFileModel). When editor type changed during navigation, hook count changed → React crash.
**Fix:** Created `useOptionalState()` utility in `src/renderer/core/state/state.ts` — always calls hooks unconditionally, returns default when state is null.

### 5. PageTab doesn't update on navigation + conditional hook crash
**File:** `src/renderer/ui/tabs/PageTab.tsx`
**Cause:** Same two issues as PageContent — no version subscription, and `editor?.state.use()` conditional hook.
**Fix:** Subscribe to `mainEditorId`, use `useOptionalState()` for editor state.

### 6. Monaco "Canceled" console error during navigation
**File:** `src/renderer/api/internal/GlobalEventService.ts`, `src/renderer/api/pages/PageModel.ts`
**Cause:** Monaco's internal `Delayer` rejects promises during editor disposal. Harmless but noisy.
**Fix:** Suppress "Canceled" rejections in `handleUnhandledRejection`. Defer old editor disposal in `setMainEditor()` via `setTimeout` to let React unmount the view first.

### 7. Empty page can't navigate (sidebar folder double-click)
**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`
**Cause:** `navigatePageTo` had `if (!page.mainEditor) return false` — empty pages couldn't navigate.
**Fix:** Allow navigation when `mainEditor` is null, skip `confirmRelease` for empty pages.

### 8. `useOptionalState` infinite loop
**File:** `src/renderer/core/state/state.ts`
**Cause:** Initial `useSyncExternalStore` implementation returned new object references every render → `Object.is` comparison always false → infinite re-render.
**Fix:** Replaced with `useState` + `useEffect` approach that only triggers re-renders on actual store notifications.

### 9. Replace `version` counter with `mainEditorId`
**File:** `src/renderer/api/pages/PageModel.ts`
**Cause:** Incrementing `version` counter is not idempotent — setting the same editor twice causes unnecessary re-renders.
**Fix:** Replaced `version: number` with `mainEditorId: string | null` in `IPageState`. Semantically meaningful and idempotent.

### 10. ZipEditor "Archive" panel doesn't appear + file click doesn't navigate
**Files:** `src/renderer/editors/zip/ZipEditorModel.ts`, `src/renderer/editors/zip/ZipEditorView.tsx`
**Cause:** (a) `restore()` runs before `setPage()` during navigation, so `this.page` is null and secondary editor never registers. (b) `ZipEditorView` used `model.id` (editor ID) instead of page ID.
**Fix:** (a) Override `setPage()` in ZipEditorModel to register "zip-tree" when page context becomes available. (b) Use `model.page?.id ?? model.id`.

### 11. ZipEditor "Archive" panel shows close button when it shouldn't
**File:** `src/renderer/ui/navigation/PageNavigator.tsx`
**Cause:** `model.id === pageId` compared editor ID with page ID (always false after EPIC-017).
**Fix:** Compare `model === page.mainEditor` (reference equality).

### 12. Open Tabs sidebar shows empty titles for other windows
**File:** `src/renderer/ui/sidebar/OpenTabsList.tsx`
**Cause:** Other windows return `PageDescriptor` (with `editor` nested object), but code read `page.title` at top level.
**Fix:** Unwrap `desc.editor` and override `id` with page ID.

### 13. Script output page not grouped with script page
**Files:** `src/renderer/api/pages/PagesQueryModel.ts`, `src/renderer/api/pages/PagesLayoutModel.ts`
**Cause:** `requireGroupedText(pageId)` receives editor ID from callers, but grouping maps use page IDs. `getGroupedPage(editorId)` never finds a match.
**Fix:** Made `findPage()` resolve any associated ID (page, mainEditor, or secondaryEditor). All query/layout methods resolve through `findPage()` first, so callers can pass any ID.

### 14. CollapsiblePanel header height inconsistency
**File:** `src/renderer/components/layout/CollapsiblePanelStack.tsx`
**Cause:** Panel headers without buttons or chevrons were 19px; with buttons 27px.
**Fix:** Added `minHeight: 27` to `.panel-header` style.

### 15. Secondary editors missing page reference after restore
**File:** `src/renderer/api/pages/PageModel.ts`
**Cause:** `restoreSecondaryEditors()` pushed models to `secondaryEditors[]` without calling `setPage(this)`. After restore, `model.page` was null.
**Fix:** Added `model.setPage(this)` after push in both the normal and dedup paths.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PageModel.ts` | `mainEditorId` replaces `version`, fix toggleNavigator first-click, defer disposal in setMainEditor, setPage in restoreSecondaryEditors |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Allow navigatePageTo with null mainEditor |
| `src/renderer/api/pages/PagesQueryModel.ts` | findPage resolves any ID (page, editor, secondary); getGroupedPage/isGrouped resolve through findPage |
| `src/renderer/api/pages/PagesLayoutModel.ts` | groupTabs resolves IDs through findPage |
| `src/renderer/core/state/state.ts` | New `useOptionalState()` hook utility |
| `src/renderer/ui/app/Pages.tsx` | Subscribe to mainEditorId, use useOptionalState for compareMode |
| `src/renderer/ui/tabs/PageTab.tsx` | Subscribe to mainEditorId, use useOptionalState for editor state |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Fix pageId to page.id, fix close button check |
| `src/renderer/api/internal/GlobalEventService.ts` | Suppress Monaco "Canceled" rejections |
| `src/renderer/editors/zip/ZipEditorModel.ts` | Override setPage() for secondary editor registration |
| `src/renderer/editors/zip/ZipEditorView.tsx` | Fix pageId to page ID |
| `src/renderer/ui/sidebar/OpenTabsList.tsx` | Unwrap PageDescriptor for other windows |
| `src/renderer/components/layout/CollapsiblePanelStack.tsx` | Fixed panel header minHeight |
| `doc/tasks/active.md` | Added US-325 (standalone preload error task) |
