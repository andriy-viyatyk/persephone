# US-270: HttpProvider

## Status

**Status:** Planned
**Priority:** Medium
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement `HttpProvider` (read-only HTTP fetch), HTTP parser/resolver in the link pipeline, and migrate URL handling to `openRawLink`. URLs with recognized file extensions open as content in dedicated editors; other URLs open in the browser tab.

## Why

- Enables opening URLs like `https://...file.css`, `https://...data.json`, `https://...icon.png` in dedicated editors (Monaco with correct language, image viewer, PDF viewer)
- Browsers don't show raw CSS/JS content and have limited functionality for other types
- Unifies all link handling (files AND URLs) through the same three-layer pipeline

## Design: Content vs Browser Decision

The HTTP resolver decides based on file extension:

```
extractEffectivePath("https://github.../file.css") → "file.css"
editorRegistry.resolve("file.css") → Monaco (css) → OPEN AS CONTENT

extractEffectivePath("https://github.com/some-page") → "some-page"
editorRegistry.resolve("some-page") → undefined → OPEN IN BROWSER
```

| URL pattern | Effective path | Editor match | Action |
|-------------|---------------|-------------|--------|
| `https://cdn.com/style.css` | `style.css` | Monaco (css) | Content pipe |
| `https://cdn.com/app.js` | `app.js` | Monaco (javascript) | Content pipe |
| `https://raw.github.com/icon.png` | `icon.png` | image-view | Content pipe |
| `https://example.com/doc.pdf` | `doc.pdf` | pdf-view | Content pipe |
| `https://api.com/data.json` | `data.json` | Monaco (json) | Content pipe |
| `https://github.com/repo` | `repo` (no ext) | none | Browser tab |
| `https://google.com` | `` (empty) | none | Browser tab |

## Current URL Entry Points to Migrate

| Source | Current handler | New flow |
|--------|----------------|----------|
| IPC `eOpenUrl` | `RendererEventsService.handleOpenUrl` → checks setting → browser or external | → `openRawLink` → HTTP parser → HTTP resolver → content or browser |
| IPC `eOpenExternalUrl` | `RendererEventsService.handleExternalUrl` → browser tab | → `openRawLink` with metadata `{ forceBrowser: true }` |
| CLI arg with URL | `PagesPersistenceModel.init` → `handleExternalUrl` | → `openRawLink` |
| `pagesModel.handleOpenUrl(url)` | `PagesLifecycleModel.handleOpenUrl` → checks setting | → redirect to `openRawLink` (like `openFile` redirect) |
| `LinkViewModel.openLink(url)` | Calls `pagesModel.handleOpenUrl` | No change — goes through redirected `handleOpenUrl` |

## Implementation Plan

### Step 1: Create HttpProvider

File: `src/renderer/content/providers/HttpProvider.ts`

- `readBinary()` — fetches URL via dynamic `import("../../api/node-fetch")` → `nodeFetch(url, options)`
- `writable: false`, `restorable: true`
- `config: { url, method?, headers?, body? }` — supports future cURL parser
- `displayName` — `hostname + pathname` from URL

### Step 2: Register in registry

File: `src/renderer/content/registry.ts`

### Step 3: Add HTTP parser on `openRawLink`

File: `src/renderer/content/parsers.ts`

Registered after archive parser (runs before archive in LIFO since HTTP is more specific than the file fallback):
```
Registration:                Execution (LIFO):
1. fileParser (first)        ← runs last (fallback)
2. archiveParser             ← runs third
3. httpParser (last)         ← runs first (checks for http://)
```

### Step 4: Add HTTP resolver on `openLink`

File: `src/renderer/content/resolvers.ts`

