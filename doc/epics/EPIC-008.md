# EPIC-008: MCP Inspector Editor

## Status

**Status:** Active
**Created:** 2026-03-19

## Overview

Add an MCP (Model Context Protocol) browser/inspector editor to js-notepad. This gives developers an interactive tool for connecting to MCP servers, browsing their tools/resources/prompts, and calling them — similar to the official MCP Inspector but integrated directly into js-notepad as a page-editor. Built on top of `@modelcontextprotocol/sdk` (already a project dependency) using its `Client` class.

## Goals

- Connect to MCP servers via HTTP (StreamableHTTPClientTransport) and stdio (StdioClientTransport — spawn local server processes)
- Browse and inspect tools, resources, and prompts with full schema details
- Call tools and read resources interactively with dynamic argument forms
- Track request/response history for debugging
- Manage saved connections in a centralized store with auto-save on successful connect
- Expose scripting API for automation (`page.asMcpInspector()`)

## Why Custom (No Embeddable Library)

Evaluated existing options:
- **MCP Inspector** — standalone app (React + Node proxy), not embeddable as a component library
- **`use-mcp`** — official React hook, handles connection lifecycle, but HTTP-only and provides zero UI
- **MCP-UI SDK** — renders UI that MCP servers provide, not for browsing/inspecting servers
- **CopilotKit open-mcp-client** — chat-oriented, tied to CopilotKit ecosystem

No Excalidraw-equivalent exists for MCP. The `@modelcontextprotocol/sdk` Client API is clean and sufficient — we build custom UI on top.

## Technical Notes

### MCP Client SDK

Already installed: `@modelcontextprotocol/sdk` ^1.27.1 (used by the MCP server in main process).

Client-side API:
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "js-notepad-mcp-inspector", version: "1.0.0" });
await client.connect(transport);

