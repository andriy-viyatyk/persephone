# US-264: Raw Link Parsers

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement Layer 1 parsers as handlers on `app.events.openRawLink`. These parsers recognize raw string patterns (file paths, `file://` URLs, archive paths) and fire `app.events.openLink.sendAsync()` with a structured `OpenLinkEvent`.

## Why

- Layer 1 is the entry point for all link opening — every raw string flows through `openRawLink`
- Parsers convert raw strings into structured links with URL and optional metadata
- LIFO order ensures custom script parsers can intercept before app parsers

## Background

### Raw link patterns to handle

| Pattern | Example | Parser |
|---------|---------|--------|
| Absolute file path | `C:\data\file.txt`, `/home/user/file.txt` | File parser (fallback) |
| `file://` protocol | `file:///C:/data/file.txt`, `file://d:/file.txt` | File parser (strip protocol) |
| Archive path with `!` | `C:\docs.zip!readme.txt` | Archive parser |
| Archive `file://` | `file:///C:/docs.zip!readme.txt` | Archive parser (after file parser strips protocol) |

**HTTP/HTTPS URLs** are NOT handled in this task — they're bundled with US-270 (HttpProvider) since the parser is useless without the provider/resolver.

### Parser registration order (LIFO)

Parsers are registered during bootstrap in general-to-specific order. Since `sendAsync()` uses LIFO, the most specific parser runs first:

```
Registration order:          Execution order (LIFO):
1. fileParser  (first)       ← runs last  (fallback)
2. archiveParser (second)    ← runs first (checks for "!")
```

### What each parser does

**Archive parser:**
1. Check if raw string contains `!` separator
2. If yes → fire `openLink.sendAsync(new OpenLinkEvent(raw))` with the full archive path as URL
3. Set `event.handled = true`

**File parser (fallback):**
1. Strip `file://` protocol prefix if present (convert to plain path)
2. Fire `openLink.sendAsync(new OpenLinkEvent(filePath))`
3. Set `event.handled = true`

Note: The file parser is the fallback — it handles anything that wasn't caught by a more specific parser. At this stage it just forwards the path to Layer 2. It doesn't validate whether the path exists.

### `file://` URL normalization

The `file://` protocol has variations:
- `file:///C:/path/file.txt` — standard 3 slashes + drive letter
- `file://C:/path/file.txt` — 2 slashes + drive letter (common in practice)
- `file:///home/user/file.txt` — Unix paths

Normalization: strip `file://` prefix, decode URI components (`%20` → space, etc.).

## Acceptance Criteria

- [ ] Archive parser registered on `openRawLink` — detects `!` in raw string, fires `openLink`
- [ ] File parser registered on `openRawLink` — fallback, strips `file://` if present, fires `openLink`
- [ ] Registration order ensures archive parser runs before file parser (LIFO)
- [ ] `file://` URLs correctly normalized to plain file paths
- [ ] URI-encoded characters decoded (`%20` → space, etc.)
- [ ] Parsers registered during app bootstrap
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Create parsers module

File: `src/renderer/content/parsers.ts`

```typescript
import { app } from "../api/app";
import { OpenLinkEvent } from "../api/events/events";

/**
 * Normalize a file:// URL to a plain file path.
 * - Strips "file://" or "file:///" prefix
 * - Decodes URI-encoded characters (%20 → space, etc.)
 * - Handles Windows drive letters: file:///C:/... → C:/...
 */
function normalizeFileUrl(raw: string): string {
    let path = raw;
    if (path.startsWith("file:///")) {
        path = path.slice(8); // "file:///C:/..." → "C:/..."
    } else if (path.startsWith("file://")) {
        path = path.slice(7); // "file://C:/..." → "C:/..."
    }
    return decodeURIComponent(path);
}

/** Whether the raw string looks like a file:// URL. */
function isFileUrl(raw: string): boolean {
    return raw.startsWith("file://");
}

/** Whether the raw string contains an archive separator. */
function isArchivePath(raw: string): boolean {
    return raw.includes("!");
}

/**
 * Register Layer 1 parsers on openRawLink.
 * Call during app bootstrap. Registration order matters (LIFO):
 * - fileParser registered first → runs last (fallback)
 * - archiveParser registered second → runs first
 */
export function registerRawLinkParsers(): void {
    // File parser — fallback for plain file paths and file:// URLs
    app.events.openRawLink.subscribe(async (event) => {
        let filePath = event.raw;
        if (isFileUrl(filePath)) {
            filePath = normalizeFileUrl(filePath);
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(filePath));
        event.handled = true;
    });

    // Archive parser — detects "!" separator, fires openLink with full archive path
    app.events.openRawLink.subscribe(async (event) => {
        if (!isArchivePath(event.raw)) return;
        let archivePath = event.raw;
        if (isFileUrl(archivePath)) {
            archivePath = normalizeFileUrl(archivePath);
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(archivePath));
        event.handled = true;
    });
}
```

### Step 2: Register parsers during bootstrap

File: `src/renderer/api/app.ts` — call `registerRawLinkParsers()` during init.

Need to find the right place in the bootstrap sequence. The parsers must be registered BEFORE any scripts load (so scripts register after and run first in LIFO). Look for where `AppEvents` is initialized or where other bootstrap subscriptions happen.

### Step 3: Verify with archive paths containing `file://`

Edge case: `file:///C:/docs.zip!readme.txt` — the archive parser should handle this:
1. Archive parser sees `!` → matches
2. Strips `file://` → `C:/docs.zip!readme.txt`
3. Fires `openLink` with the normalized archive path

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/content/parsers.ts` | **NEW** — `registerRawLinkParsers()`, file and archive parsers |
| `src/renderer/api/app.ts` | Call `registerRawLinkParsers()` during bootstrap |

## Design Decisions

### File parser is the fallback — handles everything
The file parser doesn't validate paths. It just normalizes `file://` URLs and forwards to Layer 2. If the path doesn't exist, the Layer 2 resolver or the editor will handle the error.

### Archive parser runs before file parser
The archive parser checks for `!` and handles the full archive path (including `file://` normalization). If `!` is not present, the archive parser does nothing and the file parser handles it.

### HTTP parser deferred to US-270
An HTTP parser would detect `https://...` and fire `openLink`. But without `HttpProvider` and an HTTP resolver, the link would go unhandled in Layer 2. So the HTTP parser is bundled with US-270.

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-263 (link event channels)
- Needed by: US-267 (migrate entry points — entry points will fire `openRawLink` instead of calling `openFile()`)
