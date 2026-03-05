# EPIC-001: AI Claude Integration (MCP Server)

## Status

**Status:** Active
**Created:** 2026-03-05

## Overview

Make js-notepad controllable by Claude AI via the **Model Context Protocol (MCP)**. Instead of embedding Claude inside js-notepad, we expose js-notepad as an MCP server that Claude Desktop and Claude Code can connect to. Claude can then execute scripts, create/manipulate pages, show diagrams, read/write files, and run shell commands — all through the existing app object model. This uses the user's existing Claude subscription (Team/Pro/Max) with zero API costs.

## Goals

- **MCP server** — Expose js-notepad capabilities as MCP tools that Claude Desktop/Code can call
- **Bidirectional IPC** — Extend Named Pipe with JSON-RPC protocol for request/response communication
- **Script execution with results** — Claude sends scripts, receives execution output + console logs
- **Page manipulation** — Claude can create pages, set content, switch editors, read page state
- **Console capture** — Intercept console.log/error/warn in script context, return to Claude
- **DevTools exposure** — Surface renderer errors and console output to the MCP caller

## Architecture

```
Claude Desktop / Claude Code
    ↕ stdio (JSON-RPC 2.0)
MCP Server (lightweight Node.js process, ~200 lines)
    ↕ Named Pipe (JSON-RPC 2.0, bidirectional)
js-notepad main process (pipe-server.ts)
    ↕ Electron IPC (ipcMain/ipcRenderer)
js-notepad renderer (ScriptRunner, app object model)
```

### How It Works

1. User starts js-notepad (pipe server starts automatically)
2. User configures MCP server in Claude Desktop or Claude Code
3. Claude Desktop launches MCP server process (Node.js script)
4. MCP server connects to js-notepad's Named Pipe
5. User asks Claude to do something with js-notepad
6. Claude calls MCP tool → MCP server sends JSON-RPC request over pipe → js-notepad executes → returns result
7. Claude sees result, may call more tools, eventually responds to user

### Key Insight

The existing ScriptRunner + app object model (`app.pages`, `app.fs`, `app.ui`, `app.shell`) already provides full app control. A single `execute_script` MCP tool gives Claude access to everything — additional tools (list_pages, get_page_content) are convenience optimizations for common read operations.

### Technology

- **MCP SDK:** `@modelcontextprotocol/sdk` (Node.js)
- **Transport:** stdio (MCP server ↔ Claude) + Named Pipe (MCP server ↔ js-notepad)
- **Protocol:** JSON-RPC 2.0 over Named Pipe (extending existing pipe-server.ts)
- **Cost:** Zero — uses existing Claude subscription (Team/Pro/Max)

## Planned Phases

### Phase 1: Bidirectional Pipe Protocol
Extend `pipe-server.ts` with JSON-RPC 2.0 support alongside existing OPEN/SHOW/DIFF commands.

- **Backward compatible:** Plain text commands (OPEN, SHOW, DIFF) still work for the Rust launcher
- **New protocol:** Lines starting with `{` are parsed as JSON-RPC requests
- **Request/response:** Each request gets a JSON-RPC response with result or error
- **New IPC handlers:** Main process forwards JSON-RPC requests to renderer, awaits response

Initial commands:
- `execute_script` — Run JS via ScriptRunner, return result text + console output
- `get_pages` — List all open pages (id, title, type, editor, language, filePath)
- `get_page_content` — Read content of a specific page
- `get_active_page` — Get active page info + content

### Phase 2: Console Capture
Intercept console methods in script execution context.

- Override `console.log/error/warn/info` in ScriptContext before execution
- Buffer all output with timestamps and levels
- Return captured logs alongside script result in JSON-RPC response
- Also capture unhandled errors/rejections during script execution

### Phase 3: MCP Server
Create the MCP server that bridges Claude to js-notepad.

