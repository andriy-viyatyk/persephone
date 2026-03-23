# US-248: Request Body Types & Enhancements

**Epic:** EPIC-010 (Rest Client)
**Status:** Planned

## Goal

Add body type selection to the Rest Client request builder, matching Postman's approach:
- **none** — no body
- **x-www-form-urlencoded** — key-value pairs encoded as URL params
- **raw** — text body with language sub-selector (plaintext, json, javascript, html, xml)

Extract the header row pattern into a reusable `KeyValueEditor` component shared by headers and form-data.

**Deferred to future tasks:** `form-data` (multipart) and `binary` (file upload).

## Background

### Current state
- Body is always a plain `<textarea>` (hidden for GET/HEAD methods)
- `RestRequest.body` is a single string field
- No body type concept — Content-Type header must be set manually
- Header rows use inline `HeaderRow` sub-component in `RequestBuilder.tsx` (lines 373-436) with: checkbox + ComboSelect key + TextAreaField value + delete button
- The auto-add empty last row pattern is in `RestClientViewModel.ensureEmptyLastHeader()`

### Patterns to follow
- Body type selector: tab-style buttons in the "Body" section header (like response tabs in `ResponseViewer.tsx` lines 206-235)
- Monaco editor for body: use `@monaco-editor/react` `Editor` component (same as `ResponseViewer.tsx` line 238)
- Key-value editor: extract from existing `HeaderRow` pattern

### Design decisions (resolved)
1. **Monaco Editor for raw body** — Use Monaco for all raw body content with language selector (plaintext, json, javascript, html, xml). Provides syntax highlighting and validation for JSON/JS/HTML/XML.
2. **Content-Type auto-management** — Auto-set Content-Type when switching body type (overwrite existing). User can change header manually after.
3. **Body panel visibility for GET/HEAD** — Body panel is always visible. Auto-select bodyType "none" when switching to GET/HEAD, but allow user to change it afterwards.
4. **KeyValueEditor styling** — Component owns its own styled root with row styles. Parent drops `.header-row` styles.

## Implementation Plan

### Step 1: Add `bodyType`, `bodyLanguage`, and `formData` to data model

**File:** `src/renderer/editors/rest-client/restClientTypes.ts`

```typescript
export type BodyType = "none" | "form-urlencoded" | "raw";

export const RAW_LANGUAGES = ["plaintext", "json", "javascript", "html", "xml"] as const;
export type RawLanguage = typeof RAW_LANGUAGES[number];

export interface RestRequest {
    id: string;
    name: string;
    method: string;
    url: string;
    headers: RestHeader[];
    body: string;
    bodyType: BodyType;           // default "none"
    bodyLanguage: RawLanguage;    // default "plaintext", used when bodyType is "raw"
    formData: RestHeader[];       // key-value pairs for form-urlencoded
}
```

Update `createDefaultRequest()`:
```typescript
export function createDefaultRequest(name?: string): RestRequest {
    return {
        id: crypto.randomUUID(),
        name: name || "New Request",
        method: "GET",
        url: "",
        headers: [],
        body: "",
        bodyType: "none",
        bodyLanguage: "plaintext",
        formData: [],
    };
}
```

Move `RAW_LANGUAGES` array here (used by both RequestBuilder UI and clipboard parser).

### Step 2: Update ViewModel for new fields

**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

**loadData** (line 189-197) — Add `bodyType`, `bodyLanguage`, and `formData` to request parsing with backward-compatible defaults:
```typescript
bodyType: r.bodyType || (r.body ? "raw" : "none"),
bodyLanguage: r.bodyLanguage || "plaintext",
formData: Array.isArray(r.formData) ? r.formData : [],
```

**onDataChanged** (line 84-93) — Strip empty trailing formData rows before serializing (same as headers):
```typescript
formData: r.formData.filter((h) => h.key || h.value),
```

**sendRequest** (line 390-456) — Build body based on bodyType:
- `"none"` → body is `undefined`
- `"raw"` → use `request.body` as-is (current behavior)
- `"form-urlencoded"` → encode `request.formData` as URL-encoded string:
  ```typescript
  const pairs = request.formData
      .filter(f => f.enabled && f.key.trim())
      .map(f => `${encodeURIComponent(f.key.trim())}=${encodeURIComponent(f.value)}`);
  body = pairs.join("&");
  ```

**New methods** for form-data CRUD (mirror header CRUD pattern):
- `ensureEmptyLastFormData(requestId)` — same auto-add pattern as `ensureEmptyLastHeader`
- `updateFormData(requestId, index, changes)` — same as `updateHeader`
- `deleteFormData(requestId, index)` — same as `deleteHeader`
- `toggleFormData(requestId, index)` — same as `toggleHeader`

