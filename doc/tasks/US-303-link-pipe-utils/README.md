# US-303: Extract Link Parsing and Pipe Creation Utilities

**Status:** Planned
**Epic:** EPIC-015 (Phase 3)
**Depends on:** —

## Goal

Extract pipe resolution logic from `resolvers.ts` into a reusable utility function. This enables tree providers (and other consumers) to create pipes from URLs without going through the event channel system.

## Background

### Current architecture

Pipe creation is embedded inside event channel subscribers in `resolvers.ts`:
- **File resolver** — detects file paths, handles archive "!" separator, creates `ContentPipe(FileProvider)` or `ContentPipe(FileProvider, [ZipTransformer])`
- **HTTP resolver** — detects HTTP URLs, resolves target editor, creates `ContentPipe(HttpProvider)` or `ContentPipe(HttpProvider, [ZipTransformer])`

Both resolvers mix two concerns: **pipe creation** (which provider + transformers) and **target resolution** (which editor, browser fallback). Only pipe creation needs extraction.

### Existing infrastructure

The pipe descriptor and registry system already exists:
- `IPipeDescriptor` — serializable pipe description (`{ provider, transformers, encoding }`)
- `createPipeFromDescriptor(descriptor)` — reconstructs `IContentPipe` from a descriptor (in `content/registry.ts`)
- Provider/transformer factories registered for "file", "http", "cache", "zip", "decrypt"

### Target architecture

```
content/link-utils.ts (NEW)
  └── resolveUrlToPipeDescriptor(url, metadata?) → IPipeDescriptor | null
      // Pure function: URL → pipe descriptor (no side effects, no events)
      // Returns null for unrecognized URLs or tree-category:// links

content/resolvers.ts (REFACTORED)
  └── file resolver:
      1. resolveUrlToPipeDescriptor(event.url) → descriptor
      2. resolve target editor (kept in handler)
      3. createPipeFromDescriptor(descriptor) → pipe
      4. fire openContent event

  └── http resolver:
      1. resolve target (extension map, browser fallback — kept in handler)
      2. resolveUrlToPipeDescriptor(event.url, metadata) → descriptor
      3. createPipeFromDescriptor(descriptor) → pipe
      4. fire openContent event

Tree providers (future US-302):
  └── const descriptor = resolveUrlToPipeDescriptor(sourceUrl)
      if (!descriptor) throw new Error(...)
      const pipe = createPipeFromDescriptor(descriptor)
```

## Implementation Plan

### Step 1: Create `content/link-utils.ts`

```typescript
import type { IPipeDescriptor } from "../api/types/io.pipe";
import type { ILinkMetadata } from "../api/types/io.events";
import { isArchivePath, parseArchivePath } from "../core/utils/file-path";
import { TREE_CATEGORY_PREFIX } from "./tree-providers/tree-provider-link";

/**
 * Normalize a file:// URL to a plain file path.
 */
export function normalizeFileUrl(raw: string): string { ... }

/**
 * Check if a string looks like a valid Windows file path.
 */
export function isPlausibleFilePath(path: string): boolean { ... }

/**
 * Resolve a URL to a pipe descriptor.
 * Returns null for URLs that cannot be resolved to a pipe (tree-category://, unrecognized).
 *
 * Handles: file paths, file:// URLs, archive paths (with "!"),
 * HTTP/HTTPS URLs, HTTP archive URLs.
 */
export function resolveUrlToPipeDescriptor(
    url: string,
    metadata?: ILinkMetadata,
): IPipeDescriptor | null {
    // tree-category:// → null
    if (url.startsWith(TREE_CATEGORY_PREFIX)) return null;

    // HTTP/HTTPS
    if (url.startsWith("http://") || url.startsWith("https://")) {
        return resolveHttpPipeDescriptor(url, metadata);
    }

    // File path (normalize file:// URLs)
    return resolveFilePipeDescriptor(url);
}

function resolveFilePipeDescriptor(url: string): IPipeDescriptor | null {
    let filePath = url;
    if (filePath.startsWith("file://")) {
        filePath = normalizeFileUrl(filePath);
    }
    if (!isPlausibleFilePath(filePath)) return null;

    if (isArchivePath(filePath)) {
        const { archivePath, innerPath } = parseArchivePath(filePath);
        return {
            provider: { type: "file", config: { path: archivePath } },
            transformers: [{ type: "zip", config: { entryPath: innerPath } }],
        };
    }

    return {
        provider: { type: "file", config: { path: filePath } },
        transformers: [],
    };
}

function resolveHttpPipeDescriptor(url: string, metadata?: ILinkMetadata): IPipeDescriptor {
    const httpConfig: Record<string, unknown> = { url };
    if (metadata?.method) httpConfig.method = metadata.method;
    if (metadata?.headers) httpConfig.headers = metadata.headers;
    if (metadata?.body) httpConfig.body = metadata.body;

    // No "!" archive detection for HTTP URLs — "!" is valid in HTTP URLs (query params, etc.)
    // Archive-in-HTTP support deferred to future.
    return {
        provider: { type: "http", config: httpConfig },
        transformers: [],
    };
}
```

