# US-350: ILink Type Consolidation — "Everything is a Link"

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, predecessor to Task 1.3a-2
**Depends on:** US-346 (isDirectory rename already done)
**Status:** Planned

## Goal

Consolidate `ITreeProviderItem` and `LinkItem` into a single `ILink` type. Rename `ITreeProviderItem.name` → `title` to match `LinkItem.title`. Add `id` as optional to the unified type. Eliminate the need for mapping between the two types.

This is the "Everything is a Link" vision: one item type used everywhere — Explorer, Archive, Link collections, scripts.

## Background

### Current state (after US-346 isDirectory rename)

```typescript
// LinkItem (src/renderer/editors/link-editor/linkTypes.ts)
interface LinkItem {
    id: string;
    title: string;
    href: string;
    category: string;
    tags: string[];
    imgSrc?: string;
    isDirectory?: boolean;
}

// ITreeProviderItem (src/renderer/api/types/io.tree.d.ts)
interface ITreeProviderItem {
    name: string;          // ← only remaining collision: should be "title"
    href: string;
    category: string;
    tags: string[];
    isDirectory: boolean;
    size?: number;
    mtime?: string;
    imgSrc?: string;
}
```

After renaming `name` → `title`, the only structural differences are:
- `id` — LinkItem has it (required), ITreeProviderItem doesn't
- `size`, `mtime` — ITreeProviderItem has them (optional), LinkItem doesn't
- `isDirectory` optionality — optional in LinkItem, required in ITreeProviderItem

### Target: unified `ILink` type

```typescript
/** Universal link item — used by tree providers, link collections, and scripts. */
interface ILink {
    /** Unique identifier. Optional for tree provider items (href is unique within a category). */
    id?: string;
    /** Display title. */
    title: string;
    /** Resolved link string — URL, file path, or archive path. */
    href: string;
    /** Category/folder path using "/" separators. */
    category: string;
    /** Metadata tags — extension, type, etc. */
    tags: string[];
    /** Whether this entry is a directory/container. */
    isDirectory: boolean;
    /** File size in bytes. */
    size?: number;
    /** Last modified time (ISO string). */
    mtime?: string;
    /** Optional preview image URL or file path. */
    imgSrc?: string;
}
```

`LinkItem` becomes a type alias or interface that extends `ILink` with required `id`:
```typescript
interface LinkItem extends ILink {
    id: string;  // required for link collections
}
```

### Why `name` → `title` (not `title` → `name`)

- `title` is stored in users' `.link.json` files — cannot rename without migration
- `name` is a runtime-only property, never persisted — safe to rename
- `title` is more descriptive for a display label

## Implementation Plan

### Step 1: Rename `name` → `title` in `ITreeProviderItem`

**File:** `src/renderer/api/types/io.tree.d.ts`

```typescript
// Before:
name: string;
// After:
title: string;
```

Also update the JSDoc comment.

**File:** `assets/editor-types/io.tree.d.ts` — same rename in the script-facing type.

### Step 2: Rename `ITreeProviderItem` → `ILink`

**File:** `src/renderer/api/types/io.tree.d.ts`

Rename the interface. Keep `ITreeProviderItem` as a type alias for backward compatibility during the transition:

```typescript
/** Universal link item. */
export interface ILink { ... }

/** @deprecated Use ILink. */
export type ITreeProviderItem = ILink;
```

The deprecated alias allows gradual migration — existing code keeps working, new code uses `ILink`.

### Step 3: Update `LinkItem` to extend `ILink`

**File:** `src/renderer/editors/link-editor/linkTypes.ts`

```typescript
import type { ILink } from "../../api/types/io.tree";

/** Link item with required id — used in .link.json collections. */
export interface LinkItem extends ILink {
    id: string;
}
```

Remove the duplicate field definitions (href, category, tags, etc.) — they come from `ILink`.

### Step 4: Mechanical rename `item.name` → `item.title` across codebase

All files that access `.name` on `ITreeProviderItem` instances. Based on grep analysis (~40 occurrences in ~12 files):

| File | Approx changes |
|------|---------------|
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | 4 (`name: entry.name` → `title: entry.name`) |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | 4 |
| `src/renderer/content/tree-context-menus.tsx` | 1 |
| `src/renderer/editors/link-editor/LinkTreeProvider.ts` | 2 |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | 10 (`node.data.name` → `node.data.title`) |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | 2 |
| `src/renderer/components/tree-provider/TreeProviderItemIcon.tsx` | 2 |
| `src/renderer/components/tree-provider/ItemTile.tsx` | 3 |
| `src/renderer/components/tree-provider/CategoryView.tsx` | 2 |
| `src/renderer/components/tree-provider/CategoryViewModel.tsx` | 4 |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | 1 (in `getNavigationUrl` call) |
| `assets/editor-types/io.tree.d.ts` | 1 (type definition) |

