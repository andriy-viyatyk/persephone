---
title: "Scripting: Examples and app"
audience: "both"
summary: "How do scripts use examples, app APIs, agents, Node.js, and scripting tips?"
---

# Scripting: Examples and app

## Examples

### Transform JSON

```javascript
// Parse, filter, and format
const data = JSON.parse(page.content);
return data.filter(item => item.active);
```

### Process CSV Lines

```javascript
const lines = page.content.split('\n');
const filtered = lines.filter(line => line.includes('important'));
return filtered.join('\n');
```

### Convert JSON to CSV

```javascript
const data = JSON.parse(page.content);
const headers = Object.keys(data[0]);
const csv = [
  headers.join(','),
  ...data.map(row => headers.map(h => row[h]).join(','))
];
return csv.join('\n');
```

### Query Database

```javascript
const path = require('path');
const sql = require(path.join('D:\\packages\\node_modules', 'mssql'));

const config = {
  user: 'sa',
  password: '123',
  server: 'localhost',
  database: 'MyDB',
  options: { encrypt: false, trustServerCertificate: true }
};

await sql.connect(config);
const result = await sql.query(page.content);
await sql.close();

// Display as grid
page.grouped.language = 'json';
await page.grouped.editorSwitches.switchTo('grid-json');
return result.recordset;
```

### TypeScript Example

```typescript
interface User {
  name: string;
  email: string;
  active: boolean;
}

const users: User[] = JSON.parse(page.content);
const active: User[] = users.filter((u: User) => u.active);
return active.map((u: User) => `${u.name} <${u.email}>`).join('\n');
```

TypeScript type annotations are stripped before execution. You get the readability benefits of types without any extra setup.

### Fetch API Data

```javascript
// Simple GET — app.fetch uses Node.js with no automatic Chromium headers
const res = await app.fetch("https://api.example.com/users");
const data = await res.json();
return data;
```

```javascript
// POST with custom headers and body
const res = await app.fetch("https://api.example.com/users", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer my-token",
    },
    body: JSON.stringify({ name: "John" }),
});
return await res.json();
```

## The `app` Object

Scripts also have access to [`app`](api/app-capabilities-and-vars.md) — the root application object with settings, file system, dialogs, and more:

```javascript
// Show a confirmation dialog
const answer = await app.ui.confirm("Proceed?", { buttons: ["Yes", "No"] });
if (answer === "Yes") { /* ... */ }

// Show a notification
app.ui.notify("Done!", "success");

// Prompt for input
const result = await app.ui.input("Enter name:", { value: "default" });
if (result) { console.log(result.value); }

// Read/write files
const text = await app.fs.read("C:/data/file.txt");
await app.fs.write("C:/data/out.txt", text);

// Change settings
app.settings.set("theme", "monokai");

// Open URL in browser
await app.shell.openExternal("https://github.com");
```

### Resolve the live object model

`app.call()` lets a script address the same discoverable object-model paths used by the MCP `call`
tool. Script results are unbounded by default, so programmatic reads are not silently clipped at the
MCP tool's 20,000-character display limit. Pass `maxLength` explicitly when you want a bound. Use
`args` to invoke the final method or `value` to assign a writable property; these options are
mutually exclusive:

```javascript
const content = await app.call("page.content");
const rows = await app.call("page.editor.rowCount");
await app.call("page.grouped.content", {
    value: JSON.stringify({ rows }, null, 2),
});

// Find a setting and point at its row without changing it
await app.call("settings.highlight", { args: ["mcp.enabled"] });

// Use live IDs when working with shell surfaces
const folders = await app.call("window.menuBar.folders");
await app.call("window.menuBar.open", { args: [folders[0].id] });
const panels = await app.call("page.panels.items");
if (panels.length) await app.call("page.panels.expand", { args: [panels[0].id] });

// Inspect local boards and search registered Agent Tools
const boards = await app.call("boards.list");
const tools = await app.call("tools.search", { args: ["inbox", 5] });
```

