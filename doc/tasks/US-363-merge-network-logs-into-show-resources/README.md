# US-363: Merge Network Logs into Show Resources

## Goal

Enhance "Show Resources" to include network-logged requests alongside DOM-extracted resources. Network log entries are converted to `ILink[]` with cURL-formatted `href` strings, grouped under `"Network/GET"`, `"Network/POST"`, etc. categories. This gives visibility into fetch/XHR requests that don't appear in the DOM.

## Background

### Current "Show Resources" flow

Both the context menu (line 489) and the toolbar page menu (line 592) in `BrowserWebviewModel.ts` share identical logic:

```typescript
const html = await ipcRenderer.invoke(BrowserChannel.collectDom, regKey);
const { extractHtmlResources } = await import("../../core/utils/html-resources");
const links = extractHtmlResources(html, { baseUrl: pageUrl });
pagesModel.openLinks(links, title + " — Resources");
```

DOM-extracted resources get categories like `"Images"`, `"Scripts"`, `"Stylesheets"`, etc.

### Network log IPC (US-362)

The main process stores per-page network logs (200 entries). The renderer fetches them via:
```typescript
const log: NetworkLogEntry[] = await ipcRenderer.invoke(BrowserChannel.getNetworkLog, regKey);
```

Each `NetworkLogEntry` contains: `url`, `method`, `requestHeaders`, `requestBody?`, `statusCode?`, `responseHeaders?`, `resourceType`, `timestamp`.

### cURL in the content pipeline

Persephone's Layer 1 parser (`src/renderer/content/parsers.ts` lines 69-86) detects `curl ...` strings and parses them via `parseHttpRequest()`. This extracts URL, method, headers, body → populates `ILinkMetadata` → opens via `HttpProvider` with the correct request configuration.

So setting `ILink.href` to a cURL command string means clicking the link will open it through the existing content pipeline with full HTTP context.

### ILink categories

Categories use `/` as the hierarchy separator. `"Network/GET"` renders as a nested tree: `Network` > `GET` in the CategoryView sidebar.

## Implementation Plan

### Step 1: Create a utility to convert NetworkLogEntry[] to ILink[]

**File: `src/renderer/editors/browser/network-log-links.ts`** (new file)

This utility converts network log entries to ILink items with cURL-formatted href:

```typescript
import { ILink } from "../../api/types/io.tree";
import { NetworkLogEntry } from "../../../ipc/browser-ipc";

/**
 * Convert network log entries to ILink[] with cURL href strings.
 * Each link is categorized under "Network/{METHOD}".
 */
export function networkLogToLinks(entries: NetworkLogEntry[]): ILink[] {
    const seen = new Set<string>();
    const result: ILink[] = [];

    for (const entry of entries) {
        const curl = buildCurl(entry);
        if (seen.has(curl)) continue;
        seen.add(curl);

        result.push({
            title: urlTitle(entry.url),
            href: curl,
            category: `Network/${entry.method}`,
            tags: [entry.resourceType, String(entry.statusCode ?? "pending")],
            isDirectory: false,
            // Non-GET methods should open in RestClient (wired in US-364)
            target: isReadOnly(entry.method) ? undefined : "rest-client",
        });
    }

    return result;
}
```

**`buildCurl(entry)` helper:**
```typescript
function buildCurl(entry: NetworkLogEntry): string {
    const parts: string[] = [`curl '${entry.url}'`];

    if (entry.method !== "GET") {
        parts.push(`-X ${entry.method}`);
    }

    // Add headers (skip pseudo-headers and very long values)
    for (const [key, value] of Object.entries(entry.requestHeaders)) {
        if (key.startsWith(":")) continue;  // Skip HTTP/2 pseudo-headers
        parts.push(`-H '${key}: ${value}'`);
    }

    if (entry.requestBody) {
        parts.push(`--data-raw '${escapeSingleQuotes(entry.requestBody)}'`);
    }

    return parts.join(" ");
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isReadOnly(method: string): boolean {
    return READ_ONLY_METHODS.has(method.toUpperCase());
}

function escapeSingleQuotes(s: string): string {
    return s.replace(/'/g, "'\\''");
}

function urlTitle(url: string): string {
    try {
        const u = new URL(url);
        // Use last path segment or hostname
        const segments = u.pathname.split("/").filter(Boolean);
        return segments.length > 0 ? segments[segments.length - 1] + u.search : u.hostname + u.pathname;
    } catch {
        return url;
    }
}
```

