# US-337: Add `imgSrc` to ITreeProviderItem

**Epic:** EPIC-018 (Phase 0, Decision B)
**Status:** Planned

## Goal

Add an optional `imgSrc?: string` field to `ITreeProviderItem` so that tree-based views (CategoryView, future tile views) can display image previews for items that have them.

## Background

`ITreeProviderItem` (defined in `src/renderer/api/types/io.tree.d.ts` and mirrored in `assets/editor-types/io.tree.d.ts`) currently has no image field. `LinkItem` already has `imgSrc?: string` (in `src/renderer/editors/link-editor/linkTypes.ts:23`), and the future `LinkTreeProvider` will copy it directly. For file-based providers, image files can auto-populate this field with their own path.

EPIC-018 Decision B specifies the rendering priority for tile view: `imgSrc` → favicon → file-type icon fallback. This task only adds the field and populates it in existing providers — tile rendering is a separate task.

### Image extensions

Reuse the list from `src/renderer/editors/register-editors.ts:261`:
```
.png, .jpg, .jpeg, .gif, .webp, .bmp, .ico
```
Plus `.svg` per EPIC-018.

## Implementation Plan

### Step 1: Add `imgSrc` to `ITreeProviderItem` in both type files

**File:** `src/renderer/api/types/io.tree.d.ts` (line 107, before closing `}`)
**File:** `assets/editor-types/io.tree.d.ts` (same position — mirrored copy)

Add after `mtime?`:
```typescript
/** Optional preview image URL or file path. Used for tile view thumbnails. */
imgSrc?: string;
```

### Step 2: Populate `imgSrc` in `FileTreeProvider.list()`

**File:** `src/renderer/content/tree-providers/FileTreeProvider.ts`

In the file branch of the `list()` method (around line 62-69), after computing `ext`, check if the extension is an image extension. If so, set `imgSrc: fullPath`:

```typescript
// Before (line 62-69):
const ext = path.extname(entry.name).toLowerCase();
files.push({
    name: entry.name,
    href: fullPath,
    category: dirPath,
    tags: ext ? [ext] : [],
    isDirectory: false,
});

// After:
const ext = path.extname(entry.name).toLowerCase();
files.push({
    name: entry.name,
    href: fullPath,
    category: dirPath,
    tags: ext ? [ext] : [],
    isDirectory: false,
    imgSrc: IMAGE_EXTENSIONS.has(ext) ? fullPath : undefined,
});
```

Add a module-level constant:
```typescript
const IMAGE_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
]);
```

### Step 3: Populate `imgSrc` in `ZipTreeProvider.list()`

**File:** `src/renderer/content/tree-providers/ZipTreeProvider.ts`

Same pattern — check extension, set `imgSrc` to the archive path (the `href` value). Add the same `IMAGE_EXTENSIONS` constant.

```typescript
const ext = path.extname(entry.name).toLowerCase();
files.push({
    name: entry.name,
    href: buildArchivePath(this.sourceUrl, innerPath),
    category: innerDir,
    tags: ext ? [ext] : [],
    isDirectory: false,
    imgSrc: IMAGE_EXTENSIONS.has(ext)
        ? buildArchivePath(this.sourceUrl, innerPath)
        : undefined,
});
```

### Step 4: No changes needed

These files need **no changes** — listed to save investigation time:

| File | Reason |
|------|--------|
| `src/renderer/components/tree-provider/CategoryView.tsx` | Doesn't render images yet (separate task) |
| `src/renderer/editors/link-editor/linkTypes.ts` | `LinkItem.imgSrc` already exists |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | Will be updated in Phase 1 (LinkTreeProvider task) |
| `src/renderer/editors/register-editors.ts` | Image extension list stays there too (different purpose) |

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/types/io.tree.d.ts` | Add `imgSrc?: string` to `ITreeProviderItem` |
| `assets/editor-types/io.tree.d.ts` | Mirror the same addition |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Add `IMAGE_EXTENSIONS` set, populate `imgSrc` in `list()` |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | Add `IMAGE_EXTENSIONS` set, populate `imgSrc` in `list()` |

## Concerns

None — this is a purely additive change (optional field).

## Acceptance Criteria

- [ ] `ITreeProviderItem` has `imgSrc?: string` in both type definition files
- [ ] `FileTreeProvider.list()` sets `imgSrc` to the file path for image files
- [ ] `ZipTreeProvider.list()` sets `imgSrc` to the archive path for image entries
- [ ] Existing functionality unchanged — `imgSrc` is optional, no consumers use it yet
