# US-212: MCP Request Log (new log-view entry type)

**Epic:** EPIC-008 (MCP Browser Editor)
**Status:** Planned

## Goal

Add a new log-view entry type `output.mcp-request` that renders MCP request/response data inline in the existing log-view editor. This allows both the MCP Inspector and js-notepad's own MCP handler to show request history in a standard log page — no new editor needed.

## Background

### Existing log-view entry system

The log-view editor (`src/renderer/editors/log-view/`) supports multiple entry types routed by `LogEntryContent.tsx`:
- **Log messages**: `log.info`, `log.warn`, `log.error`, etc.
- **Dialog entries**: `input.confirm`, `input.text`, `input.buttons`, etc.
- **Output entries**: `output.grid`, `output.text`, `output.markdown`, `output.mermaid`, `output.progress`

Adding a new type requires: interface in `logTypes.ts`, routing case in `LogEntryContent.tsx`, renderer in `log-view/items/`.

### Syntax highlighting without a full editor

`CodeBlock.tsx` uses `monaco.editor.colorize(code, language, options)` which returns an HTML string with syntax highlighting — no editor instance created. Much lighter than `monaco.editor.create()` used by `TextOutputView`. For read-only JSON display in log entries, `colorize()` is the right approach.

```typescript
const html = await monaco.editor.colorize(jsonText, "json", { tabSize: 2 });
// renders via dangerouslySetInnerHTML={{ __html: html }}
```

### Log page identification (well-known pages)

US-215 introduced the well-known pages system (`src/renderer/api/pages/well-known-pages.ts`). The `mcp-ui-log` page is already registered there. For MCP request logs, we register a new well-known page `mcp-server-log` (already pre-registered in US-215).

Use `pagesModel.requireWellKnownPage("mcp-server-log")` to get-or-create the singleton page — no manual page ID tracking needed.

### Two log page strategies

1. **MCP Inspector history** → opens a **new one-time page** with all collected entries as static JSONL content. No live updates, no reuse. Just a snapshot.
2. **js-notepad MCP server log** → uses the well-known `mcp-server-log` page via `requireWellKnownPage()`. Entries pushed via `vm.addEntry()` as requests come in. Capped at 200 entries.

## Implementation Plan

### Step 1: Define entry type

**File:** `src/renderer/editors/log-view/logTypes.ts`

```typescript
export interface McpRequestEntry extends LogEntryBase {
    type: "output.mcp-request";
    title?: StyledText;
    direction: "outgoing" | "incoming";
    method: string;
    params: any;
    result: any;
    error: string | null;
    durationMs: number;
}
```

The existing `isOutputEntry` guard checks `type.startsWith("output.")` — no changes needed.

### Step 2: Create McpRequestView renderer

**File:** `src/renderer/editors/log-view/items/McpRequestView.tsx`

**Layout:**
```
┌──────────────────────────────────────────────────────┐
│ → outgoing   tools/call   execute_script       42ms  │  header row
├──────────────────────────────────────────────────────┤
│ ▶ Request                                            │  collapsed by default
│ ▶ Response                                           │  collapsed by default
└──────────────────────────────────────────────────────┘

Expanded:
┌──────────────────────────────────────────────────────┐
│ → outgoing   tools/call   execute_script       42ms  │
├──────────────────────────────────────────────────────┤
│ ▼ Request                                            │
│   { "name": "execute_script",                        │  colorized JSON
│     "arguments": { "script": "..." } }               │
│ ▼ Response                                           │
│   { "content": [{ "type": "text", ... }] }           │  colorized JSON
└──────────────────────────────────────────────────────┘
```

**Header row:**
- Direction arrow: `→` outgoing (blue) / `←` incoming (green)
- Method name: `tools/call`, `resources/read`, `prompts/get`, `tools/list`, etc.
- Detail: for `tools/call` show `params.name`, for `resources/read` show `params.uri`
- Duration badge: `42ms`
- Error badge (red) if `error` is set

**Collapsible sections (Request / Response):**
- Toggle via click on section header (`▶` / `▼`)
- Use `vm.getItemState(id)` / `vm.setItemState(id, { requestOpen, responseOpen })` for expand state persistence
- Content: `monaco.editor.colorize(JSON.stringify(data, null, 2), "json")` → render as highlighted HTML in a scrollable `<pre>` container, max-height ~200px
- Error responses: show error text with `color.error.text`

**Styling:** Single `McpRequestRoot` styled component with nested class-based styles.

### Step 3: Add routing in LogEntryContent

**File:** `src/renderer/editors/log-view/LogEntryContent.tsx`

Add case in the output entries switch:
```typescript
case "output.mcp-request":
    return <McpRequestView entry={entry as McpRequestEntry} />;
```

Import lazily or directly (the log-view module is already code-split).

### Step 4: Add history collection to MCP Inspector

**File:** `src/renderer/editors/mcp-browser/McpBrowserModel.ts`

Add history array and helper:
```typescript
private _history: McpRequestEntry[] = [];

private logRequest(method: string, params: any, result: any, error: string | null, durationMs: number): void {
    this._history.push({
        type: "output.mcp-request",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        direction: "outgoing",
        method,
        params,
        result,
        error,
        durationMs,
    });
}
```

