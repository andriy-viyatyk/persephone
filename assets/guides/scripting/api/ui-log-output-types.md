---
title: "ui: Progress and Output Types"
audience: user
summary: "How do scripts show progress, grids, text, Markdown, diagrams, and MCP output?"
---

# ui: Progress and Output Types

## Progress Bars

The `ui.show` namespace provides rich output display methods for the Log View, including progress bars and inline data grids.

### show.progress(label?)
### show.progress(options)

Show a progress bar in the Log View. Returns a `Progress` helper whose property setters update the bar in real-time.

```javascript
// Simple form — just a label
const progress = ui.show.progress("Downloading...");
progress.max = 100;
for (let i = 0; i <= 100; i += 10) {
    await delay(200);
    progress.value = i;
}
progress.completed = true;
progress.label = "Done!";
```

```javascript
// Full form — initial values
const progress = ui.show.progress({
    label: "Processing files",
    value: 0,
    max: 50,
});
```

#### Progress properties

| Property | Type | Description |
|----------|------|-------------|
| `label` | `string \| IStyledSegment[]` | Progress label (supports styled text). Setting updates the displayed progress overlay in real time. |
| `value` | `number \| undefined` | Current progress value |
| `max` | `number \| undefined` | Maximum value (default: 100) |
| `completed` | `boolean \| undefined` | When `true`, shows the bar as fully completed |

#### completeWithPromise(promise, completeLabel?)

Mark the progress bar as completed when a promise settles. Optionally update the label on completion.

```javascript
const progress = ui.show.progress("Loading data...");
progress.completeWithPromise(
    fetchData(),
    styledText("Loaded!").color("green").value
);
```

## Grid Output

### show.grid(data)
### show.grid(options)

Show an inline data grid in the Log View. Returns a `Grid` helper whose property setters update the grid in real-time.

The grid supports column resizing, column reordering, and cell selection with copy-to-clipboard. A hover toolbar shows an "Open in Grid editor" button.

```javascript
// Simple form — array of objects
const grid = ui.show.grid([
    { name: "Alice", age: 30, city: "NYC" },
    { name: "Bob", age: 25, city: "LA" },
]);
```

```javascript
// Full form — with columns and title
const grid = ui.show.grid({
    data: users,
    columns: ["name", "age"],
    title: "User List",
});
```

```javascript
// Column objects with custom widths and data types
const grid = ui.show.grid({
    data: records,
    columns: [
        { key: "name", title: "Full Name", width: 200 },
        { key: "age", dataType: "number" },
        { key: "active", dataType: "boolean" },
    ],
    title: styledText("Results").bold().value,
});
```

#### Grid properties

| Property | Type | Description |
|----------|------|-------------|
| `data` | `any[]` | Grid data (array of objects). Setting updates the displayed grid in real time. |
| `columns` | `(string \| IGridColumn)[] \| undefined` | Column definitions — strings (key names) or column objects. Setting updates the displayed grid columns in real time. |
| `title` | `string \| IStyledSegment[] \| undefined` | Grid title (supports styled text). Setting updates the displayed grid title in real time. |

#### IGridColumn

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Property key to access from row objects |
| `title` | `string \| undefined` | Display name in header (defaults to key) |
| `width` | `number \| undefined` | Column width in pixels |
| `dataType` | `"string" \| "number" \| "boolean" \| undefined` | Data type for sorting/alignment |

#### openInEditor(pageTitle?)

Open the grid data in a dedicated Grid editor tab for full sorting, filtering, and editing capabilities.

```javascript
const grid = ui.show.grid(data);
// Later — open in a full Grid editor
grid.openInEditor("My Data");
```

## Text Output

### show.text(text, language?)
### show.text(options)

Show a syntax-highlighted text block in the Log View using an embedded read-only Monaco editor. Returns a `Text` helper whose property setters update the entry in real-time.

```javascript
// Simple form — text and language
const txt = ui.show.text("SELECT * FROM users WHERE active = 1;", "sql");
```

```javascript
// Full form — with title and options
const txt = ui.show.text({
    text: jsonData,
    language: "json",
    title: "API Response",
    wordWrap: false,
    lineNumbers: true,
});
```

#### Text properties

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | The text content. Setting updates the displayed text in real time. |
| `language` | `string \| undefined` | Language for syntax highlighting (default: `"plaintext"`). Setting updates syntax highlighting in real time. |
| `title` | `string \| IStyledSegment[] \| undefined` | Title displayed above the text (supports styled text). Setting updates the displayed text title in real time. |
| `wordWrap` | `boolean \| undefined` | Enable word wrap (default: `true`). Setting updates line wrapping in real time. |
| `lineNumbers` | `boolean \| undefined` | Show line numbers (default: `false`). Setting updates the line-number display in real time. |
| `minimap` | `boolean \| undefined` | Show minimap (default: `false`). Setting updates the minimap display in real time. |

#### openInEditor(pageTitle?)

Open the text in a new Monaco editor tab.

```javascript
const txt = ui.show.text(sourceCode, "typescript");
// Later — open in a full editor tab
txt.openInEditor("Source Code");
```

## Markdown Output

### show.markdown(text)
### show.markdown(options)

Show rendered markdown inline in the Log View. Supports headings, tables, code blocks, Mermaid diagrams, task lists, and blockquotes. Returns a `Markdown` helper whose property setters update the entry in real-time.

