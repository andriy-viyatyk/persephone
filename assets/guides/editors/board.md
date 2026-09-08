---
title: "Board"
audience: both
summary: "Sandboxed custom HTML applications and file editors backed by scripts and board manifests."
editorId: "board-view"
---

# Board

A Board is a custom HTML application hosted by Persephone and backed by scripts in a board folder.
Boards can be dashboards, viewers, tools, or custom editors associated with file masks.

## How to Open

Open a trusted board from the Explorer **Boards** panel, a `board-manifest.json` row, or the Boards
tab in **Tools & Editors**. Published boards can be installed from the catalog. A trusted board
declaring `fileMasks` can appear in the editor switch for matching files.

## Layout

```
+---------------------------------------------------------------------+
| [Explorer] [Path] [Reload] [Log] [Properties] [Switch]              |  Board toolbar: navigation and actions left, switch at right
+---------------------------------------------------------------------+
| [Board]                                  [Script panel]             |  board content and optional script panel
+---------------------------------------------------------------------+
| [Board status footer]                                               |  board status footer
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- File Explorer → `board-toolbar-explorer`
- Reload → `board-toolbar-reload`
- Show log → `board-toolbar-log`
- Properties → `board-toolbar-properties`
- Trust board → `board-trust`
- Editor switch and generic Page navigation → no entry: Board owns its toolbar and draws no generic shell switch
- Board webview controls → no entry: embedded board content

### When the board is untrusted

```
+---------------------------------------------------------------------+
| [Trust board]                                                       |  center of the untrusted board placeholder
+---------------------------------------------------------------------+
```

### When the board script panel is mounted

```
+---------------------------------------------------------------------+
| [Board]                                  [Script panel]             |  board webview with script panel mounted
+---------------------------------------------------------------------+
```

### When the board toolbar switch menu is open

```
+---------------------------------------------------------------------+
| [Board switch choices]                                              |  transient board toolbar switch menu
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Board toolbar switch menu — no entry: transient switch choices are not a static facade control.
- Board webview controls — no entry: embedded board content is addressed through the board frame automation surface.
- Generic Page navigation and Editor switch — no entry: Board uses its own toolbar and switcher.

## Board capabilities

Boards own their HTML, CSS, and JavaScript UI and can call backend scripts through the
`persephone.execute()` channel. Integration helpers cover notifications, file/folder dialogs, raw
links, and file access. The `--p-*` theme contract follows app theme changes. The board toolbar can
reload the board, show its log, and switch declared secondary views. Custom editors may either own
local file I/O or use a content host for Persephone-managed encoding, encryption, autosave, and
unsaved changes.

## Trust and safety

Installed or otherwise untrusted boards show the **Trust this board?** gate before rendering because
their scripts run with the user's privileges. Trust is remembered per folder and inherited by boards
inside a trusted folder. API-created boards from `app.boards.createBoard` and `createDemoBoard`
scaffold and auto-trust their board; the installed/published-board path still uses the user trust gate.

## Agent API

After narrowing `page.editor.id` to `board-view`, the `BoardEditor` facade exposes trust/render state,
manifest metadata, reload, status, declared secondary views, snapshots, clicks, typing, evaluation,
screenshots, network requests, and frame selection. Verified chrome elements include
`board-toolbar-explorer`, `board-toolbar-reload`, `board-toolbar-log`, `board-toolbar-properties`,
and `board-trust`. A trusted board that publishes `persephone.aiVision.expose(root)` also exposes
its optional named model at `page.editor.app`, with help, hints, state, methods, elements, and
highlighting in the owning frame. Board iframe content without that model is reached through
snapshots rather than the chrome inventory.

The app's `board-info` id is a separate screen-owned content-host exception: the page lifecycle can
accept it through `pages.addEditorPage` because its registration has `hasContentHost: true`. This does
not make `board-info` one of the 23 editor guide pages, and the old blanket claim that every app/tool
page is rejected is incorrect.

## Errors and limits

Untrusted content remains restricted until the user answers the trust prompt. A board can be trusted
but still fail to load because of its manifest, script, or iframe content; use its status and log for
diagnosis. See [Boards](../boards.md) for manifests and custom editors.
