# EPIC-001: AI Claude Integration (MCP Server)

## Status

**Status:** Active
**Created:** 2026-03-05

## Overview

Make js-notepad controllable by AI agents via the **Model Context Protocol (MCP)**. Instead of embedding AI inside js-notepad, we expose js-notepad as an MCP server that any MCP client (Claude Desktop, Claude Code, ChatGPT, Gemini CLI) can connect to. AI agents can then execute scripts, create/manipulate pages, and read page state — all through the existing app object model. This uses the user's existing AI subscription with zero API costs.

## Goals

- **Built-in MCP server** — HTTP Streamable MCP server running inside js-notepad (no external bridge process)
- **Universal compatibility** — Any MCP client connects via `http://localhost:7865/mcp`
- **Script execution with results** — AI sends scripts, receives execution output + console logs
- **Page manipulation** — AI can create pages, set content, switch editors, read page state
- **Console capture** — Intercept console.log/error/warn in script context, return to caller

## Architecture

```
Claude Desktop / Claude Code / ChatGPT / Gemini CLI
    ↕ Streamable HTTP (http://localhost:7865/mcp)
js-notepad main process (built-in MCP HTTP server)
    ↕ Electron IPC (ipcMain/ipcRenderer)
js-notepad renderer (ScriptRunner, app object model)
```

### How It Works

1. User starts js-notepad with MCP enabled in Settings
2. js-notepad starts an HTTP MCP server on `http://localhost:7865/mcp`
3. User pastes the URL into any MCP client (Claude, ChatGPT, Gemini, etc.)
4. AI agent calls MCP tools → js-notepad executes → returns result
5. No external bridge process needed — everything runs inside js-notepad

### Key Insight

The existing ScriptRunner + app object model (`app.pages`, `app.fs`, `app.ui`, `app.shell`) already provides full app control. A single `execute_script` MCP tool gives AI access to everything — additional tools (list_pages, get_page_content) are convenience optimizations for common read operations.

### Technology

- **MCP SDK:** `@modelcontextprotocol/sdk` (Node.js, runs in Electron main process)
- **Transport:** Streamable HTTP (MCP standard, supported by all major AI tools)
- **IPC:** Electron ipcMain/ipcRenderer for main ↔ renderer communication
- **Cost:** Zero — uses existing AI subscription

## Planned Phases

### Phase 1: Bidirectional IPC Protocol + Console Capture ✅
Separate MCP Named Pipe server with JSON-RPC 2.0, command handler in renderer, console capture in ScriptContext.

- Separate Named Pipe: `\\.\pipe\js-notepad-mcp-{user}` with JSON-RPC 2.0
- IPC bridge: main ↔ renderer via `MCP_EXECUTE`/`MCP_RESULT` channels
- Command handler in renderer: `execute_script`, `get_pages`, `get_page_content`, `get_active_page`
- Console capture: Override `console.log/error/warn/info` in ScriptContext, return with results
- Settings toggle: `mcp.enabled` controls pipe server lifecycle

### Phase 2: HTTP MCP Transport ✅
Replace the Named Pipe transport with a **Streamable HTTP** MCP server built into js-notepad's main process.

- Add `@modelcontextprotocol/sdk` to Electron main process
- Create HTTP MCP server using `StreamableHTTPServerTransport`
- Listen on `http://localhost:7865/mcp` when MCP is enabled (default port: 7865)
- Reuse existing IPC bridge (main → renderer command handler stays unchanged)
- Replace `mcp-pipe-server.ts` with `mcp-http-server.ts`
- Settings: `mcp.enabled` starts/stops the HTTP server, `mcp.port` configures port (default 7865)
- Update IPC endpoints: `getMcpStatus` returns URL instead of pipe name

**Why HTTP over Named Pipe:**
- Universal: all MCP clients support HTTP (Claude, ChatGPT, Gemini, etc.)
- No bridge process: server runs inside js-notepad, user just pastes a URL
- Standard: Streamable HTTP is the MCP spec's recommended remote transport

### Phase 3: MCP Tools & Configuration ✅
Define MCP tools with schemas, add new commands, configure AI clients.

- Define MCP tools with proper names, descriptions, and Zod input schemas
- Add new commands to renderer handler: `create_page`, `set_page_content`, `get_app_info`
- Optimize tool descriptions (help AI understand when/how to use each tool)
- Create `.mcp.json` / config examples for Claude Code, Claude Desktop, ChatGPT, Gemini

MCP Tools:
| Tool | Description |
|------|-------------|
| `execute_script` | Run JavaScript with access to `page` and `app` objects |
| `list_pages` | List all open pages with metadata |
| `get_page_content` | Read content of a page by ID |
| `get_active_page` | Get active page with content |
| `create_page` | Create a new page with content/editor/language |
| `set_page_content` | Update content of a page by ID |
| `get_app_info` | Get app version, window state, page count |

Note: `read_file`, `write_file`, `run_command` are skipped — AI tools (Claude Code, etc.) already have native file/shell access.

