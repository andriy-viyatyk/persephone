---
title: "Grid Editor"
audience: both
summary: "Spreadsheet-like viewing and editing of JSON, CSV, and JSONL data."
editorId: ["grid-json", "grid-csv", "grid-jsonl"]
---

# Grid Editor

Grid is a spreadsheet-like editor for tabular JSON, CSV, and JSONL data. The three script-facing
ids share one surface: `grid-json`, `grid-csv`, and `grid-jsonl`.

## How to Open

- Open a `.json` array or single object and choose **Grid** in the page toolbar.
- Open a `.csv`, `.jsonl`, or `.ndjson` file and choose **Grid**.
- Files named `.grid.json`, `.grid.csv`, or `.grid.jsonl` open directly in the matching Grid module.
- Use the arrow beside **+** and choose **Grid (JSON)**, **Grid (CSV)**, or **Grid (JSONL)**.

## Layout

```
+---------------------------------------------------------------------+
| [Edit Columns] [CSV Options]             [Search ⌕] [Editor switch] |  toolbar: columns at the left, search and switch at the right
+---------------------------------------------------------------------+
| Column headers — click to sort, drag to reorder. A filter button    |  each column header carries a filter button at its right edge,
| appears at the right edge of a header when you hover it.            |  shown on hover or while that column is filtered
| Cells — double-click to edit, Ctrl+C / Ctrl+V to paste from Excel.  |  grid body, below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Search → `grid-search`
- Clear search → `grid-search-clear`
- Edit Columns → `grid-columns`
- CSV Options → `grid-csv-options`
- Column filter → `grid-column-filter`
- Apply → `columns-options-apply`
- Cancel → `columns-options-cancel`
- Header checkbox → `csv-options-header`
- Delimiter → `csv-options-delimiter`
- Custom delimiter → `csv-options-other`
- Page navigation and Editor switch → no entry: shell-owned controls
- Grid cells and cell editors → no entry: editor-internal data-grid controls

### When the Columns popup is open

```
+---------------------------------------------------------------------+
| [Column options]                                                    |  Columns popup options
| [Cancel] [Apply]                                                    |  Columns popup answer buttons at bottom-right
+---------------------------------------------------------------------+
```

### When the CSV Options popup is open

```
+---------------------------------------------------------------------+
| [x] First row is a header                                           |  CSV Options popup, top
| Delimiter:  ( ) comma  ( ) semicolon  ( ) tab  ( ) other            |  below the header checkbox
| Custom delimiter: [    ]                                            |  bottom of the CSV Options popup
+---------------------------------------------------------------------+
```

### When a column filter is visible

```
+---------------------------------------------------------------------+
| [Column header]                                             [Filter]|  column filter remains at each header's right edge
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.
- Grid cells and transient cell editors — no entry: editor-internal data-grid controls.

## Data and editing

JSON arrays of objects become rows and their properties become columns. A single JSON object is also
accepted and becomes one row. Types are inferred as strings, numbers, or booleans; cell edits and
paste operations validate those types. JSONL/NDJSON reads one object per line, while CSV detects its
delimiter and can be configured with the CSV options button.

Use **Search** to find text across cells. Column-header filters support text/number values and lists
of unique values; multiple filters combine. Click a header to sort ascending or descending. **Columns**
can show, hide, reorder, and resize columns. The status bar shows visible and total row counts.

Double-click a cell or press **Enter** or **F2** to edit; **Escape** cancels. Boolean cells toggle
with their checkbox, **Space**, or **Enter**. Row and column insertion/deletion use `Ctrl+Insert`,
`Ctrl+Delete`, `Ctrl+Shift+Insert`, and `Ctrl+Shift+Delete`; moving past the last row or column can
add one when editing is enabled. Sorting or filtering disables row insertion and deletion.

## Copy and paste

`Ctrl+C` copies one raw value or a selected range as tab-delimited data. `Ctrl+Shift+C` includes
headers. The context menu can copy the selection as headers, JSON, or an HTML table. `Ctrl+V` pastes
tab-delimited values, growing rows as needed; pasting one value into a selected range fills the range.
The same workflow works with Excel.

## Agent API

Use `pages.addEditorPage("grid-json", "json", title, content)`, or the corresponding `grid-csv`
and `grid-jsonl` id, for a new content page. After narrowing `page.editor.id` to one of the three
ids, the `GridEditor` facade exposes the grid state and row/cell operations. The verified page
elements include `grid-search`, `grid-search-clear`, `grid-column-filter`, `grid-columns`,
`grid-csv-options`, `columns-options-apply`, `columns-options-cancel`, `csv-options-header`,
`csv-options-delimiter`, and `csv-options-other`; transient cell controls are not currently facade
elements.

## Errors and limits

Grid requires data compatible with its selected language. A malformed JSON array/object, invalid JSONL
line, or malformed CSV produces a parse error rather than a useful table. JSON objects must have
consistent enough properties for meaningful columns; missing properties remain empty cells.
