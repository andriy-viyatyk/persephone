---
title: "Boards — opening, running and managing"
audience: both
summary: "Open an existing board, run it in its own window, edit and reload, manage boards, the demo board, icon, error log and offline-first behaviour."
---

# Boards — opening, running and managing

## 2. Open an existing board

- **Boards panel** — click the **Boards** button in the Explorer header. All trusted boards under the current root are listed as a tree. Click any board name to open it in the current tab. Right-click a board for **Open in New Tab** — opens it in its own dedicated tab instead of replacing the current tab's content, so its iframe (and any dev-server process it spawned) keeps running while you work in other tabs. A board whose spawned processes are still running (via `persephone.setBoardBusy(true)` — see [Long-running processes](bridge-state.md#long-running-processes-setboardbusy--getboardbusy--getjobs)) shows a green **running** dot next to its name, even after its tab has moved on to something else.
- **File Explorer panel** — rows for `board-manifest.json` files show an **Open Board** button (board icon) directly in the row. Click it to open that board. (Clicking the row itself opens the JSON in Monaco.)
- **Tools & Editors panel → Editors tab** — lists all trusted boards, including file-associated boards, grouped by folder alongside built-in editors. Click a board to open it. In the full hub, assign trusted boards to categories so they appear in that category in the **+** menu. Only disabled bundled boards are excluded from categories. Click **Open in new tab** in the panel header for the full-page hub, with a **Search boards** tab for discovering and installing boards published by the project — see [Published boards catalog](published-boards.md#published-boards-catalog--discover-install-update) below.
- **Scripting / agent** — in a script call `app.boards.openBoard(boardRoot)`; an AI agent uses the `boards.openBoard` call path. Both take the absolute path to the board's root folder.

## Run a board in its own window

Create a Windows shortcut or Linux application launcher for the board, then open it to launch the
board in a dedicated Persephone window. To create one, right-click the board in the **Boards** panel,
the **Tools & Editors** Editors tree, or its open page tab and choose **Create shortcut…**. The Save dialog starts
in the board's folder on Windows and in the user applications folder on Linux; choose another
location such as **Desktop** if you want the launcher there.

You can also ask an AI agent connected to Persephone to create the shortcut or open the board in
its own window. The board must be trusted or bundled; ask the agent to trust an untrusted board
first.

The board stays open in that window as a locked tab at the left. When it is the only page, the tab
shows the board's name and icon without the usual active-tab highlight. The board tab cannot be
closed or dragged away. Pages the board opens appear in ordinary tabs beside it and can be closed
normally. Board windows do not have the **+** new-page button, and `Ctrl+N` does not create a page
there. The File Explorer button is also hidden from the locked board page's toolbar.

On Windows, a development shortcut prefers an installed Persephone launcher and hands off to the
running development instance when available. On Linux, a development launcher uses the current
checkout and Electron binary; a second launch hands off to the running instance for that profile.
Launching it by itself requires the development renderer server to be running.

Linux application launchers save a PNG icon under Persephone's user data. A launcher saved to Desktop
can require GNOME's **Allow Launching** action before it opens.

Bundled boards are opened from the **Built-in** folder in the Editors list. They do not
write to the board trust list. Their stable bundled identity also means an open page and its saved
state continue to refer to the same board when the application is installed in a different folder.

## 3. Edit and reload

Boards do **not** reload automatically when files change. To apply edits to `index.html`, `app.js`, or any `.js`/`.css`, choose **Reload board** from the in-board toolbar's **…** menu. AI agents editing board files should call `pages[pageId].editor.reload()` and then re-run `pages[pageId].editor.snapshot()` to see the updated board.

Settings declared in `board-manifest.json` appear as a Settings panel once the board is trusted or
bundled. The registry caches the manifest, so editing that file directly does not update the
Settings page live; toggle trust off and on or restart Persephone to refresh it.

## Managing boards

| Action | How |
|--------|-----|
| Create a board | **Boards** panel → **New board** (or caret → **Create Demo board**) |
| Create a board (script) | `await app.boards.createBoard("Name", "C:/path/to/dir")` |
| Open a board from Explorer | Click the **Open Board** button on a `board-manifest.json` row |
| Open a board from the Boards panel | Click the board in the **Boards** Explorer-sibling panel |
| Open a board in a new tab (keep it running) | Right-click the board in the **Boards** panel → **Open in New Tab** |
| Run a board in its own window | Right-click it in the **Boards** panel, **Tools & Editors** Editors tree, or its page tab → **Create shortcut…**, then open the saved shortcut |
| Keep a board's spawned processes running after navigating away or reloading | Board calls `persephone.setBoardBusy(true)` — see [Long-running processes](bridge-state.md#long-running-processes-setboardbusy--getboardbusy--getjobs) |
| See which boards have processes still running in the background | Look for the green **running** dot next to the board name in the **Boards** panel |
| Open a board from the sidebar | **Tools & Editors** panel → **Editors** tab → click the board |
| Open a board (script) | `await app.boards.openBoard("C:/path/to/board/root")` |
| Open File Explorer from inside a board | Click the **File Explorer** button (folder icon) in the in-board toolbar |
| Reload the board | In the in-board toolbar, open **…** → **Reload board** |
| View the error log | In the in-board toolbar, open **…** → **Open board log** |
| Add a trusted board to a category | In the full **Tools & Editors** hub, drag the board from the Editors tree into a category |
| Copy a board's folder path | Right-click the board in the **Boards** Explorer panel or the sidebar's **Editors** tree → **Copy board path**, or right-click an open board page tab → **Copy Board Path** |
| Open a board's folder as a workspace page | Right-click the board in the **Boards** Explorer panel or the sidebar's **Editors** tree → **Open board folder**, or right-click an open board page tab → **Open Board Folder**. The new page's File Explorer is rooted at the board folder. |
| Remove / untrust a locally-created board | Right-click the board in the Tools & Editors **Editors** tree → **Remove** |
| Delete a locally-created board | Right-click in the **Boards** Explorer panel → **Delete Board** |
| Rename a locally-created board | Rename the board's folder in the file system (Explorer, terminal, or the File Explorer sidebar), or ask an AI agent to rename it (`app.boards.renameBoard`) |
| Discover & install a board published by the project | Open a matching file and click **+** in the editor switch, or open the **Search boards** tab of the Tools & Editors hub — see [Published boards catalog](published-boards.md#published-boards-catalog--discover-install-update) |
| Update an installed catalog board | **Editors** tree → **Update** chip / context menu, or the dot on the board's **…** button |
| Roll back an installed catalog board to an older version | Board's **Properties** screen → **Versions** list → **Install** on the older version |
| Remove an installed catalog board (deletes its folder) | Board's **Properties** screen → **Uninstall** |

---

## Demo board

The Demo board (`"Create Demo board"`) is a full working example that demonstrates:

- Buffered `execute()` — fetching JSON from a backend script
- Streaming `execute()` — a long-running script with live output
- Stdin / kill — sending input and stopping a process
- The integration tier — `notify`, `openFileDialog`, `openRawLink`
- A declared `service.mjs` — lazy supervision, no-page requests, shared `persephone.storage`, and visible lifecycle status
- The `--p-*` theme contract and JS token access
- A multi-tab layout with a pinned output console

Read its `index.html`, `app.js`, and `style.css` for a rich authoring reference — they are extensively commented.

The Demo board is created in the folder and with the name you specify in the **Create Demo board** dialog. The source template lives at `resources/assets/demo-board/` inside the Persephone installation folder (or at `assets/demo-board/` in the repository).

## Board icon

Place an `icon.svg`, `icon.png`, or `icon.ico` in the board folder to set a custom icon. The icon appears in the page tab (when the board is open), the **Boards** Explorer panel, and the Editors tree in Tools & Editors. SVG is preferred; first match wins. Without an icon file, a default board glyph is shown.

If the board is also a [custom editor](custom-editors.md#custom-editors--associate-a-board-with-a-file-type) and wins as a file type's **default** editor, its icon replaces the generic file-type icon everywhere that file type is listed — the File Explorer tree, other file lists, and page tabs — not just when the board itself is open.

---

## Error log (`ui.log`)

Board errors — including script and load failures — are appended to `ui.log`. The log also records
`console.error` and `console.warn` from the board, service output, and warnings or errors sent
through `persephone.notify()`. Choose **Open board log** from the in-board toolbar's **…** menu
to review it. Ordinary boards keep the file in their board folder; bundled boards keep it at
`%APPDATA%\persephone\board-logs\<id>\ui.log` (or the corresponding named application profile folder).

Opening or reloading a board adds a `----- board loaded -----` separator, so earlier entries remain
available across reloads. The log is limited to 256 KiB; when it grows beyond that, older entries
are removed to make room. Keep `catch` blocks in your board JS calling
`persephone.notify(message, "error")` so failures are captured there.

---

## Offline-first and the CSP

A board's Content Security Policy (`connect-src 'self'`) blocks remote resources such as CDN scripts, stylesheets, fonts, and cross-host browser `fetch()`. For intentional remote HTTP requests, a trusted board can call `persephone.fetch(url, init)`, optionally with `{ tor: true }` or `{ proxy: "host:port" }`. This API sends only the headers you provide, is not subject to browser CORS, and returns a standard `Response`. **Download all component libraries into the board folder** and reference them with relative paths:

```html
<!-- Correct: relative path to a local copy -->
<script src="./lib/av-grid.umd.js"></script>

<!-- Wrong: blocked by CSP -->
<script src="https://cdn.jsdelivr.net/..."></script>
```

This keeps the board self-contained and offline-ready — it works with no network connection and is unaffected by CDN changes.

---
