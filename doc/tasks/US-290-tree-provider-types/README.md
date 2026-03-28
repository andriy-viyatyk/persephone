# US-290: Define ITreeProvider & ITreeProviderItem Types

**Status:** Complete
**Epic:** EPIC-015 (Phase 1, Task 1.1)

## Goal

Create the type definitions for the ITreeProvider interface and all related types. Add `isCategory` field to `LinkItem`. These types are the foundation for all subsequent EPIC-015 tasks.

## Background

### Existing patterns to follow

Type definitions in this project live in `src/renderer/api/types/` as `.d.ts` files. The Vite build plugin (`editorTypesPlugin` in `vite.renderer.config.ts`) auto-syncs them to `assets/editor-types/` for Monaco IntelliSense. No manual copy needed.

Conventions observed in existing files (`io.provider.d.ts`, `io.transformer.d.ts`, `io.events.d.ts`):
- **JSDoc on every exported interface and every property** — concise, one-line where possible
- **`export interface`** — all interfaces are exported
- **`import type`** for cross-file references
- **`readonly` on identity/status properties** — `type`, `displayName`, `sourceUrl`, `writable`, `pinnable`
- **Optional methods use `?`** — `mkdir?()`, `rename?()`, `pin?()`
- **No class implementations** in `.d.ts` files — interfaces only

### LinkItem (runtime) vs ILink (script API)

- `LinkItem` (`editors/link-editor/linkTypes.ts`) — runtime data structure, used internally
- `ILink` (`api/types/link-editor.d.ts`) — script-facing read-only projection via `LinkEditorFacade`
- `ILink` renames `href` → `url`, adds computed `pinned`, makes everything `readonly`

Adding `isCategory` to `LinkItem` means we should also add it to `ILink` in the script API types, and map it in `LinkEditorFacade`.

## Implementation Plan

### Step 1: Create `src/renderer/api/types/io.tree.d.ts`

Define all interfaces in one file (same pattern as `io.events.d.ts` which groups related types):

```typescript
// Interfaces to define:
ITreeProvider          // Main interface — list, stat, resolveLink, CRUD, bulk, search, pinning
ITreeProviderItem      // LinkItem-compatible entry — name, href, category, tags, isDirectory
ITreeStat              // Metadata — exists, isDirectory, size, mtime
ITreeSearchOptions     // Search config — category, tags, limit
ITreeSearchHandle      // Progressive search — onResults, onProgress, cancel, done
ITreeSearchResult      // Search result — extends ITreeProviderItem with matchLines, matchPreview
```

No imports needed — all types are self-contained (no dependency on IProvider, IContentPipe, etc.).

### Step 2: Add `isCategory` to `LinkItem`

File: `src/renderer/editors/link-editor/linkTypes.ts`

```typescript
export interface LinkItem {
    id: string;
    title: string;
    href: string;
    category: string;
    tags: string[];
    imgSrc?: string;
    isCategory?: boolean;    // ← NEW: true for folder/container items
}
```

Optional field (`?`) — existing links without it default to `false` (leaf items). No migration needed for existing `.link.json` files.

### Step 3: Add `isCategory` to `ILink` (script API)

File: `src/renderer/api/types/link-editor.d.ts`

```typescript
export interface ILink {
    // ... existing fields ...
    readonly isCategory: boolean;    // ← NEW
}
```

### Step 4: Update `LinkEditorFacade` mapping

File: `src/renderer/scripting/api-wrapper/LinkEditorFacade.ts`

Add `isCategory: link.isCategory ?? false` to the `mapLink()` function and the `links` getter return type.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/api/types/io.tree.d.ts` | **NEW** — all tree provider type definitions |
| `src/renderer/editors/link-editor/linkTypes.ts` | Add `isCategory?: boolean` to `LinkItem` |
| `src/renderer/api/types/link-editor.d.ts` | Add `readonly isCategory: boolean` to `ILink` |
| `src/renderer/scripting/api-wrapper/LinkEditorFacade.ts` | Map `isCategory` in `mapLink()` and `links` getter |

## Files NOT Changed

- `assets/editor-types/` — auto-synced by build plugin, no manual edits
- `src/renderer/api/types/io.d.ts` — tree provider constructors added later (Phase 6, task 6.4)
- `src/renderer/api/types/index.d.ts` — no new globals needed yet
- `src/renderer/editors/link-editor/LinkViewModel.ts` — no logic changes needed; `isCategory` is just data that flows through
- `src/renderer/editors/link-editor/LinkEditor.tsx` — rendering changes come later (Phase 4)

## Concerns

1. **`isCategory` on existing LinkItem data:** Since it's optional (`?`), all existing `.link.json` files work unchanged. Items without `isCategory` are treated as leaf items (`false`). No migration required.

2. **ILink.isCategory is non-optional (`boolean`, not `boolean | undefined`):** The facade maps `link.isCategory ?? false`, so scripts always get a clean boolean. This is consistent with how `pinned` is handled (computed, always boolean).

## Acceptance Criteria

- [ ] `io.tree.d.ts` exists with all 6 interfaces, proper JSDoc, follows existing conventions
- [ ] `LinkItem` has `isCategory?: boolean`
- [ ] `ILink` has `readonly isCategory: boolean`
- [ ] `LinkEditorFacade.mapLink()` maps `isCategory`
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
