# US-364: Open Non-GET Network Requests in RestClient

## Goal

Route links with `target: "rest-client"` to open in the RestClient editor instead of the normal content pipeline. This handles both cURL-formatted hrefs (from network logs, US-363) and plain HTTP URLs. The RestClient page is opened with a pre-populated request derived from the link's URL, method, headers, and body.

## Background

### Current link flow for cURL hrefs

When a user clicks a network resource link (from "Show Resources"), the flow is:
1. **Link click** → `app.events.openRawLink.sendAsync(new RawLinkEvent(href, target, metadata))`
2. **Layer 1 cURL parser** (`parsers.ts:69-86`) — detects `curl ...`, parses URL/method/headers/body into `ILinkMetadata`, fires `openLink`
3. **Layer 2 HTTP resolver** (`resolvers.ts:143-204`) — creates `HttpProvider` pipe, fires `openContent`
4. **Layer 3 open handler** — creates page with pipe

For `target: "rest-client"`, we must intercept at Layer 2 **before** pipe creation and open RestClient instead.

### Plain HTTP URL flow

Plain `https://...` URLs also go through Layer 2. The resolver checks extension, Accept header, etc. to decide the editor. For `target: "rest-client"` on plain URLs, we also need to route to RestClient (useful for opening any URL in RestClient for manual testing).

### RestClient data format

**`src/renderer/editors/rest-client/restClientTypes.ts`**

```typescript
interface RestClientData {
    type: "rest-client";
    requests: RestRequest[];
}

interface RestRequest {
    id: string;
    name: string;
    collection: string;
    method: string;
    url: string;
    headers: RestHeader[];      // { key, value, enabled }
    body: string;
    bodyType: BodyType;         // "none" | "form-urlencoded" | "raw" | "binary" | "form-data"
    bodyLanguage: RawLanguage;  // "plaintext" | "json" | "javascript" | "html" | "xml"
    formData: RestHeader[];
    binaryFilePath: string;
    formDataEntries: FormDataEntry[];
}
```

### Opening RestClient programmatically

```typescript
pagesModel.addEditorPage("rest-client", "json", "title.rest.json", jsonContent);
```

This works because RestClient is registered as `editorType: "textFile"`, `category: "content-view"`, and `isEditorContent()` detects `"type": "rest-client"` in JSON content.

### Existing cURL parser in RestClient

**`src/renderer/editors/rest-client/parseClipboardRequest.ts`**

`parseClipboardRequest(text)` returns `ParsedRequest`:
```typescript
interface ParsedRequest {
    method: string;
    url: string;
    headers: RestHeader[];   // Already in { key, value, enabled } format
    body: string;
    bodyType: BodyType;      // Auto-detected from Content-Type
    bodyLanguage: RawLanguage;
    formData: RestHeader[];
}
```

This is the exact shape needed to build a `RestRequest`. We reuse this parser for cURL hrefs.

### ILinkMetadata for plain URLs

When a plain HTTP URL comes through Layer 1 → Layer 2, `event.metadata` may contain:
- `method?: string` — from cURL parser
- `headers?: Record<string, string>` — from cURL parser
- `body?: string` — from cURL parser

For plain URLs without metadata, we create a simple GET request.

## Implementation Plan

### Step 1: Add RestClient handler in Layer 2 resolver

**File: `src/renderer/content/resolvers.ts`**

Add an early check at the top of the HTTP resolver (after line 144 `if (!isHttpUrl(event.url)) return;`) for `target === "rest-client"`:

```typescript
app.events.openLink.subscribe(async (event) => {
    if (!isHttpUrl(event.url)) return;

    // Route to RestClient when target is "rest-client"
    if (event.target === "rest-client") {
        const { openInRestClient } = await import("../editors/rest-client/open-in-rest-client");
        await openInRestClient(event.url, event.metadata);
        event.handled = true;
        return;
    }

    // ... existing resolver logic unchanged ...
});
```

### Step 2: Create the RestClient opening utility

**File: `src/renderer/editors/rest-client/open-in-rest-client.ts`** (new file)

This utility handles both cURL-parsed metadata and plain URLs:

