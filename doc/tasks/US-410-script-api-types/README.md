# US-410: Update script API types, IoNamespace, and editor-types

## Goal

Delete the now-empty `io.events.d.ts` files and clean up all references to them. This is the final cleanup step after EPIC-023 tasks US-404 through US-409 removed all types (`IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`, `ILinkMetadata`, `ISourceLink`) from these files.

## Background

The original US-410 scope included migrating IoNamespace exports, updating script API type definitions, and syncing `assets/editor-types/` mirrors. However, prior tasks already completed all of that:

- **US-404** created `io.link-data.d.ts` with `ILinkData` (both `src/` and `assets/`)
- **US-405** updated `IoNamespace.ts` to export `createLinkData`/`linkToLinkData` instead of event constructors; updated `io.d.ts` to reflect new factories; removed `IRawLinkEvent`/`IOpenLinkEvent`/`IOpenContentEvent` from `io.events.d.ts`
- **US-408** removed `ISourceLink` from `io.events.d.ts`; updated `events.d.ts` with `IEventChannel<ILinkData>`
- **US-409** removed `ILinkMetadata` from `io.events.d.ts` (last remaining type)

The result: `io.events.d.ts` is empty in both `src/renderer/api/types/` and `assets/editor-types/`. It's still listed in `_imports.txt` and referenced in documentation, so cleanup is needed.

## Implementation Plan

### Step 1: Delete empty `io.events.d.ts` files

**Delete:**
- `src/renderer/api/types/io.events.d.ts` (empty, 2 bytes)
- `assets/editor-types/io.events.d.ts` (empty, 2 bytes — mirror copy)

### Step 2: Remove from `_imports.txt`

**File:** `assets/editor-types/_imports.txt`

Remove line 14: `io.events.d.ts`

Note: The Vite plugin `editorTypesPlugin()` in `vite.renderer.config.ts` auto-generates this file from `src/renderer/api/types/*.d.ts` on build. But since we commit `_imports.txt`, we must also update it manually to keep the working tree clean.

### Step 3: Update `folder-structure.md`

**File:** `doc/architecture/folder-structure.md` line 143

```
// Before:
│       ├── io.events.d.ts    # ISourceLink, ILinkMetadata (legacy — being replaced by ILinkData)

// After:
(delete the line entirely)
```

### Step 4: Update EPIC-023 task table

**File:** `doc/epics/EPIC-023.md`

Mark US-410 as Done in the Linked Tasks table (line ~429):
```
| US-410 | Update script API types, IoNamespace, and editor-types | Done |
```

## Files NOT requiring changes

| File | Reason |
|------|--------|
| `src/renderer/scripting/api-wrapper/IoNamespace.ts` | Already updated in US-405 |
| `src/renderer/api/types/io.d.ts` | Already updated in US-405 |
| `src/renderer/api/types/events.d.ts` | Already updated in US-408 |
| `assets/editor-types/io.d.ts` | Already mirrored in US-405 |
| `assets/editor-types/events.d.ts` | Already mirrored in US-408 |
| `assets/editor-types/io.link-data.d.ts` | Already created in US-404 |
| `src/renderer/api/setup/configure-monaco.ts` | Reads `_imports.txt` dynamically — no hardcoded reference to io.events |
| `vite.renderer.config.ts` | Generates `_imports.txt` from directory listing — no hardcoded reference |

## Acceptance Criteria

- [ ] `src/renderer/api/types/io.events.d.ts` deleted
- [ ] `assets/editor-types/io.events.d.ts` deleted
- [ ] `io.events.d.ts` removed from `assets/editor-types/_imports.txt`
- [ ] `doc/architecture/folder-structure.md` no longer references `io.events.d.ts`
- [ ] EPIC-023 task table updated
- [ ] No source file imports from `io.events`

## Files Changed Summary

| File | Action |
|------|--------|
| `src/renderer/api/types/io.events.d.ts` | **Delete** |
| `assets/editor-types/io.events.d.ts` | **Delete** |
| `assets/editor-types/_imports.txt` | **Modify** — remove `io.events.d.ts` line |
| `doc/architecture/folder-structure.md` | **Modify** — remove `io.events.d.ts` line |
| `doc/epics/EPIC-023.md` | **Modify** — mark US-410 Done |
