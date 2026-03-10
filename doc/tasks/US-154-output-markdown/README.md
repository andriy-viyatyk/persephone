# US-154: Log item: output.markdown (renderer + ui.show.markdown)

**Epic:** EPIC-004 (Log View Editor)
**Status:** Planned
**Depends on:** US-155 (Extract MarkdownBlock reusable component)

## Goal

Add `output.markdown` log entry type that renders markdown content inline in the Log View as a document (no dialog-like border/box). Unlike other output entries, markdown grows to full content height with no max-height cap. Includes a hover "Open in new tab" button positioned in the 40px right gutter column.

## Background

### Prerequisites

US-155 creates a reusable `MarkdownBlock` component extracted from `MarkdownView`. This task uses `MarkdownBlock` for the log entry renderer.

### Existing Patterns

- **MarkdownBlock** (from US-155): Reusable component with full markdown rendering — code blocks, mermaid, tables, task lists, search highlighting, compact mode.
- **TextOutputView** (`src/renderer/editors/log-view/items/TextOutputView.tsx`): Reference for output entry pattern — styled root, DialogHeader, hover actions button.
- **LogEntryWrapper** (`src/renderer/editors/log-view/LogEntryWrapper.tsx`): Wraps all entries with accent border + timestamp.
- **2-column grid**: `LogViewEditor.tsx` uses `RenderFlexGrid` with col 0 (100% content) + col 1 (40px gutter). Currently col 1 returns `null` for all rows.

### MarkdownOutputEntry Type (already defined)

```typescript
// logTypes.ts line 142
export interface MarkdownOutputEntry extends LogEntryBase {
    type: "output.markdown";
    text: string;
}
```

### Grid Cell Layout (Important for Button Placement)

Cells are `position: absolute` with explicit dimensions. Each cell has class `flex-cell flex-cell-row-N`. Grid root has `overflow: hidden`. Content from col 0 cannot overflow into col 1.

## Implementation Plan

### Step 1: Add `title` field to MarkdownOutputEntry

**File:** `src/renderer/editors/log-view/logTypes.ts` (modify)

```typescript
export interface MarkdownOutputEntry extends LogEntryBase {
    type: "output.markdown";
    title?: StyledText;
    text: string;
}
```

### Step 2: Create MarkdownOutputView component

**File:** `src/renderer/editors/log-view/items/MarkdownOutputView.tsx` (new)

Simple wrapper using `MarkdownBlock` from US-155:

```tsx
export function MarkdownOutputView({ entry }: { entry: MarkdownOutputEntry }) {
    return (
        <div style={{ width: "100%" }}>
            <DialogHeader title={entry.title} />
            <MarkdownBlock
                content={entry.text}
                compact
            />
        </div>
    );
}
```

Key design:
- **No border/box** — flat document inline in log
- **No max height** — grows to natural content height
- **Compact mode** — reduced spacing for log context
- **No scroll container** — RenderFlexGrid handles scrolling
- **No search** — no `highlightText` prop

### Step 3: Gutter button — hover detection via row hover state

**Add hover tracking to LogViewModel:**

```typescript
// LogViewState:
hoveredRow: number | null;

// LogViewModel:
private _hoverClearTimer: ReturnType<typeof setTimeout> | null = null;

setHoveredRow = (row: number | null) => {
    if (this._hoverClearTimer) { clearTimeout(this._hoverClearTimer); this._hoverClearTimer = null; }
    if (row === null) {
        // 80ms delay to allow mouse to cross cell gap
        this._hoverClearTimer = setTimeout(() => {
            this.state.update(s => { s.hoveredRow = null; });
        }, 80);
    } else {
        this.state.update(s => { s.hoveredRow = row; });
    }
};
```

**LogEntryWrapper** — add mouse events:
```tsx
<WrapperRoot
    onMouseEnter={() => vm.setHoveredRow(index)}
    onMouseLeave={() => vm.setHoveredRow(null)}
>
```

**LogViewEditor** `renderLogEntry` — render gutter for col 1:
```tsx
if (p.col === 1) {
    return <GutterCell vm={vm} row={p.row} />;
}
```

