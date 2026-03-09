[← API Reference](./index.md)

# ui (Log View)

The `ui` global provides logging and interactive dialogs via a Log View page. It is **lazy-initialized**: the Log View page is created when the script first accesses `ui`, and is auto-grouped with the source page.

Accessing `ui` automatically suppresses default script output (same as calling `preventOutput()`).

```javascript
ui.log("Starting process...");
ui.info("Loaded 42 items");
ui.success("Done!");
```

## Logging Methods

All logging methods accept either a plain string or an array of styled segments (see [Styled Text](#styled-text) below).

### log(message)

Log a message (default level — no special styling).

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

Alias for `log()`.

### clear()

Remove all log entries from the Log View.

```javascript
ui.clear();
```

## Styled Text

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

## Dialogs

The `ui.dialog` namespace provides interactive dialogs that appear inline in the Log View. All dialog methods return a `Promise<IDialogResult>` where:

- `result.button` — the label of the clicked button, or `undefined` if the dialog was canceled (e.g., the Log View page was closed)

### dialog.confirm(message, buttons?)

Show a confirmation dialog. Default buttons: `["No", "Yes"]`.

```javascript
const result = await ui.dialog.confirm("Delete all items?");
if (result.button === "Yes") {
    deleteAll();
}

// Custom buttons
const result = await ui.dialog.confirm("Save changes?", ["Save", "Discard", "Cancel"]);
if (result.button === "Save") { save(); }
```

### dialog.buttons(buttons, title?)

Show a dialog with custom buttons. The title is optional and supports styled text.

```javascript
const result = await ui.dialog.buttons(
    ["Option A", "Option B", "Cancel"],
    "Choose an option"
);
if (result.button === "Option A") { /* ... */ }
```

### dialog.textInput(title?, options?)

Show a text input dialog. The entered text is available in `result.text`. Default buttons: `["OK"]`.

Options:
- `placeholder?: string` — placeholder text
- `defaultValue?: string` — initial value
- `buttons?: string[]` — button labels (prefix with `!` to require non-empty input)

```javascript
const result = await ui.dialog.textInput("Enter your name", {
    placeholder: "Name...",
    defaultValue: "World",
    buttons: ["!OK", "Cancel"],
});
if (result.button === "OK") {
    ui.log(`Hello, ${result.text}!`);
}
```

The `!` prefix on a button label (e.g., `"!OK"`) disables that button until the user has entered text. The prefix is not included in `result.button`.

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
