[← Home](./index.md)

# Scripting

js-notepad lets you run JavaScript and TypeScript to transform and process content. TypeScript is fully supported — type annotations are stripped automatically before execution.

## Quick Start

1. Open a file with JavaScript or TypeScript code (or set the language accordingly)
2. Press `F5` to run
3. Output appears in a new grouped tab

## Running Scripts

### Run File Content
- Set file language to JavaScript or TypeScript
- Press `F5` to run the entire file (works with both `.js` and `.ts` files)
- Or select text and press `F5` to run selection

### Script Panel
- Open Script Panel from toolbar or context menu
- The Script Panel uses TypeScript by default — write plain JavaScript or add type annotations as you like
- Press `F5` in Script Panel to run

#### Script Selector & Save

The Script Panel toolbar includes a **script selector dropdown** and a **Save button** for managing reusable scripts:

- **Script selector** — lists saved scripts from your Script Library under `script-panel/{language}/` and `script-panel/all/` folders. Scripts from the "all" folder are shown with an "all/" prefix. Select a script to load its content into the editor, or choose "(unsaved script)" for ad-hoc editing.
- **Save button** — saves the current script to the library:
  - **Ad-hoc scripts:** Opens a dialog where you enter a filename and choose the target folder (current language folder or "all" for shared scripts)
  - **Library scripts:** Directly overwrites the file when content has been modified
  - Folders are created automatically if they don't exist
  - Overwrite confirmation is shown when saving an ad-hoc script with an existing filename
- **Ctrl+S** shortcut works when the Script Panel editor is focused

## The `page` Object

Scripts have access to [`page`](./api/page.md) representing the current file:

```javascript
// Read content
const text = page.content;

// Write content
page.content = "new content";

// Get/set language
console.log(page.language);  // "javascript"
page.language = "json";

// Get/set editor type
page.editor = "grid-json";  // Switch to grid view

// Custom data storage
page.data.myValue = 123;
```

## Grouped Pages (Output)

When a script runs, the result is displayed in a grouped (side-by-side) output page:

- **On success:** The return value is written to the output page
- **On error:** The error message with stack trace is displayed
- **No return value:** Shows "undefined"

```javascript
// Return value is written to grouped page
return { result: "data" };
```

You can configure the output page before returning:

```javascript
// Set language and editor type for the output
page.grouped.language = "json";
page.grouped.editor = "grid-json";
return result.recordset;
```

## Output Suppression

Sometimes you want full control over script output — for example, when writing to `page.grouped.content` directly or when using dialogs to display results. There are two ways to prevent the default output behavior:

### Writing to `page.grouped.content` directly

When you assign to `page.grouped.content`, the default output is automatically suppressed. The grouped page shows exactly what you wrote:

```javascript
// Default output is suppressed — grouped page shows your content
page.grouped.content = "Custom output";
page.grouped.language = "json";
```

### Using `preventOutput()`

Call the global `preventOutput()` function to explicitly suppress default output:

```javascript
// Show results in a dialog instead of the grouped page
const data = JSON.parse(page.content);
await app.ui.textDialog({
    title: "Results",
    text: JSON.stringify(data, null, 2),
    options: { language: "json" },
});
preventOutput();
```

### Error handling with suppressed output

When output is suppressed and a script error occurs, the error is shown in a text dialog instead of the grouped page. This keeps error details visible even when the grouped page is not used for output.

## The `ui` Object (Log View)

Scripts can use the global [`ui`](./api/ui-log.md) object for structured logging and inline dialogs. Instead of writing output to a grouped text page, `ui` opens a **Log View** — a scrollable list of typed log entries and interactive dialogs.

```javascript
ui.info("Starting import...");

const data = JSON.parse(page.content);
ui.log(`Found ${data.length} records`);

const result = await ui.dialog.confirm("Continue with import?");
if (result.button === "Yes") {
    // process data...
    ui.success("Import complete!");
} else {
    ui.warn("Import canceled");
}
```

Key points:
- **Lazy initialization** — the Log View page is created on the first `ui` access and auto-grouped with the source page
- **Suppresses default output** — accessing `ui` automatically prevents the return value from being written to a grouped page (same as `preventOutput()`)
- **Console forwarding** — when `ui` is active, `console.log/info/warn/error` are automatically forwarded to the Log View (`console.log` → lighter text, `console.info` → info, etc.). The native console is always called too. Suppress with `ui.preventConsoleLog()`, `ui.preventConsoleWarn()`, `ui.preventConsoleError()`.
- **Logging levels** — `ui.log()` (lighter text), `ui.text()` (normal text), `ui.info()`, `ui.warn()`, `ui.error()`, `ui.success()`
- **Fluent styled text** — logging methods return a builder for chaining: `ui.log("Status: ").append("OK").color("lime").bold().print()`
- **Styled text arrays** — pass an array of `{ text, styles }` segments for custom formatting
- **`styledText()` global** — build styled text for dialog labels: `styledText("Warning").color("red").bold().value`
- **Inline dialogs** — `ui.dialog.confirm()`, `ui.dialog.buttons()`, `ui.dialog.textInput()`, `ui.dialog.checkboxes()`, `ui.dialog.radioboxes()`, `ui.dialog.select()` appear directly in the Log View and return a `Promise` with the user's response
- **Progress bars** — `ui.show.progress()` adds a progress bar to the Log View and returns a `Progress` helper with `label`, `value`, `max`, and `completed` setters for real-time updates. Use `progress.completeWithPromise(promise)` to auto-complete on promise settlement.
- **Inline grids** — `ui.show.grid(data)` displays tabular data inline in the Log View using a full-featured grid with column resizing, reordering, and cell selection/copy. Pass an options object for custom columns and title: `ui.show.grid({ data, columns?, title? })`. The returned `Grid` helper has live `data`, `columns`, and `title` setters, plus `openInEditor()` to open the data in a dedicated Grid editor tab.

