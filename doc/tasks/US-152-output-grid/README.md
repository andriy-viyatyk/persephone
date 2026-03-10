# US-152: Log item: output.grid (renderer + ui.show.grid)

## Goal

Add an `output.grid` entry type to the Log View editor that renders tabular data inline using AVGrid, with a script API (`ui.show.grid()`) and MCP support. The grid should auto-size its height to content (up to a max), support column auto-detection from object arrays, and allow opening its data in a dedicated Grid editor page.

## Resolved Decisions

1. **GridColumn import** — Import `GridColumn` type from `editors/grid/utils/grid-utils.ts` (type-only). Remove `hidden` property from `GridColumn` (only used by Grid editor's ColumnsOptions, not needed for output.grid or scripts). AVGrid's own `Column.hidden` in `avGridTypes.ts` stays unchanged.

2. **Entry format** — Two separate contracts:
   - **LogEntry** (stored in JSONL): `{ type: "output.grid", data: any[], columns?, title? }` — `data` is always an array of objects.
   - **MCP** (agent sends): `{ type: "output.grid", content: string, contentType?: "csv"|"json", title? }` — MCP handler parses `content` to `data[]` before calling `vm.addEntry()`. No `columns` param in MCP — columns are always auto-detected from the data.
   - **Script API** (developer calls): `ui.show.grid(data)` or `ui.show.grid({ data, columns?, title? })` — `columns` param available for filtering/overriding detected columns.

3. **growToHeight** — Use `DIALOG_CONTENT_MAX_HEIGHT` (400px). This constant is currently defined locally in `CheckboxesDialogView.tsx` and `RadioboxesDialogView.tsx` — extract to a shared location in the log-view folder.

4. **"Open in Grid" button** — Hover overlay (opacity 0 → 1 on parent hover). Use `OpenLinkIcon` from `theme/icons.tsx`.

5. **Column merge logic** (script API only, not MCP):
   - Always detect columns from data first
   - If no `columns` param → use all detected columns
   - If `columns` provided → filter to only those columns + merge overrides from passed params
   - String shorthand: `["name", "age"]` → `[{key: "name"}, {key: "age"}]`

6. **Reuse `getGridDataWithColumns()`** from `grid-utils.ts` — it already does detect→merge→addIdColumn. We just need to normalize string shorthand before calling it.

## Implementation Plan

### Step 1: Remove `hidden` from GridColumn

**File:** `src/renderer/editors/grid/utils/grid-utils.ts`
- Remove `hidden?: boolean` from the `GridColumn` interface (line 13)

**Note:** `GridViewModel.ts` lines 455 and 499 read `c.hidden` where `c` is AVGrid's `Column` type (from `avGridTypes.ts`), NOT `GridColumn`. These lines are unaffected.

### Step 2: Extract DIALOG_CONTENT_MAX_HEIGHT to shared constant

**File:** Create `src/renderer/editors/log-view/logConstants.ts` (new file)
```typescript
/** Maximum height for scrollable content areas in log entries (dialogs, grids). */
export const DIALOG_CONTENT_MAX_HEIGHT = 400;
```

**File:** `src/renderer/editors/log-view/items/CheckboxesDialogView.tsx`
- Remove local `const DIALOG_CONTENT_MAX_HEIGHT = 400;`
- Add `import { DIALOG_CONTENT_MAX_HEIGHT } from "../logConstants";`

**File:** `src/renderer/editors/log-view/items/RadioboxesDialogView.tsx`
- Same change as above.

### Step 3: Redesign GridOutputEntry type

**File:** `src/renderer/editors/log-view/logTypes.ts`

Replace the existing `GridOutputEntry` (lines 122-127):
```typescript
// Before:
export interface GridOutputEntry extends LogEntryBase {
    type: "output.grid";
    title?: StyledText;
    columns: string[];
    rows: any[][];
}

// After:
export interface GridOutputEntry extends LogEntryBase {
    type: "output.grid";
    title?: StyledText;
    data: any[];                           // Array of objects
    columns?: (string | GridColumn)[];     // Optional — string shorthand or {key, title?, width?, dataType?}
}
```

Add type-only import at top of file:
```typescript
import type { GridColumn } from "../grid/utils/grid-utils";
```

Also add `GridColumn` to the exports so other files can use it:
```typescript
export type { GridColumn };
```

### Step 4: Create GridOutputView component

**File:** `src/renderer/editors/log-view/items/GridOutputView.tsx` (new file)

```tsx
import { useMemo, useCallback } from "react";
import styled from "@emotion/styled";
import { GridOutputEntry } from "../logTypes";
import { DialogHeader } from "./DialogHeader";
import { getGridDataWithColumns, getRowKey } from "../../grid/utils/grid-utils";
import type { GridColumn } from "../../grid/utils/grid-utils";
import AVGrid from "../../../components/data-grid/AVGrid/AVGrid";
import { Button } from "../../../components/basic/Button";
import { OpenLinkIcon } from "../../../theme/icons";
import { pagesModel } from "../../../api/pages";
import { isTextFileModel } from "../../text/TextPageModel";
import { DIALOG_CONTENT_MAX_HEIGHT } from "../logConstants";
import color from "../../../theme/color";
```

Component structure — single styled root (per coding standards):
```
GridOutputRoot (styled.div, position: relative)
  ├── DialogHeader (for title, if provided)
  ├── AVGrid (growToHeight, growToWidth="100%", readonly, disableFiltering)
  └── .grid-hover-actions (position: absolute, top-right, visible on hover)
        └── Button with OpenLinkIcon
```

Key implementation details:

**Column normalization** — before calling `getGridDataWithColumns`:
```typescript
function normalizeColumns(columns?: (string | GridColumn)[]): GridColumn[] | undefined {
    if (!columns || columns.length === 0) return undefined;
    return columns.map(c => typeof c === "string" ? { key: c } : c);
}
```

**Data preparation** — memoized:
```typescript
const gridData = useMemo(
    () => getGridDataWithColumns(entry.data, normalizeColumns(entry.columns)),
    [entry.data, entry.columns],
);
```

**AVGrid props:**
- `columns={gridData.columns}`
- `rows={gridData.rows}`
- `getRowKey={getRowKey}`
- `growToHeight={DIALOG_CONTENT_MAX_HEIGHT}`
- `growToWidth="100%"`
- `readonly`
- `disableFiltering`

**Hover overlay** — styled with opacity transition:
```css
"& .grid-hover-actions": {
    position: "absolute",
    top: 4,
    right: 4,
    opacity: 0,
    transition: "opacity 0.15s",
},
"&:hover .grid-hover-actions": {
    opacity: 1,
},
```

**"Open in Grid" click handler:**
```typescript
const handleOpenInGrid = useCallback(() => {
    const title = typeof entry.title === "string" ? entry.title : "Grid Data";
    const page = pagesModel.addEditorPage("grid-json", "json", title);
    if (isTextFileModel(page)) {
        page.changeContent(JSON.stringify(entry.data, null, 2));
    }
}, [entry.data, entry.title]);
```

### Step 5: Wire GridOutputView into LogEntryContent router

**File:** `src/renderer/editors/log-view/LogEntryContent.tsx`

Add import:
```typescript
import { GridOutputView } from "./items/GridOutputView";
```

Add case in the output switch block (before the `isOutputEntry` fallback):
```typescript
case "output.grid":
    return <GridOutputView entry={entry as GridOutputEntry} />;
```

### Step 6: Add Grid helper class

**File:** `src/renderer/scripting/api-wrapper/Grid.ts` (new file)

Follow the same pattern as `Progress.ts`:

```typescript
import type { LogViewModel } from "../../editors/log-view/LogViewModel";
import type { StyledText, GridOutputEntry } from "../../editors/log-view/logTypes";
import type { GridColumn } from "../../editors/grid/utils/grid-utils";
import { pagesModel } from "../../api/pages";
import { isTextFileModel } from "../../editors/text/TextPageModel";

export class Grid {
    private _data: any[];
    private _columns?: (string | GridColumn)[];
    private _title?: StyledText;

    constructor(
        private readonly entryId: string,
        private readonly vm: LogViewModel,
        initial: { data: any[]; columns?: (string | GridColumn)[]; title?: StyledText },
    ) {
        this._data = initial.data;
        this._columns = initial.columns;
        this._title = initial.title;
    }

    private update(): void {
        this.vm.updateEntryById(this.entryId, (draft) => {
            const d = draft as GridOutputEntry;
            d.data = this._data;
            d.columns = this._columns;
            d.title = this._title;
        });
    }

    get data(): any[] { return this._data; }
    set data(value: any[]) { this._data = value; this.update(); }

    get columns(): (string | GridColumn)[] | undefined { return this._columns; }
    set columns(value: (string | GridColumn)[] | undefined) { this._columns = value; this.update(); }

    get title(): StyledText | undefined { return this._title; }
    set title(value: StyledText | undefined) { this._title = value; this.update(); }

    openInEditor(pageTitle?: string): void {
        const title = pageTitle ?? (typeof this._title === "string" ? this._title : "Grid Data");
        const page = pagesModel.addEditorPage("grid-json", "json", title);
        if (isTextFileModel(page)) {
            page.changeContent(JSON.stringify(this._data, null, 2));
        }
    }
}
```

### Step 7: Add ui.show.grid() to UiFacade

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts`

Add import at top:
```typescript
import { Grid } from "./Grid";
```

Add `grid` method to the existing `readonly show` object (alongside `progress`):
```typescript
grid: (dataOrOpts: any[] | { data: any[]; columns?: (string | GridColumn)[]; title?: StyledText }): Grid => {
    let fields: Record<string, any>;
    if (Array.isArray(dataOrOpts)) {
        fields = { data: dataOrOpts };
    } else {
        fields = dataOrOpts;
    }
    const entry = this.vm.addEntry("output.grid", fields);
    return new Grid(entry.id, this.vm, fields as any);
},
```

Also add `GridColumn` to the type import from `logTypes`:
```typescript
import type { StyledText, LogEntry, CheckboxItem, GridColumn } from "../../editors/log-view/logTypes";
```

(Since `logTypes.ts` re-exports `GridColumn` from grid-utils — see Step 3.)

### Step 8: Update script API types

**File:** `src/renderer/api/types/ui-log.d.ts` (and sync to `assets/editor-types/ui-log.d.ts`)

Add new interfaces:
```typescript
// =============================================================================
// Grid Column
// =============================================================================

/** Column definition for grid output. */
export interface IGridColumn {
    /** Property key to access from row objects. */
    key: string;
    /** Display name in header (defaults to key). */
    title?: string;
    /** Column width in pixels. */
    width?: number;
    /** Data type for sorting/alignment. */
    dataType?: "string" | "number" | "boolean";
}

// =============================================================================
// Grid Helper
// =============================================================================

/**
 * Grid helper returned by `ui.show.grid()`.
 * Update properties to change the grid in real-time.
 *
 * @example
 * const grid = ui.show.grid([
 *     { name: "Alice", age: 30 },
 *     { name: "Bob", age: 25 },
 * ]);
 *
 * @example
 * // With columns and title
 * const grid = ui.show.grid({
 *     data: users,
 *     columns: ["name", "age"],
 *     title: "User List",
 * });
 *
 * @example
 * // Column objects with overrides
 * const grid = ui.show.grid({
 *     data: users,
 *     columns: [
 *         { key: "name", width: 200 },
 *         { key: "age", dataType: "number" },
 *     ],
 * });
 *
 * @example
 * // Open in dedicated grid editor
 * grid.openInEditor("My Data");
 */
export interface IGrid {
    /** Grid data (array of objects). Setting triggers re-render. */
    data: any[];
    /** Column definitions — strings or objects. Setting triggers re-render. */
    columns: (string | IGridColumn)[] | undefined;
    /** Grid title. Setting triggers re-render. */
    title: IStyledText | undefined;
    /** Open grid data in a dedicated Grid editor page. */
    openInEditor(pageTitle?: string): void;
}
```

Add `grid` method to `IUiShow` interface:
```typescript
export interface IUiShow {
    // ... existing progress method ...

    /**
     * Show a data grid in the Log View. Returns a Grid helper
     * whose property setters update the grid in real-time.
     *
     * @example
     * // Simple form — array of objects
     * const grid = ui.show.grid([{ name: "Alice", age: 30 }]);
     *
     * @example
     * // Full form with columns and title
     * const grid = ui.show.grid({
     *     data: users,
     *     columns: ["name", "age"],
     *     title: "User List",
     * });
     */
    grid(data: any[]): IGrid;
    grid(options: { data: any[]; columns?: (string | IGridColumn)[]; title?: IStyledText }): IGrid;
}
```

### Step 9: MCP handler — CSV/JSON content parsing

**File:** `src/renderer/api/mcp-handler.ts`

Add import at top:
```typescript
import { csvToRecords } from "../core/utils/csv-utils";
```

In the entry processing logic (inside `handleUiPush` or equivalent), add special handling for `output.grid` BEFORE the generic `output.*` branch:

```typescript
} else if (type === "output.grid") {
    // MCP sends: { content: string, contentType?: "csv" | "json", title? }
    // Parse content to data[] before storing in the entry
    const contentType = fields.contentType ?? "json";
    let data: any[];
    if (contentType === "csv") {
        data = csvToRecords(fields.content, true, ",");
    } else {
        data = JSON.parse(fields.content);
    }
    // Strip content/contentType, keep title and other fields, add parsed data
    const { content: _, contentType: _ct, ...rest } = fields;
    vm.addEntry(type, { ...rest, data });
} else if (typeof type === "string" && type.startsWith("output.")) {
    // Generic output entry — pass full fields object
    vm.addEntry(type, fields);
}
```

**Important:** The `output.grid` case MUST come before the generic `output.*` case.

### Step 10: Update MCP documentation

**File:** `assets/mcp-res-ui-push.md`

Add `output.grid` to the **Output entries** table:
```
| `output.grid` | `content, contentType?, title?` | Tabular data grid (auto-detects columns from data) |
```

Add documentation after the table:
```markdown
**`output.grid` content formats:**

