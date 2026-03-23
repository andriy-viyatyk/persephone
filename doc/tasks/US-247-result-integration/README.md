# US-247: Rest Client — Result Integration

**Epic:** EPIC-010 (Rest Client)
**Status:** Planned

## Goal

Add copy/export capabilities to the Rest Client: open response body in a new tab, copy headers as JSON, copy request as cURL/fetch, and open requests in new editor tabs.

## Background

### Current state
- Response body is displayed in a Monaco Editor (read-only formatting)
- Response headers displayed as a table
- Request headers displayed via KeyValueEditor
- No way to export or copy request/response data
- No way to open response in a separate tab

### Key APIs
- `app.pages.addEditorPage(editor, language, title, content)` — opens new tab with content and language
- `navigator.clipboard.writeText(text)` — copy to clipboard
- `app.ui.confirm()` — confirmation dialogs
- `parseClipboardRequest.ts` — existing parser for cURL/fetch (we need the reverse: serialize)

### Existing patterns
- `WithPopupMenu` — used for language selectors and method selector (popup menu on click)
- `ResponseViewer` has language label with popup menu in Body tab bar
- `SplitDetailPanel` has REQUEST header bar with collection/name inputs and delete button

## Implementation Plan

### Step 1: Create request serializer

**New file:** `src/renderer/editors/rest-client/serializeRequest.ts`

Build the reverse of `parseClipboardRequest` — serialize a `RestRequest` to:

**cURL (bash):**
```
curl 'https://api.example.com/users' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer token' \
  --data-raw '{"name":"John"}'
```

**cURL (cmd):**
```
curl "https://api.example.com/users" ^
  -X POST ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer token" ^
  --data-raw "{\"name\":\"John\"}"
```

**fetch (browser):**
```javascript
fetch("https://api.example.com/users", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer token"
  },
  body: "{\"name\":\"John\"}"
});
```

**fetch (Node.js):**
```javascript
const res = await fetch("https://api.example.com/users", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer token"
  },
  body: JSON.stringify({ name: "John" })
});
```

Export functions:
```typescript
export function serializeAsCurlBash(request: RestRequest): string;
export function serializeAsCurlCmd(request: RestRequest): string;
export function serializeAsFetch(request: RestRequest): string;
export function serializeAsFetchNodeJs(request: RestRequest): string;
```

Each function should:
- Only include `-X METHOD` if not GET (cURL default)
- Only include enabled headers
- Handle body based on `bodyType`: "raw" uses body string, "form-urlencoded" encodes formData, "none" skips body
- Properly escape quotes for each format

### Step 2: "Open in tab" button on response body

**File:** `src/renderer/editors/rest-client/ResponseViewer.tsx`

Add button to the left of the language label in the Body tab bar (visible only when Body tab is active):

```tsx
<Button size="small" type="icon" title="Open in new tab" onClick={handleOpenInTab}>
    <OpenInNewIcon />  // or ExternalLinkIcon — check available icons
</Button>
```

Handler:
```typescript
const handleOpenInTab = () => {
    if (!response) return;
    const body = formatBody(response.body, language);
    app.pages.addEditorPage("monaco", language, "Response", body);
};
```

### Step 3: "Copy as JSON" button on response headers

**File:** `src/renderer/editors/rest-client/ResponseViewer.tsx`

When Headers tab is active, show a "Copy as JSON" button in the tab bar (same position as language label):

```tsx
{activeTab === "headers" && (
    <Button size="small" type="icon" title="Copy headers as JSON" onClick={handleCopyHeaders}>
        <CopyIcon />
    </Button>
)}
```

Handler:
```typescript
const handleCopyHeaders = () => {
    if (!response) return;
    const obj: Record<string, string> = {};
    for (const h of response.headers) obj[h.key] = h.value;
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
};
```

### Step 4: "Copy as JSON" button on request headers

**File:** `src/renderer/editors/rest-client/RequestBuilder.tsx`

Add a small "Copy" icon button in the Headers section header:

