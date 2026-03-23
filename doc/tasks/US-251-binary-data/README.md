# US-251: Rest Client — Binary Data Support

**Epic:** EPIC-010 (Rest Client)
**Status:** Planned

## Goal

Add two capabilities to the Rest Client:
1. **Binary request body** — select a file from disk to upload as multipart/form-data or raw binary
2. **Binary response handling** — detect binary responses, display as hex/image preview, save to file

## Background

### Current state
- Request body types: `none`, `raw` (text with language), `form-urlencoded` (key-value)
- Response is always read via `res.text()` and displayed in Monaco Editor
- Binary responses show corrupted text in Monaco
- No file picker for request body
- `nodeFetch` returns standard `Response` with `text()`, `arrayBuffer()`, `blob()` methods

### Test servers for file upload
- `https://httpbin.org/post` — returns posted data including files as JSON
- `https://postman-echo.com/post` — echoes back multipart form data
- `https://httpbin.org/anything` — accepts any method, returns everything

### Test servers for binary response
- `https://httpbin.org/image/png` — returns a PNG image
- `https://httpbin.org/image/jpeg` — returns a JPEG image
- `https://httpbin.org/bytes/1024` — returns random binary bytes

### Key APIs
- `app.fs.showOpenDialog()` — file picker
- `app.fs.showSaveDialog()` — save dialog
- `app.fs.writeFile()` — write binary data to file
- `pagesModel.openImageInNewTab(blobUrl)` — open image in Image Viewer (accepts blob URLs)
- `nodeFetch` returns standard `Response` — supports `arrayBuffer()`, `blob()`, `text()`

## Implementation Plan

### Step 1: Add new body types to data model

**File:** `src/renderer/editors/rest-client/restClientTypes.ts`

Extend `BodyType`:
```typescript
export type BodyType = "none" | "form-urlencoded" | "raw" | "binary" | "form-data";
```

Add fields to `RestRequest`:
```typescript
export interface RestRequest {
    // ... existing fields
    binaryFilePath: string;   // file path for binary body type
}
```

Add `FormDataEntry` type for multipart form-data:
```typescript
export interface FormDataEntry {
    key: string;
    value: string;
    type: "text" | "file";   // text value or file path
    enabled: boolean;
}
```

Add `formDataEntries` to `RestRequest` (separate from `formData` which is URL-encoded key-value):
```typescript
formDataEntries: FormDataEntry[];
```

### Step 2: Binary response handling in ViewModel

**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

Update `sendRequest`:
- Check `Content-Type` response header for binary types (image/*, application/octet-stream, application/pdf, etc.)
- For binary: use `res.arrayBuffer()` instead of `res.text()`
- Store binary data as base64 string in `RestResponse.body` with a flag `isBinary: true`
- Store original content type for display

Update `RestResponse`:
```typescript
export interface RestResponse {
    status: number;
    statusText: string;
    headers: RestHeader[];
    body: string;          // text or base64-encoded binary
    isBinary?: boolean;    // true if body is base64
    contentType?: string;  // original content type
}
```

### Step 3: Binary body type UI in RequestBuilder

**File:** `src/renderer/editors/rest-client/RequestBuilder.tsx`

Add `"binary"` and `"form-data"` to body type tabs.

**Binary body content:**
- Show selected file path (or "No file selected")
- "Select File" button → `app.fs.showOpenDialog()`
- Display file size after selection

**Form-data (multipart) content:**
- Key-value editor similar to form-urlencoded but each row has a type toggle (text/file)
- File rows show file path + "Browse" button
- Text rows show text input

### Step 4: Binary response viewer

**File:** `src/renderer/editors/rest-client/ResponseViewer.tsx`

When `response.isBinary` is true:
- Don't show Monaco Editor
- Show binary info panel:
  - Content-Type
  - Size
  - "Save to File" button → `app.fs.showSaveDialog()` + write base64 decoded data
- If content type is image (image/png, image/jpeg, image/gif, image/webp):
  - Show image preview (convert base64 to blob URL, display `<img>`)
  - "Open in Image Viewer" button → `pagesModel.openImageInNewTab(blobUrl)`

### Step 5: Send binary/multipart requests

**File:** `src/renderer/editors/rest-client/RestClientViewModel.ts`

**Binary body:** Stream file directly from disk using `require("fs").createReadStream()` wrapped as `ReadableStream`. Pass to `nodeFetch` as body — no memory limit, files of any size work.

**Multipart form-data:** Build multipart boundary manually:
- For text fields: add as text part
- For file fields: stream file content as binary part with filename and content type
- Set `Content-Type: multipart/form-data; boundary=...` header
- Use `require("fs").createReadStream()` for file parts to avoid loading into memory

**Alternative:** Use Node.js `FormData` (available in modern Node.js) if supported in our Electron version. Verify if `nodeFetch` accepts it.

### Step 6: Update clipboard parsing

**File:** `src/renderer/editors/rest-client/parseClipboardRequest.ts`

Detect `--form` / `-F` flags in cURL as `form-data` body type.
Detect `--data-binary @filename` as `binary` body type.

## Concerns / Open Questions

All concerns resolved:

1. **Binary response caching** — Keep in memory only, skip persisting to stateStorage.
2. **Multipart form-data** — Verify if `nodeFetch` accepts `FormData`. If not, build multipart boundaries manually.
3. **Large file upload** — Stream files directly from disk using `require("fs").createReadStream()` (nodeIntegration: true). `nodeFetch` already accepts `ReadableStream` as body. No memory limit.
4. **File paths non-portable** — OK, absolute paths in `.rest.json`. Show error if file doesn't exist on send.

## Acceptance Criteria

- [ ] Body type tabs include "binary" and "form-data"
- [ ] Binary body: file picker, displays file path and size
- [ ] Form-data body: key-value editor with text/file type per row
- [ ] Binary request body sent correctly (verified with httpbin.org)
- [ ] Multipart form-data sent correctly (verified with httpbin.org)
- [ ] Binary responses detected by Content-Type
- [ ] Binary response shows size, content type, "Save to File" button
- [ ] Image responses show preview + "Open in Image Viewer" button
- [ ] Text responses still work as before (no regression)
- [ ] cURL paste detects `--form` and `--data-binary` flags

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/rest-client/restClientTypes.ts` | Add `binary`/`form-data` body types, `FormDataEntry`, `binaryFilePath`, `isBinary` |
| `src/renderer/editors/rest-client/RestClientViewModel.ts` | Binary/multipart send, binary response detection, response caching changes |
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | Binary file picker, form-data key-value editor with type toggle |
| `src/renderer/editors/rest-client/ResponseViewer.tsx` | Binary response panel, image preview, save to file |
| `src/renderer/editors/rest-client/parseClipboardRequest.ts` | Detect `--form` and `--data-binary` |
| `src/renderer/editors/rest-client/serializeRequest.ts` | Serialize binary/form-data body types |
| `assets/mcp-res-pages.md` | Update rest-client format with new body types |
