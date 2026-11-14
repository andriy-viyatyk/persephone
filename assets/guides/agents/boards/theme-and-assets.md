---
title: "Boards — theme, local assets, manifest and icon"
audience: agent
summary: "Use Persephone theme tokens in a board, vendor libraries and assets locally (offline-first, CSP), and the manifest, icon and reload."
---

# Boards — theme, local assets, manifest and icon

## Theme: the `--p-*` contract

Persephone injects its palette as CSS variables on `<html>` and keeps them live across theme
switches — style everything with them so the board matches the app. The variables are defined
**before the first paint**, so a board loads already themed (no flash):

```css
body { background: var(--p-bg); color: var(--p-text); }
button { background: var(--p-accent); color: var(--p-accent-text); border-radius: var(--p-radius-md); }
```

Every board ships with **`board-base.css`** (linked first in `index.html`) applying sensible
defaults (page bg/text, monospace font, themed scrollbars, themed focus ring, and
Persephone-style native checkboxes). Colors (`--p-bg`, `--p-panel`,
`--p-border`, `--p-text`, `--p-accent`, `--p-error`, `--p-success`, `--p-warning`, …) update
live; metrics (`--p-space-*`, `--p-gap-*`, `--p-radius-*`, `--p-size-*`, `--p-font-*`) are
constants. To match **Persephone's own chrome** (title bar / sidebar / grid header) use
`--p-bg-dark` (darker than `--p-panel`), plus `--p-hover` (list/button hover) and
`--p-tree-selection` (selected row). For JS-colored components (charts/diagrams) read the live palette via
`persephone.getTheme()` / `persephone.onThemeChange(cb)` and re-apply on each fire — never cache
`persephone.theme.vars` across a switch. The app theme shortcuts (`Ctrl+Alt+]` / `Ctrl+Alt+[`) work
with focus inside the board frame — Persephone forwards them out — so a theme pass over a board needs
no clicking back into the app; a board binding either combo opts out with `preventDefault()`.

**Graph colors (`--p-graph-*`).** Persephone also publishes its 14 force-graph colors — canvas
background, node / border / link fills in default, highlight, selected and special variants, the
label plate and text, and the group outline — as `--p-graph-bg`, `--p-graph-node-default`,
`--p-graph-node-highlight`, `--p-graph-node-selected`, `--p-graph-node-special`,
`--p-graph-border-default`, `--p-graph-border-highlight`, `--p-graph-border-selected`,
`--p-graph-border-special`, `--p-graph-link-default`, `--p-graph-link-selected`,
`--p-graph-label-bg`, `--p-graph-label-text` and `--p-graph-group-border`. They are per-theme
values tuned across all built-in themes — a palette derived from the general `--p-*` set loses that
fidelity. Because a `<canvas>` cannot consume `var(...)`, the same values arrive as concrete
strings on `persephone.getTheme().graph`, keyed by the camelCased suffix (`bg`, `nodeDefault`,
`nodeHighlight`, `nodeSelected`, `nodeSpecial`, `borderDefault`, `borderHighlight`,
`borderSelected`, `borderSpecial`, `linkDefault`, `linkSelected`, `labelBg`, `labelText`,
`groupBorder`). `onThemeChange` delivers the graph family too — re-read it on every fire and
repaint, never cache it across a switch.

```js
persephone.onThemeChange((theme) => {
    ctx.fillStyle = theme.graph.nodeDefault;
    ctx.strokeStyle = theme.graph.linkDefault;
    repaint();
});
```

## Libraries & assets — vendor them locally

A board is **offline-first**. Its CSP (`connect-src 'self'`) blocks remote resources such as CDN
scripts, stylesheets, fonts, and cross-host browser `fetch()`. For intentional remote HTTP requests,
boards need `network: "internet"` or `network: "full"` to use `persephone.fetch(url, init)`, optionally with `{ tor: true }` or
`{ proxy: "host:port" }`. It sends only the headers you provide, is not subject to browser CORS,
and returns a standard `Response`. Download each library into the board folder and reference it
with a **relative** path:

```html
<script src="./lib/av-grid.umd.js"></script>
<link rel="stylesheet" href="./lib/av-grid.css" />
```

Never use `https://…cdn…` URLs in `<script>`/`<link>`/`@import`/`fetch()` — they are blocked and
the board fails silently. Bundle fonts/images locally too (or inline images as `data:` URIs).

**Recommended components:** the `boards-assets/manifest.json` catalog lists pre-tested,
theme-skinned libraries (grids, charts, markdown, …) with their vendor download URLs and load
order. The skins are **not bundled in the installer** — they live on GitHub. Fetch the manifest and
each skin from the raw base URL specified in the manifest:

- Manifest: `https://raw.githubusercontent.com/andriy-viyatyk/persephone/main/boards-assets/manifest.json`
- Each component's `skin.file` (e.g. `tabulator.css`) is fetchable as **`baseUrl + skin.file`**, where
  `baseUrl` is the manifest's top-level `baseUrl` field. A component with `skin.file: null`
  (`"type": "none"`) has **no skin to fetch** — it reads `--p-*` itself.

**Tabular data → use `av-grid` 2.12.1.** It is the catalog's default grid and a port of Persephone's own
internal grid (VAGrid), so it is native to the app: it matches the built-in grid editors, needs **no
skin and no theme code** (its `--avg-*` tokens fall back to `--p-*`, so a theme switch re-tints it
with zero JS), and it renders more smoothly than Tabulator — noticeably so even on small datasets.
It covers sorting, checklist filters + a chip bar, built-in text filters with per-column operators
(`contains`, `equals`, `startsWith`, `blank`, `notBlank`), search with in-cell highlighting, range
select + clipboard, virtualization, editing, and add/delete rows and columns. Hosts can own
filtering and sorting; `treeColumn` supplies a gutter over flat rows; `pinned: "left"` / `"right"`
provides leading/trailing sticky data columns. Vendor `av-grid.css` +
`av-grid.umd.cjs` (rename the `.cjs` to `.js`; it exposes `window.AVGrid`, class `AVGrid.AVGrid`),
link its CSS **before** your own `<style>` and pass `injectStyles: false`, and give the host a
definite height. Read its API doc first — one complete file written for an agent, including a
  *"Driving the grid from an agent"* section on the `pages[pageId].editor` path:
`https://raw.githubusercontent.com/andriy-viyatyk/av-grid/main/docs/api.md`.
Choose **Tabulator** instead only for a feature av-grid lacks: variable row heights, row grouping,
a true tree-data engine or nested rows, three-or-more-level nested column headers (av-grid's
`Column.group` supplies one group band), pagination or server-side paging, remote data
transport/fetching, footer calculations, built-in export, drag-to-reorder rows, responsive collapse,
undo/redo, arbitrary or interleaved data-column freezing, or its ready-made formatters (progress
bar, star rating, traffic light).

Vendor flow on any machine: **GET the manifest → read the component's `vendor` URLs (the third-party
library, from a CDN) and its `skin.file` → GET `baseUrl + skin.file` → write both into the board folder**
(relative paths). Download from inside `script.execute` (full Node.js — e.g. `https.get` then
`app.fs.writeBinary(destPath, data)`), then reference the files with relative paths in `index.html` per
the manifest's `loadOrder`.

## Manifest, icon, reload

- `board-manifest.json` — keep `schemaVersion: 1`; add optional `name`/`description`/`author`/
  `repository`. The non-empty trimmed pair `author` + `name` is the board's stable identity
  for portable namespaces used by board environment variables; a missing or empty author keeps
  the ordinary board-root fallback. Changing either identity field after variables exist moves
  the namespace and orphans the old values. Persephone does not migrate, copy, merge, or prune
  those values, so any deliberate migration is the user's responsibility. `minBridgeVersion`
  rejects a board on an older bridge;
  `permissions` is the enforced object-form grant set; new boards start all-false and need
  `minBridgeVersion: "1.30.0"`. Add only flags used by reachable calls;
  missing permissions and the historical array form are deprecated; add an object-form `permissions` block.
  `service` names a board-relative ESM module-service entry. No secrets, no trust flags. To make the board a **custom editor**
  for a file type, add `fileMasks` (glob masks matched against the file name, e.g. `["*.drawio"]`;
  a wildcard-free mask with a dot inside it is an exact file **name**, e.g. `["DASHBOARD.md"]`),
  optional `folderMasks` to scope those masks to certain folders (e.g. `"fileMasks": ["DASHBOARD.md"]`
  + `"folderMasks": ["*/tasks"]` claims only `…/dev/tasks/DASHBOARD.md`; matched against the parent
  folder as a case-insensitive path *suffix* — `*`/`?` stop at a separator, `**` crosses them; omit
  for any folder; path-based file icons honor the folder scope while name-only icon lookups omit
  folder-scoped boards),
  optional `contentMasks` (**regex** sources tested against the page's text *content* — the way to
  claim an **untitled, in-memory** page that no file name can match, e.g.
  `["\"type\"\s*:\s*\"force-graph\""]`; case-insensitive, tested against the first 64 KB,
  uncompilable masks ignored, switch-option scope only so content never decides which editor *opens
  a file*; usable with or without `fileMasks`),
  optional `browserUrlMasks` (whole-URL globs for Browser downloads, independent of `fileMasks`;
  normalized, anchored, and limited to trusted or enabled bundled boards),
  optional `singleInstance: true` (converges claimed sources on one board page per renderer window;
  windows keep separate pages, so use the shared module service when their state must agree),
  optional `singleInstanceMasks` (file-name masks that route matching claimed files to that singleton;
  when omitted, every claimed source keeps the legacy singleton routing behavior),
  optional `editorPriority` (a number; makes the board the *default* editor for those masks when it
  strictly outranks the built-in that also claims the file — omit/`0` = switch option only. Built-in
  ladder: Monaco `0`, Markdown Preview `10`, compound-name editors like `*.grid.json` `20`, Drawing
  `50`, image/archive/video `100`; ties go to the built-in, so a `DASHBOARD.md` board needs more
  than `10`, and `100` beats everything but the media viewers), and optional `editorName`
  (switch-widget label). Honored only when the board is trusted. Optional `editorKind`: `"simple"` (default) → the
  file arrives via `persephone.getFilePath()` (read/write it yourself); `"content-host"` → Persephone
  owns the file and the board works through `persephone.host.*` (shares the host with Monaco, edits
  non-local files, auto-saves); `"stream-host"` → Persephone owns the pipe and exposes
  `persephone.host.streamUrl()` instead of text or a materialized file. Optional `editorSources`:
  `"local"` (default) → a simple board is
  offered only for real local files; `"any"` → also for an archive entry or an `http(s)` URL, where
  `getFilePath()` still returns a readable local path (see the bridge section). Ignored for
  content-host and stream-host boards, which always get every source.