**updateBodyType(requestId, bodyType)** — updates bodyType, auto-manages Content-Type header:
- If `"raw"` and `bodyLanguage` is `"json"` → set Content-Type to `application/json`
- If `"raw"` and `bodyLanguage` is `"javascript"` → set Content-Type to `application/javascript`
- If `"raw"` and `bodyLanguage` is `"html"` → set Content-Type to `text/html`
- If `"raw"` and `bodyLanguage` is `"xml"` → set Content-Type to `application/xml`
- If `"raw"` and `bodyLanguage` is `"plaintext"` → set Content-Type to `text/plain`
- If `"form-urlencoded"` → set Content-Type to `application/x-www-form-urlencoded`
- If `"none"` → do NOT change Content-Type

**updateBodyLanguage(requestId, language)** — updates bodyLanguage and auto-sets Content-Type (same mapping as above).

**Content-Type auto-set helper** — `private autoSetContentType(requestId, contentType)`:
- Find existing Content-Type header (case-insensitive match on key)
- If found → update its value
- If not found → add new header `{ key: "Content-Type", value: contentType, enabled: true }`
- Call `ensureEmptyLastHeader` after

**updateRequest** — When method changes to GET/HEAD, auto-set bodyType to "none". When method changes FROM GET/HEAD to something else and bodyType is "none", auto-set to "raw".

**selectRequest** (line 236) — Call `ensureEmptyLastFormData` alongside `ensureEmptyLastHeader`.

### Step 3: Extract KeyValueEditor component

**New file:** `src/renderer/editors/rest-client/KeyValueEditor.tsx`

Extract the header row rendering logic into a reusable component:

```typescript
interface KeyValueEditorProps {
    items: RestHeader[];
    onUpdate: (index: number, changes: Partial<RestHeader>) => void;
    onDelete: (index: number) => void;
    onToggle: (index: number) => void;
    keyOptions?: string[];        // ComboSelect dropdown options (e.g., COMMON_HEADERS)
    keyPlaceholder?: string;      // default "Key"
    valuePlaceholder?: string;    // default "Value"
}
```

**Styled root** — `KeyValueEditorRoot` with all row styles:
- `.kv-list` — flex column, gap 4
- `.kv-row` — flex row, align start, gap 4
- `.kv-checkbox` — flex shrink 0
- `.kv-key` — width 35%, min-width 100, flex shrink 0 (with ComboSelect or free-text input)
- `.kv-value` — flex 1, TextAreaField with singleLine, wordBreak break-all
- `.kv-delete` — icon button, opacity 0.5 → 1 on hover
- `.kv-row-disabled` — opacity 0.5 (when checkbox unchecked)

**KeyValueRow** sub-component — same logic as current `HeaderRow`:
- If `keyOptions` provided → ComboSelect with freeText for key
- If no `keyOptions` → TextAreaField for key (used by form-urlencoded where keys are arbitrary)
- Last row with empty key+value hides delete button

This is a **presentation-only** component — it does not manage state or auto-add rows (the ViewModel handles that).

### Step 4: Update RequestBuilder body panel

**File:** `src/renderer/editors/rest-client/RequestBuilder.tsx`

**Body section header** — Replace static "Body" title with body type tabs + language selector:
```
[Body]  none | form-urlencoded | raw   [plaintext ▾]
```
- Body type tabs styled like response viewer tabs (`.body-type-tab` with active state)
- Language selector shown only when bodyType is "raw" — clickable label with popup menu (same pattern as ResponseViewer language label)
- Clicking a body type calls `vm.updateBodyType(request.id, type)`
- Clicking language label shows popup menu with RAW_LANGUAGES options

**Body content** based on `request.bodyType`:
- `"none"` → show a light message: "This request has no body"
- `"raw"` → Monaco `<Editor>` with `language={request.bodyLanguage}`, editable. Use `onChange` to call `vm.updateRequest(id, { body: value })`. Same editor options as ResponseViewer but without `readOnly`.
- `"form-urlencoded"` → `<KeyValueEditor>` with `request.formData`, wired to ViewModel's formData CRUD methods. No `keyOptions`. `keyPlaceholder="Key"`, `valuePlaceholder="Value"`.

**Body panel always visible** — Remove the `hasBody` check that hides the body panel for GET/HEAD. The body panel is always rendered. The Splitter between headers and body is always present.

**Replace HeaderRow** with `<KeyValueEditor>` for the headers section:
```tsx
<KeyValueEditor
    items={request.headers}
    onUpdate={(i, changes) => vm.updateHeader(request.id, i, changes)}
    onDelete={(i) => vm.deleteHeader(request.id, i)}
    onToggle={(i) => vm.toggleHeader(request.id, i)}
    keyOptions={COMMON_HEADERS}
    keyPlaceholder="Header name"
    valuePlaceholder="Value"
/>
```

