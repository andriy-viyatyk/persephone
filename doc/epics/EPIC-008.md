# EPIC-008: MCP Browser Editor

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
- Save connection profiles for quick reconnect
- Expose scripting API for automation (`page.asMcpBrowser()`)

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

const client = new Client({ name: "js-notepad-mcp-browser", version: "1.0.0" });
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
- **Stdio** (`StdioClientTransport`): Spawn a child process (e.g., `npx @modelcontextprotocol/server-filesystem /path`). Since js-notepad runs with `nodeIntegration: true`, can spawn from renderer, but may be cleaner via main process IPC.

### Editor Registration

- **Editor ID:** `mcp-view`
- **Category:** `page-editor` (own PageModel, manages its own state — not a text content view)
- **Page type:** New `mcpBrowserPage` added to `PageType`
- **File association:** `.mcp.json` files (connection config + state)
- **Dynamic import:** `await import("./mcp-browser")` for code splitting

### Data Format (`.mcp.json`)

Connection configuration file that can be saved/opened:
```json
{
  "type": "mcp-connection",
  "version": 1,
  "connection": {
    "name": "My Server",
    "transport": "http",
    "url": "http://localhost:7865/mcp"
  }
}
```

For stdio:
```json
{
  "type": "mcp-connection",
  "version": 1,
  "connection": {
    "name": "Filesystem Server",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
  }
}
```

### UI Layout Concept

```
+----------------------------------------------+
| [Connect] URL: http://localhost:7865/mcp  [▼] |
| Status: Connected — js-notepad MCP v1.0.24    |
+------+---------------------------------------+
| Side | Main Panel                            |
| bar  |                                       |
| ──── | Tool: execute_script                  |
| Tools| Description: Run JS/TS code...        |
|  9   | ─────────────────────────────────      |
| ──── | Arguments:                            |
| Res  |   script: [...................]        |
|  4   |   windowIndex: [0]                    |
| ──── | ─────────────────────────────────      |
| Prm  | [▶ Call Tool]                          |
|  2   | ─────────────────────────────────      |
| ──── | Result:                               |
| Hist | { "content": [{ "type": "text", ... }]|
|      |                                       |
+------+---------------------------------------+
```

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-209 | MCP Browser — editor scaffold & connection manager | Planned |
| US-210 | MCP Browser — tools panel (list, inspect, call) | Planned |
| US-211 | MCP Browser — resources & prompts panels | Planned |
| US-212 | MCP Browser — request history & logging | Planned |
| US-213 | MCP Browser — saved connections & profiles | Planned |
| US-214 | MCP Browser — scripting API & MCP integration | Planned |

## Task Details

### US-209: MCP Browser — editor scaffold & connection manager

**The foundation task.** Create the editor shell, register it, and implement connection management for both HTTP and stdio transports.

Scope:
- Add `mcpBrowserPage` to `PageType` and `mcp-view` to `PageEditor` in `shared/types.ts`
- Create `/src/renderer/editors/mcp-browser/` folder:
  - `McpBrowserModel.ts` — PageModel managing connection state, server capabilities, active panel
  - `McpBrowserView.tsx` — Main editor component with connection bar and panel layout
  - `McpConnectionManager.ts` — Wraps MCP SDK Client: connect, disconnect, reconnect, error handling
  - `index.ts` — EditorModule exports
- Register in `register-editors.ts` (page-editor, `.mcp.json`, priority 50)
- Connection bar UI: transport selector (HTTP/stdio), URL or command input, connect/disconnect button
- Display server info after connection: name, version, capabilities
- Connection state: disconnected → connecting → connected → error
- Parse `.mcp.json` files on open to restore connection config
- "New MCP Browser" option in new-page menu or command palette
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

### US-212: MCP Browser — request history & logging

Scope:
- Log all MCP JSON-RPC requests and responses with timestamps
- History panel in sidebar (or bottom section)
- Click to view request/response details (formatted JSON)
- Timing info (request duration)
- "Re-execute" button to replay a request
- Clear history action
- Optional: filter by method type (tools/resources/prompts)

### US-213: MCP Browser — saved connections & profiles

Scope:
- Save current connection as a named profile
- Profiles stored in app settings or a dedicated config file
- Quick-connect dropdown showing saved profiles
- Edit/delete saved profiles
- Default profiles: js-notepad MCP server (auto-detected URL from running instance)
- Import/export connection configs (`.mcp.json` files)
- Remember last used connection per editor instance

### US-214: MCP Browser — scripting API & MCP integration

Scope:
- `page.asMcpBrowser()` facade for scripting:
  - `connect(url)` / `connectStdio(command, args)`
  - `disconnect()`
  - `listTools()`, `callTool(name, args)`
  - `listResources()`, `readResource(uri)`
  - `listPrompts()`, `getPrompt(name, args)`
  - `connectionStatus` property
- Type definitions in `mcp-browser-editor.d.ts`
- MCP handler: support creating MCP browser pages via `create_page`
- MCP resource guide update for the new editor type

## Notes

### 2026-03-19
- Evaluated MCP Inspector (standalone, not embeddable), use-mcp (hook only, no UI), MCP-UI SDK (for rendering server UIs, not inspecting)
- Decision: build custom UI on `@modelcontextprotocol/sdk` Client — SDK already in project dependencies
- Two transports: HTTP (easy, direct from renderer) and stdio (spawn processes, may need main process IPC)
- Key inspiration: MCP Inspector UI layout, Postman-style request/response flow
- `.mcp.json` file format for saving/sharing connection configs
