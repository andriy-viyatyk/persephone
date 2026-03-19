# US-209: MCP Browser — Editor Scaffold & Connection Manager

**Epic:** EPIC-008 (MCP Browser Editor)
**Status:** Planned

## Goal

Create the MCP Browser editor shell — register it as a `page-editor`, implement the `McpBrowserModel` PageModel, build a connection manager wrapping the MCP SDK `Client`, and render a basic UI with connection bar + panel layout skeleton. After this task, users can open an MCP Browser tab, connect to an HTTP or stdio MCP server, see server info, and disconnect.

## Background

### Editor registration pattern (page-editor)

Page-editors are standalone editors with their own `PageModel` subclass. They don't use `ContentViewModel` or `IContentHost` — they manage their own state entirely.

**Existing examples:** `browser-view` (BrowserPageModel), `about-view`, `settings-view`, `pdf-view`, `image-view`.

Registration in [register-editors.ts](../../src/renderer/editors/register-editors.ts) is minimal for page-editors:
```typescript
editorRegistry.register({
    id: "mcp-view",
    name: "MCP Browser",
    pageType: "mcpBrowserPage",
    category: "page-editor",
    loadModule: async () => {
        const module = await import("./mcp-browser/McpBrowserView");
        return module.default;
    },
});
```

### PageModel pattern for page-editors

Follow `BrowserPageModel` pattern ([BrowserPageModel.ts](../../src/renderer/editors/browser/BrowserPageModel.ts)):
- Extends `PageModel<McpBrowserPageState, void>`
- `noLanguage = true` (no language selector in status bar)
- `skipSave = true` (no auto-save to disk — connection state is ephemeral)
- Implements `restore()`, `getRestoreData()`, `applyRestoreData()`, `dispose()`, `getIcon()`
- Default state factory: `getDefaultMcpBrowserPageState()`

### Types to add

In [shared/types.ts](../../src/shared/types.ts):
- `PageType`: add `"mcpBrowserPage"`
- `PageEditor`: add `"mcp-view"`

### MCP Client SDK

Already installed: `@modelcontextprotocol/sdk` ^1.27.1. Client imports:
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
```

Use lazy loading pattern (same as [mcp-http-server.ts](../../src/main/mcp-http-server.ts)):
```typescript
let ClientClass: typeof import("@modelcontextprotocol/sdk/client/index.js").Client;
async function loadSdk() { ... }
```

### Lifecycle method pattern

In [PagesLifecycleModel.ts](../../src/renderer/api/pages/PagesLifecycleModel.ts), add `showMcpBrowserPage()` following the `showBrowserPage()` pattern:
```typescript
showMcpBrowserPage = async (options?: { url?: string }): Promise<void> => {
    const module = await import("../../editors/mcp-browser/McpBrowserView");
    const model = await module.default.newEmptyPageModel("mcpBrowserPage");
    if (model) {
        if (options?.url) {
            model.state.update((s: any) => { s.url = options.url; });
        }
        this.addPage(model);
    }
};
```

### .mcp.json file association

When a `.mcp.json` file is opened, it should open in the MCP Browser editor with the connection config pre-populated. This requires an `acceptFile` handler in the registration and parsing the JSON content in the model's `restore()`.

Add `.mcp.json` to `SPECIALIZED_JSON_PATTERNS` so it doesn't get opened in the grid editor.

## Implementation Plan

### Step 1: Add types to shared/types.ts

**File:** `src/shared/types.ts`

- Add `"mcpBrowserPage"` to `PageType` union
- Add `"mcp-view"` to `PageEditor` union

### Step 2: Create McpConnectionManager.ts

**File:** `src/renderer/editors/mcp-browser/McpConnectionManager.ts`

Wraps the MCP SDK `Client` class. Manages connection lifecycle.

```typescript
export type McpTransportType = "http" | "stdio";

export interface McpConnectionConfig {
    name: string;
    transport: McpTransportType;
    // HTTP
    url?: string;
    // Stdio
    command?: string;
    args?: string[];
    env?: Record<string, string>;
}

export type McpConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerInfo {
    name: string;
    version: string;
    capabilities: {
        tools?: boolean;
        resources?: boolean;
        prompts?: boolean;
    };
}
```

Class methods:
- `connect(config: McpConnectionConfig): Promise<void>` — creates transport, connects client, emits status changes
- `disconnect(): Promise<void>` — closes client and transport gracefully
- `getClient(): Client | null` — returns the connected client (for tools/resources/prompts panels in future tasks)
- `getServerInfo(): McpServerInfo | null`
- `getStatus(): McpConnectionStatus`
- `onStatusChange: (status: McpConnectionStatus, error?: string) => void` — callback for model to react
- `dispose(): void` — disconnect and cleanup

Lazy-load SDK modules on first `connect()` call.

### Step 3: Create McpBrowserModel.ts

**File:** `src/renderer/editors/mcp-browser/McpBrowserModel.ts`

```typescript
export interface McpBrowserPageState extends IPageState {
    // Connection config
    url: string;
    transportType: McpTransportType;
    command: string;
    args: string;
    connectionName: string;