Call `logRequest()` at end of: `callTool`, `readResource`, `getPrompt`, `loadTools`, `loadResources`, `loadPrompts`.

Add `showHistory()` — opens a **new one-time page** (not reused):
```typescript
showHistory = async (): Promise<void> => {
    if (this._history.length === 0) return;
    await editorRegistry.loadViewModelFactory("log-view");
    const content = this._history.map(e => JSON.stringify(e)).join("\n");
    pagesModel.addEditorPage("log-view", "jsonl", "MCP Inspector History", content);
};

clearHistory = (): void => { this._history = []; };
```

Clear history on disconnect.

Replace "History" placeholder panel in `McpBrowserView.tsx`:
- Show history entry count + "Show History" button + "Clear" button
- Or show a simple list of recent entries inline with a "Open in Log View" button

### Step 5: Add request logging to js-notepad MCP handler

**File:** `src/renderer/api/mcp-handler.ts`

Keep an in-memory history array (module-level, no external state file needed):
```typescript
const MAX_REQUEST_LOG_ENTRIES = 200;
const requestHistory: McpRequestEntry[] = [];
```

Wrap `handleCommand()` to log each request:
```typescript
// After handleCommand completes:
requestHistory.push({
    type: "output.mcp-request",
    id: requestId,
    timestamp: startTime,
    direction: "incoming",
    method,
    params,
    result: response.result ?? null,
    error: response.error?.message ?? null,
    durationMs: Date.now() - startTime,
});
// Trim oldest if over cap
if (requestHistory.length > MAX_REQUEST_LOG_ENTRIES) {
    requestHistory.splice(0, requestHistory.length - MAX_REQUEST_LOG_ENTRIES);
}
// If live log page is open, push entry to it
const logPage = pagesModel.findPage("mcp-server-log");
if (logPage) { /* push entry via vm.addEntry() */ }
```

Add `showMcpRequestLog()` function — uses well-known page:
```typescript
export async function showMcpRequestLog(): Promise<void> {
    const page = await pagesModel.requireWellKnownPage("mcp-server-log");
    // If page was just created, backfill with requestHistory entries
}
```

### Step 6: Wire MCP indicator click

**File:** `src/renderer/ui/app/MainPage.tsx`

Add `onClick` handler to `.mcp-indicator`:
```typescript
onClick={() => showMcpRequestLog()}
```

Add `cursor: "pointer"` to the `.mcp-indicator` CSS.

## Resolved Concerns

1. **Syntax highlighting:** Use `monaco.editor.colorize()` (same pattern as `CodeBlock.tsx` in markdown view). Returns HTML, no editor instance. Lightweight for rendering JSON in log entries.

2. **Separate log pages:** MCP request logs go to a **separate page** from `ui_push` logs. MCP Inspector opens a **one-time snapshot** page (no live updates). MCP server handler uses the well-known `mcp-server-log` page via `requireWellKnownPage()`. No manual page ID tracking needed.

3. **History limits:** MCP Inspector keeps full history until user clicks "Clear" or disconnects. js-notepad MCP server handler caps at 200 entries (drops oldest).

4. **Entry type naming:** `output.mcp-request` fits the `output.*` convention. Existing `isOutputEntry` guard covers it automatically.

## Acceptance Criteria

- [ ] `output.mcp-request` entry type defined in logTypes.ts
- [ ] McpRequestView renderer shows direction, method, detail, duration, error status
- [ ] Request/response JSON collapsible with `colorize()` highlighting
- [ ] Expand/collapse state persisted via `itemsState`
- [ ] MCP Inspector logs all SDK calls (callTool, readResource, getPrompt, list*)
- [ ] "Show History" opens a new one-time log page with snapshot
- [ ] "Clear History" clears collected entries
- [ ] History clears on disconnect
- [ ] js-notepad MCP handler logs incoming requests (capped at 200)
- [ ] MCP server requests go to a separate log page from ui_push
- [ ] MCP indicator click opens/focuses the MCP request log page
- [ ] Error entries visually distinct (red styling)
- [ ] Direction badges: → outgoing (blue) / ← incoming (green)

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/editors/log-view/logTypes.ts` | Modify | Add McpRequestEntry interface |
| `src/renderer/editors/log-view/LogEntryContent.tsx` | Modify | Add routing case for output.mcp-request |
| `src/renderer/editors/log-view/items/McpRequestView.tsx` | Create | MCP request/response entry renderer (colorize + collapsible) |
| `src/renderer/editors/mcp-browser/McpBrowserModel.ts` | Modify | Add history collection + logRequest + showHistory + clearHistory |
| `src/renderer/editors/mcp-browser/McpBrowserView.tsx` | Modify | Replace History placeholder with history UI |
| `src/renderer/api/mcp-handler.ts` | Modify | Wrap handleCommand with request logging + showMcpRequestLog |
| `src/renderer/api/pages/well-known-pages.ts` | No change | `mcp-server-log` already registered by US-215 |
| `src/renderer/ui/app/MainPage.tsx` | Modify | Wire MCP indicator click + cursor pointer |

## Files NOT Changed

- `register-editors.ts` — log-view already registered, no new editor
- `LogViewModel.ts` — `addEntry()` already handles any type string
- `McpConnectionManager.ts` — logging at model level
- `shared/types.ts` — no new PageEditor type
