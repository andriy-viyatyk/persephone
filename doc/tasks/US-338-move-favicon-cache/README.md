# US-338: Move favicon-cache to shared location

**Epic:** EPIC-018 (Phase 0, Task 0.2)
**Status:** Planned

## Goal

Move `favicon-cache.ts` from `editors/link-editor/` to `components/tree-provider/` so it can be consumed by the upcoming `ItemTile` component without cross-layer imports. Currently it's inside the link-editor but used by `TreeProviderItemIcon`, browser editor, and link-editor components.

## Background

**Current location:** `src/renderer/editors/link-editor/favicon-cache.ts`

The file has one internal dependency: `import { LinkItem } from "./linkTypes"` — used only by the `useFavicons` hook parameter type. All other imports are from `../../api/fs` and Node.js built-ins.

**Target location:** `src/renderer/components/tree-provider/favicon-cache.ts`

This folder already contains `TreeProviderItemIcon.tsx` which imports `getFaviconPathSync` from the current location.

### Current consumers (7 files)

| File | Imports | Import style |
|------|---------|-------------|
| `components/tree-provider/TreeProviderItemIcon.tsx` | `getFaviconPathSync` | static |
| `editors/link-editor/LinkViewModel.ts` | `getHostname` | static |
| `editors/link-editor/LinkItemList.tsx` | `getHostname`, `getFaviconPathSync`, `useFavicons`, `requestFaviconSave` | static |
| `editors/link-editor/LinkItemTiles.tsx` | `getHostname`, `getFaviconPathSync`, `useFavicons`, `requestFaviconSave` | static |
| `editors/link-editor/PinnedLinksPanel.tsx` | `getHostname`, `getFaviconPathSync`, `requestFaviconSave`, `useFavicons` | static |
| `editors/browser/BrowserEditorView.tsx` | `getHostname`, `saveFavicon`, `consumeFaviconSaveRequest` | dynamic `import()` |
| `editors/browser/BrowserBookmarksUIModel.ts` | `getHostname`, `saveFavicon` | dynamic `import()` |

### LinkItem dependency

`useFavicons(links: LinkItem[])` takes `LinkItem[]`. After the move, this would create a backward import from `components/` → `editors/link-editor/linkTypes`. 

**Fix:** Change the parameter to accept `{ href: string }[]` — that's the only field accessed (via `getHostname(link.href)`). This also makes the hook usable with `ITreeProviderItem[]` directly, which is the whole point of the move.

## Implementation Plan

### Step 1: Move the file

Move `src/renderer/editors/link-editor/favicon-cache.ts` → `src/renderer/components/tree-provider/favicon-cache.ts`

### Step 2: Remove `LinkItem` dependency

In the moved file, change the `useFavicons` signature:

```typescript
// Before:
import { LinkItem } from "./linkTypes";
export function useFavicons(links: LinkItem[]): number {

// After (no import needed):
export function useFavicons(links: Array<{ href: string }>): number {
```

No other code changes in the file — `getHostname(link.href)` works the same way.

### Step 3: Update all 7 consumer imports

**Static imports (5 files)** — update path:

| File | Old import path | New import path |
|------|----------------|-----------------|
| `components/tree-provider/TreeProviderItemIcon.tsx` | `../../editors/link-editor/favicon-cache` | `./favicon-cache` |
| `editors/link-editor/LinkViewModel.ts` | `./favicon-cache` | `../../components/tree-provider/favicon-cache` |
| `editors/link-editor/LinkItemList.tsx` | `./favicon-cache` | `../../components/tree-provider/favicon-cache` |
| `editors/link-editor/LinkItemTiles.tsx` | `./favicon-cache` | `../../components/tree-provider/favicon-cache` |
| `editors/link-editor/PinnedLinksPanel.tsx` | `./favicon-cache` | `../../components/tree-provider/favicon-cache` |

**Dynamic imports (2 files)** — update string path:

| File | Old import path | New import path |
|------|----------------|-----------------|
| `editors/browser/BrowserEditorView.tsx` | `../link-editor/favicon-cache` | `../../components/tree-provider/favicon-cache` |
| `editors/browser/BrowserBookmarksUIModel.ts` | `../link-editor/favicon-cache` | `../../components/tree-provider/favicon-cache` |

### No changes needed

| File | Reason |
|------|--------|
| `editors/link-editor/linkTypes.ts` | No change — `LinkItem` still used by link-editor internally |
| `components/tree-provider/index.ts` | Don't re-export favicon-cache — consumers import directly |

## Files Changed

| File | Change |
|------|--------|
| `editors/link-editor/favicon-cache.ts` | **Deleted** (moved) |
| `components/tree-provider/favicon-cache.ts` | **New** (moved from above, `LinkItem` → `{ href: string }`) |
| `components/tree-provider/TreeProviderItemIcon.tsx` | Update import path |
| `editors/link-editor/LinkViewModel.ts` | Update import path |
| `editors/link-editor/LinkItemList.tsx` | Update import path |
| `editors/link-editor/LinkItemTiles.tsx` | Update import path |
| `editors/link-editor/PinnedLinksPanel.tsx` | Update import path |
| `editors/browser/BrowserEditorView.tsx` | Update dynamic import path |
| `editors/browser/BrowserBookmarksUIModel.ts` | Update dynamic import path |

## Concerns

None — pure move + one minor type widening (`LinkItem[]` → `{ href: string }[]`). All call sites already pass objects with `href`.

## Acceptance Criteria

- [ ] `favicon-cache.ts` lives in `components/tree-provider/`
- [ ] No import from `components/` → `editors/link-editor/` (no backward dependency)
- [ ] `useFavicons` accepts `{ href: string }[]` instead of `LinkItem[]`
- [ ] All 7 consumers compile with updated import paths
- [ ] No functional changes — favicon caching works identically