### Step 2: Update "Show Resources" to merge network logs

**File: `src/renderer/editors/browser/BrowserWebviewModel.ts`**

Extract a shared `showResources` method to avoid duplicating the logic in both the context menu and toolbar menu:

```typescript
/** Collect DOM resources + network log and open as a link collection. */
private showResources = async (regKey: string, pageUrl: string, title: string) => {
    const [html, networkLog] = await Promise.all([
        ipcRenderer.invoke(BrowserChannel.collectDom, regKey),
        ipcRenderer.invoke(BrowserChannel.getNetworkLog, regKey),
    ]);

    const { extractHtmlResources } = await import("../../core/utils/html-resources");
    const { networkLogToLinks } = await import("./network-log-links");

    const domLinks = extractHtmlResources(html, { baseUrl: pageUrl });
    const networkLinks = networkLogToLinks(networkLog);
    const links = [...domLinks, ...networkLinks];

    if (links.length === 0) {
        ui.notify("No resources found on this page.", "info");
        return;
    }

    pagesModel.openLinks(links, title + " — Resources");
};
```

**Context menu handler (line 489)** — replace inline onClick:
```typescript
// Before:
onClick: async () => {
    const html = await ipcRenderer.invoke(BrowserChannel.collectDom, regKey);
    // ... 7 lines of logic ...
},

// After:
onClick: () => this.showResources(regKey, pageUrl, tab?.pageTitle || pageUrl),
```

**Toolbar page menu (line 592)** — same replacement:
```typescript
// Before:
onClick: async () => {
    const html = await ipcRenderer.invoke(BrowserChannel.collectDom, regKey);
    // ... 7 lines of logic ...
},

// After:
onClick: () => this.showResources(regKey, pageUrl, tab?.pageTitle || pageUrl),
```

### Step 3: Verify ILink type import

Check that `ILink` is properly importable in the new file. The type is defined in `src/renderer/api/types/io.tree.d.ts`. It should be available as a standard import since it's a `.d.ts` ambient declaration.

## Edge Cases

- **Empty network log:** `networkLogToLinks([])` returns `[]` — merged list is just DOM resources. No special handling needed.
- **No cross-category duplicates:** DOM resources have plain `https://...` hrefs, network entries have `curl '...'` hrefs — they can never collide.
- **Network log deduplication:** Identical requests (same URL + headers + body) produce the same cURL string. `networkLogToLinks()` deduplicates by the final cURL string via a `Set<string>`, keeping the first occurrence.
- **Single-quote escaping in cURL:** Request bodies or header values containing `'` are escaped with the bash idiom `'\''` (end quote, escaped quote, start quote).
- **HTTP/2 pseudo-headers:** Headers like `:authority`, `:method`, `:path` are filtered out — they're redundant with the URL and method in the cURL command.
- **Parallel fetch:** DOM collection and network log are fetched in parallel via `Promise.all` for better performance.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/browser/network-log-links.ts` | **New file** — `networkLogToLinks()` utility |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Extract shared `showResources()` method, update both context menu and toolbar menu |

### Files NOT changed

- `src/ipc/browser-ipc.ts` — `NetworkLogEntry` and `getNetworkLog` channel already exist (US-362)
- `src/main/network-logger.ts` — no changes needed
- `src/renderer/core/utils/html-resources.ts` — unchanged, DOM extraction works as before
- `src/renderer/core/utils/curl-parser.ts` — unchanged, parsing happens in the content pipeline when links are clicked

## Acceptance Criteria

- [ ] "Show Resources" includes network-logged requests alongside DOM resources
- [ ] Network requests categorized as `Network/GET`, `Network/POST`, `Network/PUT`, etc.
- [ ] Each network ILink.href is a valid cURL command with URL, method, headers, and body
- [ ] Clicking a network resource link opens it through the existing content pipeline
- [ ] Both context menu and toolbar "..." menu use the same shared logic
- [ ] DOM resources still work as before (no regression)
- [ ] Empty network log doesn't affect DOM resource display