```typescript
import type { ILinkMetadata } from "../../api/types/io.events";
import type { RestRequest, RestClientData } from "./restClientTypes";
import { createDefaultRequest } from "./restClientTypes";

/**
 * Open a URL in the RestClient editor.
 * Handles both cURL-parsed metadata (method, headers, body) and plain URLs.
 */
export async function openInRestClient(
    url: string,
    metadata?: ILinkMetadata,
): Promise<void> {
    const { pagesModel } = await import("../../api/pages");

    const request = buildRestRequest(url, metadata);
    const data: RestClientData = {
        type: "rest-client",
        requests: [request],
    };

    const title = restClientTitle(url);
    pagesModel.addEditorPage(
        "rest-client",
        "json",
        title,
        JSON.stringify(data, null, 4),
    );
}

function buildRestRequest(url: string, metadata?: ILinkMetadata): RestRequest {
    const request = createDefaultRequest(requestName(url));
    request.url = url;

    if (metadata?.method) {
        request.method = metadata.method;
    }

    if (metadata?.headers) {
        request.headers = Object.entries(metadata.headers).map(
            ([key, value]) => ({ key, value, enabled: true }),
        );
    }

    if (metadata?.body) {
        request.body = metadata.body;
        request.bodyType = "raw";
        // Detect body language from Content-Type header
        const contentType = metadata.headers?.["Content-Type"]
            || metadata.headers?.["content-type"] || "";
        if (contentType.includes("json")) {
            request.bodyLanguage = "json";
        } else if (contentType.includes("xml")) {
            request.bodyLanguage = "xml";
        } else if (contentType.includes("html")) {
            request.bodyLanguage = "html";
        } else if (contentType.includes("javascript")) {
            request.bodyLanguage = "javascript";
        }
    }

    return request;
}

function requestName(url: string): string {
    try {
        const u = new URL(url);
        const segments = u.pathname.split("/").filter(Boolean);
        return segments.length > 0
            ? segments[segments.length - 1]
            : u.hostname;
    } catch {
        return "Request";
    }
}

function restClientTitle(url: string): string {
    try {
        const u = new URL(url);
        return u.hostname + ".rest.json";
    } catch {
        return "request.rest.json";
    }
}
```

### Step 3: No changes needed elsewhere

- **Layer 1 cURL parser** (`parsers.ts`) already forwards `target` from the event
- **`network-log-links.ts`** (US-363) already sets `target: "rest-client"` on non-GET links
- **`parseClipboardRequest.ts`** is NOT used here — we use `ILinkMetadata` (which already has the parsed data from Layer 1's `parseHttpRequest()`). The two parsers produce equivalent data, just in different shapes (`Record<string, string>` headers vs `RestHeader[]`). The conversion happens in `buildRestRequest()`.

## Edge Cases

- **Plain HTTP URL without metadata:** Creates a simple GET request with no headers/body
- **cURL href with full metadata:** Method, headers, body all populated from Layer 1 parsing
- **Missing Content-Type:** Body language defaults to "plaintext" (from `createDefaultRequest`)
- **Title format:** Uses `hostname.rest.json` (e.g., `api.example.com.rest.json`) — the `.rest.json` extension ensures RestClient auto-detection on restore

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/content/resolvers.ts` | Add early `target === "rest-client"` check in HTTP resolver |
| `src/renderer/editors/rest-client/open-in-rest-client.ts` | **New file** — `openInRestClient()` utility |

### Files NOT changed

- `src/renderer/content/parsers.ts` — already forwards target
- `src/renderer/editors/browser/network-log-links.ts` — already sets `target: "rest-client"`
- `src/renderer/editors/rest-client/restClientTypes.ts` — reusing `createDefaultRequest()`
- `src/renderer/editors/rest-client/parseClipboardRequest.ts` — not needed, metadata already parsed
- `src/renderer/editors/rest-client/RestClientViewModel.ts` — no changes
- `src/renderer/editors/register-editors.ts` — RestClient registration unchanged

## Acceptance Criteria

- [ ] Clicking a non-GET network resource link (from Show Resources) opens RestClient
- [ ] RestClient is pre-populated with correct URL, method, headers, and body
- [ ] Clicking a plain HTTP URL with `target: "rest-client"` opens RestClient with GET request
- [ ] Body language auto-detected from Content-Type header (json, xml, html)
- [ ] Page title uses `.rest.json` extension for proper RestClient detection
- [ ] GET/HEAD links from network log still open normally through content pipeline
- [ ] No regression in existing link opening behavior
