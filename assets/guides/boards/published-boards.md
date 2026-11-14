---
title: "Boards — published catalog, recommended components and AI authoring"
audience: both
summary: "Discover, install, update and roll back published boards, recommended components, and AI-assisted board authoring."
---

# Boards — published catalog, recommended components and AI authoring

## Published boards catalog — discover, install, update

Persephone maintains a small **catalog of boards published by the project** — ready-made custom editors and tools you can install without building them yourself. The flagship example is the **PDF Viewer** board — it replaced Persephone's former built-in PDF viewer (see [Editors — PDF Viewer](published-boards.md#published-boards-catalog--discover-install-update)), so PDF viewing is now a ~3.5 MB opt-in download instead of ~21 MB of pdf.js shipped to every installation. Other examples include a `.drawio` diagram viewer. The catalog is refreshed automatically in the background (roughly once a day) and can also be refreshed on demand.

### Discovering a board

- **From a file** — open a file whose type has no editor installed yet, but that matches a published board's file type. The editor-switch control at the top of the page shows an extra **+** entry next to **Text** (`Text | +`). Click it to open the **Board Info** screen for that board (or, if more than one published board matches the file type, a screen listing all of them).
- **From a folder** — open a folder whose path matches a published board's direct-folder claim. The folder page's editor-switch control shows **+** after the available folder editors. Click it to open **Board Info**, which lists the matching board and its folder mask. The folder remains in Folder View until you download and register the board.
- **From the hub** — open the **Tools & Editors** panel (App menu) and click **Open in new tab**, or open its **Search boards** tab directly. This full-page **Search boards** tab browses the whole catalog — filter by name, description, or file type — and works without any matching file open. A **Refresh catalog** button forces an immediate check instead of waiting for the next automatic cycle.

Each board's card in the **Search boards** tab shows a **screenshot** of the board alongside its name, version, size, description, and file types, so browsing the catalog looks like a gallery rather than a text list. The **Board Info** screen shows the same screenshot, in both its install and its properties view. A board with no screenshot — or a screenshot that can't be loaded (for example while offline) — shows a neutral placeholder in its place, so cards stay the same size either way. The catalog listing itself is cached and browsable offline, but screenshots are loaded from the internet on demand, so they fall back to the placeholder until you're back online.

### Installing a board — Download, then Register

Installing a published board is always two separate, explicit steps — nothing is ever trusted or executed on your behalf:

