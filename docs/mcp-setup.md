# MCP Server Setup

persephone includes a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that allows AI agents to control the application — execute scripts, create and read pages, and more.

## Quick Start

1. Open persephone Settings (`Ctrl+,` or Settings tab)
2. Find the **MCP Server** section and check **Enable MCP server**
3. The server starts automatically — a green status dot and the server URL appear below the toggle, and a small **MCP indicator** appears in the title bar showing the connection count. Click the indicator to open the **MCP Server Log** — a live log of all incoming requests with method names, durations, and expandable request/response JSON.
4. Click **Copy URL** to grab the server address, or **Copy Config** to get a ready-to-paste JSON snippet for your AI client
5. Paste the configuration into your AI client (see below)

> **Tip:** You can also change the port number in the Settings UI (disable MCP first, change the port, then re-enable). The default port is `7865`.

## AI Client Configuration

### Claude Code

Add to your `.mcp.json` (in project root or `~/.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "persephone": {
      "type": "http",
      "url": "http://localhost:7865/mcp"
    }
  }
}
```

### Claude Desktop

In Claude Desktop settings, add an MCP server:
- **Name:** persephone
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
| **list_windows** | List all windows (open and closed) with their status, page count, and page metadata. |
| **open_window** | Open or reopen a window by index. Closed windows are recreated with their persisted pages. |
| **execute_script** | Execute JavaScript or TypeScript with access to `page` and `app` objects. Accepts an optional `language` parameter (`"javascript"` or `"typescript"`; defaults to `"javascript"`). The most powerful tool — can do anything the scripting system supports. |
| **list_pages** | List all open pages (tabs) with IDs, titles, editors, metadata. |
| **get_page_content** | Get text content of a page by ID. |
| **get_active_page** | Get the active page with content and metadata. |
| **create_page** | Create a new page with optional content, language, and editor. Returns a clear error with specific hints for standalone editor types (browser, PDF, image, MCP Inspector, etc.) — use `open_url` or `execute_script` instead. |
| **set_page_content** | Update text content of a page by ID. |
| **open_url** | Open a URL in the [built-in browser](./browser.md). Accepts optional `profileName` (browser profile), `incognito` (boolean), and `tor` (boolean) parameters. Reuses an existing browser page if one is open, otherwise creates a new one. |
| **ui_push** | Push log entries, interactive dialogs, and output widgets to a Log View page — the recommended output channel for AI agents. Strings are shorthand for `log.info`. Dialog entries (`input.confirm`, `input.text`, `input.buttons`, `input.checkboxes`, `input.radioboxes`, `input.select`) block until the user responds. Output entries (`output.progress`, `output.grid`) support rich display — progress bars with upsert-by-id for real-time updates, and inline data grids from JSON or CSV strings. The Log View page is created automatically on first call and reused on subsequent calls. |
| **read_guide** | Read a documentation guide by name (`ui-push`, `pages`, `scripting`, `graph`, `notebook`, `todo`, `links`). Returns the guide content as text. An alternative to fetching `notepad://guides/*` resources — works with AI clients that don't support MCP resources. |
| **get_app_info** | Get app version, page count, and active page ID. |

### Browser Automation Tools

These tools control the built-in browser directly — no script needed. They operate on the active browser tab in the target window. Use `open_url` first to open a browser page if one is not already open.

| Tool | Description |
|------|-------------|
| **browser_navigate** | Navigate to a URL. Returns an accessibility snapshot of the loaded page. |
| **browser_snapshot** | Get the accessibility snapshot of the current page — a YAML-like tree of elements with roles, names, and `[ref=eN]` IDs. Preferred over screenshots for structured, deterministic inspection. |
| **browser_click** | Click an element. Accepts a CSS `selector`, an accessibility `ref` from a snapshot (e.g. `"e52"`), or a human-readable `element` description used as a CSS selector. Returns an updated snapshot. |
| **browser_type** | Type text into an input element. Clears existing value first. Returns an updated snapshot. Accepts `selector` or `ref`. Optional `slowly: true` to type character by character (triggers key handlers); optional `submit: true` to press Enter after typing. |
| **browser_select_option** | Select an option in a `<select>` element by value. Returns an updated snapshot. Accepts `selector` or `ref`. |
| **browser_press_key** | Press a keyboard key (e.g. `"Enter"`, `"Tab"`, `"Escape"`, `"ArrowDown"`). Returns an updated snapshot. |
| **browser_evaluate** | Run JavaScript in the page and return the result. Supports async expressions. |
| **browser_tabs** | List all open browser tabs. Returns an array of `{ id, url, title, loading, active }`. |
| **browser_navigate_back** | Navigate back in browser history. Returns an updated snapshot. |
| **browser_wait_for** | Wait for an element (`selector`) or text (`text`) to appear on the page. Returns a snapshot when found. Accepts optional `timeout` in ms (default 30000). |
| **browser_take_screenshot** | Take a screenshot of the current page. Returns a base64-encoded PNG image. |
| **browser_network_requests** | Get the network request log for the current tab. Returns an array of `{ url, method, statusCode, resourceType, requestHeaders, responseHeaders }`. |
| **browser_close** | Close the active browser tab. |

> **Tip:** `browser_snapshot` is the recommended way to inspect page state — it is faster and more deterministic than screenshots. After any click or type action, the tool automatically returns an updated snapshot so you can verify the result without a separate call.

### Multi-Window Support

All tools (except `list_windows`) accept an optional `windowIndex` parameter to target a specific window. If omitted, the first open window is used.

- Use `list_windows` to discover all windows and their status (`open` or `closed`)
- Closed windows have persisted pages but cannot be targeted directly — use `open_window` to reopen them first
- After reopening, target the window with any tool using its `windowIndex`

## Available Resources

MCP resources are read-only documents that AI clients can discover and read to gain context before using tools.

| Resource | URI | Description |
|----------|-----|-------------|
| **ui_push Guide** | `notepad://guides/ui-push` | Log View output channel — entry types, dialogs, examples. Read when showing output to the user. |
| **Pages Guide** | `notepad://guides/pages` | Pages & windows — page properties, editor types, creating pages, multi-window support. Read when working with tabs or documents. |
| **Scripting Guide** | `notepad://guides/scripting` | Full scripting API — `app` object, editor facades, TypeScript, Node.js access. Read when using `execute_script`. |
| **Graph Guide** | `notepad://guides/graph` | Graph editor data format and scripting API — node/link schema, `page.asGraph()` facade, query and traversal methods. Read when working with force-graph pages. |
| **Notebook Guide** | `notepad://guides/notebook` | Notebook editor JSON format — NoteItem structure, content types (text, markdown, code, mermaid, grid). Read before creating or editing notebook pages. |
| **Todo Guide** | `notepad://guides/todo` | Todo editor JSON format — TodoItem structure, lists, tags. Read before creating or editing todo pages. |
| **Links Guide** | `notepad://guides/links` | Links editor JSON format — LinkItem structure, categories, tags. Read before creating or editing links pages. |
| **Full Guide** | `notepad://guides/full` | All guides combined into one document. Only read if you need the complete reference. |

AI agents also receive **server instructions** on connection — a concise overview of persephone and its main workflows, with pointers to which guide to read for each task. This means agents have immediate context without reading any resource.

> **Tip:** All guides are also available via the `read_guide` tool — call `read_guide({ guide: "scripting" })` instead of fetching `notepad://guides/scripting`. This is useful for AI clients that don't support MCP resources.

> **Note:** Claude Code users working inside the persephone project already have full documentation context via CLAUDE.md, so they rarely need to fetch resources explicitly. Resources are most useful for standalone AI clients connecting without any project context.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mcp.enabled` | `false` | Enable/disable the MCP HTTP server |
| `mcp.port` | `7865` | Port number for the MCP server |

## Examples

### Read the active page

Ask your AI agent: *"Read the current page in persephone"*

The agent will use `get_active_page` to retrieve the content.

### Create a page with content

Ask: *"Create a new JavaScript page in persephone with a hello world script"*

The agent will use `create_page` with `language: "javascript"` and the content.

### Open a URL in the browser

Ask: *"Open the GitHub API docs in persephone"*

The agent will use `open_url` with the URL. You can also ask for a specific profile, incognito mode, or Tor mode: *"Open google.com in incognito"*, *"Open this page through Tor"*.

### Automate the browser

Ask: *"Search for 'persephone editor' on Google and show me the first result title"*

The agent will use the browser automation tools:

1. `open_url` — opens a browser page navigated to `https://google.com`
2. `browser_wait_for` — waits for the search box to appear
3. `browser_type` — types the query into the search box
4. `browser_press_key` — presses `Enter`
5. `browser_wait_for` — waits for results to load
6. `browser_snapshot` — reads the page structure to find the first result title

### Transform data

Ask: *"Parse the JSON in the active page and create a CSV version"*

The agent will use `execute_script` to read the active page content, transform it, and write the result to a grouped page.

### Show progress and ask questions

Ask: *"Analyze the JSON in the active page and ask me before making changes"*

The agent will use `ui_push` to log status messages and show an interactive confirmation dialog in the Log View:

```
ui_push({ entries: [
    "Analyzing JSON structure...",
    { type: "log.success", text: "Found 42 records" },
    { type: "input.confirm", message: "Apply formatting to all records?" }
] })
```

The tool blocks until you click a button. See the [ui API reference](./api/ui-log.md#mcp-ui_push-tool) for all entry types and dialog options.

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
- Make sure persephone is running with MCP enabled (green status dot visible in Settings, or look for the MCP indicator in the title bar)
- Verify the URL matches the one shown in Settings (use the **Copy URL** button to be sure)
- The server only accepts connections from localhost (127.0.0.1)

**Tool calls timing out?**
- The server has a 30-second timeout for script execution
- Long-running scripts may need to be broken into smaller steps
- `ui_push` calls with dialog entries have no timeout — they block until the user responds
