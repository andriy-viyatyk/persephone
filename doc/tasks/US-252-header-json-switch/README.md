# US-252: Rest Client — Header View Switch (Table/JSON)

**Epic:** EPIC-010 (Rest Client)
**Status:** Planned

## Goal

Add a table/JSON toggle for both request and response headers. Table view is the current key-value editor. JSON view shows headers as a JSON object in a Monaco Editor — read-only for response, editable for request.

## Implementation Plan

### Request headers (RequestBuilder.tsx)

Add a toggle in the Headers section header (next to the "Copy as JSON" button):
- Two small labels/buttons: `Table` | `JSON` (same style as body type tabs)
- Default: `Table` (current KeyValueEditor)
- `JSON` view: Monaco Editor showing headers as `{ "Key": "Value" }` object
  - Editable — on change, parse JSON back into headers array
  - Only include enabled headers with non-empty keys when converting to JSON
  - When switching back to Table, parse the JSON and update headers
  - If JSON is invalid, show error or keep last valid state

**State:** Add `headersView: "table" | "json"` to `RestClientEditorState` (or local component state in RequestBuilder).

**Table → JSON conversion:**
```typescript
const obj: Record<string, string> = {};
for (const h of headers) {
    if (h.enabled && h.key.trim()) obj[h.key.trim()] = h.value;
}
return JSON.stringify(obj, null, 2);
```

**JSON → Table conversion:**
```typescript
const obj = JSON.parse(jsonStr);
const headers = Object.entries(obj).map(([key, value]) => ({
    key, value: String(value), enabled: true,
}));
```

### Response headers (ResponseViewer.tsx)

Add the same toggle in the Headers tab bar area (next to "Copy as JSON" button):
- `Table` | `JSON`
- Default: `Table` (current HTML table)
- `JSON` view: Monaco Editor (read-only) showing `{ "key": "value" }` object
- Same editor options as response body Monaco

**State:** Local `useState` in ResponseViewer.

## Invalid JSON Handling

When request headers are in JSON mode:
- **Live sync:** On every Monaco change, attempt to parse JSON. If valid, update headers in the data model immediately. If invalid, keep last valid state — Monaco already shows red underlines.
- **Switch to Table:** If JSON is invalid, show `app.ui.notify("Invalid JSON — fix errors before switching to Table view", "warning")` and stay in JSON mode.
- **Send request:** If JSON is invalid, show `app.ui.notify("Fix invalid JSON in headers before sending", "warning")` and abort send.
- **Save:** No special handling needed — live sync means the data model always has the latest valid headers. Invalid JSON in the editor is an in-progress edit state; the file is saved with the last valid headers.

## Acceptance Criteria

- [ ] Request headers: Table/JSON toggle visible
- [ ] Request headers JSON view: editable Monaco, syncs back to headers on switch or blur
- [ ] Response headers: Table/JSON toggle visible
- [ ] Response headers JSON view: read-only Monaco
- [ ] Switching between views preserves data
- [ ] "Copy as JSON" button works in both views
- [ ] Invalid JSON in request headers: warning on switch to Table, stays in JSON mode
- [ ] Invalid JSON in request headers: warning on Send, request not sent
- [ ] Valid JSON edits sync to data model immediately (live parse)

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | Table/JSON toggle, Monaco editor for headers JSON |
| `src/renderer/editors/rest-client/ResponseViewer.tsx` | Table/JSON toggle, Monaco editor for headers JSON |
