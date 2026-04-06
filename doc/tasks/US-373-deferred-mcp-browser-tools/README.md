# US-373: Missing Playwright MCP Browser Tools

## Goal

Add the Playwright MCP-compatible browser tools that are not yet implemented in Persephone. This task collects all missing tools from the [Playwright MCP spec](https://github.com/microsoft/playwright-mcp) so AI agents trained on Playwright can use Persephone seamlessly.

## Background

Persephone already implements the core Playwright browser tools. The following tools are missing from the spec. Most will likely be split into separate implementation tasks when work begins — this document serves as the collection point.

**Where to add new tools:**
- Tool registration (Zod schema + MCP handler): `src/main/mcp-http-server.ts` — follow existing pattern (lines ~400–555)
- Command handler function + switch case: `src/renderer/automation/commands.ts` — follow existing `browserClick` / `browserType` pattern
- Input helpers if needed: `src/renderer/automation/input.ts`

**Key constraint:** CDP `Input.dispatchKeyEvent` and `Input.insertText` do **not** work in Electron `<webview>`. All input must go through `Runtime.evaluate` (JS dispatch) or `target.insertText()` (Electron native). See US-376 notes.

## Missing Tools

### 1. `browser_hover` — HIGH priority

**Playwright params:** `element` (optional), `ref` (required), `selector` (optional)

**Implementation approach:**
- Focus the webview: `target.focusWebview()`
- Resolve element via `refOrSelector` / `callOnRef` (same pattern as `browserClick`)
- Dispatch hover via JS in `Runtime.evaluate`:
  ```javascript
  el.scrollIntoView({ block: 'center' });
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
  ```
- Return updated snapshot

**Note:** CDP `Input.dispatchMouseEvent(type: "mouseMoved")` likely doesn't work in webview (same issue as Input.*). Use JS mouse events instead.

---

### 2. `browser_drag` — MEDIUM priority

**Playwright params:** `startElement`, `startRef`, `startSelector`, `endElement`, `endRef`, `endSelector`

**Implementation approach:**
- Resolve source and target elements (two separate ref/selector lookups)
- JS drag-and-drop sequence via `Runtime.evaluate`:
  ```javascript
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
  src.dispatchEvent(new DragEvent('drag',      { bubbles: true }));
  tgt.dispatchEvent(new DragEvent('dragover',  { bubbles: true }));
  tgt.dispatchEvent(new DragEvent('drop',      { bubbles: true }));
  src.dispatchEvent(new DragEvent('dragend',   { bubbles: true }));
  ```
- May not work on pages using pointer events instead of drag events — document as known limitation

---

### 3. `browser_handle_dialog` — MEDIUM priority

**Playwright params:** `accept` (boolean, required), `promptText` (string, optional)

**Implementation approach:**
- CDP `Page.handleJavaScriptDialog`:
  ```typescript
  await target.cdp().send("Page.handleJavaScriptDialog", {
      accept: params.accept,
      promptText: params.promptText ?? "",
  });
  ```
- Must call `Page.enable` first (if not already enabled) to receive dialog events
- Need to store whether a dialog is currently open — subscribe to `Page.javascriptDialogOpening` event in `CdpSession` or at snapshot time
- If no dialog is open, return a descriptive error

**Alternative:** Use `detectOverlay` in `snapshot.ts` to detect dialogs. But for actual dismissal, CDP `Page.handleJavaScriptDialog` is the right path.

---

### 4. `browser_console_messages` — MEDIUM priority

**Playwright params:** `level` (required: `"all"` | `"error"` | `"warn"` | `"info"` | `"log"`), `all` (boolean, optional)

**Implementation approach:**
- Subscribe to `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` CDP events
- Store log entries in `BrowserEditorModel` or a per-tab buffer (similar to how network logs are stored in `BrowserChannel.getNetworkLog`)
- Clear buffer on navigation (unless `all: true`)
- `browser_console_messages` reads from the buffer filtered by level
- Requires IPC channel similar to `BrowserChannel.getNetworkLog`

**Files to modify:**
- `src/main/cdp-service.ts` — subscribe to console events, store per-tab
- `src/ipc/browser-ipc.ts` — add new IPC channel `getConsoleLog`
- `src/renderer/automation/commands.ts` — add `browserConsoleMessages` handler

---

### 5. `browser_file_upload` — LOW priority

**Playwright params:** `paths` (string[], optional — if omitted, cancel file chooser)

**Implementation approach:**
- CDP `Page.setFileInputFiles` can set files on a `<input type="file">` element
- Need the element's `backendDOMNodeId` (available from ref resolution)
- Call: `await cdp.send("Page.setFileInputFiles", { objectId, files: paths })`
- If no active file chooser: use `Input.synthesizeFileChooserOpened` or simply target the `<input type="file">` element by ref/selector

---

### 6. `browser_fill_form` — LOW priority

**Playwright params:** `fields` (array of `{ ref?, selector?, value }`)

**Implementation approach:**
- Convenience wrapper — iterate `fields` and call the `typeText` logic for each
- Reuse existing `typeText()` from `input.ts`
- No new CDP work needed

---

### 7. `browser_resize` — LOW priority

**Playwright params:** `width` (number, required), `height` (number, required)

**Implementation approach:**
- CDP `Emulation.setVisibleSize` to resize the viewport inside the webview:
  ```typescript
  await target.cdp().send("Emulation.setVisibleSize", { width, height });
  ```
- Does NOT resize the Persephone app window — only the viewport seen by the webview. Document this clearly.

---

### 8. `browser_run_code` — LOW priority

**Playwright params:** `code` (string — `async (page) => { ... }` function), `filename` (optional)

**Implementation approach:**
- Extract the function body from the Playwright-style `async (page) => { ... }` string
- In our context `page` doesn't exist, but we can provide a thin compatibility shim or simply strip the wrapper and evaluate the body
- Simple approach: wrap as `(async () => { const page = null; ${body} })()`
- Document that page-specific Playwright APIs won't work; JS/DOM APIs work fine

---

## Acceptance Criteria

- All tools are listed in this document ✅ (collection complete)
- Each implemented tool works with Playwright-style params (ref/selector/element pattern)
- Each implemented tool returns an updated accessibility snapshot (consistent with other tools)
- When splitting into sub-tasks, each sub-task links back to this document

## Notes

This task is a **collection document** — implementation will likely be split:
- High priority (hover) may be its own task
- Medium group (drag, dialog, console) as one task
- Low group (file upload, fill_form, resize, run_code) as one task
