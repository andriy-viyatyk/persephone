# US-244: Rest Client — Request Builder

## Goal

Replace the placeholder right panel in the Rest Client editor with a full request builder: method selector, URL input, headers editor (AVGrid with header name combobox), body editor (Monaco), and a Send button wired to `nodeFetch`.

## Background

### Current state (US-243)

The Rest Client editor has a two-panel layout. The left panel (TreeView with collection) is done. The right panel currently shows a read-only `RequestDetail` placeholder. This task replaces that placeholder with an interactive request builder.

### Key components to use

- **ComboSelect** (`src/renderer/components/form/ComboSelect.tsx`) — for HTTP method selector and header name dropdown. Supports `freeText` mode, async options, custom labels/icons.
- **AVGrid** (`src/renderer/components/data-grid/AVGrid/`) — for headers editor. Columns with `options` property automatically render a ComboSelect dropdown in edit mode.
- **Monaco Editor** (`@monaco-editor/react`) — for request body. Embedded as a sub-component with minimal chrome (no line numbers, no minimap).
- **Splitter** (`src/renderer/components/layout/Splitter.tsx`) — horizontal splitter to divide request builder (top) from response viewer area (bottom, placeholder for US-245).
- **nodeFetch** (`src/renderer/api/node-fetch.ts`) — for executing requests.

### AVGrid editing pattern

AVGrid supports inline cell editing. When a column has `options`, the edit formatter automatically uses `ComboSelect`:
```typescript
const columns: Column[] = [
    { key: "key", name: "Header", options: COMMON_HEADERS, width: "40%" },
    { key: "value", name: "Value", width: "60%" },
];
```
Edits are committed via `model.props.editRow(columnKey, rowKey, newValue)`.

### Monaco embedding pattern

From the Notebook editor's MiniTextEditor:
```typescript
import { Editor } from "@monaco-editor/react";

<Editor
    height="200px"
    value={body}
    language={bodyLanguage}
    onChange={handleBodyChange}
    options={{
        lineNumbers: "off",
        minimap: { enabled: false },
        automaticLayout: true,
        padding: { top: 4, bottom: 4 },
    }}
/>
```

## Implementation Plan

### Step 1: Create HTTP constants
**File:** `src/renderer/editors/rest-client/httpConstants.ts`

```typescript
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const COMMON_HEADERS = [
    "Accept",
    "Accept-Charset",
    "Accept-Encoding",
    "Accept-Language",
    "Authorization",
    "Cache-Control",
    "Connection",
    "Content-Length",
    "Content-Type",
    "Cookie",
    "Host",
    "If-Modified-Since",
    "If-None-Match",
    "Origin",
    "Referer",
    "User-Agent",
    "X-API-Key",
    "X-CSRF-Token",
    "X-Requested-With",
];
```