    // Connection status
    connectionStatus: McpConnectionStatus;
    errorMessage: string;

    // Server info (after connect)
    serverName: string;
    serverVersion: string;
    hasTools: boolean;
    hasResources: boolean;
    hasPrompts: boolean;

    // UI state
    activePanel: "tools" | "resources" | "prompts" | "history";
}
```

- Extends `PageModel<McpBrowserPageState, void>`
- `noLanguage = true`, `skipSave = true`
- Creates `McpConnectionManager` in constructor
- Wires `onStatusChange` to update state
- `connect()` / `disconnect()` methods delegate to manager
- `dispose()` calls `manager.dispose()`
- `restore()` — if state has URL or command from `.mcp.json`, pre-fill but don't auto-connect
- `getRestoreData()` — persist connection config (not status) for session restore
- `applyRestoreData()` — restore connection config
- `getIcon()` — return a custom icon (can use an existing icon like `PlugIcon` or simple SVG)

### Step 4: Create McpBrowserView.tsx

**File:** `src/renderer/editors/mcp-browser/McpBrowserView.tsx`

Single styled root component (`McpBrowserViewRoot`) with nested class-based styles.

**Layout:**
```
+----------------------------------------------------+
| Connection Bar                                      |
| [HTTP ▼] [url input............] [Connect/Disconnect]|
+----------------------------------------------------+
| Status: Connected — ServerName v1.0.0               |
| Capabilities: Tools (9) | Resources (4) | Prompts (2)|
+------+---------------------------------------------+
| Side | Main Panel (placeholder for US-210+)         |
| bar  |                                              |
| ──── | "Select a tool, resource, or prompt          |
| Tools|  from the sidebar to get started"            |
|  ──  |                                              |
| Res  |                                              |
|  ──  |                                              |
| Prm  |                                              |
+------+---------------------------------------------+
```

**Connection bar components:**
- Transport selector dropdown: HTTP / Stdio
- URL input (for HTTP) or Command + Args inputs (for Stdio)
- Connect / Disconnect button (changes based on `connectionStatus`)
- Loading spinner when `connecting`

**Server info section** (visible when connected):
- Server name and version
- Capability badges (Tools, Resources, Prompts) — clickable to switch panel

**Sidebar** (placeholder for US-210+):
- Panel tabs: Tools, Resources, Prompts, History
- Just the tab buttons for now, no content

**Main panel** (placeholder):
- Empty state message when nothing selected

### Step 5: Create index.ts and EditorModule default export

**File:** `src/renderer/editors/mcp-browser/index.ts`

Export the view component.

The `default` export on `McpBrowserView.tsx` should be the `EditorModule`:
```typescript
const mcpBrowserEditorModule: EditorModule = {
    Editor: McpBrowserView,
    newPageModel: async () => {
        return new McpBrowserModel(new TComponentState(getDefaultMcpBrowserPageState()));
    },
    newEmptyPageModel: async (pageType) => {
        if (pageType !== "mcpBrowserPage") return null;
        return new McpBrowserModel(new TComponentState(getDefaultMcpBrowserPageState()));
    },
    newPageModelFromState: async (state) => {
        const s = { ...getDefaultMcpBrowserPageState(), ...state };
        return new McpBrowserModel(new TComponentState(s));
    },
};
export default mcpBrowserEditorModule;
```

### Step 6: Register editor in register-editors.ts

**File:** `src/renderer/editors/register-editors.ts`

1. Add `/\.mcp\.json$/i` to `SPECIALIZED_JSON_PATTERNS` array
2. Add registration block at the end (before about/settings/browser or after — with about/settings/browser group):

```typescript
// MCP Browser (standalone page editor, accepts .mcp.json files)
editorRegistry.register({
    id: "mcp-view",
    name: "MCP Browser",
    pageType: "mcpBrowserPage",
    category: "page-editor",
    acceptFile: (fileName) => {
        if (matchesPattern(fileName, /\.mcp\.json$/i)) return 50;
        return -1;
    },
    loadModule: async () => {
        const module = await import("./mcp-browser/McpBrowserView");
        return module.default;
    },
});
```

### Step 7: Add lifecycle method and API delegates

**Files to update:**

1. **`src/renderer/api/pages/PagesLifecycleModel.ts`** — add `showMcpBrowserPage()` method (after `showBrowserPage`)

2. **`src/renderer/api/pages/PagesModel.ts`** — add delegate:
   ```typescript
   showMcpBrowserPage = (options?: { url?: string }) => this.lifecycle.showMcpBrowserPage(options);
   ```

3. **`src/renderer/api/types/pages.d.ts`** — add type definition:
   ```typescript
   /** Show an MCP Browser page, optionally with a pre-filled URL. */
   showMcpBrowserPage(options?: { url?: string }): Promise<void>;
   ```

4. **`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`** — add wrapper:
   ```typescript
   showMcpBrowserPage(options?: { url?: string }): Promise<void> {
       return this.pages.showMcpBrowserPage(options);
   }
   ```

### Step 8: Handle .mcp.json file opening

When a `.mcp.json` file is opened (via `acceptFile` returning priority 50), the `newPageModel(filePath)` in the EditorModule should:
1. Read the file content
2. Parse the JSON to extract `connection` config
3. Pre-populate `McpBrowserPageState` with the connection details
4. Set `filePath` on the state so changes can be saved back

The `newPageModel` function in the EditorModule:
```typescript
newPageModel: async (filePath?: string) => {
    const state = getDefaultMcpBrowserPageState();
    if (filePath) {
        state.filePath = filePath;
        state.title = fpBasename(filePath);
        try {
            const content = await appFs.readFile(filePath);
            const config = JSON.parse(content);
            if (config.connection) {
                state.url = config.connection.url || "";
                state.transportType = config.connection.transport || "http";
                state.command = config.connection.command || "";
                state.args = (config.connection.args || []).join(" ");
                state.connectionName = config.connection.name || "";
            }
        } catch { /* ignore parse errors */ }
    }
    return new McpBrowserModel(new TComponentState(state));
},
```

### Step 9: Update MCP handler for create_page error message

**File:** `src/renderer/api/mcp-handler.ts`

The existing error message for page-editors mentions browser and file opening. Update it to also mention `showMcpBrowserPage()` as an option, or keep it generic. No code changes needed if the generic message is acceptable — the `execute_script` fallback already covers `app.pages.showMcpBrowserPage()`.

### Step 10: Verify — connect to js-notepad's own MCP server

Manual verification:
1. Open js-notepad
2. Open a new MCP Browser tab (via `app.pages.showMcpBrowserPage()` in script executor)
3. Enter `http://localhost:7865/mcp` in the URL field
4. Click Connect
5. Verify: status changes to "Connected", server info displays name/version/capabilities
6. Click Disconnect
7. Verify: status returns to "Disconnected"

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/shared/types.ts` | Modify | Add `mcpBrowserPage` to PageType, `mcp-view` to PageEditor |
| `src/renderer/editors/mcp-browser/McpConnectionManager.ts` | Create | MCP SDK Client wrapper with connect/disconnect/status |
| `src/renderer/editors/mcp-browser/McpBrowserModel.ts` | Create | PageModel for MCP Browser (state, lifecycle, icon) |
| `src/renderer/editors/mcp-browser/McpBrowserView.tsx` | Create | Main view: connection bar, server info, panel layout skeleton |
| `src/renderer/editors/mcp-browser/index.ts` | Create | Re-exports |
| `src/renderer/editors/register-editors.ts` | Modify | Register mcp-view (no file association) |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Modify | Add showMcpBrowserPage() |
| `src/renderer/api/pages/PagesModel.ts` | Modify | Add delegate method |
| `src/renderer/api/types/pages.d.ts` | Modify | Add type definition |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Modify | Add wrapper method |

## Files NOT Changed

- `src/main/mcp-http-server.ts` — server-side, not related
- `src/renderer/api/mcp-handler.ts` — generic error message already covers this case
- `src/renderer/editors/base/ContentViewModel.ts` — page-editors don't use ContentViewModel
- `assets/mcp-res-*.md` — MCP resource guides updated in US-214 (scripting API task)

## Resolved Concerns

1. **Stdio transport in renderer process:** Keep in renderer. The editor is an inspector — it's fine that the spawned process is killed when the editor page is closed or js-notepad exits. Simpler than IPC to main process.

2. **Icon for MCP Browser tab:** Create a custom SVG icon. The official MCP logo is a complex wordmark (three interlinked diagonal strokes + "Model Context Protocol" text) — not suitable for a 16px tab icon. Instead, create a compact icon with the letters "MCP" styled to be recognizable at small sizes, using the `createIcon` pattern from `icons.tsx`.

3. **No file association:** Dropped `.mcp.json` file association. Connections are managed via a centralized store (US-213). Editor opens as standalone page like About/Settings.

## Acceptance Criteria

- [ ] `mcpBrowserPage` type and `mcp-view` editor registered and functional
- [ ] New MCP Browser tab opens via `app.pages.showMcpBrowserPage()`
- [ ] Connection bar allows entering HTTP URL and connecting
- [ ] Connection bar allows entering stdio command/args and connecting
- [ ] Server info (name, version, capabilities) displays after successful connection
- [ ] Disconnect works cleanly
- [ ] Connection errors are shown to the user
- [ ] Session restore preserves connection config (not connection state)
- [ ] Tab dispose properly disconnects and cleans up resources
- [ ] Successfully connects to js-notepad's own MCP server at `localhost:7865/mcp`
