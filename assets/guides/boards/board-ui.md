---
title: "Boards — settings, toolbar, right-click menu and sidebar panel"
audience: both
summary: "Board settings, the in-board toolbar and tab mute button, the default right-click menu, and a board's own secondary-view sidebar panel."
---

# Boards — settings, toolbar, right-click menu and sidebar panel

## Board settings

A board can declare user-editable settings in its manifest. The declaration requires stable,
non-empty `name` and `author` fields, and each setting needs a unique `id`, a scalar `type`, and a
default value. Supported types are `string`, `number`, `boolean`, and `enum`; enum settings also
provide a non-empty `options` array. A string may use `format: "folderPath"` for a folder picker or
`format: "multiline"` for a multi-line Textarea. Multiline values save when the field loses focus.
Boards that rely on multiline settings must declare `minBridgeVersion: "1.42.0"` in their manifest.

```json
{
  "schemaVersion": 1,
  "minBridgeVersion": "1.42.0",
  "name": "Weather Board",
  "author": "Example",
  "settings": [
    {
      "id": "units",
      "type": "enum",
      "options": ["celsius", "fahrenheit"],
      "default": "celsius",
      "label": "Temperature units",
      "description": "How temperatures are displayed."
    },
    {
      "id": "data-folder",
      "type": "string",
      "format": "folderPath",
      "default": "",
      "label": "Data folder"
    },
    {
      "id": "notes",
      "type": "string",
      "format": "multiline",
      "default": "",
      "label": "Notes",
      "description": "Optional notes for this board."
    }
  ]
}
```

The settings appear in a board-named panel in **Settings**. A board that is also a custom editor
appears under **Editors**; a standalone board appears under **Boards**. Persephone stores explicit
values in the application profile's `data\board-settings.json` (normally `%APPDATA%\persephone\data\board-settings.json`), namespaced by the board's stable
`author`/`name` identity. Resetting a setting removes its stored value and restores the manifest
default.

Inside the board, bridge version **1.13.0** adds read-only settings access:

```js
const units = await persephone.settings.get("units");

const stopListening = persephone.settings.onChange(({ id, value }) => {
  if (id === "units") renderUnits(value);
});

// Call stopListening() when the board no longer needs notifications.
```

`get()` returns the stored value or the current manifest default when no value is stored.
`onChange()` reports effective values after a user edits or resets a setting in Persephone. The
board cannot write its setting values through the bridge; use the Settings panel for changes.

---

## In-board toolbar

Every open board displays a thin toolbar above the board's content area. The toolbar provides quick access to board operations without leaving the board view.

| Control | Description |
|---------|-------------|
| **File Explorer** (folder icon) | Open the File Explorer panel rooted at the board's parent folder. Hidden on the locked board page in a board window. |
| **Text slot** | Empty unless the open board fills it with `persephone.toolbar.setText()`. A non-interactive label; the board's own folder path is under **… → Board properties** and the tab's **Copy Board Path**. |
| **…** (Board actions) | Open **Reload board**, **Open board log**, and **Board properties**. A board can add its own actions at the top of this menu. An update-available dot appears here when a newer catalog version is ready. |
| **Board controls** | Controls the open board declared for itself — buttons, toggles, menus, dropdowns, segmented choice buttons and text boxes — shown between the label and Persephone's own buttons, and separated from them. They belong to the board, so they change with it and clear when it reloads, its grants change, or it loses trust; the frame can declare them again after it starts. |

Trusted and bundled boards can declare these controls with `persephone.toolbar.set()` and handle
their picks with `persephone.toolbar.onAction()`. A `segmented` control shows joined choice buttons
with one value selected; use it for a few short, always-visible options. Each option needs a label,
an icon, or both. Buttons and menus work the same way: give one a `label` for a text button, an
`icon` for an icon button, or both. A menu with `placement: "board-menu"` adds its items to the top
of the **…** menu instead of showing a button of its own:

```js
persephone.toolbar.set([
  { id: "save", type: "button", label: "Save" },
  { id: "refresh", type: "button", title: "Refresh", icon: { name: "refresh" } },
  { id: "more", type: "menu", placement: "board-menu", items: [{ id: "export", label: "Export JSON" }] },
  { id: "scope", type: "segmented", value: "active", options: [
    { value: "active", label: "Active" },
    { value: "all", label: "All" },
  ] },
]);
persephone.toolbar.onAction(({ id, type, value }) => {
  if (id === "save") save();
  if (id === "scope" && type === "segmented") showScope(value);
});
```

Text inputs include a clear button while they have a value; clicking it clears the field and
immediately sends an empty string to the board.

The `segmented` type requires board bridge `1.28.0`; set `minBridgeVersion: "1.28.0"` in the
board manifest when using it. See the [board authoring reference](../agents/boards/toolbar-and-footer.md#host-rendered-board-toolbar)
for all control types and option details.

## Page tab mute button

A board that plays audio can show a mute button on its page tab. Report the current mute state with
`persephone.page.setMuted(muted)`; pass `null` to remove the button. When the user clicks the tab
button, `persephone.page.onMuteToggle(callback)` runs the callback. The board remains responsible
for changing its audio and reporting the resulting state, including changes made through its own
controls. Removing trust or changing the board's grants clears the button until the main frame
reports its mute state again:

```js
persephone.page.setMuted(audio.muted);
persephone.page.onMuteToggle(() => { audio.muted = !audio.muted; });
audio.addEventListener("volumechange", () => persephone.page.setMuted(audio.muted));
```

These methods require board bridge `1.38.0` and work in the main board view.

---

## Default right-click menu

Right-clicking inside a board's content works exactly like right-clicking anywhere else in Persephone, with no setup needed from the board author:

| Right-click target | Menu items |
|---------------------|------------|
| A link | **Open Link**, **Copy Link** |
| An image | **Open Image in New Tab**, **Copy Image**, **Save Image As…** |
| A text field, text area, or editable region | **Cut** / **Copy** / **Paste**, depending on whether there's a selection and whether the field is read-only |
| Selected text (not in an editable field) | **Copy** |

**Open Image in New Tab** opens the image in Persephone's Image Viewer as its own tab, the same way opening an image file normally does. **Save Image As…** shows the native Save dialog and writes the file to disk.

If a right-click doesn't match any of the above (for example, empty space with nothing selected), no menu appears — the board's own page just gets a normal right-click with nothing added.

A board that wants to draw its own custom right-click menu instead can call `event.preventDefault()` in its own `contextmenu` handler; Persephone's default menu only appears when the event reaches it unhandled.

---

## Secondary views — a board's own sidebar panel

A board isn't limited to the single main view in its tab. It can declare one or more **secondary views** — extra pages that show up as sidebar panels next to the board, kept in sync with the main view automatically. This is how an editor-style board offers a companion panel such as "Lists", "Outline", or "Details" alongside its main content.

- Secondary views are declared by the board itself (in its `board-manifest.json`, or added/removed while it runs) — there's nothing to configure as a user.
- Each declared view opens as its own sidebar panel while the board's tab is active, with the title the board gave it (its icon always matches the board's own icon).
- The main view and every secondary panel share state, so selecting something in a sidebar panel (e.g. picking a list) can instantly filter or update what the main view shows, and vice versa.
- Some of what a board puts in that shared state is remembered across app restarts and board reloads (a per-board author choice), so a selection you made can still be there next time you open the board.
- Closing the board's tab, or navigating it to something else, closes its secondary panels along with it — they aren't a way to keep the board running in the background (see [Long-running processes](bridge-state.md#long-running-processes-setboardbusy--getboardbusy--getjobs) for that).
- Closing one secondary panel leaves the main frame's toolbar and status items in place.

> **Building a board with secondary views?** See the board's own `CLAUDE.md` (or `persephone://guides/boards` for an AI agent) for the full `persephone.state.*` and `persephone.setSecondaryViews` reference. The bundled **Demo board** includes a working example.

---
