# US-153: Log item: output.text (renderer + ui.show.text)

**Epic:** EPIC-004
**Status:** Planned

## Goal

Add an `output.text` log entry type that renders a read-only Monaco editor inside the Log View. This enables scripts and AI agents to display syntax-highlighted code/text blocks with configurable options (language, word wrap, line numbers, minimap).

## Background

### Existing patterns

- **Entry type already defined** in `logTypes.ts`: `TextOutputEntry` with `type`, `title`, `text`, `language`
- **Entry routing** in `LogEntryContent.tsx`: currently falls through to `OutputEntryStub`
- **Script API** in `UiFacade.ts`: `show` namespace with `progress()` and `grid()` — follows two-overload pattern
- **Helper classes** in `scripting/api-wrapper/`: `Progress.ts` and `Grid.ts` — property setters call `vm.updateEntryById()`
- **Type definitions** in `ui-log.d.ts`: `IUiShow` interface with `progress()` and `grid()`
- **MCP handler** in `mcp-handler.ts`: already routes `output.*` entries generically — no changes needed
- **`DialogHeader`** component renders optional title bar
- **`DIALOG_CONTENT_MAX_HEIGHT`** = 400px shared constant in `logConstants.ts`
- **GridOutputView** has a hover action button to open data in a separate editor — we should add similar for text

### User requirements

The `ui.show.text()` API should accept these parameters (all optional except `text`):
- `title` — header title (StyledText)
- `text` — the text content (string)
- `language` — Monaco language ID (default: `"plaintext"`)
- `wordWrap` — enable word wrapping (default: `true`)
- `lineNumbers` — show line numbers (default: `false`)
- `minimap` — show minimap (default: `false`)

The view should:
- **Adjust height** to fit content, growing up to `DIALOG_CONTENT_MAX_HEIGHT` (400px), then show scrollbar
- **Use full available width** (unlike grid which uses `fit-content`)

### Monaco embedding approach

Use `monaco.editor.create()` directly in a `useEffect` with a container ref. The editor is:
- **Read-only** — no editing
- **Themed** — inherits from the app theme (Monaco is already configured globally)
- **Minimal chrome** — no scrollbar decorations, no context menu, disabled suggestions
- **Height auto-fit** — compute from line count × line height, capped at max

## Implementation Plan

### Step 1: Update `TextOutputEntry` type in `logTypes.ts`

Add new fields to the existing interface:

```typescript
export interface TextOutputEntry extends LogEntryBase {
    type: "output.text";
    title?: StyledText;
    text: string;
    language?: string;
    wordWrap?: boolean;       // NEW — default true
    lineNumbers?: boolean;    // NEW — default false
    minimap?: boolean;        // NEW — default false
}
```

### Step 2: Create `TextOutputView.tsx` in `items/`

**File:** `src/renderer/editors/log-view/items/TextOutputView.tsx`

