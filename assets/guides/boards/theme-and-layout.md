---
title: "Boards — theme, folder layout and own documentation"
audience: both
summary: "Board theme tokens, the board folder layout, and shipping a guides folder inside a board."
---

# Boards — theme, folder layout and own documentation

## Theme

Persephone injects the app's current theme as CSS variables on `<html>` and keeps them live as the user switches themes:

```css
body { background: var(--p-bg); color: var(--p-text); }
button { background: var(--p-accent); color: var(--p-accent-text); }
```

The board template ships with a `board-base.css` (linked first in `index.html`, copied into every **new** board at creation) that applies sensible defaults — page background, text color, monospace font, themed scrollbars, a themed focus ring, and styled checkboxes — all from `--p-*`. Build your own styles on top.

`board-base.css` also ships an **opt-in "Persephone chrome" layer**: ready-made classes for toolbars and controls, sized and colored to match the app exactly, so a board built from them looks built-in rather than embedded. They fire only when you put the class on an element — a bare `<button>` or `<input>` is untouched, which keeps a vendored library's own controls (av-grid, Flatpickr, Tom Select) styled by their own skin instead.

| Class | What it is |
|-------|------------|
| `.p-toolbar` | 30px chrome bar on `--p-bg-dark` with a bottom rule. Add `data-orientation="vertical"` for a side rail (right border instead, no min-height). |
| `.p-btn` | Button — 26px on a page, 24px inside a `.p-toolbar` automatically. Modifiers: `primary` (the one filled/accent button in a bar), `ghost` (transparent), `danger`, `link`, `selected` (toggled/active state), `icon` (square, for a lone glyph), `sm` (24px anywhere), `md` (keep 26px inside a bar), `on-dark` (toolbar-style fill outside a toolbar). |
| `.p-input`, `.p-select` | Text field / dropdown, sized to line up with `.p-btn` — same 26px / 24px pair and the same `sm` / `md` modifiers. |
| `.p-sep` | Vertical hairline separating toolbar groups. |
| `.p-spacer` | Pushes everything after it to the right edge of the toolbar. |
| `.p-toolbar-title` | Label/caption text inside a toolbar (a board title or breadcrumb, not a control). |

The numbers are ported from the app's own UIKit, so controls come out the same size Persephone uses everywhere else — a fixed height with horizontal padding only; adding vertical padding is the most common way to end up with an oversized bar. The size split matters: Persephone's own editor toolbars are built from *small* (24px) buttons, and the 26px medium size belongs on a page or in a dialog, so a bar of medium buttons looks plausible in isolation and oversized next to the app's chrome. Putting `.p-btn` in a `.p-toolbar` applies the small tier for you. See the **Theming** tab of the Demo board (`assets/demo-board/`) for a live, working example of the whole set.

**Existing boards are unaffected** — this only changes what a **newly created** board's `board-base.css` contains. A board created before this layer was added keeps the copy of `board-base.css` it was created with; copy the file (or its rules) in from a fresh board's template if you want the chrome classes in an older board.

The app's theme shortcuts — **Ctrl+Alt+]** (next theme) and **Ctrl+Alt+[** (previous) — work with focus inside a board, so you can cycle themes to check a board's styling without clicking back into the app first. A board that binds either combination itself takes precedence.

**Full token list:**

| Group | Variables |
|-------|-----------|
| Colors | `--p-bg`, `--p-panel`, `--p-bg-dark`, `--p-overlay`, `--p-hover`, `--p-tree-selection`, `--p-border`, `--p-border-light`, `--p-text`, `--p-text-muted`, `--p-text-strong`, `--p-accent`, `--p-accent-text`, `--p-accent-hover`, `--p-selection-bg`, `--p-selection-text`, `--p-link`, `--p-error`, `--p-success`, `--p-warning`, `--p-scrollbar`, `--p-scrollbar-thumb`, `--p-shadow` |
| Graph colors | `--p-graph-bg`, `--p-graph-node-default`, `--p-graph-node-highlight`, `--p-graph-node-selected`, `--p-graph-node-special`, `--p-graph-border-default`, `--p-graph-border-highlight`, `--p-graph-border-selected`, `--p-graph-border-special`, `--p-graph-link-default`, `--p-graph-link-selected`, `--p-graph-label-bg`, `--p-graph-label-text`, `--p-graph-group-border` |
| Spacing | `--p-space-xs`, `--p-space-sm`, `--p-space-md`, `--p-space-lg`, `--p-space-xl`, `--p-space-xxl` |
| Gap | `--p-gap-xs`, `--p-gap-sm`, `--p-gap-md`, `--p-gap-lg` |
| Radius | `--p-radius-sm`, `--p-radius-md`, `--p-radius-lg` |
| Font | `--p-font-base`, `--p-font-sm`, `--p-font-lg`, `--p-size-icon` |

