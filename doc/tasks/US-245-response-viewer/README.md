# US-245: Rest Client — Response Viewer

## Goal

Enhance the response panel in the Rest Client editor with a proper response viewer: Monaco Editor for the response body (with auto-detect language and syntax highlighting), tabbed headers/body view, and improved status display.

## Background

### Current state (US-244)

The response panel currently uses a simple `<div>` with `whiteSpace: pre-wrap` for the response body and plain text for headers. It works but lacks:
- Syntax highlighting for JSON/XML/HTML responses
- Search within response body (Ctrl+F)
- Proper formatting and line numbers
- Tabs to switch between body and headers views
- Response size information

### Monaco embedding pattern

From the Notebook editor's MiniTextEditor:
```typescript
import { Editor } from "@monaco-editor/react";

<Editor
    height="100%"
    value={content}
    language="json"
    options={{
        readOnly: true,
        lineNumbers: "off",
        minimap: { enabled: false },
        automaticLayout: true,
        wordWrap: "on",
        scrollBeyondLastLine: false,
    }}
/>
```

### Language auto-detection from Content-Type

| Content-Type | Monaco language |
|---|---|
| `application/json` | `json` |
| `text/html` | `html` |
| `text/xml`, `application/xml` | `xml` |
| `text/css` | `css` |
| `text/javascript`, `application/javascript` | `javascript` |
| `text/plain` | `plaintext` |
| Everything else | `plaintext` |

## Implementation Plan

### Step 1: Create ResponseViewer component
**File:** `src/renderer/editors/rest-client/ResponseViewer.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ Response    200 OK    345ms    1.2 KB            │  ← panel header (from parent)
├──────┬──────────────────────────────────────────┤
│ Body │ Headers (12)                              │  ← tab bar
├──────┴──────────────────────────────────────────┤
│                                                  │
│  Monaco Editor (read-only, syntax highlighted)   │  ← Body tab
│                                                  │
│  OR                                              │
│                                                  │
│  Header Name: value                              │  ← Headers tab
│  Content-Type: application/json                  │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Tab bar:**
- "Body" tab — shows Monaco Editor with response body
- "Headers (N)" tab — shows response headers list
- Simple styled tabs (not a full tab component — just clickable spans)

**Body tab:**
- Monaco Editor in read-only mode
- Language auto-detected from Content-Type header
- JSON responses auto-formatted (pretty-printed)
- Minimal chrome: no line numbers, no minimap, word wrap on
- `automaticLayout: true` for resize handling

**Headers tab:**
- Key-value list (similar to current display but cleaner)
- Clickable header values (copy on click)

### Step 2: Add response size to status bar
Calculate and display response body size (bytes/KB/MB) in the panel header.

### Step 3: Replace ResponseContent in RestClientEditor
**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Replace the current `ResponseContent` function with the new `ResponseViewer` component. Keep the panel header with status/timing in the parent (it's already there).

### Step 4: Detect language from Content-Type
**File:** `src/renderer/editors/rest-client/ResponseViewer.tsx`

```typescript
function detectLanguage(headers: RestHeader[]): string {
    const ct = headers.find(h => h.key.toLowerCase() === "content-type")?.value || "";
    if (ct.includes("json")) return "json";
    if (ct.includes("html")) return "html";
    if (ct.includes("xml")) return "xml";
    if (ct.includes("css")) return "css";
    if (ct.includes("javascript")) return "javascript";
    return "plaintext";
}
```

## Design Decisions (resolved)

1. **Monaco for response body** — provides syntax highlighting, search, and proper formatting. Read-only mode so user can't accidentally edit.
2. **Tabs not splitter** — headers and body don't need to be visible simultaneously. Tabs save space.
3. **JSON auto-format** — pretty-print JSON responses before displaying in Monaco.
4. **Dynamic import for Monaco** — use `import()` to avoid loading Monaco until the response viewer is first shown.

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/rest-client/ResponseViewer.tsx` | **New.** Tabbed response viewer with Monaco body + headers list |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | Replace `ResponseContent` with `ResponseViewer` |

## Acceptance Criteria

- [ ] Response body displayed in Monaco Editor (read-only)
- [ ] Language auto-detected from Content-Type header
- [ ] JSON responses pretty-printed
- [ ] Tabs to switch between Body and Headers views
- [ ] Response size shown in panel header
- [ ] Ctrl+F works in response body (Monaco built-in search)
- [ ] Word wrap enabled for long lines
- [ ] Dynamic import of Monaco (no bundle impact when response not shown)
