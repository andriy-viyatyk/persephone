# US-143: MCP tool `ui_push` — Log View entries via MCP

**Epic:** [EPIC-004](../../epics/EPIC-004.md) (Log View Editor)
**Status:** Planned
**Priority:** High (Phase 2 completion — enables AI agent integration)

## Goal

Add a new MCP tool `ui_push` that allows AI agents to push entries (log messages, dialogs, output items) to a Log View page. This is the MCP counterpart of the script `ui` global.

## Background

Scripts already have the `ui` global for logging and dialogs (US-141, US-142). MCP agents currently have no way to use the Log View — they can only `execute_script` or `create_page`. This task adds a dedicated `ui_push` tool that manages an "active MCP log page" automatically.

## Design (from EPIC-004)

### Tool: `ui_push`

**Parameters:**

```typescript
{
    entries: Array<string | { type: string; data: any }>
    // String shorthand: treated as log.info
    // Object: { type, data } matching LogEntry types
}
```

**Return value:**

```typescript
{
    results?: Array<{ button: string | null; [key: string]: any }>
    // One result per dialog entry in the input array
    // button = null means canceled (page closed)
    // Non-dialog entries produce no results
}
```

### Supported entry types (currently implemented renderers)

| Entry type | data | Category |
|------------|------|----------|
| `log.text` | `StyledText` | Log |
| `log.info` | `StyledText` | Log |
| `log.warn` | `StyledText` | Log |
| `log.error` | `StyledText` | Log |
| `log.success` | `StyledText` | Log |
| `input.confirm` | `{ message, buttons? }` | Dialog |
| `input.text` | `{ title?, placeholder?, defaultValue?, buttons? }` | Dialog |
| `input.buttons` | `{ buttons, title? }` | Dialog |

Note: `output.*` entry types and remaining `input.*` types (checkboxes, radioboxes, select) are Phase 3 — their renderers don't exist yet. The MCP tool accepts them — entries with unknown types are displayed as serialized `log.text` fallback until their renderers are implemented. Entries without `id` are filtered out.

### Active MCP log page

The MCP handler manages an "active MCP log page" per window:

1. On first `ui_push` call: create a new Log View page, mark it as active MCP log
2. Subsequent `ui_push` calls reuse the active MCP log page
3. If the user closes the active MCP log page, the next `ui_push` creates a new one
4. Title format: `"2026-03-10 12:24.log.jsonl"` (matching script `ui` behavior)

### Batching and blocking

- Non-dialog entries are appended immediately and don't block
- Dialog entries create pending promises — `Promise.all()` collects results
- The tool call blocks until ALL dialogs in the batch are resolved (or canceled)
- If no dialogs in the batch, return immediately with empty results

### Cancellation