await client.listTools();
await client.callTool({ name: "tool-name", arguments: { key: "value" } });
await client.listResources();
await client.readResource({ uri: "notepad://guides/pages" });
await client.listPrompts();
await client.getPrompt({ name: "prompt-name", arguments: {} });
```

### Transport Options

- **HTTP** (`StreamableHTTPClientTransport`): Connect to running HTTP-based MCP servers by URL. Works from renderer process directly.
- **Stdio** (`StdioClientTransport`): Spawn a child process (e.g., `npx @modelcontextprotocol/server-filesystem /path`). Runs in renderer process — process is killed when editor tab is closed or app exits. Acceptable for an inspector tool.

### Editor Registration

- **Editor ID:** `mcp-view`
- **Category:** `page-editor` (own PageModel, manages its own state — not a text content view)
- **Page type:** `mcpInspectorPage` (renamed from `mcpBrowserPage` in US-216)
- **No file association** — standalone page like About or Settings
- **Dynamic import:** `await import("./mcp-inspector")` for code splitting

### Connections Store

All saved connections are stored in a single centralized file:
```
%APPDATA%/js-notepad/data/mcp-connections.json
```

Format:
```json
[
  {
    "id": "uuid-1",
    "name": "js-notepad MCP",
    "transport": "http",
    "url": "http://localhost:7865/mcp"
  },
  {
    "id": "uuid-2",
    "name": "Filesystem Server",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
  }
]
```

Connections are auto-saved on successful connect. Default name is generated from URL or command. Users can rename, edit, or delete connections from the editor UI.

### UI Layout Concept

```
+----------------------------------------------------+
| [Saved ▼] [HTTP ▼] [url input..........] [Connect] |
| Status: Connected — js-notepad MCP v1.0.24         |
+------+---------------------------------------------+
| Side | Main Panel                                  |
| bar  |                                             |
| ──── | Tool: execute_script                        |
| Tools| Description: Run JS/TS code...              |
|  9   | ─────────────────────────────────            |
| ──── | Arguments:                                  |
| Res  |   script: [...................]              |
|  4   |   windowIndex: [0]                           |
| ──── | ─────────────────────────────────            |
| Prm  | [▶ Call Tool]                                |
|  2   | ─────────────────────────────────            |
| ──── | Result:                                     |
| Hist | { "content": [{ "type": "text", ... }]      |
|      |                                             |
+------+---------------------------------------------+
```

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-209 | MCP Browser — editor scaffold & connection manager | Done |
| US-210 | MCP Browser — tools panel (list, inspect, call) | Done |
| US-211 | MCP Browser — resources & prompts panels | Done |
| US-212 | MCP request log (new log-view entry type) | Done |
| US-213 | MCP Browser — connections store & management UI | Done |
| US-214 | MCP Inspector — scripting API (connection & troubleshooting) | Done |
| US-216 | Rename mcp-browser → mcp-inspector across codebase | Done |

## Task Details

### US-209: MCP Browser — editor scaffold & connection manager

**The foundation task.** Create the editor shell, register it, and implement connection management for both HTTP and stdio transports.

Scope:
- Add `mcpBrowserPage` to `PageType` and `mcp-view` to `PageEditor` in `shared/types.ts`
- Create `/src/renderer/editors/mcp-browser/` folder:
  - `McpBrowserModel.ts` — PageModel managing connection state, server capabilities, active panel
  - `McpBrowserView.tsx` — Main editor component with connection bar and panel layout
  - `McpConnectionManager.ts` — Wraps MCP SDK Client: connect, disconnect, error handling
  - `index.ts` — EditorModule exports
- Register in `register-editors.ts` (page-editor, no file association)
- Connection bar UI: transport selector (HTTP/stdio), URL or command input, connect/disconnect button
- Display server info after connection: name, version, capabilities
- Connection state: disconnected → connecting → connected → error
- Lifecycle method `showMcpBrowserPage()` on pages API
- Verify: connect to js-notepad's own MCP server at `localhost:7865/mcp`

### US-210: MCP Browser — tools panel (list, inspect, call)

**The most useful panel.** Browse tools, build argument forms from JSON Schema, execute, and see results.

Scope:
- Tools sidebar list: tool names with count badge
- Tool detail view: name, description, input schema display
- Dynamic argument form generated from tool's JSON Schema (`inputSchema`):
  - String → text input (multiline for `description` containing "code" or "script")
  - Number → number input
  - Boolean → checkbox
  - Enum → dropdown
  - Object/Array → JSON editor (Monaco inline or textarea)
  - Required field indicators
- "Call Tool" button → `client.callTool()` → display result
- Result display: format `content` array (text → syntax-highlighted, image → rendered)
- Error display: `isError` flag, error messages
- Loading state during tool calls

### US-211: MCP Browser — resources & prompts panels

Scope:
- **Resources panel:**
  - List resources (`client.listResources()`) with name, URI, description
  - Resource templates (`client.listResourceTemplates()`) with URI pattern
  - Click to read (`client.readResource()`) → display content
  - Content display: text (syntax-highlighted by mimeType), binary (hex dump or base64 info)
- **Prompts panel:**
  - List prompts (`client.listPrompts()`) with name, description
  - Argument form (similar to tools, but from prompt's `arguments` schema)
  - "Get Prompt" → `client.getPrompt()` → display messages array
  - Message display: role + content formatting

### US-212: MCP request log (new log-view entry type)

**Reuses the existing log-view editor** by adding a new `output.mcp-request` entry type. No new editor — just a new entry renderer in `log-view/items/`.

Two consumers:
1. **MCP Inspector** — collects history entries from SDK calls, "Show History" opens a log page
2. **js-notepad's own MCP server** — MCP handler logs incoming requests, MCP indicator click opens the log

Scope:
- New entry type `output.mcp-request` in `logTypes.ts` with: method, params, result, error, durationMs, direction
- `McpRequestView.tsx` renderer in `log-view/items/` — header row (direction badge, method, tool name, duration) + collapsible request/response JSON sections
- Routing case in `LogEntryContent.tsx`
- MCP Inspector model: history collection array, `logRequest()` helper, `showHistory()` opens log page
- MCP handler: wrap `handleCommand()` to log incoming requests to the MCP log page
- MCP indicator click: opens/focuses the MCP log page

### US-213: MCP Browser — connections store & management UI

**Centralized connections management.** All saved connections live in a single JSON file in the app data folder.

Scope:
- `McpConnectionStore` service — reads/writes `%APPDATA%/js-notepad/data/mcp-connections.json`
  - `loadConnections()`, `saveConnection(config)`, `deleteConnection(id)`, `updateConnection(id, changes)`
  - Uses `app.fs` for file I/O
- Auto-save connection on successful connect:
  - Default name = URL (for HTTP) or command + first arg (for stdio)
  - Deduplication: if a connection with the same URL/command already exists, don't create a duplicate
- Connections dropdown/panel in the editor UI:
  - Quick-connect: select a saved connection → fills connection bar → optional auto-connect
  - Edit connection name inline
  - Delete connection with confirmation
- Default connection: js-notepad MCP server (auto-detected from running instance URL)
- Session restore remembers which saved connection was used (by ID)
- **Per-connection UI state persistence:** save selected tool, entered arguments, selected resource/prompt per connection ID in `mcp-connections.json`. Restores state when reconnecting to the same server. (Deferred from US-210 which clears args on tool switch.)

### US-214: MCP Inspector — scripting API (connection & troubleshooting)

**Slimmed-down scope.** The full MCP client API (listTools, callTool, readResource, getPrompt) is deliberately excluded — AI agents already interact with MCP servers directly through `@modelcontextprotocol/sdk`. The facade focuses on connection management and troubleshooting, which is what agents actually need to help users.

Scope:
- `page.asMcpInspector()` facade for scripting:
  - **Connection management:**
    - `connect()` — connect using current page config
    - `disconnect()`
    - `connectionStatus` — read-only (`"disconnected"` | `"connecting"` | `"connected"` | `"error"`)
    - `serverName`, `serverVersion` — read-only (populated after connect)
    - `errorMessage` — read-only
  - **Connection parameters** (read/write):
    - `url`, `command`, `args`, `transportType`
  - **Troubleshooting:**
    - `history` — read-only array of `McpRequestEntry` objects (request log)
    - `clearHistory()`
- Type definitions in `mcp-inspector-editor.d.ts`
- MCP resource guide update for the editor type

### US-216: Rename mcp-browser → mcp-inspector across codebase

**Consistency rename.** The UI already shows "MCP Inspector" but all code still uses "mcp-browser" naming. This creates confusion when reading code, docs, and file paths.

Scope:
- Rename folder: `editors/mcp-browser/` → `editors/mcp-inspector/`
- Rename files: `McpBrowserModel.ts` → `McpInspectorModel.ts`, `McpBrowserView.tsx` → `McpInspectorView.tsx`
- Rename classes: `McpBrowserModel` → `McpInspectorModel`, `McpBrowserPageState` → `McpInspectorPageState`
- Rename page type: `mcpBrowserPage` → `mcpInspectorPage` (with backward-compat in session restore)
- Editor ID stays `mcp-view` (no user-visible change)
- Update all imports, references in register-editors, CLAUDE.md, architecture docs
- Keep `showMcpBrowserPage()` as deprecated alias → `showMcpInspectorPage()` (one release cycle)

## Notes

### 2026-03-19
- Evaluated MCP Inspector (standalone, not embeddable), use-mcp (hook only, no UI), MCP-UI SDK (for rendering server UIs, not inspecting)
- Decision: build custom UI on `@modelcontextprotocol/sdk` Client — SDK already in project dependencies
- Two transports: HTTP (easy, direct from renderer) and stdio (spawn processes, runs in renderer — killed on tab close)
- Key inspiration: MCP Inspector UI layout, Postman-style request/response flow
- Redesign: dropped `.mcp.json` file association in favor of centralized connections store (`mcp-connections.json` in app data folder). Auto-save on successful connect, manage all connections from the editor UI. Simpler UX than scattered config files.
- Use Monaco editor instances for all text input/output fields (tool arguments, tool results, prompt messages). Provides syntax highlighting, autocompletion, and a consistent editing experience instead of plain textareas.
- Resource content rendering should be adaptive based on `mimeType`: `text/markdown` → md-view component, `application/json` → Monaco with JSON language, other `text/*` → Monaco with language detection, `image/*` → inline image render, fallback → Monaco as plain text.
