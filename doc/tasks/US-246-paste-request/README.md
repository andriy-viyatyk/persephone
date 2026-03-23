# US-246: Rest Client — Paste Request from Browser

## Goal

Allow users to paste HTTP requests copied from browser DevTools network tab into the Rest Client. Support common copy formats: fetch, fetch (Node.js), cURL (bash), and cURL (cmd).

## Background

Browser DevTools (Chrome, Edge) offer multiple "Copy as..." options in the network tab context menu. Users frequently copy requests to reproduce them in API tools. We detect the format automatically from the clipboard content and parse it into a RestRequest.

### Supported formats

**1. Copy as fetch / Copy as fetch (Node.js)**
```javascript
fetch("https://example.com/api", {
  "headers": {
    "accept": "application/json",
    "authorization": "Bearer token"
  },
  "body": null,
  "method": "GET"
});
```
Differences: Node.js variant includes cookies in the `cookie` header. Browser variant has extra fields (`mode`, `credentials`) that we ignore.

**2. Copy as cURL (bash)**
```bash
curl 'https://example.com/api' \
  -H 'accept: application/json' \
  -H 'authorization: Bearer token' \
  -b 'session=abc123' \
  -X POST \
  -d '{"key":"value"}'
```

**3. Copy as cURL (cmd)**
Same as bash but with `^` line continuations and `^"` escaping:
```cmd
curl ^"https://example.com/api^" ^
  -H ^"accept: application/json^" ^
  -X POST
```

## Implementation Plan

### Step 1: Create clipboard parser module
**File:** `src/renderer/editors/rest-client/parseClipboardRequest.ts`

A function that takes clipboard text and returns a parsed request:
```typescript
interface ParsedRequest {
    method: string;
    url: string;
    headers: { key: string; value: string; enabled: boolean }[];
    body: string;
}

function parseClipboardRequest(text: string): ParsedRequest | null
```

**Auto-detection order:**
1. Starts with `fetch(` → parse as fetch
2. Starts with `curl ` (case-insensitive) → parse as cURL
3. Otherwise → return null

PowerShell format is intentionally skipped — too verbose and rarely used for copy-paste into API tools.

**Parsers:**

**parseFetch(text):**
- Extract URL from first argument: `fetch("URL", {`
- Extract headers object: `"headers": { ... }`
- Extract method: `"method": "POST"`
- Extract body: `"body": "..."` or `"body": null`
- Handle both regular and Node.js variants

**parseCurl(text):**
- Normalize: remove `^` (cmd) and `\` (bash) line continuations
- Extract URL: first non-flag argument (may be quoted)
- Extract headers: all `-H` / `--header` values → split on first `: `
- Extract cookies: `-b` / `--cookie` value → add as `Cookie` header
- Extract method: `-X` / `--request` value (default GET, or POST if `-d` present)
- Extract body: `-d` / `--data` / `--data-raw` / `--data-binary` value

### Step 2: Integrate paste into the editor
**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx` or `RestClientViewModel.ts`

**Two ways to paste:**

**A. Keyboard shortcut (Ctrl+V in URL input):**
- Intercept paste event on the URL input
- If clipboard contains a parseable request format → create/update request
- If not → normal paste behavior (just paste the URL text)

**B. Context menu / button:**
- Add "Paste as Request" to the request tree context menu
- Or add a paste button/icon near the URL bar
- Creates a new request from clipboard content

### Step 3: Handle the parsed result
When a request is parsed:
- If pasting into the URL input of the current request → update the current request (method, URL, headers, body)
- If using "Paste as Request" → create a new request with parsed data
- Name the request based on the URL hostname + path

## Design Decisions

1. **Auto-detect format** — user doesn't need to specify which format they copied. Parser tries each format in order.
2. **URL input paste** — most natural UX. User pastes into URL field, if it's a full cURL/fetch command, the whole request is populated.
3. **Cookies as Cookie header** — cURL `-b` and PowerShell cookies are merged into a single `Cookie` header.
4. **No data loss** — all headers from the clipboard are preserved. User can disable/delete ones they don't need.

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/rest-client/parseClipboardRequest.ts` | **New.** Format detection + parsers for fetch, cURL, PowerShell |
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | Add paste interception on URL input |
| `src/renderer/editors/rest-client/RestClientViewModel.ts` | Add `pasteRequest()` method |

## Acceptance Criteria

- [ ] Pasting "Copy as fetch" into URL input populates method, URL, headers, body
- [ ] Pasting "Copy as fetch (Node.js)" works the same (includes cookie header)
- [ ] Pasting "Copy as cURL (bash)" parses correctly
- [ ] Pasting "Copy as cURL (cmd)" parses correctly (handles `^` escaping)
- [ ] Plain URL paste still works normally (just sets the URL)
- [ ] Parsed request preserves all headers
- [ ] Cookie flags (`-b`) converted to Cookie header
- [ ] Body preserved for POST/PUT/PATCH requests
- [ ] Method correctly detected (explicit or inferred from body/flags)