Decision logic:
```typescript
app.events.openLink.subscribe(async (event) => {
    if (!event.url.startsWith("http://") && !event.url.startsWith("https://")) return;

    // Check if URL should open in browser
    const forceBrowser = (event.metadata as any)?.forceBrowser;
    const effectivePath = extractEffectivePath(event.url);
    const editorDef = editorRegistry.resolve(effectivePath);

    if (forceBrowser || !editorDef) {
        // No recognized extension or forced browser — open in browser tab
        const { settings } = await import("../api/settings");
        const behavior = settings.get("link-open-behavior");
        if (behavior === "internal-browser" || forceBrowser) {
            const { pagesModel } = await import("../api/pages");
            await pagesModel.lifecycle.openUrlInBrowserTab(event.url, {
                external: !!forceBrowser,
            });
        } else {
            const { shell } = await import("../api/shell");
            shell.openExternal(event.url);
        }
        event.handled = true;
        return;
    }

    // Recognized extension — open as content via HttpProvider
    const target = event.target || editorDef.id;

    let pipe: ContentPipe;
    const bangIndex = event.url.indexOf("!");
    if (bangIndex >= 0) {
        const httpUrl = event.url.slice(0, bangIndex);
        const entryPath = event.url.slice(bangIndex + 1);
        pipe = new ContentPipe(new HttpProvider(httpUrl, metadata), [new ZipTransformer(entryPath)]);
    } else {
        pipe = new ContentPipe(new HttpProvider(event.url, metadata));
    }

    await app.events.openContent.sendAsync(new OpenContentEvent(pipe, target, event.metadata));
    event.handled = true;
});
```

### Step 5: Migrate URL entry points to `openRawLink`

**RendererEventsService.ts:**
- `handleOpenUrl` → `app.events.openRawLink.sendAsync(new RawLinkEvent(url))`
- `handleExternalUrl` → `app.events.openRawLink.sendAsync(new RawLinkEvent(url))` with metadata `{ forceBrowser: true }` — but `RawLinkEvent` only has `raw` string. Need to pass metadata through.

**Problem:** `RawLinkEvent` only carries a raw string, no metadata. For `handleExternalUrl` we need to signal "force browser". Options:
1. Add optional metadata to `RawLinkEvent` — `new RawLinkEvent(url, { forceBrowser: true })`
2. Keep `handleExternalUrl` calling `openUrlInBrowserTab` directly (not through pipeline)
3. Use `openLink` directly (skip Layer 1 parsing) — `app.events.openLink.sendAsync(new OpenLinkEvent(url, undefined, { forceBrowser: true }))`

**Recommendation:** Option 3 for `handleExternalUrl` — it already knows the URL type, skip parsing. Option 1 or direct `openRawLink` for `handleOpenUrl`.

Actually simplest: `handleOpenUrl` → `openRawLink` (pipeline decides content vs browser). `handleExternalUrl` → `openLink` with `forceBrowser` metadata (skips parsing, resolver handles browser-open).

**PagesLifecycleModel.ts:**
- `handleOpenUrl` → redirect to `openRawLink` (like `openFile` redirect)
- `handleExternalUrl` → redirect to `openLink` with `forceBrowser: true`

**PagesPersistenceModel.ts:**
- CLI URL arg → `openRawLink` (already migrated for files, now handle URLs too)

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/content/providers/HttpProvider.ts` | **NEW** — HTTP fetch provider |
| `src/renderer/content/registry.ts` | Register `"http"` provider type |
| `src/renderer/content/parsers.ts` | Add HTTP parser on `openRawLink` |
| `src/renderer/content/resolvers.ts` | Add HTTP resolver with content-vs-browser decision |
| `src/renderer/api/internal/RendererEventsService.ts` | Migrate `handleOpenUrl`/`handleExternalUrl` to pipeline |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Redirect `handleOpenUrl`/`handleExternalUrl` through pipeline |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | CLI URL arg through `openRawLink` |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-265 (pipe resolvers)
- Needed by: US-273 (cURL parser passes metadata to HttpProvider)
- Uses: `src/renderer/api/node-fetch.ts` (existing HTTP client)
