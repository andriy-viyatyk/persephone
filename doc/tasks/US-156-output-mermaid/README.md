# US-156: Log item: output.mermaid (renderer + ui.show.mermaid)

**Epic:** EPIC-004 (Log View Editor)
**Status:** Planned

## Goal

Add `output.mermaid` log entry type that renders mermaid diagrams inline in the Log View, with a script API (`ui.show.mermaid()`), MCP support, and hover action buttons (copy image, open in Mermaid editor).

## Background

### Existing Mermaid Infrastructure

The codebase has solid mermaid rendering utilities already:

- **`src/renderer/editors/mermaid/render-mermaid.ts`** — Shared rendering:
  - `renderMermaidSvg(content, lightMode)` — renders mermaid text to SVG string via `mermaid.render()`
  - `svgToDataUrl(svg, backgroundColor?, fixContrast?)` — converts SVG to data URL for `<img>` tags
  - `renderMermaid(content, lightMode)` — convenience: render + convert to data URL
  - Handles dark/light theme, text contrast fixing, viewBox dimensions
  - Lazy imports `mermaid` library (async)

- **`src/renderer/editors/markdown/CodeBlock.tsx`** — `MermaidBlock` component (lines 98-158):
  - Renders mermaid code blocks inside markdown
  - Pattern: `useEffect` → `renderMermaidSvg()` → `svgToDataUrl()` → `<img src={svgUrl}>`
  - Loading state: "Rendering..." text
  - Error state: red error message
  - Hover toolbar with **Copy** and **Open in Editor** buttons
  - Opens in mermaid-view editor: `pagesModel.addEditorPage("mermaid-view", "mermaid", "Mermaid Diagram")`

- **`src/renderer/editors/mermaid/MermaidView.tsx`** — Standalone mermaid page editor (uses `BaseImageView`)

### Existing Type Stub

`logTypes.ts` already has the `MermaidOutputEntry` interface and `"output.mermaid"` in `OUTPUT_TYPES`:

```typescript
export interface MermaidOutputEntry extends LogEntryBase {
    type: "output.mermaid";
    text: string;
}
```

### Pattern to Follow

This task follows the exact same pattern as US-154 (output.markdown):
- `MarkdownOutputView.tsx` → `MermaidOutputView.tsx`
- `Markdown.ts` helper → `Mermaid.ts` helper
- UiFacade `show.markdown()` → `show.mermaid()`
- Same hover button pattern (CSS `:hover` on item, top-right corner)

Key difference: markdown uses `MarkdownBlock` for rendering; mermaid uses `renderMermaidSvg()` + `svgToDataUrl()` + `<img>` tag (async rendering with loading/error states).

## Implementation Plan

### 1. Add `title` field to `MermaidOutputEntry` (logTypes.ts)

File: `src/renderer/editors/log-view/logTypes.ts`

Add optional `title?: StyledText` to the existing stub:

```typescript
export interface MermaidOutputEntry extends LogEntryBase {
    type: "output.mermaid";
    title?: StyledText;
    text: string;
}
```

### 2. Create `MermaidOutputView.tsx` component

File: `src/renderer/editors/log-view/items/MermaidOutputView.tsx`

Renders mermaid diagram inline in Log View. Based on `MermaidBlock` from CodeBlock.tsx but adapted for Log View context:

- **Rendering**: `useEffect` with `renderMermaidSvg()` → `svgToDataUrl()` → `<img>` (same as MermaidBlock)
- **Theme**: Subscribe to theme changes via `settings.use("theme")` + `isCurrentThemeDark()`
- **States**: Loading ("Rendering..."), Error (red message), Rendered (`<img>` with data URL)
- **Title**: `DialogHeader` for optional title (same as MarkdownOutputView)
- **Hover actions** (top-right corner, CSS `:hover` pattern):
  - **Copy image** button — copy rendered diagram to clipboard as PNG (reuse `copyImageToClipboard` logic from CodeBlock.tsx)
  - **Open in Mermaid editor** button — `pagesModel.addEditorPage("mermaid-view", "mermaid", title)`
- **Image sizing**: `max-width: 100%`, `height: auto`, centered
- **Single styled root** with nested class-based styles (project convention)