The path is rooted in the current script's window, so `app.call()` does not resolve the
MCP-only `main.*` or `windows[i].*` paths. See the [app API reference](api/app.md#callpath-options)
for options and examples. For the equivalent API inside a trusted Board, see
[`persephone.call()`](../boards/bridge-integration.md#persephonecallpath-options).

`settings.highlight(key)` opens or activates the Settings page and highlights a supported row.
`window.menuBar.open(folderId)` requires a current folder ID from `window.menuBar.folders`, and
`page.panels.expand(panelId)` requires the bare ID from `page.panels.items`.

The object model also exposes board inventory and the Agent Tools registry. `boards.list()` is a
local, read-only inventory; `tools.search()` and `tools.execute()` operate on registered tools,
whose scripts run with your user privileges. Toolset creation still requires the registration
confirmation dialog. See [Boards](../boards/index.md), [Agent Tools](../agent-tools.md), and the [page API
reference](api/page-editor-facades.md#editor-facades) for the available board, toolset, and hub editor facades.

### Available services

| Property | Description |
|----------|-------------|
| `app.version` | Application version string |
| [`app.settings`](./api/settings.md) | Read/write application settings |
| [`app.editors`](./api/editors.md) | Read-only editor registry |
| [`app.recent`](./api/recent.md) | Recently opened files |
| [`app.fs`](./api/fs.md) | File system operations and dialogs |
| [`app.window`](./api/window.md) | Window management (minimize, maximize, zoom) |
| [`app.ui`](./api/ui.md) | Dialogs (confirm, input, password) and notifications |
| [`app.shell`](./api/shell.md) | OS integration (open URLs, encryption, version info) |
| [`app.pages`](./api/pages.md) | Open tabs management |
| [`app.downloads`](./api/downloads.md) | Download tracking |
| [`app.fetch()`](api/app.md#fetchurl-options) | HTTP client (Node.js, no automatic headers) |
| [`app.runAsync()`](api/app.md#runasyncfn-data-proxy) | Run a function in a background worker thread |
| [`app.call()`](api/app.md#callpath-options) | Resolve or update the live object model |

For the complete API with all methods and parameters, see the [Scripting API Reference](./api/index.md).

## AI Agent Integration (MCP)

The same `page` and `app` scripting API is available to external AI agents through the built-in MCP
server. Agents use the `script.execute` call path to run renderer code and the `call` surface to
create pages, read content, and use editor facades.

AI agents can use `pages.logView.push` to send log entries and interactive dialogs to the same Log
View that scripts access via the `ui` global. This is the recommended output channel for status,
results, and questions. See the [ui API reference](api/ui-log-output-types.md#log-view-output-for-mcp-agents) for details.

See [MCP Server Setup](../mcp-setup/index.md) to connect Claude, ChatGPT, Gemini, or any MCP-compatible client.


## Node.js Access

Scripts have full Node.js access:

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Read other files
const config = fs.readFileSync('config.json', 'utf8');

// Use npm packages (from your node_modules)
const _ = require(path.join('D:\\myproject\\node_modules', 'lodash'));
```

> **Tip:** For Base64 encoding/decoding, you can use either Node.js `Buffer` (`Buffer.from(str).toString('base64')`) or browser APIs (`btoa()` / `atob()`). For binary conversions, `TextEncoder` / `TextDecoder` are also available.


## Tips

1. **Use async/await** for asynchronous operations
2. **Return values** to set output content, or write to `page.grouped.content` directly for full control
3. **Use `ui`** for structured logging and inline dialogs instead of grouped page output
4. **Use `preventOutput()`** when displaying results via dialogs instead of the grouped page
5. **Set language** on grouped page for syntax highlighting: `page.grouped.language = 'json'`
6. **Use grid view** for tabular data: `await page.grouped.editorSwitches.switchTo('grid-json')`
