# US-139: Log View editor — basic rendering of log entries

## Status

**Status:** Done
**Priority:** High
**Epic:** EPIC-004
**Depends on:** US-136 (LogEntry types, models, LogViewModel)
**Completed:** 2026-03-09

## Summary

Replace the placeholder LogViewEditor with a fully rendered log view using RenderFlexGrid for virtualization. Implement entry renderers for all log message types (`log.text`, `log.info`, `log.warn`, `log.error`, `log.success`), the LogEntryWrapper container, styled text rendering, and auto-scroll to bottom on new entries.

This task covers **display-only log entries**. Dialog entries and output entries will be rendered in subsequent tasks.

## Why

- US-136 built the data layer (types, models, view model) — this task adds the visual layer
- Without rendering, the Log View editor is just a placeholder showing entry count
- Log message entries are the simplest and most common entry type — good starting point before dialogs/outputs
- Establishes the rendering architecture (wrapper, cell pattern, styled text) that all subsequent entry renderers build upon

## Reference: interactive-script

The rendering approach is inspired by `D:\projects\interactive-script`:

| interactive-script | js-notepad Log View |
|---|---|
| Flat `<div>` list with `overflow-y: auto` | **RenderFlexGrid** — virtualized, variable row heights |
| `OutputItem` component routes by `command` type | `LogEntryContent` routes by `entry.type` |
| `OutputItemWrapper` — generic container | `LogEntryWrapper` — generic container (spacing, timestamp, future actions) |
| `TextWithStyleComponent` renders styled text | `StyledTextView` renders `StyledText` |
| `useItemState()` per-item reactive state | `LogEntryModel.state` (TOneState) |

**Key difference:** interactive-script uses its own virtualized RenderGrid with a custom flexible row height implementation. js-notepad will use RenderFlexGrid — a component that was inspired by interactive-script's flex row height handling but is already integrated into the project (used by Notebook and Todo editors).

## Acceptance Criteria

- [ ] Log entries render with colored text based on level (info=blue, warn=yellow, error=red, success=green, text=default)
- [ ] Each entry is wrapped in `LogEntryWrapper` with consistent spacing and optional timestamp
- [ ] Styled text segments render correctly (plain strings and `StyledSegment[]` arrays)
- [ ] Virtualized rendering via RenderFlexGrid — smooth scrolling with 1000+ entries
- [ ] Variable row heights measured correctly via ResizeObserver (multi-line entries)
- [ ] Auto-scroll to bottom when new entries are added (while user is at bottom)
- [ ] Auto-scroll disabled when user scrolls up manually
- [ ] Model cache eviction works via `onAdjustRenderRange` (models evicted when scrolled out of view)
- [ ] Error state renders properly (parse errors shown in log view)
- [ ] Unknown entry types render a fallback (type + JSON data preview)
- [ ] Empty log shows a centered placeholder message
- [ ] Existing `.log.jsonl` files render correctly when opened

## Technical Approach

### Architecture Overview

```
LogViewEditor (React component)
  └── RenderFlexGrid (virtualized list, 1 column, variable row heights)
        └── renderCell callback
              └── LogEntryWrapper (cell root: ref for measurement, spacing, timestamp, accent)
                    └── LogEntryContent (type-specific renderer)
                          ├── LogMessageView   (log.text/info/warn/error/success)
                          ├── DialogEntryStub  (stub — "Dialog: {type}")
                          ├── OutputEntryStub  (stub — "Output: {type}")
                          └── UnknownEntryView (fallback for unknown types)
```

### Component Details

#### 1. `LogViewEditor.tsx` — Main component (modify existing)

Replace the placeholder with RenderFlexGrid integration:

