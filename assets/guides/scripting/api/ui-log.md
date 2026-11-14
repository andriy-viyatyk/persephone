---
title: "ui (Log View)"
audience: "user"
summary: "How do scripts write to Log View and show dialogs?"
---

# ui (Log View)

The `ui` global provides logging and interactive dialogs via a Log View page. It is **lazy-initialized**: the Log View page is created when the script first accesses `ui`, and is auto-grouped with the source page.

Accessing `ui` automatically suppresses default script output (same as calling `preventOutput()`).

```javascript
ui.log("Starting process...");
ui.info("Loaded 42 items");
ui.success("Done!");
```

## await ui()

Call `await ui()` to yield to the event loop, allowing the UI to update. Use this inside long-running loops to prevent the interface from freezing:

```javascript
for (const item of largeArray) {
    // ... heavy processing ...
    await ui(); // let the UI breathe
}
```

This does not create a Log View page or suppress default output — it simply pauses execution briefly so the UI can repaint and respond to user input.

## Logging Methods

All logging methods accept either a plain string or an array of styled segments (see [Styled Text](ui-log.md#styled-text) below). They return a `StyledLogBuilder` that can optionally be used to build styled text via fluent chaining (see [Fluent Styled Text](ui-log.md#fluent-styled-text) below).

### log(message)

Log a message with lighter text, suitable for secondary or supplementary output.

```javascript
ui.log("Plain message");
```

### info(message)

Log an informational message (highlighted).

```javascript
ui.info("Processing started");
```

### warn(message)

Log a warning message.

```javascript
ui.warn("File is larger than expected");
```

### error(message)

Log an error message.

```javascript
ui.error("Failed to connect");
```

### success(message)

Log a success message.

```javascript
ui.success("All tests passed");
```

### text(message)

Log a message with normal text color. Unlike `log()` which uses lighter text, `text()` renders at full contrast.

### clear()

Remove all log entries from the Log View.

```javascript
ui.clear();
```

## Console Forwarding

When a script accesses `ui`, all `console` output is automatically forwarded to the Log View:

| Console method | Log View level | Appearance |
|----------------|---------------|------------|
| `console.log()` | `log.log` | Lighter text (same as `ui.log()`) |
| `console.info()` | `log.info` | Highlighted |
| `console.warn()` | `log.warn` | Warning style |
| `console.error()` | `log.error` | Error style |

The native console is always called as well — forwarding adds a Log View entry on top.

To suppress forwarding for specific levels, call these methods on `ui`:

```javascript
ui.preventConsoleLog();   // suppress console.log → Log View
ui.preventConsoleWarn();  // suppress console.warn → Log View
ui.preventConsoleError(); // suppress console.error → Log View
```

Each method suppresses forwarding for its level only; the native console call is unaffected.

For **MCP scripts** that use `ui`, console output goes to both the MCP response (`consoleLogs`) and the shared MCP Log View.

## Styled Text

There are two ways to create styled text in Log View: the **array syntax** and the **fluent builder**.

### Array Syntax

Any logging method can accept an array of styled segments instead of a plain string. Each segment has a `text` property and an optional `styles` object with CSS properties:

```javascript
ui.log([
    { text: "Status: " },
    { text: "OK", styles: { color: "#4caf50", fontWeight: "bold" } },
]);

ui.log([
    { text: "Error code: ", styles: { color: "#888" } },
    { text: "404", styles: { color: "red", fontWeight: "bold" } },
]);
```

### Fluent Styled Text

All logging methods (`ui.log()`, `ui.info()`, `ui.warn()`, `ui.error()`, `ui.success()`, `ui.text()`) return a `StyledLogBuilder`. You can chain styling methods on it and call `.print()` to update the log entry with the styled result:

```javascript
ui.log("Status: ")
    .append("OK").color("lime").bold()
    .append(" — all checks passed")
    .print();

ui.error("Failed: ")
    .append("connection timeout").italic()
    .print();

ui.info("Build ")
    .append("SUCCESS").color("lime").bold().background("#1a3a1a")
    .print();
```

If you don't call `.print()`, the entry keeps the initial plain text — so existing code that ignores the return value works exactly as before.

#### Builder methods

| Method | Description |
|--------|-------------|
| `.append(text?)` | Append a new text segment |
| `.color(color)` | Set text color of the current segment |
| `.background(color)` | Set background color (with padding and border-radius) |
| `.border(color)` | Add a border around the current segment |
| `.fontSize(size)` | Set font size (`string` or `number`) |
| `.bold()` | Bold the current segment |
| `.italic()` | Italicize the current segment |
| `.underline()` | Underline the current segment |
| `.style(styles)` | Apply arbitrary CSS styles (`Record<string, string \| number>`) |
| `.print()` | Finalize and update the log entry |

## `styledText()` Global

The `styledText(text)` global function creates a standalone styled text builder for use in dialog labels and anywhere styled text is accepted. It returns a `StyledTextBuilder` (same methods as above, without `.print()`). Access the built value via `.value`:

```javascript
// Styled dialog label
const label = styledText("Warning").color("red").bold()
    .append(": this action is irreversible").value;
await ui.dialog.confirm(label);

// Styled dialog title
const title = styledText("Enter ").append("server name").bold().underline().value;
await ui.dialog.textInput(title);
```

## Dialogs

The `ui.dialog` namespace provides interactive dialogs that appear inline in the Log View. All dialog methods return a `Promise<IDialogResult>` where:

- `result.button` — the label of the clicked button, or `undefined` if the dialog was canceled (e.g., the Log View page was closed)

All dialog methods support two calling styles: a **simple form** with positional arguments and a **full form** with a single options object.

### dialog.confirm(message, buttons?)
### dialog.confirm(options)

Show a confirmation dialog. Default buttons: `["No", "Yes"]`.

```javascript
// Simple form — positional arguments
const result = await ui.dialog.confirm("Delete all items?");
if (result.button === "Yes") {
    deleteAll();
}

// Simple form — custom buttons
const result = await ui.dialog.confirm("Save changes?", ["Save", "Discard", "Cancel"]);
if (result.button === "Save") { save(); }

// Full form — single options object
const result = await ui.dialog.confirm({
    message: "Delete all items?",
    buttons: ["Yes", "No"],
});
```

### dialog.buttons(buttons, title?)
### dialog.buttons(options)

Show a dialog with custom buttons. The title is optional and supports styled text.

```javascript
// Simple form
const result = await ui.dialog.buttons(
    ["Option A", "Option B", "Cancel"],
    "Choose an option"
);
if (result.button === "Option A") { /* ... */ }

// Full form
const result = await ui.dialog.buttons({
    buttons: ["Option A", "Option B", "Cancel"],
    title: "Choose an option",
});
```

### dialog.textInput(title?, options?)
### dialog.textInput(options)

Show a text input dialog. The entered text is available in `result.text`. Default buttons: `["OK"]`.

Options:
- `title?: string` — dialog title (supports styled text)
- `placeholder?: string` — placeholder text
- `defaultValue?: string` — initial value
- `buttons?: string[]` — button labels (prefix with `!` to require non-empty input)

```javascript
// Simple form
const result = await ui.dialog.textInput("Enter your name", {
    placeholder: "Name...",
    defaultValue: "World",
    buttons: ["!OK", "Cancel"],
});
if (result.button === "OK") {
    ui.log(`Hello, ${result.text}!`);
}

// Full form — all options in one object
const result = await ui.dialog.textInput({
    title: "Enter your name",
    placeholder: "Name...",
    defaultValue: "World",
    buttons: ["!OK", "Cancel"],
});
```

The `!` prefix on a button label (e.g., `"!OK"`) disables that button until the user has entered text. The prefix is not included in `result.button`.

### dialog.checkboxes(items, title?, buttons?)
### dialog.checkboxes(options)

Show a checkboxes dialog. The updated checkbox state is available in `result.items`. Default buttons: `["OK"]`.

Items can be plain strings (treated as unchecked) or objects with `label` and optional `checked` properties.

Options:
- `items: (string | { label, checked? })[]` — checkbox items
- `title?: string` — dialog title (supports styled text)
- `layout?: "vertical" | "flex"` — layout mode (`"vertical"` = one item per row, `"flex"` = items wrap horizontally; default: `"vertical"`)
- `buttons?: string[]` — button labels (prefix with `!` to require at least one checked item)

```javascript
// Simple form — array of strings
const result = await ui.dialog.checkboxes(["Option A", "Option B", "Option C"]);
if (result.button === "OK") {
    const selected = result.items.filter(i => i.checked).map(i => i.label);
    ui.log(`Selected: ${selected.join(", ")}`);
}

// Simple form — with title and buttons
const result = await ui.dialog.checkboxes(
    ["Feature 1", "Feature 2", "Feature 3"],
    "Select features",
    ["!Apply", "Cancel"]
);

// Full form — pre-checked items, flex layout
const result = await ui.dialog.checkboxes({
    items: [
        { label: "Enable logging", checked: true },
        { label: "Verbose mode" },
        { label: "Dry run", checked: true },
    ],
    title: "Configuration",
    layout: "flex",
    buttons: ["!Apply", "Cancel"],
});
if (result.button === "Apply") {
    for (const item of result.items) {
        ui.log(`${item.label}: ${item.checked ? "on" : "off"}`);
    }
}
```

The `!` prefix on a button label (e.g., `"!Apply"`) disables that button until at least one checkbox is checked. The prefix is not included in `result.button`.

### dialog.radioboxes(items, title?, buttons?)
### dialog.radioboxes(options)

Show a radio buttons dialog for single-selection. The selected item label is available in `result.checked`. Default buttons: `["OK"]`.

Items are plain strings (unlike checkboxes, no object form).

Options:
- `items: string[]` — radio button items
- `title?: string` — dialog title (supports styled text)
- `checked?: string` — pre-selected item label
- `layout?: "vertical" | "flex"` — layout mode (`"vertical"` = one item per row, `"flex"` = items wrap horizontally; default: `"vertical"`)
- `buttons?: string[]` — button labels (prefix with `!` to require a selection)

```javascript
// Simple form — array of strings
const result = await ui.dialog.radioboxes(["Option A", "Option B", "Option C"]);
if (result.button === "OK") {
    ui.log(`Selected: ${result.checked}`);
}

// Simple form — with title and buttons
const result = await ui.dialog.radioboxes(
    ["Small", "Medium", "Large"],
    "Select size",
    ["!OK", "Cancel"]
);

// Full form — pre-selected item, flex layout
const result = await ui.dialog.radioboxes({
    items: ["Small", "Medium", "Large"],
    title: "Select size",
    checked: "Medium",
    layout: "flex",
    buttons: ["!Apply", "Cancel"],
});
if (result.button === "Apply") {
    ui.log(`Size: ${result.checked}`);
}
```

The `!` prefix on a button label (e.g., `"!Apply"`) disables that button until an item is selected. The prefix is not included in `result.button`.

### dialog.select(items, title?, buttons?)
### dialog.select(options)

Show a dropdown select dialog. The selected item label is available in `result.selected`. Default buttons: `["OK"]`.

The dropdown supports search/filter and keyboard navigation.

Options:
- `items: string[]` — selectable items
- `title?: string` — dialog title (supports styled text)
- `selected?: string` — pre-selected item label
- `placeholder?: string` — placeholder text when no item is selected
- `buttons?: string[]` — button labels (prefix with `!` to require a selection)

```javascript
// Simple form — array of strings
const result = await ui.dialog.select(["Option A", "Option B", "Option C"]);
if (result.button === "OK") {
    ui.log(`Selected: ${result.selected}`);
}

// Simple form — with title and buttons
const result = await ui.dialog.select(
    ["Small", "Medium", "Large"],
    "Select size",
    ["!OK", "Cancel"]
);

// Full form — pre-selected item with placeholder
const result = await ui.dialog.select({
    items: ["Small", "Medium", "Large"],
    title: "Select size",
    selected: "Medium",
    placeholder: "Choose a size...",
    buttons: ["!Apply", "Cancel"],
});
if (result.button === "Apply") {
    ui.log(`Size: ${result.selected}`);
}
```

The `!` prefix on a button label (e.g., `"!Apply"`) disables that button until an item is selected. The prefix is not included in `result.button`.


## Read next

| What you need | Page (object-model path) |
|---|---|
| Progress, output types and MCP entries | [ui-log-output-types](ui-log-output-types.md) - `guides.scripting.api["ui-log-output-types"]` |
