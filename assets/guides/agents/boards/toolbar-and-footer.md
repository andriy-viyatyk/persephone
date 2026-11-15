---
title: "Boards — host-rendered toolbar, footer and .p-* classes"
audience: agent
summary: "Board toolbar controls, breadcrumbs, menus, placement, the host footer status bar, and the .p-* chrome classes for in-page toolbars and buttons."
---

# Boards — host-rendered toolbar, footer and .p-* classes

The Persephone File Explorer button opens a new Explorer at the board's declared working folder
(see [`persephone.setWorkingFolder()`](files-and-app-access.md)), then falls back to the claimed
folder, edited file's folder, and board folder. The declared folder must still exist when the button
is clicked. If an Explorer or sidebar model already exists, the button only toggles it and preserves
its root and state. The ordinary file toolbar keeps opening at the file's folder.

## Host-rendered board toolbar

A `breadcrumb` (bridge 1.49.0) is `{ id, type: "breadcrumb", rootLabel, value, separators?,
title?, disabled? }`. `rootLabel` and `value` are strings, including empty strings; `separators`
is a nonempty string of separator characters and defaults to `/`. `update()` can change those
fields together, including `separators`, but cannot change type or placement. Segments are trimmed
and empty segments dropped; ancestor values join the remaining segments with the first separator
character, without a trailing separator. Clicking an ancestor immediately updates the host value
and emits `{ id, type: "breadcrumb", value }`; the root emits `""`. The current item and disabled
breadcrumbs emit nothing. Disabled controls expose `aria-disabled` and suppress clicks.

Breadcrumbs appear after start buttons and menus, before normal controls. They share the flexible
space equally and clip their start when narrow. While any exist, the `setText()` slot is hidden but
its text and tooltip are retained and restored when the last breadcrumb is removed. Each control
is available through `BoardEditor.elements` while its trusted main frame is live. An older host
ignores the unknown descriptor with a warning and still renders other valid controls. A manifest
requiring `minBridgeVersion: "1.49.0"` is gated on older hosts; choose the manifest and feature
detection accordingly if fallback is needed.

```js
persephone.toolbar.set([{ id: "path", type: "breadcrumb", rootLabel: "Home", value: "a/b/c" }]);
persephone.toolbar.update([{ id: "path", value: "tag:child", separators: ":" }]);
persephone.toolbar.onAction((event) => {
  if (event.type === "breadcrumb") console.log(event.value); // "tag" or ""
});
```

Trusted and bundled boards can declare up to eight controls in the page toolbar. The board owns
the catalog and calls `set()` with the complete ordered list; `update()` patches known controls by
`id` without adding, removing, or reordering them. Invalid entries, duplicate ids, updates for
unknown ids, and controls beyond the cap are ignored and written to the board's `ui.log` as
warnings. Values are host-owned, so a board does not need to echo an action before calling
`update()`.

```js
persephone.toolbar.set([
  { id: "refresh", type: "button", title: "Refresh", icon: { name: "refresh" } },
  { id: "enabled", type: "toggle", label: "Enabled", value: true },
  { id: "view", type: "select", options: [
    { value: "all", label: "All" }, { value: "open", label: "Open" },
  ], value: "all" },
  { id: "query", type: "input", placeholder: "Filter", value: "" },
  { id: "scope", type: "segmented", value: "active", options: [
    { value: "active", label: "Active" }, { value: "all", label: "All", title: "Include closed items" },
  ] },
]);
persephone.toolbar.update([{ id: "enabled", value: false }]);
const off = persephone.toolbar.onAction(({ id, type, value }) => {
  // button: no value; toggle: boolean; menu/select/segmented/input/breadcrumb: string
});
```

The fixed types are `button`, `toggle`, `menu`, `select`, `segmented`, `input`, and `breadcrumb`. A button
action has `{ id, type: "button" }`; toggles send a boolean, menus send the selected item id,
selects and segmented controls send the selected option value, and inputs send the current string
after 500 ms of quiet time. An input shows a clear (×) button while it holds text; clicking it
sends `""` at once, without the delay (Persephone 1.38.0). Menu items are `{ id, label, disabled? }`; select options are
`{ value, label }`.

