# US-214: MCP Inspector — scripting API (connection & troubleshooting)

## Goal

Add a `page.asMcpInspector()` scripting facade that exposes connection management, connection parameters, and request history for automation and AI-agent troubleshooting.

## Background

### Facade pattern (page-editor variant)

Page-editor facades wrap a PageModel directly — no ViewModel, no ref-counting. Reference implementation: `BrowserEditorFacade.ts`.

```
PageWrapper.asBrowser()
  → validates page type is "browserPage"
  → creates BrowserEditorFacade(model)
  → returns facade
```

### What NOT to expose

The full MCP client API (`listTools`, `callTool`, `readResource`, `getPrompt`) is deliberately excluded. AI agents interact with MCP servers natively via `@modelcontextprotocol/sdk` — wrapping those methods in a facade just duplicates what agents can already do. The facade focuses on what agents *can't* do natively: reading/writing the Inspector's UI state and troubleshooting connection issues.

### Existing model properties available

From `McpInspectorModel` (`src/renderer/editors/mcp-inspector/McpInspectorModel.ts`):
- **State**: `url`, `transportType`, `command`, `args`, `connectionName`, `connectionStatus`, `errorMessage`, `serverName`, `serverVersion`, `activePanel`
- **Methods**: `connect()`, `disconnect()`, `setActivePanel()`
- **History**: `_history` (private array of `McpRequestEntry`), `historyCount`, `showHistory()`, `clearHistory()`

## Implementation Plan

### Step 1: Create `IMcpInspectorEditor` type definition

**File:** `src/renderer/api/types/mcp-inspector-editor.d.ts`

```typescript
/**
 * IMcpInspectorEditor — script interface for MCP Inspector pages.
 *
 * Obtained via `page.asMcpInspector()`. Only available for MCP Inspector pages.
 * Provides connection management and troubleshooting access.
 *
 * @example
 * const inspector = await page.asMcpInspector();
 * inspector.url = "http://localhost:7865/mcp";
 * await inspector.connect();
 * console.log(inspector.connectionStatus); // "connected"
 * console.log(inspector.serverName);       // "js-notepad"
 */
export interface IMcpInspectorEditor {
    // -- Connection status (read-only) --

    /** Connection state: "disconnected", "connecting", "connected", "error". */
    readonly connectionStatus: string;

    /** Connected server name (empty when disconnected). */
    readonly serverName: string;

    /** Connected server version (empty when disconnected). */
    readonly serverVersion: string;

    /** Last error message (empty when no error). */
    readonly errorMessage: string;

    // -- Connection parameters (read/write) --

    /** Transport type: "http" or "stdio". */
    transportType: string;

    /** Server URL (for HTTP transport). */
    url: string;

    /** Command to spawn (for stdio transport). */
    command: string;

    /** Space-separated arguments (for stdio transport). */
    args: string;

    /** Display name for the connection. */
    connectionName: string;

    // -- Connection actions --

    /** Connect using current parameters. */
    connect(): Promise<void>;

    /** Disconnect from the current server. */
    disconnect(): Promise<void>;

    // -- History (troubleshooting) --

    /** Number of recorded request entries. */
    readonly historyCount: number;

    /**
     * Array of recorded MCP request/response entries.
     * Each entry has: direction, method, params, result, error, durationMs, timestamp.
     */
    readonly history: ReadonlyArray<{
        direction: "outgoing" | "incoming";
        method: string;
        params: any;
        result: any;
        error: string | null;
        durationMs: number;
        timestamp: number;
    }>;

    /** Clear all recorded history. */
    clearHistory(): void;

    /** Open history in a new Log View page. */
    showHistory(): Promise<void>;
}
```

### Step 2: Copy type definition to assets

**File:** `assets/editor-types/mcp-inspector-editor.d.ts`

Exact copy of the file from Step 1 (for Monaco IntelliSense).

### Step 3: Update `_imports.txt`

**File:** `assets/editor-types/_imports.txt`

Add line (alphabetical order, after `menu-folders.d.ts`):
```
mcp-inspector-editor.d.ts
```

### Step 4: Update `IPage` interface

**File:** `src/renderer/api/types/page.d.ts`

Add import:
```typescript
import type { IMcpInspectorEditor } from "./mcp-inspector-editor";
```

Add method after `asBrowser()` (line 105):
```typescript
/** Get MCP Inspector interface. Only for MCP Inspector pages. */
asMcpInspector(): Promise<IMcpInspectorEditor>;
```

**File:** `assets/editor-types/page.d.ts`

Same two changes (import + method signature).

### Step 5: Create `McpInspectorFacade`

**File:** `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts`

