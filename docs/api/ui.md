[← API Reference](./index.md)

# app.ui

Dialogs and toast notifications.

```javascript
const answer = await app.ui.confirm("Save changes?");
if (answer === "Yes") { /* save */ }

app.ui.notify("Done!", "success");
```

## Methods

### confirm(message, options?) → `Promise<string | null>`

Show a confirmation dialog. Returns the clicked button label, or `null` if dismissed.

Options:
- `title?: string` — dialog title (default: `"Confirmation"`)
- `buttons?: string[]` — button labels (default: `["Yes", "Cancel"]`)

```javascript
// Simple yes/no
const answer = await app.ui.confirm("Delete this file?");
if (answer === "Yes") { /* delete */ }

// Custom buttons
const choice = await app.ui.confirm("Save changes?", {
    title: "Unsaved Changes",
    buttons: ["Save", "Discard", "Cancel"]
});
```

### input(message, options?) → `Promise<IInputResult | null>`

Show an input dialog. Returns `{ value, button }`, or `null` if dismissed.

Options:
- `title?: string` — dialog title (default: `"Input"`)
- `value?: string` — initial value (default: `""`)
- `buttons?: string[]` — button labels (default: `["OK", "Cancel"]`)
- `selectAll?: boolean` — select all text on open (default: `false`)

```javascript
const result = await app.ui.input("Enter file name:", {
    value: "untitled.txt",
    selectAll: true
});
if (result) {
    console.log(result.value);   // what user typed
    console.log(result.button);  // "OK"
}
```

### password(options?) → `Promise<string | null>`

Show a password dialog. Returns the entered password, or `null` if dismissed.

Options:
- `mode?: "encrypt" | "decrypt"` — `"encrypt"` shows a confirm field (default: `"decrypt"`)

```javascript
// Ask for password to decrypt
const password = await app.ui.password();

// Ask for new password (with confirmation)
const password = await app.ui.password({ mode: "encrypt" });
```

### notify(message, type?) → `Promise<string | undefined>`

Show a toast notification. Returns `"clicked"` if the user clicks it, or `undefined` if dismissed.

Type: `"info"` (default) · `"success"` · `"warning"` · `"error"`

```javascript
// Fire and forget
app.ui.notify("File saved", "success");
app.ui.notify("Something went wrong", "error");

// Wait for user interaction
const result = await app.ui.notify("Click to open log", "info");
if (result === "clicked") {
    await app.pages.openFile("C:/logs/app.log");
}
```