**Note:** `entry.name` from `fs.readdirSync()` stays as `entry.name` — only the property assignment changes: `name: entry.name` → `title: entry.name`.

### Step 5: Update `ITreeProvider` method signatures

**File:** `src/renderer/api/types/io.tree.d.ts`

Methods that reference `ITreeProviderItem` in their signatures — rename to `ILink`:
- `list(path): Promise<ILink[]>`
- `stat(path): Promise<ITreeStat>` (unchanged, doesn't use item type)
- `getNavigationUrl(item: ILink): string`
- `addItem(item: Partial<ILink> & { href: string }): Promise<ILink>`
- etc.

Or keep using the `ITreeProviderItem` alias during this task and do a full rename in a follow-up.

### Step 6: Update script type definitions

**File:** `assets/editor-types/io.tree.d.ts`

Rename `name` → `title`. Optionally rename `ITreeProviderItem` → `ILink` (with deprecated alias for script backward compatibility).

### Step 7: Remove `LinkTreeProvider.linkToItem` mapping

**File:** `src/renderer/editors/link-editor/LinkTreeProvider.ts`

After consolidation, `LinkItem extends ILink`, so `linkToItem()` becomes a trivial cast or spread — no field renaming needed. Simplify or remove the method.

## Concerns

### 1. Script backward compatibility — RESOLVED

Scripts may use `item.name` on `ITreeProviderItem`. The `assets/editor-types/io.tree.d.ts` change will break existing scripts that use `.name`.

**Resolution:** This is a breaking change for scripts. Add to `docs/whats-new.md` under breaking changes: "`ITreeProviderItem.name` renamed to `.title`". Since `ITreeProviderItem` is relatively new (EPIC-015), the impact is minimal. The deprecated `ITreeProviderItem` type alias ensures scripts using the type name still compile.

### 2. `ITreeProviderItem` → `ILink` rename scope — RESOLVED

Renaming the type across 16+ files is mechanical but large. 

**Resolution:** Do it in two phases within this task:
1. First commit: rename `name` → `title` (functional change)
2. Keep `ITreeProviderItem` as alias for now. Full type rename to `ILink` can happen gradually or in a quick follow-up.

### 3. `LinkItem.isDirectory` optionality

In `LinkItem`, `isDirectory` was optional (`isCategory?: boolean`). In `ILink`, it's required (`isDirectory: boolean`).

**Resolution:** Make `isDirectory` required in `ILink` with default behavior: when creating `LinkItem` objects (e.g., in `LinkViewModel.addLink()`), set `isDirectory: false` explicitly. This is already the case — all link creation code never sets `isCategory`/`isDirectory`, so adding `isDirectory: false` is trivial.

## Acceptance Criteria

- [ ] `ILink` type defined with all fields from both `ITreeProviderItem` and `LinkItem`
- [ ] `ITreeProviderItem` is a type alias for `ILink` (deprecated)
- [ ] `LinkItem` extends `ILink` with required `id`
- [ ] `name` → `title` renamed everywhere
- [ ] `LinkTreeProvider.linkToItem()` simplified (no field renaming)
- [ ] Script type definitions updated
- [ ] Breaking change documented in whats-new
- [ ] No TypeScript errors
- [ ] No runtime regressions

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/types/io.tree.d.ts` | Define `ILink`, rename `name` → `title`, add `ITreeProviderItem` alias |
| `assets/editor-types/io.tree.d.ts` | Same rename for script types |
| `src/renderer/editors/link-editor/linkTypes.ts` | `LinkItem extends ILink` |
| `src/renderer/editors/link-editor/LinkTreeProvider.ts` | Simplify `linkToItem`, rename `.name` refs |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | Add `isDirectory: false` in `addLink` |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | `name:` → `title:` in item construction |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | `name:` → `title:` in item construction |
| `src/renderer/content/tree-context-menus.tsx` | `item.name` → `item.title` |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | `node.data.name` → `node.data.title` |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | `node.data.name` → `node.data.title` |
| `src/renderer/components/tree-provider/TreeProviderItemIcon.tsx` | `item.name` → `item.title` |
| `src/renderer/components/tree-provider/ItemTile.tsx` | `item.name` → `item.title` |
| `src/renderer/components/tree-provider/CategoryView.tsx` | `item.name` → `item.title` |
| `src/renderer/components/tree-provider/CategoryViewModel.tsx` | `item.name` → `item.title` |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Adjust if `.name` used |