Note: The `copyImageToClipboard` function in CodeBlock.tsx is a module-level function (not exported). We should either:
- (a) Extract it to a shared utility, or
- (b) Duplicate it in MermaidOutputView (it's only 10 lines)

Decision: **(b) Duplicate** — it's tiny and avoids coupling two unrelated files. If a third usage appears, refactor then.

### 3. Wire into LogEntryContent.tsx

File: `src/renderer/editors/log-view/LogEntryContent.tsx`

Add case to the output entry switch:
```typescript
case "output.mermaid":
    return <MermaidOutputView entry={entry as MermaidOutputEntry} />;
```

Add dynamic import for `MermaidOutputView` (same pattern as other output views).

### 4. Create `Mermaid.ts` helper class

File: `src/renderer/scripting/api-wrapper/Mermaid.ts`

Same pattern as `Markdown.ts`:
- Properties: `text` (string), `title` (StyledText | undefined)
- Each setter calls `vm.updateEntryById()`
- `openInEditor(pageTitle?)` — opens in mermaid-view editor
- `copyToClipboard()` — renders and copies as PNG (nice-to-have, may skip if complex)

Actually, skip `copyToClipboard()` on the helper — it requires DOM access (canvas, img element) which is awkward from script context. Keep it UI-only via hover button.

### 5. Add `show.mermaid()` to UiFacade.ts

File: `src/renderer/scripting/api-wrapper/UiFacade.ts`

Two-overload pattern:
```typescript
mermaid: (textOrOpts: string | { text: string; title?: StyledText }): Mermaid => {
    // same pattern as markdown()
}
```

### 6. Update type definitions

Files: `src/renderer/api/types/ui-log.d.ts` AND `assets/editor-types/ui-log.d.ts` (kept in sync)

Add `IMermaid` interface and `mermaid()` overloads to `IUiShow`:

```typescript
interface IMermaid {
    /** The mermaid diagram source text. */
    text: string;
    /** Optional title displayed above the diagram. */
    title: StyledText | undefined;
    /** Open the mermaid source in the Mermaid editor. */
    openInEditor(pageTitle?: string): void;
}
```

### 7. Update MCP resource documentation

File: `assets/mcp-res-ui-push.md`

- Add `output.mermaid` to the entry types table: `output.mermaid | text, title? | Rendered mermaid diagram`
- Add example in examples section

No MCP handler changes needed — `output.mermaid` routes via the generic `output.*` handler.

### 8. Add test entries to test.log.jsonl

File: `D:\js-notepad-notes\temp\test.log.jsonl`

Add mermaid test entries:
- Simple flowchart
- Sequence diagram
- Diagram with title

## Concerns / Open Questions

1. **Async rendering in virtualized list (Low risk)** — Mermaid rendering is async (imports library, renders SVG). When a mermaid entry scrolls into view, it starts rendering. When it scrolls out, the component unmounts. If the user scrolls fast, this creates render/unmount cycles. Mitigation: The rendered `svgUrl` is stored via `useState` — React's normal lifecycle handles this. The mermaid library stays cached after first import. Worst case: user sees brief "Rendering..." flicker when scrolling back. This matches the existing MermaidBlock behavior in markdown and is acceptable.

2. **Height changes during rendering (Low risk)** — The entry starts at "Rendering..." height, then expands to diagram height. RenderFlexGrid's ResizeObserver handles this via height cache invalidation. Same pattern as output.text (Monaco height auto-fit) and output.markdown (MarkdownBlock expansion). No special handling needed.

3. **Copy image to clipboard** — The `copyImageToClipboard` helper draws `<img>` → `<canvas>` → blob → clipboard. This requires the image to be fully loaded. Use `imgRef.current` with `naturalWidth/naturalHeight`. Same proven pattern from CodeBlock.tsx.

## Acceptance Criteria

- [ ] `output.mermaid` entries render mermaid diagrams inline in the Log View
- [ ] Loading state shows "Rendering..." while diagram is being generated
- [ ] Error state shows error message if mermaid syntax is invalid
- [ ] Diagram respects current theme (light/dark)
- [ ] Hover shows action buttons: Copy image, Open in Mermaid editor
- [ ] Copy copies diagram as PNG to clipboard
- [ ] Open creates a new mermaid-view page with the source text
- [ ] `ui.show.mermaid(text)` and `ui.show.mermaid({ text, title })` work from scripts
- [ ] `Mermaid` helper supports live updates via `text` and `title` setters
- [ ] MCP `output.mermaid` entries work via `ui_push`
- [ ] Test entries render correctly in test.log.jsonl
- [ ] Type definitions updated in both `.d.ts` files
