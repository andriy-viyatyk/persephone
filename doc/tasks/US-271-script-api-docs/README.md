# US-271: Script API & Docs

## Status

**Status:** Planned
**Priority:** Medium
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Expose the content pipe system to scripts via the `io` global namespace. Create type definitions for Monaco IntelliSense. Scripts can create providers, transformers, pipes, and send link events.

## What to expose

### `io` global namespace

```typescript
globalThis.io = {
    // Providers
    FileProvider,
    HttpProvider,
    CacheFileProvider,

    // Transformers
    ZipTransformer,
    DecryptTransformer,

    // Pipe assembly
    createPipe(provider, ...transformers): IContentPipe,

    // Event constructors (for sending events through the pipeline)
    RawLinkEvent,
    OpenLinkEvent,
};
```

### Script usage examples

```javascript
// Read a CSV from inside a ZIP on an HTTP server
const pipe = io.createPipe(
    new io.HttpProvider("https://data.net/archive.zip"),
    new io.ZipTransformer("data.csv"),
);
const csv = await pipe.readText();
page.grouped.content = csv;
page.grouped.editor = "grid-csv";

// Open a URL through the pipeline
await app.events.openRawLink.sendAsync(new io.RawLinkEvent("https://api.com/data.json"));

// Open a URL with custom headers
await app.events.openLink.sendAsync(
    new io.OpenLinkEvent("https://api.com/data", undefined, {
        headers: { "Authorization": "Bearer token" },
    })
);
```

## Implementation Plan

### Step 1: Create `io` global in ScriptContext

Add `io` to the script prefix (like `app`, `page`, `ui`) and expose it from ScriptContext.

### Step 2: Create `io.d.ts` type definition

Monaco IntelliSense type definition for the `io` global.

### Step 3: Update `index.d.ts` to declare `io` global

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/scripting/ScriptRunnerBase.ts` | Add `io` to SCRIPT_PREFIX |
| `src/renderer/scripting/ScriptContext.ts` | Add `io` property with providers/transformers/factories |
| `src/renderer/api/types/io.d.ts` | **NEW** — `io` namespace type definition |
| `src/renderer/api/types/index.d.ts` | Declare `io` global |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-268 (all providers/transformers implemented)
