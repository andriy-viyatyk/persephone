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
elements include `grid-search`, `grid-search-clear`, `grid-columns`, `grid-csv-options`,
`columns-options-apply`, `columns-options-cancel`, `csv-options-header`, `csv-options-delimiter`,
and `csv-options-other`; filtering and transient cell controls are not currently facade elements.

## Errors and limits

Grid requires data compatible with its selected language. A malformed JSON array/object, invalid JSONL
line, or malformed CSV produces a parse error rather than a useful table. JSON objects must have
consistent enough properties for meaningful columns; missing properties remain empty cells.