A `button` or `menu` takes an `icon`, a `label`, or both. With a `label` it is a text button —
the label is inside the clickable button, after the icon when there is one; without a label it is an
icon button (give it a `title` for the tooltip). Adding or removing a label through `update()`
rebuilds that control in place. Text buttons need bridge `1.35.0`; an older host shows the label as
plain text beside an icon button, so text-only buttons should set `minBridgeVersion: "1.35.0"`.

A `button` or `menu` with `placement: "start"` is drawn at the left of the toolbar, before the
`setText()` slot, instead of in the right-hand group — the place for a control that names what the
board has open (for example a text button showing the open file, which opens the board's own file
dialog). Like `board-menu`, the placement is fixed at `set()`. Needs bridge `1.38.0`; an older host
draws such a button in the right-hand group and ignores such a menu with a warning.

A `menu` with `placement: "board-menu"` draws no button: its items go at the top of Persephone's
own **…** menu, above Reload board, so a board needs no "More" button of its own. Picks arrive
through `onAction` as for any menu (`{ id, type: "menu", value: itemId }`), `update()` can change its
`items` (including each item's `disabled`) or disable it as a whole, and it counts toward the
eight-control cap. The placement is fixed at `set()`. It has no element of its own in
`BoardEditor.elements`; open **…** (`board-toolbar-more`) to reach the items. Needs bridge `1.35.0`;
an older host draws it as an ordinary menu button.

```js
persephone.toolbar.set([
  { id: "file", type: "menu", placement: "board-menu", items: [
    { id: "export", label: "Export JSON" }, { id: "delete", label: "Delete", disabled: true },
  ] },
]);
```

A `segmented` control is a row of joined buttons with one selected, like Persephone's editor
switch — the better fit when there are two to four short, always-visible choices. Its options are
`{ value, label?, icon?, title?, disabled? }`; each needs a `label`, an `icon`, or both (an
icon-only segment should carry a `title`). `update()` accepts `value`, `options`, and `disabled`.
The `segmented` type needs bridge `1.28.0` (`minBridgeVersion: "1.28.0"`); an older host ignores
the control with a warning and renders the rest. A control's stable
agent-facing address is `data-name="board-toolbar-control-${id}"` and it appears in
`BoardEditor.elements` while the main trusted frame and toolbar are mounted. These are host
controls, not iframe content, so use the generic host/window automation surface for them.

Icons use exactly one of `{ name }`, `{ svg, preserveColors? }`, or `{ file, preserveColors? }`.
Names come from Persephone's registered icon set. File paths are relative to the board root and
cannot be absolute, contain `..`, or escape that root. SVG sources are size-capped and rebuilt
with an explicit element/attribute allowlist through `DOMParser`; scripts, styles, foreign objects,
images, uses, event attributes, and external links are rejected, and ordinary inline SVG fills and
strokes are normalized to `currentColor`. `preserveColors: true` renders SVG through an image;
raster files also render through an image. This handling is rendering hygiene for trusted board
content, not a replacement for the existing trust gate.

The catalog exists only for the live trusted main frame. Reload, navigation away, frame disposal,
or loss of trust clears controls, dynamic element declarations, menus, and pending input timers;
the next frame must call `set()` again. Declaring from top-level script code is supported: the shim
queues host-frame request/reply calls and `set()`, `update()`, and `setText()` calls made before the
document's `load` event, then sends them in call order once it fires. The toolbar group is visually
separated from Persephone's
own **…** menu, which contains Reload board, Open board log, and Board properties; it does not add a
permission or trust surface.

## Host-rendered footer status bar

Boards with a footer can declare up to eight transient text items and buttons with
`persephone.statusBar.set(items)`. A later `set()` replaces the complete ordered catalog;
`update(id, patch)` changes one existing item and ignores unknown ids with a warning. Both types
accept `hidden`, including in patches, so an item can be hidden and shown without leaving the
catalog. Descriptors support `tone: "normal" | "muted" | "error" | "accent"`, optional `title`,
and `align: "end"`; end items follow the legacy `persephone.setStatusText()` label. Text items also
accept `variant: "plain" | "chip"` (bridge 1.42.0+): `chip` renders a compact bordered pill sized
to its text, which keeps several values distinct; `plain` (the default) is bare text that stretches
and truncates in the start group. Start items
stay in declaration order at the left. Long start text truncates with an ellipsis so it cannot push
the end group or native footer indicators away. Buttons also accept `disabled` and the toolbar icon
format (`{ name }`, `{ svg, preserveColors? }`, or `{ file, preserveColors? }`).

```js
persephone.statusBar.set([
  { id: "status", type: "text", text: "Resolving…", tone: "muted", title: "Current task" },
  { id: "model", type: "text", text: "opus", variant: "chip" },
  { id: "retry", type: "button", text: "Retry", tone: "accent" },
  { id: "network", type: "button", text: "SOCKS5", align: "end" },
]);
persephone.statusBar.update("status", { text: "Ready", tone: "normal" });
persephone.statusBar.update("retry", { hidden: true });
const off = persephone.statusBar.onAction(({ id }) => { if (id === "retry") retry(); });
// off() stops action delivery
```

Invalid descriptors, ids, duplicate ids, malformed patches, and entries over the eight-item cap
are ignored with warnings in the board log. Only visible, enabled buttons emit actions. Items and
their `data-name="board-status-bar-item-${id}"` declarations appear in `BoardEditor.elements` for
the trusted main frame, allowing host/window automation to address them. The catalog is transient:
reload, replacement, error, teardown, or loss of trust clears items and declarations. A new frame
must call `set()` again. Boards using this API declare `minBridgeVersion: "1.27.0"` in their
manifest; this API has no older-host fallback. `persephone.setStatusText()` remains an independent
legacy label and is not cleared by `statusBar.set()`.

## Toolbars and buttons — use the `.p-*` classes

`board-base.css` also carries an **opt-in chrome layer** with the app's exact control metrics.
Use it instead of hand-styling a toolbar:

```html
<div class="p-toolbar">
    <span class="p-toolbar-title">Dashboard</span>
    <span class="p-sep"></span>
    <button class="p-btn selected">Active</button>
    <button class="p-btn">All</button>
    <input class="p-input" placeholder="Search…" />
    <span class="p-spacer"></span>
    <button class="p-btn primary">Refresh</button>
</div>
```

`.p-toolbar` (30px, `--p-bg-dark`; `data-orientation="vertical"` for a rail) · `.p-btn` (26px, and
**24px automatically inside a toolbar**; `primary` / `ghost` / `danger` / `link` / `selected` /
`icon` / `sm` / `md` / `on-dark`) · `.p-input` / `.p-select` (same two sizes) · `.p-sep` ·
`.p-spacer` · `.p-toolbar-title`. Bare `<button>`/`<input>` are untouched, so vendored library
controls keep their own styling.

**Writing your own chrome instead? Keep these numbers** — they are the difference between a
compact board and a bloated one:

- **Toolbar 30px**, holding 24px controls (31px with the bottom rule). `padding: 8px 12px`
  gives **45px**.
- **A toolbar button is the small tier: `height: 24px; padding: 0 4px; font-size: 12px`.**
  Persephone's own editor toolbars use small buttons; a bar of 26px medium buttons looks fine
  alone and oversized under the app's chrome. 26px/`0 8px`/14px is the page-and-dialog size.
- **Toolbar on `--p-bg-dark`** — chrome is *darker* than the page. `--p-panel` is a content
  surface; using it is what makes a board's bar look pale next to the app.
- **Controls: fixed `height`, horizontal padding only.** Vertical padding on a button is the
  usual cause of an oversized bar.
- Radius 4px (the same radius on every button in a bar), 4px between controls, 6px inside one,
  icons 16px.