- For a direct-folder editor, use `folderEditorMasks` and `folderEditorPriority`, for example
  `{ "folderEditorMasks": ["*/projects/*"], "folderEditorPriority": 200 }`. These match the
  folder itself, not a file's parent gate. The board receives that absolute claim through
  `await persephone.getFolderPath()`; `boardRoot` remains the installed board root.
- Optional `guides` — a board-relative folder (conventionally `"guides"`) holding the board's own
  Markdown documentation. Persephone mounts every `.md` under it at
  `installed-boards/<board-folder-name>/…`, so the pages appear in the About guide tree under the
  top-level **installed-boards** branch, answer `F1` from the board's own pages, are found by
  `guides.search(...)`, and are readable at `guides["installed-boards/<board>/<page>"]`. Each page
  carries the app's own front matter — `title`, `summary`, `audience` (`user` / `agent` / `both`,
  where `agent` pages stay behind the About page's *Show agent guides* toggle), optional `screen`,
  and `editorId: "board"` to mark the page as **this board's** guide for `F1` (a fixed token: the
  board's real editor id embeds an absolute path and differs per machine). Name the entry page
  `index.md`. Absolute paths, drive letters and `..` segments are rejected, and only a **trusted**
  board contributes documentation — untrusting or removing it drops the pages from the tree and
  from search with no restart. Document the board here rather than in the app, so the docs version
  with the board.
- Optional `icon.svg` / `icon.png` / `icon.ico` in the board folder sets the board's icon (SVG
  preferred). Without one, a default glyph is used.
- **Reload model:** boards do **not** auto-reload on file changes. After editing a board's files,
  apply the changes with **… → Reload board** in the in-board toolbar — or, when driving the board
  as an agent, `pages[pageId].editor.reload()`. A dirty board prompts before reload; Save failure
  rejects without remounting, while Cancel returns `{ refreshed: false, cancelled: true, pageId,
  frameReady, renderState }`. <!-- board-template:exclude -->MCP calls can return a pending attention result while the dialog is
  open, so answer it in a concurrent call and inspect page/frame state afterward.<!-- /board-template:exclude --> Once approved,
  the path returns after the new main frame is ready, so an iterate loop is race-free: edit files →
  `reload()` → `snapshot()`.
- **`board-manifest.json` is not covered by a reload.** Persephone caches a board's manifest from the
  moment the board is trusted, so a manifest edit (`fileMasks`, `folderMasks`, `folderEditorMasks`,
  `editorPriority`, `folderEditorPriority`, `editorSources`)
  applies only after toggling the board's trust off and on, or restarting the app — not after
  `pages[pageId].editor.reload()`.
- A `settings` declaration follows the same cache boundary: its Settings panel appears once
  the board is trusted or bundled, and direct edits to the cached manifest do not update that
  page live. Toggle trust off and on or restart Persephone to refresh it.