```tsx
<div className="section-header">
    <span className="section-title">Headers</span>
    <Button size="small" type="icon" title="Copy as JSON" onClick={handleCopyHeaders}>
        <CopyIcon />
    </Button>
</div>
```

Handler:
```typescript
const handleCopyHeaders = () => {
    const obj: Record<string, string> = {};
    for (const h of request.headers) {
        if (h.enabled && h.key.trim()) obj[h.key.trim()] = h.value;
    }
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
};
```

### Step 5: "Copy as..." popup menu in REQUEST header bar

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

In the `SplitDetailPanel` REQUEST header, add a "Copy" button with `WithPopupMenu` to the left of the delete button:

```tsx
<WithPopupMenu items={copyMenuItems}>
    {(setOpen) => (
        <Button size="small" type="icon" title="Copy request" className="copy-button" onClick={(e) => setOpen(e.currentTarget)}>
            <CopyIcon />
        </Button>
    )}
</WithPopupMenu>
```

Menu items:
- "Copy as cURL (bash)" → `serializeAsCurlBash(request)` → clipboard
- "Copy as cURL (cmd)" → `serializeAsCurlCmd(request)` → clipboard
- "Copy as fetch" → `serializeAsFetch(request)` → clipboard
- "Copy as fetch (Node.js)" → `serializeAsFetchNodeJs(request)` → clipboard

### Step 6: "Open in new editor" context menu for tree items

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Add "Open in New Editor" to both request and collection context menus:

**For request item:**
Creates a new `.rest.json` editor tab with just that one request:
```typescript
{
    label: "Open in New Editor",
    onClick: () => {
        const data: RestClientData = {
            type: "rest-client",
            requests: [{ ...req, collection: "" }],
        };
        app.pages.addEditorPage("rest-client", "json", req.name || "Request", JSON.stringify(data, null, 4));
    },
}
```

**For collection item:**
Creates a new `.rest.json` editor tab with all requests in that collection:
```typescript
{
    label: "Open in New Editor",
    onClick: () => {
        const requests = vm.state.get().data.requests
            .filter(r => r.collection === colName)
            .map(r => ({ ...r, collection: "" }));
        const data: RestClientData = { type: "rest-client", requests };
        const title = colName || EMPTY_LABEL;
        app.pages.addEditorPage("rest-client", "json", title, JSON.stringify(data, null, 4));
    },
}
```

## Concerns (all resolved)

1. **Icon** — Use `NewWindowIcon` (same as Draw editor "Open in new tab").
2. **`addEditorPage` content parameter** — Update `pages.d.ts` to include optional `content` param.
3. **Serialization edge cases** — Handle what we can, fix issues later if any.
4. **Rest Client editor via `addEditorPage`** — User will verify manually.

## Acceptance Criteria

- [ ] Response Body tab has "Open in new tab" button — opens body in new Monaco tab with correct language
- [ ] Response Headers tab has "Copy as JSON" button — copies headers object to clipboard
- [ ] Request Headers section has "Copy as JSON" button — copies enabled headers to clipboard
- [ ] REQUEST header bar has "Copy as..." button with popup menu (cURL bash, cURL cmd, fetch, fetch Node.js)
- [ ] All 4 serialization formats produce valid, paste-ready output
- [ ] Tree context menu: "Open in New Editor" for requests (single request in new tab)
- [ ] Tree context menu: "Open in New Editor" for collections (all collection requests in new tab)
- [ ] `pages.d.ts` updated with `content` parameter on `addEditorPage`

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/rest-client/serializeRequest.ts` | **NEW** — cURL/fetch serialization |
| `src/renderer/editors/rest-client/ResponseViewer.tsx` | "Open in tab" button, "Copy headers as JSON" button |
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | "Copy headers as JSON" button |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | "Copy as..." popup menu, "Open in New Editor" context menu |
| `src/renderer/api/types/pages.d.ts` | Add `content` param to `addEditorPage` |