### Phase 4: Settings UI & Polish ✅
- **Settings page section** for MCP integration:
  - Toggle: Enable/Disable MCP server
  - Show MCP URL for easy copy-paste (`http://localhost:7865/mcp`)
  - Status indicator: "MCP server running" / "stopped" / "N clients connected"
- MCP instructions / system prompt for AI context
- Test with Claude Desktop, Claude Code, and other MCP clients
- User documentation

### Phase 5: Advanced (Future)
- **Resources:** Expose open pages as MCP resources (AI can read without explicit tool calls)
- **Prompts:** Predefined MCP prompts (e.g., "Analyze current page", "Create diagram from data")
- **Notifications:** Push events from js-notepad to AI (page changed, file saved, error occurred)
- **Image return:** Return rendered diagrams/images as base64 in tool results
- **Multi-window:** Support targeting specific windows

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-101 | MCP Bidirectional Pipe Protocol | Done |
| US-102 | HTTP MCP Transport | Done |
| US-103 | MCP Tools & Configuration | Done |
| US-104 | MCP Settings UI & Polish | Done |

## Open Questions

### Must Decide Before Phase 2
- ~~**HTTP port:** Fixed port (e.g., 7865) or configurable via settings?~~ → **Decided:** Default port 7865, configurable via `mcp.port` setting
- ~~**MCP SDK in Electron:** Does `@modelcontextprotocol/sdk` work in Electron's main process?~~ → **Confirmed:** Works perfectly. SDK v1.27.1 runs in Electron main process with no bundling issues.

### Can Decide Later
- **Authentication:** Should the HTTP server require a token? (security for shared machines)
- **Rate limiting:** Should script execution be throttled?
- **CORS:** Which origins should be allowed? (localhost only for security)

## Technical Details

### Transport Architecture

| Component | Protocol | Lifecycle |
|-----------|----------|-----------|
| **Launcher pipe** | `\\.\pipe\js-notepad-{user}` — Line-based text (OPEN/SHOW/DIFF) | Always on |
| **MCP HTTP server** | `http://localhost:7865/mcp` — Streamable HTTP (MCP standard) | On-demand (`mcp.enabled` setting) |

- Launcher pipe unchanged — backward compatible with `js-notepad-launcher.exe`
- MCP HTTP server runs in Electron main process
- Setting: `mcp.enabled` (boolean, default: false) — controls MCP HTTP server
- IPC bridge: main process routes MCP tool calls to renderer via `MCP_EXECUTE`/`MCP_RESULT`

### MCP Client Compatibility

All major AI tools support Streamable HTTP transport:

| Client | Transport | Setup |
|--------|-----------|-------|
| Claude Code | `"type": "http"` in `.mcp.json` | Paste URL |
| Claude Desktop | Streamable HTTP | Paste URL |
| ChatGPT Desktop | Streamable HTTP | Paste URL |
| Gemini CLI | Streamable HTTP | Paste URL |
| OpenAI Agents SDK | Streamable HTTP | Paste URL |

### ScriptRunner Capabilities (what AI gets access to)
- **app.pages** — Create, open, close, navigate, group pages
- **app.fs** — Read/write files, resolve paths, file dialogs, show in explorer
- **app.settings** — Get/set application settings
- **app.ui** — Confirm dialogs, input prompts, notifications
- **app.shell** — Open external URLs, encrypt/decrypt, version info
- **app.window** — Minimize, maximize, zoom, open new window
- **app.editors** — List registered editors, resolve by language
- **page.content** — Read/write page text content
- **page.editor** — Switch editors (monaco, grid-json, md-view, etc.)
- **page.grouped** — Create side-by-side output pages
- **page.asText/asGrid/asNotebook/...** — Typed editor facades

## Notes

### 2026-03-05
- Epic created with direct API integration approach (Anthropic SDK + Chat UI)
- Discovered OAuth is first-party only — API key required (separate billing)
- **Pivoted to MCP approach** — dramatically simpler, uses existing subscription, no chat UI needed
- MCP works with both Claude Desktop and Claude Code (VS Code extension)
- Key challenge: existing Named Pipe is one-way; need bidirectional JSON-RPC protocol
- **Two-pipe design:** Keep launcher pipe unchanged, add separate MCP pipe with Settings toggle (on/off)
- MCP server is an industry standard — works with Claude, ChatGPT, Gemini, Copilot, and any MCP client
- No existing console.log capture in ScriptRunner — must add for MCP tool results
- Existing app object model + ScriptRunner provide everything Claude needs to control the app

### 2026-03-05 (later)
- Phase 1 complete (US-101): Named Pipe JSON-RPC + console capture working end-to-end
- **Architecture decision:** Replace Named Pipe transport with Streamable HTTP
  - Reason: HTTP is universal — all MCP clients (Claude, ChatGPT, Gemini) support it
  - Reason: No bridge process needed — server runs inside js-notepad
  - Reason: Simple setup — user pastes `http://localhost:7865/mcp` into any AI tool
- Skipped `read_file`, `write_file`, `run_command` tools — AI tools already have native file/shell access
- Added `set_page_content` tool — allows AI to write content back to pages
- Phase 2 (HTTP transport) will be implemented before Phase 3 (tools & config)