See the [ui API reference](./api/ui-log.md) for complete details.

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
page.grouped.editor = 'grid-json';
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
const https = require('https');

const data = await new Promise((resolve, reject) => {
  https.get('https://api.example.com/users', (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => resolve(JSON.parse(body)));
  }).on('error', reject);
});

return data;
```

## The `app` Object

Scripts also have access to [`app`](./api/app.md) — the root application object with settings, file system, dialogs, and more:

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

For the complete API with all methods and parameters, see the [Scripting API Reference](./api/index.md).

## AI Agent Integration (MCP)

The same `page` and `app` scripting API is available to external AI agents via the built-in MCP server. Agents can execute scripts, create pages, read content, and more — without any user interaction.

AI agents also have access to the **`ui_push`** MCP tool, which pushes log entries and interactive dialogs to a Log View page — the same Log View that scripts access via the `ui` global. This is the recommended output channel for agents to show status messages, results, and ask users questions. See the [ui API reference](./api/ui-log.md#mcp-ui_push-tool) for details.

See [MCP Server Setup](./mcp-setup.md) to connect Claude, ChatGPT, Gemini, or any MCP-compatible client.

## Script Library

You can designate a folder as your **Script Library** for quick access to frequently used scripts. The library appears as a dedicated entry in the sidebar — click it to browse and open scripts without navigating through custom folders.

### Setting Up

When you link a library folder for the first time (from the sidebar, Settings, or the Script Panel save button), a **Library Setup** dialog appears:

- **Folder path** — pick any folder to use as your library root
- **Copy example scripts** — enabled by default; copies a set of bundled example scripts into the folder so you can start immediately
  - `script-panel/all/` — general-purpose examples (example.ts, base64-encode.ts, base64-decode.ts)
  - `script-panel/plaintext/` — text-oriented scripts (sort-lines.ts, parse-jwt-token.ts)
  - `script-panel/json/` — JSON utilities (format-json.ts)
  - `utils/helpers.ts` — a shared helper module you can import with `require("library/utils/helpers")`

Existing files are never overwritten — only missing example files are copied.

You can also configure the library path later in **Settings → Script Library**. See [Tabs & Navigation](./tabs-and-navigation.md#script-library) for sidebar details.

### Importing Library Modules

Once a library folder is linked, scripts can import modules from it using `require("library/...")`:

```javascript
// Import a module from your library folder
const helpers = require("library/utils/helpers");
const db = require("library/db/connection");

const result = await db.query(page.content);
return helpers.formatTable(result);
```

**How it works:**
- `require("library/utils/helpers")` resolves to a file inside your linked library folder
- Extension auto-resolution: `.ts`, `.js`, `/index.ts`, `/index.js` are tried automatically — no need to specify the extension
- TypeScript files are transpiled automatically; `.js` files using ES module syntax (`export`/`import`) are also transpiled
- Relative requires within library modules work as expected (e.g., `require('./db-config')` inside a library file)
- The library require cache is invalidated between script runs when source files change, so edits take effect immediately
- If no library folder is linked, `require("library/...")` throws a clear error message

### IntelliSense for Library Modules

When a library folder is linked, Monaco provides full IntelliSense for `require("library/...")` calls:

- **Path completion** — typing `require("library/` auto-suggests folders and files from your library. Selecting a folder re-triggers suggestions so you can drill into subdirectories; files appear without extension (matching runtime auto-resolution)
- **Type information** — exported functions and variables from library `.ts` and `.js` files show parameter types, return types, and JSDoc documentation
- **Live updates** — when you edit a library file, IntelliSense reflects the changes immediately

The built-in `require()` and `preventOutput()` functions also appear in autocomplete with documentation.

This lets you build a reusable toolkit — database helpers, formatters, API clients — and use it from any script or the Script Panel.

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

> **Note:** `Buffer` is not available in the script sandbox. Use browser APIs instead — `btoa()` / `atob()` for Base64 encoding/decoding, and `TextEncoder` / `TextDecoder` for binary conversions.

## Output Types

| Return Type | Result |
|-------------|--------|
| String | Written as-is |
| Number/Boolean | Converted to string |
| Object/Array | JSON formatted |
| Error | Error message + stack |
| undefined | "undefined" |

## Tips

1. **Use async/await** for asynchronous operations
2. **Return values** to set output content, or write to `page.grouped.content` directly for full control
3. **Use `ui`** for structured logging and inline dialogs instead of grouped page output
4. **Use `preventOutput()`** when displaying results via dialogs instead of the grouped page
4. **Set language** on grouped page for syntax highlighting: `page.grouped.language = 'json'`
5. **Use grid view** for tabular data: `page.grouped.editor = 'grid-json'`