```typescript
import type { McpInspectorModel } from "../../editors/mcp-inspector/McpInspectorModel";

/**
 * Safe facade around McpInspectorModel for script access.
 * Implements the IMcpInspectorEditor interface.
 *
 * Direct model wrap (no ViewModel, no ref-counting).
 */
export class McpInspectorFacade {
    constructor(private readonly model: McpInspectorModel) {}

    // -- Connection status (read-only) --

    get connectionStatus(): string {
        return this.model.state.get().connectionStatus;
    }

    get serverName(): string {
        return this.model.state.get().serverName;
    }

    get serverVersion(): string {
        return this.model.state.get().serverVersion;
    }

    get errorMessage(): string {
        return this.model.state.get().errorMessage;
    }

    // -- Connection parameters (read/write) --

    get transportType(): string {
        return this.model.state.get().transportType;
    }
    set transportType(value: string) {
        this.model.state.update((s) => { s.transportType = value as any; });
    }

    get url(): string {
        return this.model.state.get().url;
    }
    set url(value: string) {
        this.model.state.update((s) => { s.url = value; });
    }

    get command(): string {
        return this.model.state.get().command;
    }
    set command(value: string) {
        this.model.state.update((s) => { s.command = value; });
    }

    get args(): string {
        return this.model.state.get().args;
    }
    set args(value: string) {
        this.model.state.update((s) => { s.args = value; });
    }

    get connectionName(): string {
        return this.model.state.get().connectionName;
    }
    set connectionName(value: string) {
        this.model.state.update((s) => { s.connectionName = value; });
    }

    // -- Connection actions --

    connect(): Promise<void> {
        return this.model.connect();
    }

    disconnect(): Promise<void> {
        return this.model.disconnect();
    }

    // -- History --

    get historyCount(): number {
        return this.model.historyCount;
    }

    get history(): ReadonlyArray<any> {
        return this.model.history;
    }

    clearHistory(): void {
        this.model.clearHistory();
    }

    showHistory(): Promise<void> {
        return this.model.showHistory();
    }
}
```

### Step 6: Expose `history` getter on McpInspectorModel

Currently `_history` is private. Add a public getter:

**File:** `src/renderer/editors/mcp-inspector/McpInspectorModel.ts`

After the existing `get historyCount()`:
```typescript
get history(): ReadonlyArray<McpRequestEntry> {
    return this._history;
}
```

### Step 7: Register in PageWrapper

**File:** `src/renderer/scripting/api-wrapper/PageWrapper.ts`

Add import at top:
```typescript
import { McpInspectorFacade } from "./McpInspectorFacade";
import type { McpInspectorModel } from "../../editors/mcp-inspector/McpInspectorModel";
```

Add method after `asBrowser()`:
```typescript
async asMcpInspector(): Promise<McpInspectorFacade> {
    if (this.model.state.get().type !== "mcpInspectorPage") {
        throw new Error("asMcpInspector() is only available for MCP Inspector pages");
    }
    return new McpInspectorFacade(this.model as unknown as McpInspectorModel);
}
```

### Step 8: Type-check

Run `npx tsc --noEmit` to verify no broken references.

## Concerns (Resolved)

1. **No MCP client proxy**: Deliberately excluded. Agents use `@modelcontextprotocol/sdk` directly. The facade is for connection management and troubleshooting only.

2. **Writable connection params**: Allowing scripts to modify `url`, `command`, `args`, `transportType`, `connectionName` is safe — these are just state fields on the model. The UI will reactively update. Writing while connected doesn't auto-reconnect; the script must call `disconnect()` then `connect()`.

3. **History is a shallow copy reference**: `history` returns a reference to the internal array (via `ReadonlyArray`). This is consistent with how other facades expose state. Callers should not mutate entries.

## Acceptance Criteria

- [ ] `page.asMcpInspector()` returns a facade for `mcpInspectorPage` pages
- [ ] `page.asMcpInspector()` throws for non-MCP-Inspector pages
- [ ] Read-only properties: `connectionStatus`, `serverName`, `serverVersion`, `errorMessage`, `historyCount`, `history`
- [ ] Read/write properties: `url`, `command`, `args`, `transportType`, `connectionName`
- [ ] Actions: `connect()`, `disconnect()`, `clearHistory()`, `showHistory()`
- [ ] Type definitions in both `src/renderer/api/types/` and `assets/editor-types/`
- [ ] Monaco IntelliSense shows `asMcpInspector()` and its methods
- [ ] `npx tsc --noEmit` passes

## Files Changed Summary

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/api/types/mcp-inspector-editor.d.ts` | Create | `IMcpInspectorEditor` interface |
| `assets/editor-types/mcp-inspector-editor.d.ts` | Create | Copy of above (Monaco IntelliSense) |
| `assets/editor-types/_imports.txt` | Edit | Add `mcp-inspector-editor.d.ts` |
| `src/renderer/api/types/page.d.ts` | Edit | Import + `asMcpInspector()` method |
| `assets/editor-types/page.d.ts` | Edit | Same |
| `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts` | Create | Facade implementation |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Edit | Import + `asMcpInspector()` method |
| `src/renderer/editors/mcp-inspector/McpInspectorModel.ts` | Edit | Add public `history` getter |