### Step 2: Create RequestBuilder component
**File:** `src/renderer/editors/rest-client/RequestBuilder.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ [GET ▼]  [https://api.example.com/users  ] [Send]│
├─────────────────────────────────────────────────┤
│ Headers                                    [+ Add]│
│ ┌─────┬──────────────────┬─────────┬───┐        │
│ │ ✓   │ Header Name  ▼   │ Value   │ ✕ │        │
│ │ ✓   │ Content-Type ▼   │ app/json│ ✕ │        │
│ └─────┴──────────────────┴─────────┴───┘        │
├─────────────────────────────────────────────────┤
│ Body                                             │
│ ┌───────────────────────────────────────────┐   │
│ │ { "name": "John" }     (Monaco editor)    │   │
│ └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Sub-components within RequestBuilder:**

**URL Bar (top row):**
- ComboSelect for HTTP method (colored badge)
- Text input for URL (full width, monospace)
- Send button

**Headers section:**
- Simple input rows (not AVGrid — auto-sized height, lighter for 3-10 rows)
- Each row: `[✓ checkbox] [Header Name input with ComboSelect] [Value input] [✕ delete]`
- Header Name uses ComboSelect with `freeText: true` and `COMMON_HEADERS` as suggestions
- Value is a plain text input
- "Add Header" button below rows
- Rows auto-size to content (no fixed grid height)

**Body section:**
- Monaco Editor embedded with minimal chrome
- Auto-detect language from Content-Type header (e.g., `application/json` → `"json"`)
- Only shown when method is not GET/HEAD (methods that typically have a body)

### Step 3: Add execution logic to RestClientViewModel
**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

Add state for response and execution:
```typescript
// Add to state:
executing: false,
response: null as RestResponse | null,
responseTime: 0,
responseCache: {} as Record<string, { response: RestResponse; responseTime: number }>,
```

**Response caching:**
- On `sendRequest()` success: save response to `responseCache[requestId]` and persist to `stateStorage` under `"rest-client-responses"`
- On `selectRequest()`: restore cached response from `responseCache[requestId]` or `null`
- On `onInit()`: load response cache from `stateStorage`
- Debounce cache saves to avoid excessive disk writes

Add `sendRequest()` method:
```typescript
sendRequest = async () => {
    const request = this.selectedRequest;
    if (!request || !request.url) return;

    this.state.update(s => { s.executing = true; s.response = null; });
    const startTime = Date.now();

    try {
        const { nodeFetch } = await import("../../api/node-fetch");
        const headers: Record<string, string> = {};
        for (const h of request.headers) {
            if (h.enabled && h.key) headers[h.key] = h.value;
        }

        const res = await nodeFetch(request.url, {
            method: request.method,
            headers,
            body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body || undefined,
        });

        const responseHeaders: RestHeader[] = [];
        res.headers.forEach((v, k) => {
            responseHeaders.push({ key: k, value: v, enabled: true });
        });

        const body = await res.text();
        const responseTime = Date.now() - startTime;

        this.state.update(s => {
            s.executing = false;
            s.response = { status: res.status, statusText: res.statusText, headers: responseHeaders, body };
            s.responseTime = responseTime;
        });
    } catch (err: any) {
        this.state.update(s => {
            s.executing = false;
            s.response = { status: 0, statusText: "Error", headers: [], body: err.message };
            s.responseTime = Date.now() - startTime;
        });
    }
};
```

### Step 4: Add RestResponse type
**File:** `src/renderer/editors/rest-client/restClientTypes.ts`

```typescript
export interface RestResponse {
    status: number;
    statusText: string;
    headers: RestHeader[];
    body: string;
}
```

### Step 5: Update RestClientEditor to use RequestBuilder
**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Replace the `RequestDetail` placeholder with `RequestBuilder`. Add a horizontal Splitter between request builder (top) and response area (bottom, empty placeholder for US-245).

### Step 6: Wire up header editing to ViewModel
The AVGrid `editRow` callback should call `vm.updateRequest()` to update headers. Add/delete header methods on the ViewModel:
- `addHeader(requestId)` — add empty header row
- `deleteHeader(requestId, index)` — remove header row
- `toggleHeader(requestId, index)` — enable/disable
- `updateHeader(requestId, index, changes)` — update key or value

## Design Decisions (resolved)

1. **Simple input rows for headers (not AVGrid).** AVGrid is overkill for 3-10 rows. Simple flex rows with inputs + ComboSelect give us auto-height sizing and a lighter feel. Matches Postman's approach.

2. **Body language detection:** Default to `"json"`, auto-detect from Content-Type header when possible.

3. **Response caching via stateStorage:** Responses are cached using `host.stateStorage` (same pattern as Todo/Link editors for selection state). A separate cache name `"rest-client-responses"` stores a JSON map of `{ [requestId]: RestResponse }`. Responses persist across app restarts but are cleared when the page is closed. When switching requests, the cached response is restored. When a new response comes in, it overwrites the cached one for that request.

4. **Send button placement:** Top right, in the URL bar row (standard Postman pattern).

## Acceptance Criteria

- [ ] Method selector dropdown (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- [ ] URL input field
- [ ] Send button that executes the request via `nodeFetch`
- [ ] Headers editor with header name suggestions (combobox/dropdown)
- [ ] Add/delete/enable/disable individual headers
- [ ] Body editor (Monaco) for request body
- [ ] Body section hidden for GET/HEAD methods
- [ ] Request state (method, URL, headers, body) saved to `.rest.json` file
- [ ] Loading indicator during request execution
- [ ] Response data stored in ViewModel state (ephemeral)