```typescript
export function LogViewEditor({ model }: { model: TextFileModel }) {
    const vm = useContentViewModel<LogViewModel>(model, "log-view");
    const state = useSyncExternalStore(...); // existing pattern
    const gridModelRef = useRef<RenderGridModel | null>(null);

    // Auto-scroll: track whether user is at bottom
    // On new entries: if at bottom, scrollToRow(entryCount - 1)

    return (
        <LogViewRoot>
            {state.error ? (
                <EditorError>{state.error}</EditorError>
            ) : state.entryCount === 0 ? (
                <div className="log-view-placeholder">No log entries</div>
            ) : (
                <RenderFlexGrid
                    ref={setGridModel}
                    rowCount={state.entryCount}
                    columnCount={1}
                    columnWidth="100%"
                    renderCell={renderLogEntry}
                    fitToWidth
                    minRowHeight={28}
                    getInitialRowHeight={getInitialRowHeight}
                    onAdjustRenderRange={handleRenderRange}
                />
            )}
        </LogViewRoot>
    );
}
```

**Grid model ref** — needed for:
- `gridModelRef.current?.update({ all: true })` when entries array changes
- `gridModelRef.current?.scrollToRow(n)` for auto-scroll
- Accessing `containerRef` for scroll position detection

#### 2. `LogEntryWrapper.tsx` — Cell root + generic entry container

LogEntryWrapper serves as both the RenderFlexGrid cell root (receives `ref` for ResizeObserver measurement) and the visual container for every entry. No separate cell wrapper needed.

```
┌─────────────────────────────────────────────────┐
│ [timestamp]  [entry content]                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

- Horizontal padding, vertical spacing between entries
- Optional timestamp display (formatted as `HH:MM:SS.mmm`)
- Left colored border/accent based on entry type (subtle indicator)
- Future: action buttons on hover, collapse/expand

**Styling approach:** Single styled root with nested class-based styles (project convention).

#### 4. `LogEntryContent.tsx` — Type router

Routes to the correct renderer based on `entry.type`:

```typescript
function LogEntryContent({ entry, vm }: { entry: LogEntry; vm: LogViewModel }) {
    if (entry.type.startsWith("log.")) {
        return <LogMessageView entry={entry} />;
    }
    if (entry.type.startsWith("input.")) {
        return <DialogEntryStub entry={entry} />;  // stub for now
    }
    if (entry.type.startsWith("output.")) {
        return <OutputEntryStub entry={entry} />;  // stub for now
    }
    return <UnknownEntryView entry={entry} />;
}
```

#### 5. `LogMessageView.tsx` — Log message renderer

Renders the five log message types:

| Type | Color | Left border accent |
|------|-------|----|
| `log.text` | `color.text.default` | none |
| `log.info` | `color.misc.blue` | blue |
| `log.warn` | `color.misc.yellow` | yellow |
| `log.error` | `color.misc.red` | red |
| `log.success` | `color.misc.green` | green |

Content is `StyledText` — rendered via `StyledTextView`.

#### 6. `StyledTextView.tsx` — Styled text renderer

Renders `StyledText` (string or `StyledSegment[]`):

```typescript
function StyledTextView({ text }: { text: StyledText }) {
    if (typeof text === "string") {
        return <span>{text}</span>;
    }
    return (
        <>
            {text.map((seg, i) => (
                <span key={i} style={seg.styles}>{seg.text}</span>
            ))}
        </>
    );
}
```

**Concern:** `seg.styles` is `Record<string, string | number>` — arbitrary CSS from user data. See Concerns section.

#### 7. Auto-scroll behavior

Pattern: "stick to bottom" — auto-scroll only when user is already at the bottom.

```typescript
// Track scroll position
const isAtBottom = useRef(true);

// On scroll event from container:
const onScroll = () => {
    const el = gridModelRef.current?.containerRef.current;
    if (!el) return;
    const threshold = 50; // px tolerance
    isAtBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
};

