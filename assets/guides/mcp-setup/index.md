---
title: "MCP Server Setup"
audience: "user"
summary: "How do users enable the MCP server, connect clients, and troubleshoot setup?"
---

# MCP Server Setup

For a browser video on a TV, use MCP `call` on `windows[0].window.moveToDisplay` with arguments
`["largest"]`, then `windows[0].pages["<page-id>"].editor.fullscreen` with `[]`. A video already
in fullscreen is restored after the window moves when `fullscreen` is omitted. Read
`windows[0].window.getDisplays` first with `[]` for current zero-based display indexes and DIP
geometry; largest/smallest use bounds area and other is relative to that window. Browser fullscreen
is separate from host fullscreen. Only the active visible browser tab is eligible; private pages
are refused unless opened by the agent. Iframe permission failures may require clicking the player's
fullscreen button through browser automation. `exitFullscreen` returns guest state and preserves
independent host fullscreen; `window.setFullScreen(false)` exits both.
persephone includes a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that allows AI agents to control the application — execute scripts, create and read pages, and more.

> **Two separate servers:** this page covers the **app-control** server (drive Persephone itself). The optional [Mneme knowledge base](../mneme.md) exposes its *own* MCP server on a different port for reading and maintaining a document store. They are configured independently and can both run at once.

> **Browser requests are refused:** both servers reject requests that include an `Origin` header, as browser-based MCP clients send from a web page. This protects the local servers from web-page and DNS-rebinding attacks. Desktop agents and Persephone's in-app MCP Inspector do not send a browser `Origin` header and are unaffected.

## Quick Start

1. Open persephone Settings (`Ctrl+,` or Settings tab)
2. Find the **MCP Server** section and check **Enable MCP server**
3. The server starts automatically — a green status dot and the server URL appear below the toggle, and a small **MCP indicator** appears in the title bar showing the connection count. Click the indicator to open the **MCP Server Log** — a live log of all incoming requests with method names, durations, and expandable request/response JSON.
4. Click **Copy URL** to grab the server address, or **Copy Config** to get a ready-to-paste JSON snippet for your AI client
5. Paste the configuration into your AI client (see below)

> **Tip:** You can also change the port number in the Settings UI (disable MCP first, change the port, then re-enable). The default port is `7865`, or `7965` in a named [application profile](../getting-started.md#separate-application-profiles). Copy the URL or configuration from that instance; the examples below use the usual default port.

## AI Client Configuration

### Claude Code

Add to your `.mcp.json` (in project root or `~/.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "persephone": {
      "type": "http",
      "url": "http://127.0.0.1:7865/mcp"
    }
  }
}
```

### Claude Desktop

In Claude Desktop settings, add an MCP server:
- **Name:** persephone
- **URL:** `http://127.0.0.1:7865/mcp`

### ChatGPT Desktop

In ChatGPT settings → MCP Servers → Add:
- **URL:** `http://127.0.0.1:7865/mcp`

### Gemini CLI

```bash
gemini --mcp-server http://127.0.0.1:7865/mcp
```


## Examples

### Read the active page

Ask your AI agent: *"Read the current page in persephone"*

The agent will use `page` to retrieve the content.

### Create a page with content

Ask: *"Create a new JavaScript page in persephone with a hello world script"*

The agent will use `pages.addEditorPage` with `language: "javascript"` and the content.

### Open a URL in the browser

Ask: *"Open the GitHub API docs in persephone"*

The agent will use `pages.openUrlInBrowserTab(url, options)`. You can also ask for a specific
profile, incognito mode, or Tor mode: *"Open google.com in incognito"*, *"Open this page through
Tor"*.

### Automate the browser in a specific profile

Ask: *"Go to my Outlook inbox in the work profile and tell me the subject of the first unread email"*

The agent will:

1. `settings.browserProfiles` — confirm that the `"work"` profile exists in `browserProfiles`
2. `pages` — find the browser page whose `profileName` is `"work"`; note its `url`
3. `pages.openUrlInBrowserTab("https://outlook.com", { profileName: "work" })` — navigate to Outlook if not already there
4. `pages[pageId].editor.snapshot()` — read the page structure
5. Extract and return the first unread subject from the snapshot

Because `profileName: "work"` is passed, every tool targets the page holding the work login session — regardless of which browser page happens to be active.

### Automate the browser

Ask: *"Search for 'persephone editor' on Google and show me the first result title"*

The agent will use the browser paths:

1. `pages.openUrlInBrowserTab("https://google.com")` — opens a browser page
2. `pages[pageId].editor.waitFor({ selector: "input" })` — waits for the search box
3. `pages[pageId].editor.type({ ref: "<search ref>" }, query)` — types the query
4. `pages[pageId].editor.pressKey("Enter")` — presses `Enter`
5. `pages[pageId].editor.waitFor({ text: "<result text>" })` — waits for results
6. `pages[pageId].editor.snapshot()` — reads the page structure to find the first result title

### Transform data

Ask: *"Parse the JSON in the active page and create a CSV version"*

The agent will use `script.execute` to read the active page content, transform it, and write the result to a grouped page.

### Show progress and ask questions

Ask: *"Analyze the JSON in the active page and ask me before making changes"*

The agent will use the `pages.logView.push` call path to log status messages and show an interactive confirmation dialog in the Log View:

```
pages.logView.push([
    "Analyzing JSON structure...",
    { type: "log.success", text: "Found 42 records" },
    { type: "input.confirm", message: "Apply formatting to all records?" }
])
```

The call returns immediately with dialog IDs; read `pages.logView.dialogResult(id)` to check when
the user has answered. See the [ui API reference](../scripting/api/ui-log-output-types.md#log-view-output-for-mcp-agents) for all entry
types and dialog options.

### Advanced scripting

The `script.execute` call path gives AI access to the full [Scripting API](../scripting/scripting-examples-and-app.md):

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
- Check that the configured MCP port is not in use by another application or profile
- Try changing the port: disable MCP, enter a different port number, then re-enable

**AI client can't connect?**
- Make sure persephone is running with MCP enabled (green status dot visible in Settings, or look for the MCP indicator in the title bar)
- Verify the URL matches the one shown in Settings (use the **Copy URL** button to be sure)
- The server only accepts connections from localhost (127.0.0.1)

**Tool calls timing out?**
- The server has a 30-second timeout for script execution
- Long-running scripts may need to be broken into smaller steps
- `pages.logView.push` calls with dialog entries return immediately; poll `dialogResult(id)` until the user responds

**Allow optional agent tips** in Settings → MCP Server / Mneme controls non-blocking suggestions to connected agents. It is enabled by default and takes effect immediately. For example, an agent may offer a site extension after completing repeated site automation.

## Read next

| What you need | Page (object-model path) |
|---|---|
| Available tools | [available-tools](available-tools.md) - `guides["mcp-setup"]["available-tools"]` |
| Available resources | [available-resources](available-resources.md) - `guides["mcp-setup"]["available-resources"]` |