**Remove** the inline `HeaderRow` component and all `.header-*` styles from `RequestBuilderRoot`. Remove `.body-textarea` style. Add `.body-type-tab` and `.body-none-message` styles.

### Step 5: Update clipboard parsing

**File:** `src/renderer/editors/rest-client/parseClipboardRequest.ts`

Update `ParsedRequest` to include `bodyType`, `bodyLanguage`, and `formData`:
```typescript
import { BodyType, RawLanguage } from "./restClientTypes";

export interface ParsedRequest {
    method: string;
    url: string;
    headers: RestHeader[];
    body: string;
    bodyType: BodyType;
    bodyLanguage: RawLanguage;
    formData: RestHeader[];
}
```

Detection logic:
- Check Content-Type header value:
  - `application/json` → `bodyType: "raw"`, `bodyLanguage: "json"`
  - `application/javascript` → `bodyType: "raw"`, `bodyLanguage: "javascript"`
  - `text/html` → `bodyType: "raw"`, `bodyLanguage: "html"`
  - `application/xml` or `text/xml` → `bodyType: "raw"`, `bodyLanguage: "xml"`
  - `application/x-www-form-urlencoded` → `bodyType: "form-urlencoded"`, parse body into `formData` key-value pairs using `decodeURIComponent`
  - Otherwise if body exists → `bodyType: "raw"`, `bodyLanguage: "plaintext"`
  - No body → `bodyType: "none"`
- cURL `--data-urlencode` flag → `bodyType: "form-urlencoded"`

**Parsing form-urlencoded body into formData:**
```typescript
function parseUrlEncodedBody(body: string): RestHeader[] {
    return body.split("&")
        .filter(Boolean)
        .map(pair => {
            const eqIdx = pair.indexOf("=");
            const key = eqIdx >= 0 ? decodeURIComponent(pair.substring(0, eqIdx)) : decodeURIComponent(pair);
            const value = eqIdx >= 0 ? decodeURIComponent(pair.substring(eqIdx + 1)) : "";
            return { key, value, enabled: true };
        });
}
```

**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts` — update `pasteRequest()` to pass `bodyType`, `bodyLanguage`, and `formData`.

### Step 6: Update duplicate request

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx` — line 431-436

Add `bodyType`, `bodyLanguage`, and `formData` to the duplicate handler:
```typescript
vm.updateRequest(newReq.id, {
    method: req.method,
    url: req.url,
    headers: [...req.headers],
    body: req.body,
    bodyType: req.bodyType,
    bodyLanguage: req.bodyLanguage,
    formData: [...req.formData],
});
```

## Acceptance Criteria

- [ ] Body type selector visible in body section header (tabs: none | form-urlencoded | raw)
- [ ] Language sub-selector shown only when bodyType is "raw" (plaintext, json, javascript, html, xml)
- [ ] "none" shows empty message, "raw" shows Monaco Editor with selected language, "form-urlencoded" shows key-value editor
- [ ] Switching body type auto-updates Content-Type header
- [ ] Switching raw language auto-updates Content-Type header
- [ ] Form-urlencoded data is correctly encoded when sending request
- [ ] Pasting cURL/fetch with form-urlencoded body auto-selects correct body type and populates form data
- [ ] Pasting cURL/fetch with JSON body auto-selects raw + json language
- [ ] Headers section uses the same KeyValueEditor component as form-data
- [ ] Existing .rest.json files without bodyType/formData fields load correctly (backward compatible)
- [ ] Duplicate request copies bodyType, bodyLanguage, and formData
- [ ] Body panel visible for all methods; GET/HEAD auto-selects "none" but allows user override
- [ ] Method change from GET/HEAD to POST/etc auto-selects "raw" if currently "none"

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/rest-client/restClientTypes.ts` | Add `BodyType`, `RawLanguage`, `bodyType`, `bodyLanguage`, `formData` to `RestRequest` |
| `src/renderer/editors/rest-client/RestClientViewModel.ts` | Form-data CRUD, body encoding, bodyType/language management, Content-Type auto-set, method→bodyType sync |
| `src/renderer/editors/rest-client/KeyValueEditor.tsx` | **NEW** — Reusable key-value row editor with own styles |
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | Body type tabs, language selector, conditional body content, use KeyValueEditor for headers, remove HeaderRow |
| `src/renderer/editors/rest-client/parseClipboardRequest.ts` | Add bodyType/bodyLanguage/formData to ParsedRequest, detect types, parse form-urlencoded body |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | Update duplicate handler |
| `src/renderer/editors/rest-client/httpConstants.ts` | No changes needed |
| `src/renderer/editors/rest-client/ResponseViewer.tsx` | No changes needed |