// On new entries (entryCount changed):
useEffect(() => {
    if (isAtBottom.current && state.entryCount > 0) {
        gridModelRef.current?.scrollToRow(state.entryCount - 1, "end");
    }
    gridModelRef.current?.update({ all: true });
}, [state.entryCount]);
```

### LogViewModel Changes

Minor additions needed to support rendering:

1. **Height cache:** `Map<string, number>` storing measured row heights by entry ID. Methods: `getEntryHeight(id): number | undefined`, `setEntryHeight(id, height)`. Used by `getInitialRowHeight` callback.

2. **Grid update trigger:** The existing `state` (with `entryCount`) already drives re-renders. When `entryCount` changes, the effect calls `gridModelRef.current?.update({ all: true })`.

### File Structure

```
src/renderer/editors/log-view/
  logTypes.ts              ← existing (US-136)
  LogEntryModel.ts         ← existing (US-136)
  LogViewModel.ts          ← existing (US-136), add height cache
  LogViewEditor.tsx         ← modify: replace placeholder with RenderFlexGrid
  LogEntryWrapper.tsx       ← new: cell root + generic entry container
  LogEntryContent.tsx       ← new: type router
  LogMessageView.tsx        ← new: log message renderer (5 types)
  StyledTextView.tsx        ← new: styled text segment renderer
```

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/renderer/editors/log-view/LogEntryWrapper.tsx` | Cell root + generic entry container (ref, spacing, timestamp, accent) |
| `src/renderer/editors/log-view/LogEntryContent.tsx` | Type router — dispatches to correct renderer |
| `src/renderer/editors/log-view/LogMessageView.tsx` | Renders log.text/info/warn/error/success entries |
| `src/renderer/editors/log-view/StyledTextView.tsx` | Renders StyledText (plain string or styled segments) |

### Modified Files

| File | Change |
|------|--------|
| `src/renderer/editors/log-view/LogViewEditor.tsx` | Replace placeholder with RenderFlexGrid, auto-scroll, grid model ref |
| `src/renderer/editors/log-view/LogViewModel.ts` | Add height cache (`getEntryHeight`, `setEntryHeight`) |

## Implementation Progress

### Phase 1: Foundation components
- [ ] `StyledTextView` — renders StyledText (string or segments)
- [ ] `LogMessageView` — renders 5 log message types with colors
- [ ] `LogEntryWrapper` — cell root + container (ref, spacing, timestamp, left accent border)
- [ ] `LogEntryContent` — type router (log messages + stubs for dialog/output/unknown)

### Phase 2: Grid integration
- [ ] `LogViewEditor` — replace placeholder with RenderFlexGrid
- [ ] Wire `onAdjustRenderRange` to `vm.setRenderedRange()`
- [ ] Add height cache to `LogViewModel` + `getInitialRowHeight` callback

### Phase 3: Auto-scroll
- [ ] Track scroll position (isAtBottom ref)
- [ ] Auto-scroll to bottom on new entries (when at bottom)
- [ ] Disable auto-scroll when user scrolls up
- [ ] Grid update on entryCount change

### Phase 4: Polish & edge cases
- [ ] Empty state placeholder ("No log entries")
- [ ] Unknown entry type fallback renderer
- [ ] Error state display (parse errors)
- [ ] Test with large files (1000+ entries) — verify smooth scrolling
- [ ] Test with MCP `execute_script` — create entries and verify live rendering

## Concerns

### 1. Styled text CSS injection

**Concern:** `StyledSegment.styles` is `Record<string, string | number>` — arbitrary CSS properties from user data. Passing this directly as React `style` prop could allow unexpected styling (e.g., `position: fixed`, `zIndex: 9999`).

**Options:**
- **A) Whitelist approach:** Only allow specific CSS properties (color, fontWeight, fontStyle, textDecoration, backgroundColor, opacity). Ignore everything else.
- **B) Pass-through:** Trust the data since it's user's own file content — they can already edit the raw JSONL. The data is not from untrusted sources.
- **C) Sanitize:** Strip position, display, z-index and similar layout-breaking properties.