**GutterCell component:**
- Reads `hoveredRow` from state
- If hovered AND entry has "open" action → shows button
- `onMouseEnter` → `vm.setHoveredRow(row)` (cancels delayed clear)
- `onMouseLeave` → `vm.setHoveredRow(null)`
- `margin-left: -20px` to shift toward content
- `position: sticky; top: 8px` for tall entries (with fallback)

### Step 4: Move TextOutputView "open" button to gutter

**File:** `src/renderer/editors/log-view/items/TextOutputView.tsx` (modify)

Remove the `.text-hover-actions` overlay from TextOutputView. The `GutterCell` now handles "Open in editor" based on entry type. This gives consistent UX — all open actions live in the gutter.

### Step 5: Route entry type in LogEntryContent

**File:** `src/renderer/editors/log-view/LogEntryContent.tsx` (modify)

Add case for `output.markdown`:
```typescript
case "output.markdown":
    return <MarkdownOutputView entry={entry as MarkdownOutputEntry} />;
```

### Step 6: Create Markdown helper class for script API

**File:** `src/renderer/scripting/api-wrapper/Markdown.ts` (new)

```typescript
export class Markdown {
    private _text: string;
    private _title?: StyledText;

    constructor(entryId, vm, initial) { ... }
    private update() { vm.updateEntryById(...) }

    get/set text, title (each setter calls update())

    openInEditor(pageTitle?: string): void {
        const title = pageTitle ?? (typeof this._title === "string" ? this._title : "Markdown");
        const page = pagesModel.addEditorPage("monaco", "markdown", title);
        if (isTextFileModel(page)) page.changeContent(this._text);
    }
}
```

### Step 7: Add `markdown()` to UiFacade

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts` (modify)

```typescript
markdown: (textOrOpts: string | { text: string; title?: StyledText }): Markdown => {
    let fields: Record<string, any>;
    if (isOptionsObject(textOrOpts)) { fields = textOrOpts; }
    else { fields = { text: textOrOpts }; }
    const entry = this.vm.addEntry("output.markdown", fields);
    return new Markdown(entry.id, this.vm, fields as any);
},
```

### Step 8: Add TypeScript types for script API

**File:** `src/renderer/api/types/ui-log.d.ts` (modify)

Add `IMarkdown` interface and overloads to `IUiShow`.

**File:** `assets/editor-types/ui-log.d.ts` — copy from src types.

### Step 9: Update MCP documentation

**File:** `assets/mcp-res-ui-push.md` (modify)

Add `output.markdown` to entry types table and examples.

### Step 10: Add test entries

**File:** `D:\js-notepad-notes\temp\test.log.jsonl` (modify)

Add markdown entries: simple text, headings + code, mermaid diagram, table, task list.

## Concerns / Open Questions

### 1. Sticky button in virtualized grid (Medium risk)

`position: sticky` inside an absolutely-positioned cell may not work. Fallback: non-sticky button at top of gutter cell.

### 2. Hover flicker between cells (Low risk)

80ms delayed clear of `hoveredRow` + gutter `onMouseEnter` cancelling the clear should prevent flicker.

### 3. GutterCell — which entry types get the button?

Initially: `output.markdown` and `output.text`. The GutterCell checks entry type and delegates to the appropriate open action. Could extend to `output.grid` later.

### 4. Open in editor

Uses `pagesModel.addEditorPage("monaco", "markdown", title)` — opens as text with markdown language. User can switch to markdown preview.

## Acceptance Criteria

- [ ] `output.markdown` entries render inline as styled markdown documents (no border/box)
- [ ] Full markdown: headings, code blocks, mermaid, tables, task lists, blockquotes, links, HR
- [ ] No max height — content grows to natural height
- [ ] "Open in new tab" button appears in gutter column on hover
- [ ] Button stays visible (sticky) when scrolling through tall entries
- [ ] Hover detection works reliably between content and gutter
- [ ] TextOutputView "open" button moved to gutter (consistent UX)
- [ ] `ui.show.markdown(text)` script API works
- [ ] `ui.show.markdown({ text, title })` full form works
- [ ] Helper class: `text`, `title` setters + `openInEditor()`
- [ ] MCP `output.markdown` entries render correctly
- [ ] Test entries in test log file