A hover toolbar shows an "Open in Markdown editor" button.

```javascript
// Simple form — markdown string
ui.show.markdown("# Hello\nSome **bold** text and a [link](https://example.com)");
```

```javascript
// Full form — with title
const md = ui.show.markdown({
    text: "## Report\n\n| Name | Score |\n|------|-------|\n| Alice | 95 |",
    title: "Analysis Results",
});
```

```javascript
// Table with Mermaid diagram
ui.show.markdown(`
## Architecture

\`\`\`mermaid
graph LR
    A[Client] --> B[Server]
    B --> C[Database]
\`\`\`

### Task List

- [x] Design API
- [ ] Implement endpoints
- [ ] Write tests
`);
```

#### Markdown properties

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | Markdown text content. Setting updates the rendered Markdown in real time. |
| `title` | `string \| IStyledSegment[] \| undefined` | Title displayed above the markdown (supports styled text). Setting updates the displayed Markdown title in real time. |

#### openInEditor(pageTitle?)

Open the markdown in a dedicated Markdown editor tab.

```javascript
const md = ui.show.markdown("# My Document\nContent here...");
// Later — open in a full Markdown editor tab
md.openInEditor("My Document");
```

## Mermaid Output

### show.mermaid(text)
### show.mermaid(options)

Show a rendered Mermaid diagram inline in the Log View. The diagram is theme-aware — it automatically adapts to the current light/dark theme. Returns a `Mermaid` helper whose property setters update the entry in real-time.

A hover toolbar shows "Copy image to clipboard" and "Open in Mermaid editor" buttons.

```javascript
// Simple form — mermaid text
ui.show.mermaid("graph TD\n    A[Start] --> B[Process]\n    B --> C[End]");
```

```javascript
// Full form — with title
const diagram = ui.show.mermaid({
    text: "sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi!",
    title: "Communication Flow",
});
```

#### Mermaid properties

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | Mermaid diagram text. Setting updates the rendered Mermaid diagram in real time. |
| `title` | `string \| IStyledSegment[] \| undefined` | Title displayed above the diagram (supports styled text). Setting updates the displayed diagram title in real time. |

#### openInEditor(pageTitle?)

Open the diagram in a dedicated Mermaid editor tab.

```javascript
const diagram = ui.show.mermaid("graph LR\n    A --> B --> C");
// Later — open in a full Mermaid editor tab
diagram.openInEditor("My Diagram");
```

## Log View output for MCP agents

The same Log View is available to external AI agents through the `pages.logView` call path. While
scripts use the `ui` global, agents use `pages.logView.push(entries)` to show status, results,
rich output, and questions.

### How it works

- The first push creates a Log View page; later pushes reuse it and append entries.
- `push()` returns immediately with `entryIds` and `dialogIds`.
- Read `pages.logView.dialogResult(id)` to check a dialog: it reports `unresolved` until the
  user responds, then `resolved` with the result. The live app window may be driven through
  `window.screen.snapshot()` and `window.screen.click(...)` when an answer is needed.
- If the page is closed, the next push creates a fresh Log View page.

### Entry format

The `entries` argument may be one string, one flat entry object, or an array of either. A string is
treated as one `log.info` entry. Each object has `type` and type-specific fields directly on the
object.

**Log entry types:** `log.text`, `log.info`, `log.warn`, `log.error`, `log.success` use a
`text` field.

**Dialog entry types:** `input.confirm`, `input.text`, `input.buttons`,
`input.checkboxes`, `input.radioboxes`, and `input.select` use fields such as `message`,
`title`, `buttons`, `placeholder`, `defaultValue`, `items`, `checked`, `selected`,
and `layout`.

**Output entry types:** `output.progress` supports `label`, `value`, `max` (default 100), and
`completed`; reuse its `id` to update a progress bar. `output.grid` supports JSON or CSV
`content`, optional `contentType`, and `title`. `output.text`, `output.markdown`, and
`output.mermaid` support `text` and their corresponding display options.

### Example

```javascript
const { dialogIds } = await app.call("pages.logView.push", {
    args: [[
        { type: "log.success", text: "Analysis complete" },
        { type: "output.grid", content: "name,score\nAlice,95", contentType: "csv" },
        { type: "output.progress", id: "work", value: 100, completed: true },
        { type: "input.confirm", message: "Clear the temporary report?", buttons: ["No", "Yes"] },
    ]],
});
const answer = await app.call("pages.logView.dialogResult", { args: [dialogIds[0]] });
```

For a single message, the shorter scalar forms are also valid:

```javascript
await app.call("pages.logView.push", { args: ["Analysis complete"] });
await app.call("pages.logView.push", { args: [{ type: "log.success", text: "Done" }] });
```

See the [MCP Server Setup](../../mcp-setup/available-tools.md#available-tools) and the [scripting API](app.md#callpath-options)
for the complete call-path contract.

## Example: Interactive Script

```javascript
ui.info("Welcome to the data processor");

const result = await ui.dialog.confirm("Process the current page content?");
if (result.button !== "Yes") {
    ui.warn("Canceled by user");
    return;
}

const data = JSON.parse(page.content);
ui.log(`Found ${data.length} records`);

for (const item of data) {
    if (item.error) {
        ui.error(`Record ${item.id}: ${item.error}`);
    } else {
        ui.success(`Record ${item.id}: OK`);
    }
}

ui.success("Processing complete!");
```