**Recommendation:** Option B (pass-through) for now. The log file is the user's own data. If MCP/scripts produce styled text, those are also authorized by the user. We can add sanitization later if needed.

### 2. Timestamp display — always or configurable?

**Concern:** Showing timestamps on every entry adds visual noise. Some logs have timestamps, some don't. When entries arrive rapidly, timestamps on every line are redundant.

**Options:**
- **A) Always show** if `entry.timestamp` exists (no config).
- **B) Configurable** via a toggle in the log view toolbar (future toolbar task).
- **C) Smart grouping** — show timestamp on the first entry of a group, then suppress for entries within 1 second.

**Recommendation:** Option A for now (show if present). Simple, predictable. A toolbar toggle can be added in a future task when we build the log view toolbar. The timestamp display is part of LogEntryWrapper, so it's easy to change later.

### 3. Left accent border vs colored text

**Concern:** How strongly should we visually differentiate log levels? Too subtle = hard to scan. Too bold = overwhelming.

**Options:**
- **A) Left border accent only** — 3px colored left border (like VS Code terminal messages). Text stays default color.
- **B) Colored text only** — text color matches the level. No border.
- **C) Both** — left border accent + colored text.
- **D) Background tint** — subtle colored background row.

**Recommendation:** Option C (both border and text). It's the most scannable for logs. Info is blue text with blue left border, errors are red text with red border, etc. Plain `log.text` has no border and default text color. This matches how most log viewers work.

### 4. Auto-scroll detection threshold

**Concern:** Detecting "user is at bottom" requires a pixel threshold. Too small = auto-scroll breaks on subpixel rounding. Too large = user must scroll far to disable it.

**Recommendation:** 50px threshold. This is generous enough to handle subpixel issues and small scroll offsets, but small enough that any deliberate upward scroll disables auto-scroll.

### 5. Grid `update({ all: true })` frequency

**Concern:** When a script rapidly appends entries (e.g., 100 entries in 1 second), the debounced content update (300ms) means `entryCount` changes frequently. Each change triggers `gridModelRef.current?.update({ all: true })` which re-renders the entire visible grid.

**Mitigation:** The 300ms debounce on content updates in LogViewModel already batches rapid appends. The grid's `update({ all: true })` is fast — it only re-renders the ~20-30 visible rows. RenderFlexGrid handles this efficiently. If profiling shows issues, we can add row-level updates (`update({ rows: [newRowIndex] })`) instead of `{ all: true }`.

### 6. Dialog/output entry stubs

**Concern:** This task only implements log message rendering. Dialog and output entries will show stubs. Should stubs be visible or hidden?

**Recommendation:** Visible stubs showing the entry type and a brief summary. E.g., `"[Dialog: input.text] Enter your name"` or `"[Output: progress] Loading... 50%"`. This makes the log readable even before those renderers are implemented, and helps with testing.

## Notes

### 2026-03-09
- Task created as second rendering task of EPIC-004
- Follows US-136 (data layer) — this is the visual layer
- Scope limited to log message entries (display-only) — dialogs and outputs are separate tasks
- Uses RenderFlexGrid (same as Notebook and Todo editors) for virtualization
- LogEntryWrapper is intentionally minimal now — designed as extension point for future actions/toolbar

## Related

- **Depends on:** [US-136 — Define LogEntry types, models, and LogViewModel](../US-136-log-view-types/README.md)
- Epic: [EPIC-004 — Log View Editor](../../epics/EPIC-004.md)
- Pattern reference: [NotebookEditor](../../../src/renderer/editors/notebook/NotebookEditor.tsx), [TodoEditor](../../../src/renderer/editors/todo/TodoEditor.tsx)
- Infrastructure: [RenderFlexGrid](../../../src/renderer/components/virtualization/RenderGrid/RenderFlexGrid.tsx)