Structure:
- `TextOutputRoot` styled component — border, border-radius, overflow hidden, full width
- `DialogHeader` for optional title
- Monaco container div with ref
- `useEffect` to create/dispose Monaco editor instance
- `useEffect` to update content/language/options when entry changes
- Height calculation: `Math.min(lineCount * lineHeight + padding, DIALOG_CONTENT_MAX_HEIGHT)`
- Hover action button: "Open in Text editor" (like GridOutputView's "Open in Grid editor")

Key Monaco options:
```typescript
{
    value: entry.text,
    language: entry.language || "plaintext",
    readOnly: true,
    wordWrap: entry.wordWrap !== false ? "on" : "off",      // default on
    lineNumbers: entry.lineNumbers ? "on" : "off",           // default off
    minimap: { enabled: entry.minimap === true },             // default off
    scrollBeyondLastLine: false,
    renderLineHighlight: "none",
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    folding: false,
    contextmenu: false,
    domReadOnly: true,
    automaticLayout: true,
}
```

Height auto-fit logic:
1. After editor is created, get line count from model
2. Compute height = `lineCount * lineHeight + horizontalScrollbarHeight`
3. Cap at `DIALOG_CONTENT_MAX_HEIGHT`
4. Set container height
5. Trigger `editor.layout()` after resize

### Step 3: Create `Text.ts` helper class in `scripting/api-wrapper/`

**File:** `src/renderer/scripting/api-wrapper/Text.ts`

Following `Grid.ts` pattern:
- Private fields: `_text`, `_language`, `_title`, `_wordWrap`, `_lineNumbers`, `_minimap`
- Getters/setters that call `vm.updateEntryById()`
- `openInEditor(pageTitle?)` method — opens text in a new text editor page

### Step 4: Update `UiFacade.ts` — add `ui.show.text()`

Add to the `show` namespace:

```typescript
text: (textOrOpts: string | { text: string; language?: string; title?: StyledText; wordWrap?: boolean; lineNumbers?: boolean; minimap?: boolean }, language?: string): Text => {
    let fields: Record<string, any>;
    if (isOptionsObject(textOrOpts)) {
        fields = textOrOpts;
    } else {
        fields = { text: textOrOpts, language };
    }
    const entry = this.vm.addEntry("output.text", fields);
    return new Text(entry.id, this.vm, fields as any);
},
```

### Step 5: Update `LogEntryContent.tsx` — route `output.text`

Add case to the output switch:
```typescript
case "output.text":
    return <TextOutputView entry={entry as TextOutputEntry} />;
```

Import `TextOutputView` and `TextOutputEntry`.

### Step 6: Update `ui-log.d.ts` — type definitions

Add `IText` interface and `text()` overloads to `IUiShow`:

```typescript
export interface IText {
    text: string;
    language: string | undefined;
    title: IStyledText | undefined;
    wordWrap: boolean | undefined;
    lineNumbers: boolean | undefined;
    minimap: boolean | undefined;
    openInEditor(pageTitle?: string): void;
}
```

Add to `IUiShow`:
```typescript
text(text: string, language?: string): IText;
text(options: {
    text: string;
    language?: string;
    title?: IStyledText;
    wordWrap?: boolean;
    lineNumbers?: boolean;
    minimap?: boolean;
}): IText;
```

### Step 7: Copy updated type definitions to `assets/editor-types/`

Copy `ui-log.d.ts` to `assets/editor-types/` for Monaco IntelliSense in the script editor.

### Step 8: Update MCP resource guide

Update `assets/mcp-res-ui-push.md` to document `output.text` entry fields.

## Concerns / Open Questions

1. **Monaco instance lifecycle** — Each `output.text` entry creates a Monaco editor instance. In a log with many text outputs, this could be heavy. Since the log is virtualized (RenderFlexGrid), editors outside the viewport are unmounted, but we should ensure proper disposal in the cleanup function.

2. **Theme sync** — Monaco editors created via `monaco.editor.create()` inherit the current theme automatically (since the theme is set globally on `monaco.editor`). No extra work needed.

3. **Height measurement on content change** — When `text` is updated via the helper's setter, we need to recalculate height. The `useEffect` dependency on `entry.text` handles this.

## Acceptance Criteria

- [ ] `output.text` entries render a read-only Monaco editor with syntax highlighting
- [ ] Height auto-fits to content, capped at 400px (then scrollbar)
- [ ] Uses full available width
- [ ] `language` defaults to "plaintext"
- [ ] `wordWrap` defaults to true
- [ ] `lineNumbers` defaults to false (off)
- [ ] `minimap` defaults to false (off)
- [ ] Optional title header displayed via `DialogHeader`
- [ ] Hover action button "Open in Text editor" opens text in a new tab
- [ ] `ui.show.text()` works with simple form `(text, language?)` and full form `({...})`
- [ ] `Text` helper class allows real-time updates via property setters
- [ ] MCP `output.text` entries render correctly
- [ ] Type definitions updated for IntelliSense
- [ ] Monaco editor properly disposed on unmount
