# US-155: Extract MarkdownBlock reusable component

**Epic:** EPIC-004 (Log View Editor) — prerequisite for US-154
**Status:** Planned

## Goal

Extract the core markdown rendering from `MarkdownView` into a reusable `MarkdownBlock` component. This enables the same rich markdown rendering (code blocks, mermaid, tables, task lists, etc.) to be used in both the markdown editor page and the upcoming Log View `output.markdown` entry.

## Background

### Current Architecture

`MarkdownView` (`src/renderer/editors/markdown/MarkdownView.tsx`) mixes:
1. **Content rendering** — ReactMarkdown + plugins + CSS styles + components (CodeBlock, PreBlock, checkbox, link)
2. **Page shell** — scroll container, minimap, toolbar portal, compact toggle, editorConfig
3. **Search** — search bar UI, keyboard shortcuts, rehype highlight plugin, match navigation
4. **ViewModel** — `MarkdownViewModel` (ContentViewModel subclass) managing search state, scroll position, focus events

### What Gets Extracted

`MarkdownBlock` is a pure rendering component:
- All markdown CSS styles (headings, code, tables, lists, blockquotes, mermaid, etc.)
- `ReactMarkdown` with `remarkGfm` + `rehypeRaw` + conditionally `createRehypeHighlight`
- `getComponents()` with `CodeBlock`, `createPreBlock`, checkbox input, link resolver
- Mermaid theme detection
- Compact mode CSS
- Search highlight match counting and navigation (via `useImperativeHandle`)

### What Stays in MarkdownView

The editor page shell:
- `MdViewRoot` with layout styles (flex, overflow, scroll container, scrollbar)
- `MarkdownSearchBar` UI
- Keyboard shortcuts (Ctrl+F, Escape, F3)
- Minimap integration
- Toolbar portal (compact toggle button)
- `MarkdownViewModel` (simplified — delegates match counting/navigation to handle)
- `editorConfig` integration
- Context menu for links

## Implementation Plan

### Step 1: Create MarkdownBlock component

**File:** `src/renderer/editors/markdown/MarkdownBlock.tsx` (new)

```typescript
export interface MarkdownBlockProps {
    /** Markdown content to render. */
    content: string;
    /** Text to highlight (search). Empty/undefined = no highlight. */
    highlightText?: string;
    /** Use compact mode (reduced font, spacing). */
    compact?: boolean;
    /** File path for resolving relative links. */
    filePath?: string;
    /** Additional CSS class on the root element. */
    className?: string;
    /** Inline style on the root element. */
    style?: React.CSSProperties;
}

export interface MarkdownBlockHandle {
    /** The root DOM element. */
    readonly container: HTMLDivElement | null;
    /** Number of search highlight matches. */
    readonly totalMatches: number;
    /** Scroll to and highlight the Nth match (0-based). */
    scrollToMatch(index: number): void;
}
```

**Implementation details:**

1. **Styled root** (`MarkdownBlockRoot`): Move ALL markdown content CSS from `MdViewRoot` — code blocks, mermaid, headings, tables, lists, blockquotes, task lists, etc. Also move compact mode overrides.

2. **ReactMarkdown setup**: Move `getComponents()`, `remarkPlugins`, `rehypePlugins` logic. The `highlightText` prop drives `createRehypeHighlight` plugin inclusion.

3. **Mermaid theme**: Use `settings.use("theme")` + `isCurrentThemeDark()` internally. Check `content.includes("` `` ``` ``mermaid")` to optimize — only create mermaid-aware PreBlock when needed.

4. **useImperativeHandle**: Expose the handle. Match counting runs in a `useEffect` after render — query `.highlighted-text` spans, store count.

5. **scrollToMatch(index)**: Remove old `.highlighted-text-active`, add to new span, call `scrollIntoView({ block: "center", behavior: "smooth" })`.

6. **Link handling**: `resolveRelatedLink(filePath, href)` for relative links. The `filePath` prop is optional (empty string default).

7. **Context menu for links**: Move the `onContextMenu` handler that adds "Copy Link" and "Open" menu items. This is content-level behavior, not page-level.

### Step 2: Refactor MarkdownView to use MarkdownBlock

**File:** `src/renderer/editors/markdown/MarkdownView.tsx` (modify)

Slim down to page shell:

