# MCP Server Setup

js-notepad includes a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that allows AI agents to control the application — execute scripts, create and read pages, and more.

## Quick Start

1. Open js-notepad Settings (`Ctrl+,` or Settings tab)
2. Find the **MCP Server** section and check **Enable MCP server**
3. The server starts automatically — a green status dot and the server URL appear below the toggle
4. Click **Copy URL** to grab the server address, or **Copy Config** to get a ready-to-paste JSON snippet for your AI client
5. Paste the configuration into your AI client (see below)

> **Tip:** You can also change the port number in the Settings UI (disable MCP first, change the port, then re-enable). The default port is `7865`.

## AI Client Configuration

### Claude Code

Add to your `.mcp.json` (in project root or `~/.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "js-notepad": {
      "type": "http",
      "url": "http://localhost:7865/mcp"
    }
  }
}
```

### Claude Desktop

In Claude Desktop settings, add an MCP server:
- **Name:** js-notepad
- **URL:** `http://localhost:7865/mcp`

### ChatGPT Desktop

In ChatGPT settings → MCP Servers → Add:
- **URL:** `http://localhost:7865/mcp`

### Gemini CLI

```bash
gemini --mcp-server http://localhost:7865/mcp
```

## Available Tools

| Tool | Description |
|------|-------------|
| **execute_script** | Execute JavaScript with access to `page` and `app` objects. The most powerful tool — can do anything the scripting system supports. |
| **list_pages** | List all open pages (tabs) with IDs, titles, editors, metadata. |
| **get_page_content** | Get text content of a page by ID. |
| **get_active_page** | Get the active page with content and metadata. |
| **create_page** | Create a new page with optional content, language, and editor. |
| **set_page_content** | Update text content of a page by ID. |
| **get_app_info** | Get app version, page count, and active page ID. |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mcp.enabled` | `false` | Enable/disable the MCP HTTP server |
| `mcp.port` | `7865` | Port number for the MCP server |

## Examples

### Read the active page

Ask your AI agent: *"Read the current page in js-notepad"*

The agent will use `get_active_page` to retrieve the content.

### Create a page with content

Ask: *"Create a new JavaScript page in js-notepad with a hello world script"*

The agent will use `create_page` with `language: "javascript"` and the content.

### Transform data

Ask: *"Parse the JSON in the active page and create a CSV version"*

The agent will use `execute_script` to read the active page content, transform it, and write the result to a grouped page.

### Advanced scripting

The `execute_script` tool gives AI access to the full [Scripting API](scripting.md):

- **`page`** — Active page: content, language, editor, grouped output
- **`app.pages`** — All pages: create, open, close, navigate
- **`app.fs`** — File system: read, write, dialogs
- **`app.settings`** — Application settings
- **`app.ui`** — User interface: confirm, input, notifications
- **`app.shell`** — External URLs, encryption, version info

## Troubleshooting

**Server not starting?**
- Check that the **Enable MCP server** checkbox is checked in Settings → MCP Server
- Look at the status indicator — a red dot means the server failed to start (usually a port conflict)
- Check that port 7865 is not in use by another application
- Try changing the port: disable MCP, enter a different port number, then re-enable

**AI client can't connect?**
- Make sure js-notepad is running with MCP enabled (green status dot visible in Settings)
- Verify the URL matches the one shown in Settings (use the **Copy URL** button to be sure)
- The server only accepts connections from localhost (127.0.0.1)

**Tool calls timing out?**
- The server has a 30-second timeout for script execution
- Long-running scripts may need to be broken into smaller steps