Dialog entries canceled by page close return `{ button: null }` (using `null` instead of `undefined` since JSON doesn't support `undefined`).

## Implementation Plan

### Step 1: MCP tool definition (`mcp-http-server.ts`)

Add `ui_push` tool registration with zod schema:

```typescript
server.tool(
    "ui_push",
    "Push entries to the Log View page...",
    {
        entries: z.array(z.union([
            z.string(),
            z.object({
                type: z.string(),
                data: z.any(),
            }),
        ])).describe("Array of entries..."),
        windowIndex: windowIndexParam,
    },
    async ({ entries, windowIndex }) =>
        toToolResult(await sendToRenderer("ui_push", { entries }, windowIndex)),
);
```

### Step 2: MCP handler — `ui_push` command (`mcp-handler.ts`)

Add `ui_push` case to the command dispatcher. Key implementation:

```typescript
// Track active MCP log page (module-level)
let mcpLogPageId: string | undefined;

async function handleUiPush(params: any): Promise<McpResponse> {
    const entries = params?.entries;
    if (!Array.isArray(entries)) {
        return { error: { code: -32602, message: "Missing or invalid 'entries' parameter" } };
    }

    // 1. Resolve or create the active MCP log page
    const vm = await getOrCreateMcpLogViewModel();

    // 2. Normalize entries (string shorthand → log.info object)
    // 3. Append all entries via vm.addEntry() / vm.addDialogEntry()
    // 4. Collect dialog promises, await them with Promise.all()
    // 5. Convert dialog results (undefined → null for JSON)
    // 6. Return { results } or {} if no dialogs
}
```

### Step 3: Active MCP log page lifecycle

```typescript
async function getOrCreateMcpLogViewModel(): Promise<LogViewModel> {
    // Check if existing mcpLogPageId is still valid
    if (mcpLogPageId) {
        const page = pagesModel.findPage(mcpLogPageId);
        if (page && isTextFileModel(page)) {
            const vm = page.acquireViewModelSync("log-view") as LogViewModel;
            if (vm) return vm;
        }
        mcpLogPageId = undefined; // page was closed
    }

    // Ensure log-view editor module is loaded
    await editorRegistry.loadViewModelFactory("log-view");

    // Create new Log View page
    const title = formatLogTitle(); // "2026-03-10 12:24.log.jsonl"
    const page = pagesModel.addEditorPage("log-view", "jsonl", title);
    mcpLogPageId = page.id;

    if (!isTextFileModel(page)) throw new Error("...");
    const vm = page.acquireViewModelSync("log-view") as LogViewModel;
    if (!vm) throw new Error("...");

    return vm;
}
```

### Step 4: Timeout handling

**Decision:** Add an optional `timeoutMs` parameter to `sendToRenderer`. The renderer-side handler detects whether the `entries` array contains any dialog entries (`input.*`). If dialogs are present and no explicit timeout was passed, use **no timeout** (infinite wait). If no dialogs, use the default 30s timeout.

This ensures users can take breaks (5 min, 1 hour, etc.) and come back to resolve dialogs — the AI agent will still be waiting and will continue properly rather than receiving a false cancellation result.

**Implementation in `mcp-http-server.ts`:**
- `sendToRenderer` gets an optional `timeoutMs?: number` parameter (0 = no timeout)
- `ui_push` tool handler: scan entries for any `input.*` types → if found, pass `timeoutMs: 0` (no timeout); otherwise use default 30s
- All other tools continue using the default `REQUEST_TIMEOUT_MS`

### Step 5: ViewModel release

**Decision:** Acquire once, keep alive. The VM stays active as long as the page exists. If the page is closed, the `mcpLogPageId` validity check on next `ui_push` will detect it and create a new one. This matches how `ScriptContext` works.

`acquireViewModelSync` increments a ref count, but for the MCP active log page we always want the Log View VM alive — no explicit release needed. Page deletion handles cleanup.

### Step 6: MCP API guide update (`assets/mcp-api-guide.md`)

Add documentation for the `ui_push` tool with examples. Add "Log View as default AI output" guidance.

## Files to modify

| File | Changes |
|------|---------|
| `src/main/mcp-http-server.ts` | Add `ui_push` tool definition, increase timeout |
| `src/renderer/api/mcp-handler.ts` | Add `ui_push` command handler, active MCP log page tracking |
| `assets/mcp-api-guide.md` | Document `ui_push` tool and usage |

## Resolved Concerns

### C1: Timeout — RESOLVED
Add optional `timeoutMs` parameter to `sendToRenderer`. For `ui_push`, scan entries: if any `input.*` present → no timeout (infinite); otherwise default 30s. Users can take breaks and return to resolve dialogs without the AI agent receiving a false cancellation.

### C2: ViewModel lifecycle — RESOLVED
Acquire once, keep alive. No explicit release. Page deletion handles cleanup.

### C3: Concurrent MCP sessions — RESOLVED
Shared single active log page. Multiple agents write to the same page. Per-session tracking is future work if needed.

### C4: StyledText in MCP — RESOLVED
StyledText is sugar for script writing. For MCP, the `data` field accepts `StyledText` (plain string or `StyledSegment[]`) structurally, but we don't need to heavily promote it in MCP docs. AI agents typically work with plain strings. Document the format briefly for agents that want richer output.

### C5: Entry type validation — RESOLVED
LogView handles unknown entries gracefully:
1. Entries without `id` — filtered out (id is critical for LogView functionality: dialog resolution, JSONL serialization, height cache, etc.)
2. Entries with unknown `type` — serialize the data and display as a regular `log.text` entry (fallback rendering)

This means the MCP tool accepts any `type` value. New entry types added in Phase 3 will render properly once their renderers exist; until then they show as serialized text.

### C6: `sendToRenderer` timeout — RESOLVED
Same as C1: optional `timeoutMs` parameter. Infinite timeout for dialog-containing requests.

## Acceptance Criteria

- [ ] `ui_push` MCP tool registered and callable
- [ ] String shorthand entries normalized to `log.info`
- [ ] Log message entries (`log.*`) appended immediately
- [ ] Dialog entries (`input.*`) block until user responds
- [ ] Multiple dialogs in one call resolved via `Promise.all()`
- [ ] Canceled dialogs return `{ button: null }`
- [ ] Active MCP log page created on first call, reused on subsequent calls
- [ ] Closed MCP log page detected and recreated on next call
- [ ] Timeout: infinite for dialog-containing requests, default 30s otherwise
- [ ] Unknown entry types rendered as serialized `log.text` fallback
- [ ] Entries without `id` filtered out gracefully
- [ ] MCP API guide updated with `ui_push` documentation
- [ ] Test via MCP client: log messages, confirm dialog, text input, mixed batch

## Test Plan

### Manual testing via MCP client

1. **Simple log messages:**
   ```json
   { "entries": ["Hello from MCP!", "Processing..."] }
   ```
   Expected: Log View page created, two `log.info` entries shown.

2. **Typed log entries:**
   ```json
   { "entries": [
       { "type": "log.warn", "data": "Watch out!" },
       { "type": "log.success", "data": "All done!" }
   ] }
   ```
   Expected: Entries appended to existing log page with correct styling.

3. **Dialog (confirm):**
   ```json
   { "entries": [
       { "type": "log.info", "data": "About to ask..." },
       { "type": "input.confirm", "data": { "message": "Continue?", "buttons": ["No", "Yes"] } }
   ] }
   ```
   Expected: Tool blocks until user clicks. Returns `{ results: [{ button: "Yes" }] }`.

4. **Batched dialogs:**
   ```json
   { "entries": [
       { "type": "input.text", "data": { "title": "Name?" } },
       { "type": "input.confirm", "data": { "message": "Sure?" } }
   ] }
   ```
   Expected: Both dialogs shown, tool blocks until both resolved.

5. **Canceled dialog (close page while pending):**
   Expected: Returns `{ results: [{ button: null }] }`.

6. **Reuse existing log page:**
   Send two separate `ui_push` calls. Both should write to the same Log View page.

7. **Recreate after close:**
   Close the Log View page, send another `ui_push`. New page should be created.