```tsx
export function MarkdownView({ model }: MarkdownViewProps) {
    const vm = useContentViewModel<MarkdownViewModel>(model, "md-view");
    const blockRef = useRef<MarkdownBlockHandle>(null);
    const editorConfig = useEditorConfig();
    // ... state subscriptions ...

    return (
        <>
            {/* Toolbar portal (compact toggle) */}
            <MdViewRoot className={...} style={rootStyle}>
                {showSearchBar && <MarkdownSearchBar ... />}
                <div className="md-scroll-container" ref={vm.setContainer} onScroll={vm.containerScroll}>
                    <MarkdownBlock
                        ref={blockRef}
                        content={content}
                        highlightText={highlightText}
                        compact={compact}
                        filePath={filePath}
                    />
                </div>
                {showMinimap && <Minimap scrollContainer={...} />}
            </MdViewRoot>
        </>
    );
}
```

**MdViewRoot** retains only shell styles:
- Root flex layout (`flex: 1 1 auto`, overflow, outline)
- `.md-scroll-container` (flex, padding, font family/size/line-height, overflow, scrollbar hiding)
- `.show-scrollbar` scrollbar visibility toggle
- `max-width`, `word-wrap` on children

Everything else (code blocks, headings, tables, etc.) moves to `MarkdownBlockRoot`.

### Step 3: Simplify MarkdownViewModel

**File:** `src/renderer/editors/markdown/MarkdownViewModel.ts` (modify)

Remove DOM-querying methods that move into `MarkdownBlockHandle`:
- `updateMatchNavigation` → replaced by reading `blockRef.current.totalMatches`
- `navigateToMatch` → replaced by `blockRef.current.scrollToMatch(index)`
- `applyActiveMatchClass` → internal to MarkdownBlock
- `clearActiveMatchClass` → internal to MarkdownBlock
- `scrollToActiveMatch` → internal to MarkdownBlock

The ViewModel keeps:
- Search state management (`searchVisible`, `searchText`, `currentMatchIndex`, `totalMatches`)
- `openSearch`, `closeSearch`, `setSearchText`, `nextMatch`, `prevMatch` methods
- Compact mode toggle
- Scroll position restoration
- Focus event handling

The MarkdownView component bridges the ViewModel and the MarkdownBlock handle:
- After render / on state change, sync `vm.state.totalMatches` from `blockRef.current.totalMatches`
- On `nextMatch`/`prevMatch`, call `blockRef.current.scrollToMatch(newIndex)`

### Step 4: Verify no visual regression

Test the markdown editor page:
- [ ] Normal and compact rendering
- [ ] Code blocks with syntax highlighting
- [ ] Mermaid diagrams
- [ ] Tables
- [ ] Task lists (checkboxes)
- [ ] Search (Ctrl+F, highlight, prev/next, match count)
- [ ] Minimap
- [ ] Scroll restoration on tab switch
- [ ] Links (click, context menu, relative links)
- [ ] Embedded in notebook (maxEditorHeight, hideMinimap)

## Concerns / Open Questions

### 1. Search timing

Currently `MarkdownViewModel.updateMatchNavigation()` runs on a `setTimeout(0)` after state change. With MarkdownBlock, match counting happens in `useEffect` after React render. The parent (MarkdownView) needs to read the new `totalMatches` from the handle after the block re-renders.

**Approach:** MarkdownBlock fires an optional `onMatchCountChange(count)` callback from its `useEffect`, which the parent uses to sync ViewModel state. This avoids polling.

### 2. Minimap scroll container

The Minimap component needs a scroll container ref. Currently `vm.state.container` holds this. With MarkdownBlock, the scroll container is the `.md-scroll-container` div in MarkdownView (not the MarkdownBlock root). No change needed — `vm.setContainer` still gets the scroll container ref.

### 3. Notebook embedding

The markdown editor can be embedded in notebook cells with `editorConfig.maxEditorHeight` and `editorConfig.hideMinimap`. These are page-level concerns that stay in MarkdownView. The MarkdownBlock just receives `compact` and renders. The `maxEditorHeight` style is on `MdViewRoot`.

### 4. `highlightText` from editorConfig vs search bar

MarkdownView has two sources of highlight text: its own search bar and `editorConfig.highlightText` (from notebook). The priority logic stays in MarkdownView — it computes the effective `highlightText` and passes it as a prop to MarkdownBlock.

## Acceptance Criteria

- [ ] `MarkdownBlock` component created with full markdown rendering
- [ ] `MarkdownBlockHandle` exposes `container`, `totalMatches`, `scrollToMatch()`
- [ ] `MarkdownView` refactored to use `MarkdownBlock` — thin page shell
- [ ] `MarkdownViewModel` simplified — no direct DOM queries
- [ ] All existing markdown features work: code, mermaid, tables, task lists, search, minimap, compact
- [ ] No visual regression in markdown editor
- [ ] Notebook embedding still works (maxEditorHeight, hideMinimap)
- [ ] `MarkdownBlock` is independently usable (no dependency on MarkdownViewModel or page lifecycle)