### Step 2: Refactor `resolvers.ts` file resolver

```typescript
// Before:
let pipe: ContentPipe;
const bangIndex = event.url.indexOf("!");
if (bangIndex >= 0) {
    const archivePath = event.url.slice(0, bangIndex);
    const entryPath = event.url.slice(bangIndex + 1);
    pipe = new ContentPipe(new FileProvider(archivePath), [new ZipTransformer(entryPath)]);
} else {
    pipe = new ContentPipe(new FileProvider(event.url));
}

// After:
const pipeDescriptor = resolveUrlToPipeDescriptor(event.url);
if (!pipeDescriptor) return;
const pipe = createPipeFromDescriptor(pipeDescriptor);
```

### Step 3: Refactor `resolvers.ts` HTTP resolver

The HTTP resolver keeps its extension map, Accept header sniffing, and browser fallback logic. Only the pipe creation part changes. The old "!" archive detection for HTTP URLs is removed (concern #2).

```typescript
// Before:
let pipe: ContentPipe;
const bangIndex = event.url.indexOf("!");
if (bangIndex >= 0) { ... HttpProvider + ZipTransformer ... }
else { ... HttpProvider ... }

// After:
const pipeDescriptor = resolveUrlToPipeDescriptor(event.url, event.metadata);
if (!pipeDescriptor) return;
const pipe = createPipeFromDescriptor(pipeDescriptor);
```

### Step 3.1: Refactor `extractEffectivePath` in `resolvers.ts`

Use `isArchivePath` + `parseArchivePath` from file-path utils instead of inline `indexOf("!")`:

```typescript
// Before:
const bangIndex = url.indexOf("!");
if (bangIndex >= 0) {
    return url.slice(bangIndex + 1);
}

// After:
if (isArchivePath(url)) {
    const { innerPath } = parseArchivePath(url);
    return innerPath;
}
```

### Step 4: Move helpers from `parsers.ts` to `link-utils.ts`

Move `normalizeFileUrl`, `isFileUrl`, `isPlausibleFilePath` from parsers.ts to link-utils.ts and export them. Update parsers.ts to import from link-utils.ts.

### Step 5: Verify no behavioral changes

Test all link opening scenarios work identically.

## Resolved Concerns

1. **Should parsers.ts be refactored too?** — Not now. parsers.ts doesn't create pipes. Only move helpers (`normalizeFileUrl`, `isPlausibleFilePath`) to link-utils.ts. Full parser extraction deferred to when we need it (e.g., cURL authentication headers for HTTP zip URLs).

2. **HTTP archive URL detection — "!" in HTTP URLs** — "!" is valid in HTTP URLs (query params, fragments). **Decision:** disable "!" archive detection for HTTP URLs. `resolveHttpPipeDescriptor` always creates a plain HttpProvider, never splits on "!". Archive-in-HTTP support deferred to future when we have a real use case and can design a proper detection mechanism.

3. **Remove direct provider/transformer imports from resolvers.ts** — Yes. After refactoring, pipe creation goes through descriptors + registry. Remove unused `FileProvider`, `HttpProvider`, `ZipTransformer` imports from resolvers.ts.

4. **`extractEffectivePath` duplicates archive detection** — Refactor to use `isArchivePath` + `parseArchivePath` from file-path utils instead of inline `indexOf("!")`.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/content/link-utils.ts` | **NEW** — `resolveUrlToPipeDescriptor()`, `normalizeFileUrl()`, `isPlausibleFilePath()` |
| `src/renderer/content/resolvers.ts` | Replace inline pipe creation with `resolveUrlToPipeDescriptor` + `createPipeFromDescriptor` |
| `src/renderer/content/parsers.ts` | Import helpers from link-utils instead of defining locally |

## Files NOT Changed

- `src/renderer/content/registry.ts` — `createPipeFromDescriptor` already exists
- `src/renderer/content/ContentPipe.ts` — no changes
- `src/renderer/content/providers/` — no changes
- `src/renderer/content/transformers/` — no changes

## Acceptance Criteria

- [ ] `resolveUrlToPipeDescriptor()` correctly resolves all URL types to pipe descriptors
- [ ] `resolveUrlToPipeDescriptor()` returns null for tree-category:// and unrecognized URLs
- [ ] resolvers.ts uses `resolveUrlToPipeDescriptor` + `createPipeFromDescriptor`
- [ ] parsers.ts imports helpers from link-utils
- [ ] All existing link opening scenarios work unchanged (file, archive, HTTP, cURL, tree-category)
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
