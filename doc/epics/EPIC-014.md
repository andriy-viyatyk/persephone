# EPIC-014: Claude Integration via Terminal Editor

## Status

**Status:** Active
**Created:** 2026-03-26

## Overview

Integrate Claude AI into Persephone by adding a terminal editor that can run the Claude CLI (`claude`). Users with a Claude Team/Pro subscription can start an interactive Claude Code session inside a Persephone tab — no separate API key needed. Claude auto-discovers Persephone's MCP server, enabling bidirectional integration: Claude reads/edits pages, runs scripts, and pushes output to the Log View, all within Persephone.

## Motivation

- Users with Team/Enterprise subscriptions have Claude Code CLI access but no API key — the Agent SDK approach (`@anthropic-ai/agent-sdk`) requires a separate "pay as you go" subscription
- Running `claude` CLI inside Persephone reuses the existing subscription
- A terminal editor is useful beyond Claude — `npm`, `git`, `python`, `ssh`, any CLI tool
- Claude Code auto-discovers `.mcp.json`, so it automatically connects to Persephone's MCP server when launched from the project directory

## Goals

- New **terminal editor** (`terminal-view`) that hosts a fully interactive pseudo-terminal
- Support running any CLI process (shell, Claude CLI, Node REPL, etc.)
- ANSI escape code rendering (colors, cursor movement, clear screen)
- Bidirectional I/O: user types in the terminal, output streams to the page
- Resizable terminal (cols/rows adapt to page dimensions)
- Optional: quick-launch command for Claude (`claude` with appropriate flags)

## Architecture

```
Terminal Editor (renderer)
├── xterm.js          ← Terminal renderer (ANSI, colors, cursor)
├── xterm-addon-fit   ← Auto-resize to container
└── IPC to main process
        │
Main Process
└── node-pty          ← Pseudo-terminal (spawns shell/claude/any CLI)
        │
Claude CLI (child process)
├── Interactive chat session
├── Auto-discovers .mcp.json
└── Calls Persephone MCP tools
        │
Persephone MCP Server
├── execute_script, create_page, ui_push
├── get_page_content, set_page_content
└── list_pages, open_url, ...
```

### Key Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| `node-pty` | PTY spawning in main process | Native module, needs electron-rebuild. Same lib VS Code uses |
| `xterm` | Terminal rendering in browser | ~200KB, mature, used by VS Code, Hyper, etc. |
| `xterm-addon-fit` | Auto-resize terminal to container | Official xterm addon |
| `xterm-addon-webgl` | GPU-accelerated rendering (optional) | Better performance for high-throughput output |

### Process Architecture

`node-pty` must run in the **main process** (native module, PTY requires OS-level process spawning). The renderer communicates via IPC:

```
Renderer (terminal-view)              Main Process (pty-host)
═══════════════════════              ══════════════════════════

1. IPC: pty:spawn { id, cmd, args, cwd, cols, rows }
                                     pty = require("node-pty").spawn(...)

2.                                   pty.onData(data) →
   ← IPC: pty:data { id, data }       forward to renderer
   xterm.write(data)

3. xterm.onData(input) →
   IPC: pty:input { id, data } →     pty.write(data)

4. xterm.onResize(cols, rows) →
   IPC: pty:resize { id, cols, rows } → pty.resize(cols, rows)

5. IPC: pty:kill { id } →            pty.kill()
   ← IPC: pty:exit { id, code }
```

### Editor Registration

- **Editor ID:** `terminal-view`
- **Category:** `page-editor` (like browser-view — not tied to file content)
- **No file association** — terminals are opened programmatically, not by opening files
- **Dynamic import** — loaded on demand like all editors

## Claude Integration Flow

When the user opens a terminal page and runs `claude`:

1. Terminal editor spawns a shell (bash/PowerShell) via PTY
2. User types `claude` (or uses a quick-launch button)
3. Claude Code starts, discovers `.mcp.json` in cwd
4. Claude connects to Persephone's MCP server
5. User chats with Claude in the terminal
6. Claude can: read pages (`get_page_content`), create pages (`create_page`), run scripts (`execute_script`), push to Log View (`ui_push`), etc.
7. All Claude output renders in the terminal with full ANSI formatting

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-XXX | PTY host in main process (node-pty + IPC) | Planned |
| US-XXX | Terminal editor — xterm.js integration | Planned |
| US-XXX | Terminal page creation via script API + menu | Planned |
| US-XXX | Terminal editor polish — themes, copy/paste, scrollback | Planned |
| US-XXX | Claude quick-launch integration | Planned |

*Tasks will be created and assigned IDs as work begins.*

## Open Questions

1. **Shell default:** Use user's default shell (PowerShell on Windows) or always bash? Probably configurable via `app.settings`.
2. **Multiple terminals:** Support multiple terminal pages simultaneously? Each with its own PTY. Likely yes — same as VS Code.
3. **Terminal persistence:** Should terminal sessions survive page close? Probably not for v1 — close page = kill PTY.
4. **Script API:** `app.terminal.spawn("claude", [...args])` or just `app.pages.addEditorPage("terminal-view")` with configuration? Need to design the facade.
5. **`node-pty` native rebuild:** Needs `electron-rebuild` for the correct Electron ABI. May need build script changes. Test with both dev and production builds.
6. **Claude CLAUDE.md context:** When `claude` runs from Persephone's terminal, it should pick up the project's `CLAUDE.md` if cwd is set correctly. Verify this works.

## Notes

### 2026-03-26 (initial)
- Epic created after discussion about integrating Claude into Persephone
- Rejected Agent SDK approach: requires separate API key, Team subscriptions don't provide one
- Chosen approach: terminal editor + Claude CLI — reuses existing subscription, no API key needed
- Terminal editor is a general-purpose feature (any CLI), Claude integration is a natural bonus
- Key insight: Claude Code auto-discovers Persephone's MCP server via `.mcp.json`, enabling full bidirectional integration without any custom bridge code