- Standalone Node.js script using `@modelcontextprotocol/sdk`
- Connects to js-notepad Named Pipe on startup
- Exposes MCP tools that map to JSON-RPC commands
- Configuration for Claude Desktop (`claude_desktop_config.json`) and Claude Code (`.mcp.json`)

MCP Tools:
| Tool | Description |
|------|-------------|
| `execute_script` | Run JavaScript with access to `page` and `app` objects |
| `list_pages` | List all open pages with metadata |
| `get_page_content` | Read content of a page by ID |
| `create_page` | Create a new page with content/editor/language |
| `read_file` | Read a file from disk |
| `write_file` | Write content to a file |
| `run_command` | Execute a shell command, return stdout/stderr |
| `get_app_info` | Get app version, window state, settings |

### Phase 4: Settings UI & Polish
- **Settings page section** for MCP integration:
  - Toggle: Enable/Disable MCP server
  - Ready-to-copy config snippets for popular MCP hosts (Claude Desktop, Claude Code, ChatGPT)
  - Status indicator: "MCP server running" / "stopped" / "N clients connected"
  - Advanced (collapsed): pipe name for custom integrations
- Error handling and edge cases (js-notepad not running, pipe timeout)
- MCP tool descriptions optimization (help Claude understand when/how to use each tool)
- System prompt / MCP instructions for Claude context
- Test with Claude Desktop and Claude Code
- User documentation

### Phase 5: Advanced (Future)
- **Resources:** Expose open pages as MCP resources (Claude can read without explicit tool calls)
- **Prompts:** Predefined MCP prompts (e.g., "Analyze current page", "Create diagram from data")
- **Notifications:** Push events from js-notepad to Claude (page changed, file saved, error occurred)
- **Image return:** Return rendered diagrams/images as base64 in tool results
- **Multi-window:** Support targeting specific windows

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-101 | MCP Bidirectional Pipe Protocol | Done |

## Open Questions

### Must Decide Before Phase 1
- **Pipe protocol details:** JSON-RPC 2.0 strict, or simplified JSON request/response? → Leaning JSON-RPC 2.0 for standard compliance
- **Renderer execution:** How to route JSON-RPC commands from main process to renderer and back? New IPC channel pair, or extend existing api.ts?

### Must Decide Before Phase 3
- **MCP server packaging:** Standalone script in repo, or separate npm package?
- **Connection resilience:** What happens if js-notepad restarts while MCP server is connected?

### Can Decide Later
- **Authentication:** Should the pipe require a token for MCP connections? (security for multi-user machines)
- **Rate limiting:** Should script execution be throttled?

## Technical Details

### Named Pipe Architecture (Two Pipes)

| Pipe | Name | Protocol | Lifecycle |
|------|------|----------|-----------|
| **Launcher** | `\\.\pipe\js-notepad-{user}` | Line-based text (OPEN/SHOW/DIFF) | Always on |
| **MCP** | `\\.\pipe\js-notepad-mcp-{user}` | JSON-RPC 2.0 (bidirectional) | On-demand (Settings toggle) |

- Launcher pipe unchanged — backward compatible with `js-notepad-launcher.exe`
- MCP pipe is a **separate server** with its own start/stop lifecycle
- Setting: `mcp.enabled` (boolean, default: false) — controls MCP pipe
- Location: `/src/main/pipe-server.ts` (launcher), new file for MCP pipe

### ScriptRunner Capabilities (what Claude gets access to)
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

### Console Capture Design
```typescript
// Before script execution, inject into context:
const consoleLogs: Array<{level: string, args: any[], timestamp: number}> = [];
const capturedConsole = {
    log: (...args) => { consoleLogs.push({level: "log", args, timestamp: Date.now()}); },
    error: (...args) => { consoleLogs.push({level: "error", args, timestamp: Date.now()}); },
    warn: (...args) => { consoleLogs.push({level: "warn", args, timestamp: Date.now()}); },
    info: (...args) => { consoleLogs.push({level: "info", args, timestamp: Date.now()}); },
};
// Return { result, consoleLogs } in JSON-RPC response
```

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