To render **Persephone-style chrome** (title bars, sidebar panels, grid headers), use `--p-bg-dark` — the app's actual chrome surface, darker than `--p-panel` (which is an input/lighter-surface color) — together with `--p-hover` (hover background for list items/buttons) and `--p-tree-selection` (selected-row background).

**Theme in JavaScript** — for libraries that color themselves from JS (charts, diagrams):

```js
// At init — load-time snapshot (goes stale after a theme switch):
const palette = persephone.theme.vars;    // { "--p-bg": "#...", ... }
const isDark = persephone.theme.isDark;

// Live — always the current theme:
const live = persephone.getTheme().vars;

// React to theme switches:
persephone.onThemeChange(newPalette => {
    chart.update({ backgroundColor: newPalette["--p-accent"] });
});
```

For a canvas-based graph or another drawing that needs concrete colors, use the shaped `graph`
palette. It has `bg`, `nodeDefault`, `nodeHighlight`, `nodeSelected`, `nodeSpecial`, the four
matching `border*` colors, `linkDefault`, `linkSelected`, `labelBg`, `labelText`, and
`groupBorder`. The callback receives the new graph colors too:

```js
persephone.onThemeChange(theme => {
    ctx.fillStyle = theme.graph.nodeDefault;
    ctx.strokeStyle = theme.graph.linkDefault;
    repaint();
});
```

Read `getTheme()` or the `onThemeChange` argument again after every theme switch; the initial
`persephone.theme` value is only a load-time snapshot.

> **Important:** `persephone.theme` is a snapshot taken at page load. After an in-session theme switch it goes stale. Always re-read from the `onThemeChange` callback argument or call `persephone.getTheme()`.

---

## Board folder layout

An ordinary board can live anywhere on disk. Its log is kept in the board folder:

```
My Board/                  ← board root folder (display name = folder name)
  board-manifest.json      ← board identity file (created automatically)
  CLAUDE.md                ← authoring guide (for you or an AI agent)
  ui.log                   ← error log for boards you add — review when something breaks
  index.html               ← entry point (required at the board root)
  app.js                   ← your frontend JS
  style.css                ← your styles
  board-base.css           ← theme defaults (copy from the template)
  scripts/
    hello.js               ← a backend script
```

- `board-manifest.json` is the identity file that tells Persephone this folder is a board. Never delete it.
- The folder name is the board's display name. Rename the folder to rename the board.
- `index.html` at the board root is the only other structural requirement — everything else is your choice.

---

## A board's own documentation — the `guides` folder

A board can ship its **own user and agent documentation** and have Persephone treat it exactly like
the built-in guides. Declare a board-relative folder in `board-manifest.json`:

```json
{
  "schemaVersion": 1,
  "name": "Force Graph",
  "guides": "guides"
}
```

Every `.md` file under that folder is mounted into the app's guide system under
`installed-boards/<board-folder-name>/…`, which means the board's pages show up:

- in the **About page's guide tree**, under the top-level **installed-boards** branch;
- on **F1** from one of the board's own pages (see `editorId` below);
- in **guide search**, so `guides.search("…")` finds the board's text;
- over MCP at `guides["installed-boards/<board>/<page>"]`.

Each page starts with the same front-matter block the app's own guides use:

```markdown
---
title: "Using the Force Graph board"
audience: user
summary: "One sentence shown beside the page in the guide tree."
editorId: "board"
---
```

- `title` and `summary` are required; a page missing them is still shown, but it falls back to its
  file name and an empty summary.
- `audience` is `user`, `agent`, or `both`. `agent` pages are hidden from the guide tree until the
  reader turns on **Show agent guides**, exactly as for the app's own pages — so a board can ship a
  user guide and an agent reference side by side.
- `editorId: "board"` marks the page as the documentation **for this board**, which is what `F1`
  on one of the board's pages opens. It is a fixed token, not the board's real editor id: that id
  embeds the board's absolute path, which differs on every machine.
- `screen` and multi-id `editorId` arrays work the same way as in the app's own guides.

Some rules worth knowing:

- **Trust gates it.** Only a trusted board contributes documentation. Untrusting or removing a
  board drops its pages from the tree and from search immediately, with no restart.
- **The folder must stay inside the board.** An absolute path, a drive letter, or a `..` segment in
  `guides` is rejected and the board simply contributes nothing.
- Name the entry page `index.md` — a folder path opens its index page.
- Documentation shipped this way **versions with the board**, which is the point: it cannot drift
  out of sync with an app release.

---
