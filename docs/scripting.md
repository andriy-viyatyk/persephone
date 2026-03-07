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

See [MCP Server Setup](./mcp-setup.md) to connect Claude, ChatGPT, Gemini, or any MCP-compatible client.

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
3. **Use `preventOutput()`** when displaying results via dialogs instead of the grouped page
4. **Set language** on grouped page for syntax highlighting: `page.grouped.language = 'json'`
5. **Use grid view** for tabular data: `page.grouped.editor = 'grid-json'`
