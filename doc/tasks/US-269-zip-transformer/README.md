# US-269: ZipTransformer

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement `ZipTransformer` that extracts/replaces ZIP archive entries as a byte-to-byte transformer. Update the file resolver to detect `!` in URLs and build `FileProvider + ZipTransformer` pipes for archive paths.

## Why

- Archive paths (`C:\docs.zip!readme.txt`) are the most common non-trivial link type
- Currently handled by `archiveService` transparently in `app.fs` — needs to move to the pipe chain
- ZipTransformer keeps providers simple (FileProvider reads raw ZIP bytes) and transformers simple (ZipTransformer extracts one entry)

## Background

### Current flow (via app.fs)
```
app.fs.read("C:\docs.zip!readme.txt")
  → isArchivePath() detects "!"
  → parseArchivePath() → { archivePath: "C:\docs.zip", innerPath: "readme.txt" }
  → archiveService.readFile(archivePath, innerPath) → loads ZIP, extracts entry
```

### New flow (via content pipe)
```
FileProvider("C:\docs.zip") → ZipTransformer({ entryPath: "readme.txt" }) → Editor
  → read:  FileProvider reads ZIP bytes → ZipTransformer extracts entry
  → write: ZipTransformer replaces entry in archive → FileProvider writes ZIP back
```

### What ZipTransformer does
- `read(data)`: Takes full ZIP archive bytes, extracts `entryPath` entry, returns entry content
- `write(data, original)`: Takes new content + original ZIP bytes, replaces the entry in the archive, returns new full ZIP bytes
- Uses `jszip` (dynamic import, same as current `archiveService`)
- `persistent: true` — entry path must survive serialization
- `config: { entryPath: string }`

### Resolver update
The file resolver in `resolvers.ts` currently creates `FileProvider(event.url)` for all URLs. It needs to detect `!` and split:
- `FileProvider(archivePath)` + `ZipTransformer({ entryPath })` for archive paths
- `FileProvider(url)` for plain file paths (unchanged)

## Acceptance Criteria

- [ ] `ZipTransformer` implements `ITransformer` — read extracts entry, write replaces entry
- [ ] `persistent: true`, `config: { entryPath }`
- [ ] `toDescriptor()` returns `{ type: "zip", config: { entryPath } }`
- [ ] Registered as `"zip"` in transformer registry
- [ ] File resolver detects `!` and builds `FileProvider + ZipTransformer` pipe
- [ ] Opening archive paths (`C:\docs.zip!readme.txt`) works through the pipeline
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Create ZipTransformer

File: `src/renderer/content/transformers/ZipTransformer.ts`

### Step 2: Register in registry

File: `src/renderer/content/registry.ts` — add:
```typescript
registerTransformer("zip", (config) => new ZipTransformer(config.entryPath as string));
```

### Step 3: Update file resolver

File: `src/renderer/content/resolvers.ts` — detect `!` in URL:
```typescript
const bangIndex = event.url.indexOf("!");
if (bangIndex >= 0) {
    const archivePath = event.url.slice(0, bangIndex);
    const entryPath = event.url.slice(bangIndex + 1);
    provider = new FileProvider(archivePath);
    pipe = new ContentPipe(provider, [new ZipTransformer(entryPath)]);
} else {
    provider = new FileProvider(event.url);
    pipe = new ContentPipe(provider);
}
```

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/content/transformers/ZipTransformer.ts` | **NEW** — `ZipTransformer` class |
| `src/renderer/content/registry.ts` | Register `"zip"` transformer type |
| `src/renderer/content/resolvers.ts` | Detect `!` in URL, build archive pipe |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-265 (pipe resolvers)
- Current impl: `src/renderer/api/archive-service.ts` (archiveService stays — used by `app.fs` for non-pipe operations)
