# US-273: cURL Parser & Open URL Dialog

## Status

**Status:** Planned
**Priority:** Medium
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement a cURL command parser (Layer 1 handler on `openRawLink`) and replace the "Open File" dialog with an "Open URL" dialog that accepts any raw link — file paths, URLs, and cURL commands. This enables pasting cURL commands copied from browser DevTools to open authenticated API responses in dedicated editors.

## Why

- Developers often copy cURL commands from browser DevTools to inspect API responses
- cURL commands include authentication headers, making it possible to access protected endpoints
- The current "Open File" flow only supports local file paths via the OS file dialog
- The new "Open URL" dialog accepts any raw link through the existing pipeline

## Use Case

1. User has a React app with SSO authentication
2. Opens DevTools → Network tab → right-clicks a request → "Copy as cURL"
3. Pastes the cURL command into Persephone's "Open URL" dialog
4. cURL parser extracts URL, method, headers (including auth Bearer token)
5. HttpProvider fetches the response with those exact headers
6. Response opens in the appropriate editor (JSON in Monaco, image in viewer, etc.)

## Implementation Plan

### Part 1: cURL Parser

**Existing parser:** `src/renderer/editors/rest-client/parseClipboardRequest.ts` already has a complete cURL parser (`parseCurl`) and fetch parser (`parseFetch`). It handles:
- Single-quoted, double-quoted, unquoted arguments
- `-H`/`--header`, `-X`/`--request`, `-d`/`--data`/`--data-raw`/`--data-binary`
- `--data-urlencode`, `-b`/`--cookie`, `--compressed`, `-L`, `-k`
- Multi-line (backslash `\` and cmd `^` continuation)
- Both bash and cmd formats

**Plan:** Extract the core parsing functions (`parseCurl`, `tokenizeCurl`, `parseFetch`) into a shared utility, then use from both the Rest Client and the new Layer 1 parser.

File: `src/renderer/core/utils/curl-parser.ts` — **NEW** shared utility (extracted from `parseClipboardRequest.ts`)

File: `src/renderer/content/parsers.ts` — add cURL/fetch parser as Layer 1 handler:

```typescript
// cURL / fetch parser — detects "curl " or "fetch(" commands
app.events.openRawLink.subscribe(async (event) => {
    const trimmed = event.raw.trim();
    if (!trimmed.startsWith("curl ") && !trimmed.startsWith("fetch(")) return;

    const parsed = parseClipboardRequest(trimmed);
    if (!parsed) return;

    const metadata: Record<string, unknown> = {};
    if (parsed.method !== "GET") metadata.method = parsed.method;
    if (parsed.headers.length > 0) {
        metadata.headers = Object.fromEntries(parsed.headers.map(h => [h.key, h.value]));
    }
    if (parsed.body) metadata.body = parsed.body;

    await app.events.openLink.sendAsync(new OpenLinkEvent(parsed.url, undefined, metadata));
    event.handled = true;
});
```

**Registration order (LIFO):** cURL parser registered AFTER HTTP parser (runs BEFORE it in LIFO). If the raw string is a cURL command, the cURL parser handles it.

### Part 2: "Open URL" Dialog

Replace the current "Open File" flow:

**Current flow:**
- Ctrl+O → `openFileWithDialog()` → OS file dialog → returns file path → `openFile(path)`
- Sidebar "Open File" button → same flow

**New flow:**
- Ctrl+O → show "Open URL" dialog (custom) → user pastes any raw link → `openRawLink.sendAsync()`
- Sidebar "Open File" button → same dialog
- Dialog has a "Browse..." button that opens the OS file dialog (for users who want the old file picker)

**Dialog UI:**

```
┌─────────────────────────────────────────────┐
│  Open                                       │
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │ Paste file path, URL, or cURL command   ││
│  │                                         ││
│  │                                         ││
│  │                                         ││
│  └─────────────────────────────────────────┘│
│                                             │
│          [Open File]  [Cancel]  [Open]      │
└─────────────────────────────────────────────┘
```

- **TextAreaField** input — multi-line, no special paste handlers, placeholder: "Paste file path, URL, or cURL command"
- **Open** button — disabled if input empty. Fires `openRawLink.sendAsync(new RawLinkEvent(inputValue))`, closes dialog.
- **Cancel** button — closes dialog without action.
- **Open File** button — opens OS file dialog. If file selected, immediately opens it via `openRawLink` and closes dialog (no extra clicks).

**Architecture:** Follows the same pattern as existing dialogs (InputDialog, ConfirmationDialog) — uses `TDialogModel`, `showDialog()`, `Dialog`/`DialogContent` components.

### Part 3: Content-Type Based Editor Selection (for cURL/fetch requests)

For cURL/fetch requests, the URL often has no file extension (e.g., `/api/markets`). Use the `Content-Type` from the **request headers** (if present) to determine the editor:

- `application/json` → Monaco (json)
- `text/css` → Monaco (css)
- `text/javascript` → Monaco (javascript)
- `text/xml`, `application/xml` → Monaco (xml)
- `text/html` → Monaco (html)
- `image/*` → image-view
- `application/pdf` → pdf-view
- Anything else or missing → Monaco (plaintext)

This uses request headers only (no pre-fetch) — simple and fast. The cURL parser passes the Content-Type from request `Accept` or `Content-Type` headers as metadata, and the HTTP resolver uses it for editor selection when the URL has no file extension.

## Acceptance Criteria

- [ ] cURL parser detects `curl ` commands on `openRawLink`
- [ ] Extracts URL, method, headers, body from cURL command
- [ ] Handles single-quoted, double-quoted, and unquoted arguments
- [ ] Handles multi-line cURL commands (backslash continuation)
- [ ] "Open URL" dialog created with TextAreaField input
- [ ] Ctrl+O opens the new dialog instead of OS file dialog
- [ ] Sidebar "Open File" button opens the new dialog
- [ ] "Browse..." button in dialog opens OS file dialog (backward compat)
- [ ] Pasting a file path works (goes through file parser)
- [ ] Pasting an HTTP URL works (goes through HTTP parser)
- [ ] Pasting a cURL command works (goes through cURL parser → HttpProvider)
- [ ] API responses with no file extension open correctly based on Content-Type
- [ ] No regressions in existing file opening behavior

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/core/utils/curl-parser.ts` | **NEW** — shared utility extracted from `parseClipboardRequest.ts` |
| `src/renderer/editors/rest-client/parseClipboardRequest.ts` | Refactor to import from shared utility |
| `src/renderer/content/parsers.ts` | Add cURL/fetch parser on `openRawLink` |
| `src/renderer/ui/dialogs/OpenUrlDialog.tsx` | **NEW** — "Open URL" dialog component |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | `openFileWithDialog()` → show new dialog |
| `src/renderer/api/internal/KeyboardService.ts` | Ctrl+O → new dialog (through `openFileWithDialog`) |

## Resolved Concerns

**C1: Content-Type detection** — Use `Content-Type` or `Accept` from request headers (not response). Fall back to Monaco plaintext if missing. No pre-fetch needed. Future loading page feature (out of scope) can add response-based detection later.

**C2: Dialog complexity** — Simple dialog: TextAreaField input + three buttons (Open, Cancel, Open File). No special paste handlers. Follows existing dialog architecture.

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-270 (HttpProvider — cURL parser creates HttpProvider with headers)
- HTTP resolver: `src/renderer/content/resolvers.ts` (content-vs-browser decision)
