# US-265: Pipe Resolvers

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement Layer 2 resolver as a handler on `app.events.openLink`. The file resolver builds a `FileProvider` + `ContentPipe`, resolves the target editor via `extractEffectivePath()`, and fires `app.events.openContent.sendAsync()`.

## Why

- Layer 2 connects raw link parsing (Layer 1) to opening in editors (Layer 3)
- The file resolver is the primary resolver — handles plain file paths and archive paths
- `extractEffectivePath()` enables editor resolution from any URL type (file, archive, HTTP in future)

## Background

### What the file resolver does

1. Receive `OpenLinkEvent { url, target?, metadata? }` from Layer 1
2. If `target` already set → skip editor resolution
3. Extract effective path from URL → `editorRegistry.resolve(effectivePath)` → get editor ID
4. Create `FileProvider(url)` (for plain files; archive support added in US-269)
5. Assemble `ContentPipe(provider)`
6. Fire `openContent.sendAsync(new OpenContentEvent(pipe, target, metadata))`
7. Set `event.handled = true`

### `extractEffectivePath()` — editor resolution from URLs

| URL type | Example | Effective path |
|----------|---------|----------------|
| File path | `C:\data\report.csv` | `C:\data\report.csv` (as-is) |
| Archive path | `C:\docs.zip!data/report.grid.json` | `data/report.grid.json` (after `!`) |
| HTTP URL (future) | `https://api.com/data.json?token=x` | `data.json` (pathname, no query) |

The `editorRegistry.resolve()` method passes the effective path to each editor's `acceptFile()` which checks file extensions. For archive paths, passing the inner path (`data/report.grid.json`) ensures the correct editor is selected based on the entry's extension.

### Registration order

The file resolver is the first resolver registered (most general). Future resolvers (HTTP in US-270) register after and run first in LIFO:

```
Registration:            Execution (LIFO):
1. fileResolver (first)  ← runs last (fallback)
   ... later tasks ...
2. httpResolver (US-270) ← runs first (checks for http://)
```

## Acceptance Criteria

- [ ] `extractEffectivePath()` utility function implemented
- [ ] File resolver registered on `openLink` — builds `FileProvider` + `ContentPipe`, resolves target
- [ ] Target resolution: explicit `event.target` > `editorRegistry.resolve()` > `"monaco"` fallback
- [ ] Resolver registered during bootstrap (in `registerRawLinkParsers` or alongside it)
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Create `extractEffectivePath()` utility

File: `src/renderer/content/resolvers.ts`

```typescript
/**
 * Extract the effective path from a URL for editor resolution.
 * Archive paths → inner path (after "!").
 * HTTP URLs → pathname last segment (before query).
 * File paths → as-is.
 */
export function extractEffectivePath(url: string): string {
    // Archive path: return inner path after "!"
    const bangIndex = url.indexOf("!");
    if (bangIndex >= 0) {
        return url.slice(bangIndex + 1);
    }

    // HTTP/HTTPS URL: extract pathname
    if (url.startsWith("http://") || url.startsWith("https://")) {
        try {
            const parsed = new URL(url);
            return parsed.pathname.split("/").pop() || url;
        } catch {
            return url;
        }
    }

    // Plain file path: as-is
    return url;
}
```

### Step 2: Implement file resolver

File: `src/renderer/content/resolvers.ts`

```typescript
export function registerResolvers(): void {
    // File resolver — fallback, handles plain file paths
    app.events.openLink.subscribe(async (event) => {
        // Resolve target editor
        const target = event.target
            || editorRegistry.resolveId(extractEffectivePath(event.url))
            || "monaco";

        // Build provider and pipe
        const provider = new FileProvider(event.url);
        const pipe = new ContentPipe(provider);

        // Fire Layer 3
        await app.events.openContent.sendAsync(
            new OpenContentEvent(pipe, target, event.metadata)
        );
        event.handled = true;
    });
}
```

### Step 3: Register during bootstrap

File: `src/renderer/content/parsers.ts` — rename to `src/renderer/content/link-handlers.ts` or keep separate and register resolvers from `app.ts` alongside parsers.

Simpler: register resolvers in the same bootstrap call. Update `app.ts` to also call `registerResolvers()`.

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/content/resolvers.ts` | **NEW** — `extractEffectivePath()`, `registerResolvers()` |
| `src/renderer/api/app.ts` | Call `registerResolvers()` during bootstrap |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-262 (FileProvider, ContentPipe), US-263 (link event channels)
- Needed by: US-266 (open handler), US-267 (migrate entry points), US-269 (ZipTransformer updates resolver)