`content` (string) contains the grid data. `contentType` selects the format (default: `"json"`):
- `"json"` — JSON array of objects. Columns are auto-detected from object keys.
- `"csv"` — CSV text. First row is always column headers, comma-delimited.

Examples:
```
// JSON format (default)
{ "type": "output.grid", "content": "[{\"name\":\"Alice\",\"age\":30},{\"name\":\"Bob\",\"age\":25}]", "title": "Users" }

// CSV format
{ "type": "output.grid", "content": "name,age\nAlice,30\nBob,25", "contentType": "csv", "title": "Users" }
```

No separate `columns` parameter — columns are always derived from the data itself.
```

### Step 11: Add test entries

**File:** `D:\js-notepad-notes\temp\test.log.jsonl`

Add test entries (one JSON object per line):
```jsonl
{"type":"output.grid","id":"60","data":[{"name":"Alice","age":30,"city":"NYC"},{"name":"Bob","age":25,"city":"LA"}],"title":"Simple Grid"}
{"type":"output.grid","id":"61","data":[{"name":"Alice","age":30,"city":"NYC"},{"name":"Bob","age":25,"city":"LA"}],"columns":["name","age"],"title":"Grid with string columns"}
{"type":"output.grid","id":"62","data":[{"name":"Alice","age":30,"city":"NYC"},{"name":"Bob","age":25,"city":"LA"}],"columns":[{"key":"name","width":200},{"key":"age","dataType":"number"}],"title":"Grid with column overrides"}
{"type":"output.grid","id":"63","data":[{"id":1,"name":"Item 1","active":true},{"id":2,"name":"Item 2","active":false},{"id":3,"name":"Item 3","active":true},{"id":4,"name":"Item 4","active":false},{"id":5,"name":"Item 5","active":true},{"id":6,"name":"Item 6","active":false},{"id":7,"name":"Item 7","active":true},{"id":8,"name":"Item 8","active":false},{"id":9,"name":"Item 9","active":true},{"id":10,"name":"Item 10","active":false},{"id":11,"name":"Item 11","active":true},{"id":12,"name":"Item 12","active":false},{"id":13,"name":"Item 13","active":true},{"id":14,"name":"Item 14","active":false},{"id":15,"name":"Item 15","active":true},{"id":16,"name":"Item 16","active":false},{"id":17,"name":"Item 17","active":true},{"id":18,"name":"Item 18","active":false},{"id":19,"name":"Item 19","active":true},{"id":20,"name":"Item 20","active":false}],"title":"Scrollable Grid (20 rows)"}
{"type":"output.grid","id":"64","data":[{"x":1,"y":2}]}
```

## Acceptance Criteria

- [ ] `output.grid` entries render an inline AVGrid in the Log View
- [ ] Grid auto-detects columns from object keys when `columns` not provided
- [ ] Grid respects custom `columns` when provided (filters + merges with detected)
- [ ] String shorthand in columns: `["name", "age"]` works
- [ ] Grid auto-sizes height (grows to ~400px, then scrolls)
- [ ] Grid width fits container (`growToWidth="100%"`)
- [ ] Grid is read-only with filtering disabled
- [ ] Title renders above the grid when provided (using DialogHeader)
- [ ] "Open in Grid" hover button (OpenLinkIcon) opens data in a new grid-json editor page
- [ ] `ui.show.grid(data)` works with array of objects (simple form)
- [ ] `ui.show.grid({ data, columns?, title? })` works (full form)
- [ ] `ui.show.grid()` returns Grid helper with data/columns/title setters
- [ ] Grid helper `openInEditor()` method works
- [ ] MCP `output.grid` entries work with `content` (JSON string, default)
- [ ] MCP `output.grid` entries work with `content` + `contentType: "csv"` (CSV string, first row = headers)
- [ ] Script API types (`IGrid`, `IGridColumn`) defined in `ui-log.d.ts` with JSDoc
- [ ] Upsert-by-id works (update grid data in-place via MCP or script)
- [ ] `hidden` removed from `GridColumn` type in grid-utils.ts
- [ ] `DIALOG_CONTENT_MAX_HEIGHT` extracted to shared `logConstants.ts`
- [ ] Test entries in test.log.jsonl verify all scenarios