1. **Download** — the Board Info screen shows the board's name, version, description, file types or folder claim, and download size, plus an install-location field (defaults to a Persephone data folder; **Browse…** to choose another). Clicking **Download** fetches the ZIP with a byte-progress bar, verifies its checksum, and extracts it to disk. **Nothing is trusted yet** — the downloaded board sits inert on disk, exactly like any other folder of files. This is the point at which you (or your AI agent) can open the folder and read its scripts before deciding to trust it.
2. **Register board** — once downloaded, the screen shows **"Downloaded — not registered"** with the folder's path and a reminder that you can ask your AI agent to review the board's files first. Clicking **Register board** shows the same **Trust board** dialog every board shows on first use (see [Board trust gate](trust-and-permissions.md#board-trust-gate) above). Only after you accept does the board become active — the file or folder you opened switches to the new editor automatically, and the switch control now shows it (`Text | <Board Name>` or `Folder View | <Board Name>`) instead of `+`.

You can delete a downloaded-but-not-yet-registered board directly from this screen — nothing was ever trusted, so there's nothing to untrust.

### Board properties, updates, and rollback

Once a board is installed, the same **Board Info** screen switches to a **properties** view — reached from the **Boards** Explorer panel, the in-board toolbar's **… → Board properties**, the Editors tree, or an update notification. It shows the board's description, author, install location, file-type association, trust state, and installed version, plus:

- **Versions** — the board's full published version history, newest first, fetched on demand. The version you have installed is marked **Current**; a newer compatible version is highlighted. Click **Update** (or **Install** on an older entry) to switch to that version — the swap is safe: your existing folder is only replaced once the new version has downloaded and verified successfully, so a failed download or a cancelled update never leaves you with a broken board. A version that needs a newer Persephone than the one you're running is shown disabled with a **"Requires Persephone ≥ X"** hint.
- **Uninstall** — removes the board's folder from disk and forgets it. This only appears for boards installed from the catalog; a board you (or an agent) created locally shows **Unregister** instead, which only forgets it — the folder is kept.
- **Open board** — switches back to the board itself.

**Update notifications:** when a compatible newer version is published, installed boards show an **Update** chip in the Editors tree and keep an **Update** action in their context menu; the board's in-board **…** button also shows a small dot.

If a board you're updating is currently open (or has background processes still running via `setBoardBusy`), Persephone asks you to close its pages first, with a **Close pages & continue** shortcut that does it for you (respecting any unsaved changes) and proceeds with the update.

When you remove or unregister a board, Persephone closes its open pages and stops its background
service before completing the removal. This applies whether you remove it from Board Info, the Boards
panel, or the Editors tree. Renaming a board keeps its category pin in the same position.

> Updating or rolling back a board replaces its files, including any local edits you made by hand — there's no separate warning for that beyond the click itself.

### Checking for new boards

Persephone checks the catalog automatically, but you can force an immediate check from two places:

- The **Search boards** tab's **Refresh catalog** button.
- The **About** page's **Check for Updates** button — it now refreshes both the app-update check and the boards catalog in one click, and the About page shows an **Available boards** count reflecting the current catalog. See [Checking for Updates](../getting-started.md#checking-for-updates).

### Security model

The same trust rule that governs every board applies here without exception: **a board never runs anything until you explicitly click Register/Trust.** Downloading a board only copies verified, inert files to disk — no script runs, and it isn't offered as an editor until registered. This means you (or your AI agent, on your behalf) always have a window to inspect a downloaded board's files before deciding whether to trust it. See [Board trust gate](trust-and-permissions.md#board-trust-gate) for the trust dialog itself.

### Driving it from a script or AI agent

An AI agent can perform the whole discover → download → review → install → update lifecycle through the scripting API, with the same one-click trust rule holding throughout — nothing is trusted without the trust dialog, and a well-behaved agent reviews and reports rather than deciding for you. It should trust a board only when you have asked it to.

| Method | Description |
|--------|-------------|
| `app.boards.list()` | List local trusted, installed, and open board roots. Read-only; does not query the remote catalog. |
| `app.boards.searchPublished(query?)` | Search the catalog by name/description/file type; each result is annotated with its install state. Read-only, no dialog. |
| `app.boards.getPublishedVersions(id)` | A board's full version history. Read-only, no dialog. |
| `app.boards.downloadPublished(id, opts?)` | Download + verify + extract a board **without trusting it** — the "can I trust this board?" entry point: download it, read its files, then decide. No dialog. |
| `app.boards.installPublished(id, opts?)` | Opens the Board Info screen for an interactive install (or drives an update/rollback if already installed and `opts.version` is given). |
| `app.boards.uninstallBoard(id)` | Removes an installed catalog board after confirmation, closing its open pages and stopping its service. |
| `app.boards.checkPublishedUpdates(force?)` | Refresh the catalog and report which installed boards have an update available. No dialog. |
| `app.boards.registerBoard(boardRoot)` | Show the trust dialog for a board already on disk (e.g. one downloaded with `downloadPublished`); resolves to whether it ended up trusted. |
| `app.boards.unregisterBoard(boardRoot)` | Untrust a board, closing its open pages and stopping its service. |
| `app.boards.renameBoard(boardRoot, newName)` | Rename a trusted board's folder, carrying its trust, category pin and position, and catalog registration to the new path. |

See the [Scripting API Reference](../scripting/api/app-proc-and-boards.md#boards) for full method signatures, and ask your AI agent to `persephone://guides/boards` for the complete authoring/automation reference, including a checklist for reviewing a downloaded board's files before registering it.

> **Publishing a board to the catalog?** A `board-manifest.json` can declare `"screenshot": "screenshot.png"` (a file name, not a path) to give the board a screenshot on its catalog card and Board Info page. This only applies to boards published through the `persephone-boards` project — see that repository's own documentation for the full publishing contract.

---

## Recommended components

Persephone publishes a catalog of components recommended for boards, with a pre-built **skin** (CSS or JS adapter) that restyles each component to match the app's `--p-*` theme. The catalog lives in the [`boards-assets/`](../boards-assets/) folder in the repository.

| Component | Use | Skin type |
|-----------|-----|-----------|
| [av-grid](https://github.com/andriy-viyatyk/av-grid) | **Data grid — the default.** Sort, filter, search + highlight, range select, clipboard, editing | none needed |
| [Tabulator](https://tabulator.info/) | Data grid — fallback, for grouping, tree data, pagination, export, variable row heights, … | CSS |
| [Chart.js](https://www.chartjs.org/) | Line, bar, pie, radar, scatter charts | JS adapter |
| [Flatpickr](https://flatpickr.js.org/) | Date / time / range picker | CSS |
| [Tom Select](https://tom-select.js.org/) | Rich select, tags, autocomplete | CSS |
| [marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/) | Markdown render with syntax highlighting | CSS |
| [Mermaid](https://mermaid.js.org/) | Diagrams from text (flowchart, sequence, Gantt, …) | JS adapter |
| [Split.js](https://split.js.org/) | Resizable layout panes | CSS |
| [SortableJS](https://sortablejs.github.io/Sortable/) | Drag-to-reorder lists and kanban boards | CSS |
| [Tippy.js](https://atomiks.github.io/tippyjs/) | Tooltips, popovers, dropdown menus | CSS |
| [Native `<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) | Modal dialogs — no library needed | CSS |

**To use a skin:**
1. Download the component's JS (and CSS if needed) into the board folder under `lib/`.
2. Copy the matching skin file from `boards-assets/` into the board folder as your own local copy.
3. Link the component's CSS first, then the skin CSS (the skin overrides the defaults). For JS adapters, load the adapter after the library and before your `app.js`.

The `boards-assets/manifest.json` file has machine-readable details — vendor URLs, tested versions, and skin type notes — that an AI agent can use to automate the setup.

**For tabular data, av-grid is the default.** It is a port of Persephone's own internal grid, so it matches the app's built-in grid editors, needs **no skin** (it reads the `--p-*` variables directly, so a theme switch re-tints it with no code), and renders more smoothly than Tabulator — noticeably so even on small tables. Tabulator remains in the catalog for the features av-grid does not have: variable row heights, row grouping, tree data, nested column headers, pagination, footer calculations, built-in export, remote data loading, row drag-reorder, undo/redo, and its library of ready-made cell formatters.

> **Skins are not guaranteed.** Each skin is stamped with the component version it was tuned for (e.g. `tabulator-tables@6.5.1`). If you vendor a newer version, test the board and patch your local copy where needed.

---

## AI-assisted board authoring

Boards are designed to be authored by an AI agent. The key workflow:

1. **Create or open a board.** Use the `boards.createBoard` or `boards.openBoard` call paths. Boards
   created this way are auto-trusted — no trust prompt blocks the agent.
2. **Discover the board** through `pages`; boards report `editor: "board-view"`, a
   `selectedBoard`, and (for standalone boards) a `boardRoot`.
3. **Read `CLAUDE.md`** inside the board folder — it documents the bridge API, theme contract,
   recommended-components catalog, and authoring conventions. The
   `persephone://guides/boards` resource contains the board authoring reference.
4. **Edit files** and call `pages[pageId].editor.reload()` to pick up changes. Boards do not reload
   automatically; after reloading, call `pages[pageId].editor.snapshot()` to inspect the result.
5. **Test the board** using `pages[pageId].editor`:

```
pages["abc"].editor.snapshot()
pages["abc"].editor.click({ ref: "e12" })
pages["abc"].editor.evaluate("document.querySelector('#result').textContent")
```

Mouse and keyboard actions use trusted input and check that targets are visible and actionable.
Snapshots can be limited to interactive items or scoped to a board region. See the
[page automation reference](../scripting/api/page-editor-facades.md#browser-board-and-window-page-automation)
for locators, waits, page events, response inspection, and the shared operation list.

`pages["abc"].editor.evaluate(...)` is useful for testing `persephone.execute()` from the agent
side without modifying source files.

### Board call paths

| Call path | Parameters | Description |
|-----------|------------|-------------|
| `boards.createBoard` | `name`, `dir`, `demo?` | Create a board in `<dir>/<name>`; returns `boardRoot` and auto-trusts the result. |
| `boards.openBoard` | `path` | Open an existing board and return its page id and title. |
| `pages[pageId].editor.reload` | none | Reload a board after editing its files; returns the refreshed frame state. |
| `persephone://guides/boards` | — | Board authoring and review reference. |

---
