# IUserInterface — `app.ui`

**Status:** Implemented (Phase 3a)

Dialogs and notifications.

## Access

```javascript
app.ui
```

---

## Methods

### `confirm(message, options?)`

Show a confirmation dialog. Returns the clicked button label, or `null` if dismissed.

```javascript
const answer = await app.ui.confirm("Delete this item?");
if (answer === "Yes") { deleteItem(); }
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `message` | `string` | The message to display |
| `options` | `IConfirmOptions?` | Optional settings (see below) |

**IConfirmOptions:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | `string?` | `"Confirmation"` | Dialog title |
| `buttons` | `string[]?` | `["Yes", "Cancel"]` | Button labels |

**Returns:** `Promise<string | null>` — Button label that was clicked, or `null` if dismissed (Escape/close).

---

### `input(message, options?)`

Show a text input dialog. Returns the input result, or `null` if cancelled.

```javascript
const result = await app.ui.input("Enter file name:", { value: "untitled.txt", selectAll: true });
if (result) {
    console.log(result.value);  // The entered text
    console.log(result.button); // The button that was clicked
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `message` | `string` | The prompt message |
| `options` | `IInputOptions?` | Optional settings (see below) |

**IInputOptions:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | `string?` | `"Input"` | Dialog title |
| `value` | `string?` | `""` | Initial input value |
| `buttons` | `string[]?` | `["OK", "Cancel"]` | Button labels |
| `selectAll` | `boolean?` | `false` | Select all text on open |

**Returns:** `Promise<IInputResult | null>` — Result object or `null` if dismissed.

**IInputResult:**
| Field | Type | Description |
|-------|------|-------------|
| `value` | `string` | The value entered by the user |
| `button` | `string` | The button label that was clicked |

---

### `password(options?)`

Show a password dialog. Returns the entered password, or `null` if cancelled.

```javascript
const password = await app.ui.password({ mode: "encrypt" });
if (password) {
    const encrypted = await app.shell.encryption.encrypt(data, password);
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `options` | `IPasswordOptions?` | Optional settings (see below) |

**IPasswordOptions:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"encrypt" \| "decrypt"?` | `"decrypt"` | `"encrypt"` shows a confirm field, `"decrypt"` does not |

**Returns:** `Promise<string | null>` — Entered password, or `null` if dismissed.

---

### `notify(message, type?)`

Show a toast notification. Can be used fire-and-forget or awaited for interaction.

Resolves with `"clicked"` if the user clicks the notification, or `undefined` if dismissed/auto-closed.

```javascript
// Fire-and-forget
app.ui.notify("File saved", "success");
app.ui.notify("Something went wrong", "error");

// Await click
const result = await app.ui.notify("Click me!", "info");
if (result === "clicked") {
    console.log("User clicked the notification");
}
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `message` | `string` | — | The notification message |
| `type` | `NotificationType?` | `"info"` | Notification style |

**NotificationType:** `"info"` | `"success"` | `"warning"` | `"error"`

**Returns:** `Promise<string | undefined>` — `"clicked"` if the user clicked the notification body, `undefined` if dismissed or auto-closed.

**Auto-close behavior:**
| Type | Auto-closes after |
|------|-------------------|
| `"info"` | 5 seconds |
| `"warning"` | 5 seconds |
| `"success"` | 2 seconds |
| `"error"` | Never (must be manually closed) |

---

## Examples

### Ask before deleting

```javascript
const answer = await app.ui.confirm("Delete all selected items?", {
    title: "Confirm Delete",
    buttons: ["Delete", "Cancel"]
});
if (answer === "Delete") {
    // proceed with deletion
}
```

### Prompt for a name

```javascript
const result = await app.ui.input("Enter new file name:", {
    value: "untitled.txt",
    selectAll: true
});
if (result && result.button === "OK") {
    console.log("New name:", result.value);
}
```

### Encrypt content with a password

```javascript
const password = await app.ui.password({ mode: "encrypt" });
if (password) {
    const encrypted = await app.shell.encryption.encrypt(page.content, password);
    page.content = encrypted;
}
```

### Show different notification types

```javascript
app.ui.notify("Operation complete", "success");
app.ui.notify("Check your input", "warning");
app.ui.notify("Connection failed", "error");
```

---

## Implementation Notes

- Dialog methods use dynamic `import()` internally — dialog component code only loads when the dialog is actually shown. This preserves code splitting.
- `notify()` delegates to `alertsBarModel.addAlert()`. The alert model lives in `ui/dialogs/alerts/AlertsBar.tsx` (near its rendering component).
- All dialogs are modal — they block interaction with the rest of the app until dismissed.
- `null` return means the user dismissed the dialog without making a choice (Escape key, close button, or clicking outside).
