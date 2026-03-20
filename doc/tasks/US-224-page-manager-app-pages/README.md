# US-224: PageManager for App Pages — Portal-Based DOM Stability with Grouping

## Goal

Apply the portal-based `PageManager` pattern (from US-223) to the main app page rendering in `Pages.tsx`. Pages should never be destroyed/recreated when the page array changes (pages closed, reordered, grouped, ungrouped). This requires an extended PageManager that handles page grouping (side-by-side split view) imperatively, outside of React's reconciliation.

**Scope:** Replace the current `Pages.tsx` rendering with an imperative PageManager that supports grouping/ungrouping without destroying page DOM.

**Reference:** US-223 task document at `doc/tasks/US-223-page-manager-portals/README.md` and implementation at `src/renderer/components/page-manager/PageManager.tsx`.

## Background

### Current Architecture

**File:** `src/renderer/ui/app/Pages.tsx`

The `Pages` component (line 251-272) renders pages via `.map()`:
```tsx
const pagesToRender = pgs.filter((p) => !rightLeft.has(p.id));
return pagesToRender.map((page) => (
    <RenderGroupedPages
        key={`group-page-${page.id}`}
        model={page}
        groupedModel={pagesModel.getGroupedPage(page.id)}
        isActive={page === activePage || page === groupedPage}
    />
));
```

`RenderGroupedPages` (lines 103-249) has three rendering modes:
1. **Single page** (no grouping): `SinglePageRoot` with `NavPanelWrapper` + `PageEditorContainer` + `RenderEditor`
2. **Compare mode** (grouped + text + compareMode): `SinglePageRoot` with `CompareEditor` (Monaco DiffEditor)
3. **Grouped pages** (split view): `GroupedPagesRoot` with two `page-container` divs, a `Splitter`, and a `ResizeObserver`

### Current Grouping Implementation

**File:** `src/renderer/api/pages/PagesLayoutModel.ts`

- `state.leftRight: Map<string, string>` — left page ID → right page ID
- `state.rightLeft: Map<string, string>` — right page ID → left page ID (bidirectional)
- Pages can be grouped regardless of their position in the `pages` array (non-adjacent grouping)
- Right-pane pages are filtered out of `pagesToRender` — they render inside their left partner's `GroupedPagesRoot`

### The Problem

When pages are reordered, closed, grouped, or ungrouped, React's reconciliation may detach and reinsert DOM nodes. This causes:
- **Scroll position loss** in editors, grids, and markdown previews
- **Webview/iframe reload** if a browser editor page is reordered (though US-223 mitigated this within the browser editor itself, the outer page container can still be recreated)
- **State loss** in canvas-based editors (Draw/Excalidraw)

Additionally, when grouping/ungrouping:
- A page transitions from `SinglePageRoot` → inside `GroupedPagesRoot` (or vice versa). React sees an entirely different component tree and **destroys and recreates** the page's editor DOM.
- The `RenderEditor` component and all its children are unmounted and remounted, losing editor state.

### Why the Current PageManager (US-223) Is Not Sufficient

The US-223 `PageManager` handles a flat list of pages with `display: none` visibility toggling. It doesn't support:
- Grouping two placeholders into a side-by-side split view
- Resizable splitter between grouped pages
- ResizeObserver for proportional width adjustment on window resize
- Ungrouping back to single view without DOM recreation
- Compare mode (where two pages share a single Monaco DiffEditor)

## Design

### Core Idea

Instead of React managing page containers (SinglePageRoot / GroupedPagesRoot), we manage them imperatively:

1. **Each page gets a permanent placeholder div** — created once, never destroyed until the page closes
2. **Grouping = reparenting placeholders** into a split container div (imperatively)
3. **Ungrouping = moving placeholders back** to the main container
4. **Splitter and resize logic are imperative** — no React component, just DOM elements and event listeners
5. **React renders page content via portals** into placeholders — content is never affected by container changes

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Imperative container (not React-managed)           │
│                                                     │
│  Mode A: Single pages                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ page-A   │ │ page-B   │ │ page-C   │            │
│  │ (active) │ │ (hidden) │ │ (hidden) │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│                                                     │
│  Mode B: Page-B and Page-C are grouped              │
│  ┌──────────┐ ┌─────────────────────────────┐       │
│  │ page-A   │ │ group-container (active)    │       │
│  │ (hidden) │ │ ┌─────────┐ ║ ┌──────────┐ │       │
│  │          │ │ │ page-B  │ ║ │ page-C   │ │       │
│  │          │ │ │ (left)  │ ║ │ (right)  │ │       │
│  │          │ │ └─────────┘ ║ └──────────┘ │       │
│  │          │ │        splitter             │       │
│  │          │ └─────────────────────────────┘       │
│  └──────────┘                                       │
│                                                     │
│  createPortal(content-A, page-A)                    │
│  createPortal(content-B, page-B)                    │
│  createPortal(content-C, page-C)                    │
└─────────────────────────────────────────────────────┘
```

**Key insight:** Page placeholders are **never destroyed** during grouping/ungrouping. They are just **moved** between the main container and group-container divs. Moving a DOM node (via `appendChild`) does **NOT** cause its children to reload — iframes, webviews, canvases, scroll positions all survive.

### Imperative Splitter

The split between grouped pages needs:
- A draggable divider element (the splitter bar)
- PointerEvents-based drag tracking (setPointerCapture)
- A `ResizeObserver` on the group container for proportional resize
- Double-click to reset to 50/50

This can be implemented as a plain class (not a React component):

```typescript
class ImperativeSplitter {
    readonly element: HTMLDivElement;
    private widthK = 0.5;
    private observer: ResizeObserver;

    constructor(
        private container: HTMLDivElement,
        private leftPane: HTMLDivElement,
        private rightPane: HTMLDivElement,
    ) { ... }

    dispose() { ... }
}
```

### Compare Mode

Compare mode is a special case where two text pages share a single `CompareEditor` (Monaco DiffEditor). This is fundamentally different from split view — it renders a **single** component spanning both pages.

**Options:**
1. **Keep compare mode as-is** — when entering compare mode, the portal content changes to `CompareEditor`. The page placeholders are still stable, only the React content inside changes. This means the editor DOM is recreated when entering/leaving compare mode, but that's acceptable because Monaco DiffEditor is a completely different component from the regular Monaco editor anyway.
2. **Render compare mode inside the group container** — the group container switches between split-with-splitter and single-CompareEditor modes.

**Recommendation:** Option 1 is simpler. Compare mode already involves swapping the editor component, so DOM recreation is expected there.

## Implementation Plan

### Step 1: Create `AppPageManager` Component

**File:** `src/renderer/components/page-manager/AppPageManager.tsx` (new)

Extends the portal-based approach with grouping support:

```typescript
interface AppPageManagerProps {
    /** All page IDs */
    pageIds: string[];
    /** Active page ID */
    activeId: string;
    /** Grouped page ID (if active page is part of a group) */
    groupedActiveId?: string;
    /** Grouping map: left page ID → right page ID */
    grouping: Map<string, string>;
    /** Compare mode pages (rendered differently) */
    compareModeIds: Set<string>;
    /** Render function for page content */
    renderPage: (id: string) => ReactNode;
    /** Render function for compare mode */
    renderCompare?: (leftId: string, rightId: string) => ReactNode;
    /** Optional CSS class */
    className?: string;
}
```

**Internal state:**
- `placeholders: Map<string, HTMLDivElement>` — one per page, never destroyed until page closes
- `groupContainers: Map<string, GroupContainer>` — one per grouped pair (keyed by left page ID)

**GroupContainer structure:**
```
group-div (position: absolute, inset: 0, display: flex)
├── left-pane-wrapper (holds left page placeholder)
├── splitter-div (draggable, 8px wide)
└── right-pane-wrapper (holds right page placeholder)
```

**Lifecycle operations:**
- **New page:** Create placeholder, append to main container
- **Page closed:** Remove placeholder from parent (main or group container), delete
- **Group:** Create `GroupContainer`, move left and right placeholders into it, append group-div to main container
- **Ungroup:** Move placeholders back to main container, dispose `GroupContainer`
- **Active page changes:** Toggle `display: none` on all top-level elements (placeholders and group-divs), show only the one containing the active page

### Step 2: Implement `ImperativeSplitter`

**File:** `src/renderer/components/page-manager/ImperativeSplitter.ts` (new)

A plain TypeScript class managing the splitter bar:

- Creates a `<div>` element styled as the splitter
- Attaches `pointerdown` / `pointermove` / `pointerup` listeners
- Uses `setPointerCapture` for reliable drag tracking
- Maintains `widthK` proportion ratio
- `ResizeObserver` on the container adjusts left pane width proportionally on resize
- Double-click resets to 50/50
- `dispose()` removes listeners and observer

### Step 3: Implement `GroupContainer`

**File:** `src/renderer/components/page-manager/GroupContainer.ts` (new)

A plain TypeScript class managing the grouped page layout:

```typescript
class GroupContainer {
    readonly element: HTMLDivElement;
    private leftWrapper: HTMLDivElement;
    private rightWrapper: HTMLDivElement;
    private splitter: ImperativeSplitter;

    constructor(leftPlaceholder: HTMLDivElement, rightPlaceholder: HTMLDivElement) {
        // Create group-div, wrappers, move placeholders into wrappers
        // Initialize splitter
    }

    dispose() {
        // Move placeholders back out, remove splitter, remove group-div
    }
}
```

### Step 4: Integrate NavPanel

**Current:** `NavPanelWrapper` renders inside each `page-container` div as a React component.

**With AppPageManager:** NavPanel content will be rendered inside the portal (as part of `renderPage`). The placeholder div already acts as the page container. NavPanel is a React component, so it renders naturally inside the portal.

The `renderPage` callback will return:
```tsx
renderPage={(id) => {
    const page = pagesById.get(id)!;
    return (
        <>
            <NavPanelWrapper model={page} />
            <PageEditorContainer>
                <RenderEditor model={page} />
            </PageEditorContainer>
        </>
    );
}}
```

### Step 5: Replace `Pages.tsx` Rendering

**File:** `src/renderer/ui/app/Pages.tsx`

Replace the current `.map()` + `RenderGroupedPages` with `<AppPageManager>`. The `Pages` component becomes:

```tsx
export function Pages() {
    const { pages, leftRight, rightLeft } = pagesModel.state.use();
    const activePage = pagesModel.activePage;
    const groupedPage = pagesModel.groupedPage;

    // Collect compare mode pages
    const compareModeIds = useMemo(() => {
        const set = new Set<string>();
        for (const page of pages) {
            if (isTextFileModel(page) && page.state.get().compareMode) {
                set.add(page.id);
            }
        }
        return set;
    }, [pages]);

    return (
        <AppPageManager
            pageIds={pages.map(p => p.id)}
            activeId={activePage?.id ?? ""}
            groupedActiveId={groupedPage?.id}
            grouping={leftRight}
            compareModeIds={compareModeIds}
            renderPage={(id) => {
                const page = pages.find(p => p.id === id)!;
                return (
                    <>
                        <NavPanelWrapper model={page} />
                        <PageEditorContainer>
                            <RenderEditor model={page} />
                        </PageEditorContainer>
                    </>
                );
            }}
            renderCompare={(leftId, rightId) => {
                const left = pages.find(p => p.id === leftId)!;
                const right = pages.find(p => p.id === rightId)!;
                if (isTextFileModel(left) && isTextFileModel(right)) {
                    return <CompareEditor model={left} groupedModel={right} />;
                }
                return null;
            }}
        />
    );
}
```

### Step 6: Deferred Rendering

The current `hasBeenActiveRef` pattern defers rendering until a page is first activated. With portals, we have two options:

1. **Defer portal creation** — don't create the portal until the page is first activated. After that, keep it forever (display: none when inactive). This matches the current behavior.
2. **Always create portals** — simpler, but mounts all editors immediately (higher initial cost).

**Recommendation:** Option 1 — maintain the deferred pattern. Track "has been active" per page ID in a `Set<string>` ref inside `AppPageManager`. Only create portals for pages that have been active at least once.

### Step 7: Styling

The imperative elements need styles matching the current theme:
- Group container: `display: flex`, `flex-direction: row`, `overflow: hidden`
- Splitter: 8px wide, hover highlight, `cursor: ew-resize`
- Page placeholders when inside group: `display: flex`, `flex-direction: row`, `position: relative`, `overflow: hidden`
- Page placeholders when standalone: `position: absolute`, `inset: 0`, `display: flex`, `flex-direction: row`

**Theme colors:** The app uses CSS variables for theming (similar to VSCode) — theme switching updates CSS variables, not React context. Imperative elements should use CSS variable references (e.g., `var(--background-dark)`) in their styles instead of reading `color.ts` values directly. This ensures automatic theme switching support with zero extra work. Check exact CSS variable names used in the existing theme system.

### Step 8: Testing

Manual testing only.

1. **Basic page operations:**
   - Open 5+ pages of different types (text, grid, markdown, browser, PDF)
   - Close first page → remaining pages should NOT lose scroll position
   - Close middle page → same
   - Reorder pages via drag → pages should NOT re-render

2. **Grouping:**
   - Group two pages → both should keep their state (scroll position, selection, form data)
   - Ungroup → both should keep their state
   - Group, resize splitter, ungroup, re-group → splitter position may reset (acceptable)

3. **Compare mode:**
   - Group two text pages → split view
   - Enable compare mode → Monaco DiffEditor appears
   - Disable compare mode → pages return to split view with state preserved

4. **NavPanel:**
   - Open NavPanel on a page, group it → NavPanel should still work
   - Resize NavPanel in grouped mode → should work

5. **Window resize:**
   - Group two pages, resize window → proportional resize should work
   - Splitter double-click → reset to 50/50

6. **Edge cases:**
   - Group a browser page with a text page → browser webview should not reload
   - Close the left page of a group → group dissolves, right page becomes standalone
   - Close the right page of a group → same

## Resolved Concerns

1. **DOM reparenting and webview/iframe survival** — Will implement and test. If Electron webviews don't survive `appendChild` reparenting, fallback to CSS-based visual positioning.
2. **Theme colors** — App uses CSS variables (VSCode-style). Imperative elements should use `var(--xxx)` references — auto-updates on theme switch, no listeners needed.
3. **Splitter state persistence** — Not persisted currently. Keep position in memory while grouped; reset to 50/50 on app restart. Acceptable.
4. **Multiple styled components** — Clean up unused `SinglePageRoot`/`GroupedPagesRoot` after implementation. `PageEditorContainer` stays (used inside portals).
5. **NavPanel splitter** — Will implement and verify. React-based NavPanel Splitter renders inside portal, should work independently.
6. **Compare mode** — Compare mode is a completely different component that destroys both page editors anyway. No need to preserve portals during compare mode — just render `CompareEditor` normally when compare is active.

## Acceptance Criteria

- [ ] All app pages render through `AppPageManager` using portals
- [ ] Closing/reordering pages does NOT cause remaining pages to lose state (scroll, selection, etc.)
- [ ] Grouping two pages does NOT recreate their editor DOM
- [ ] Ungrouping pages does NOT recreate their editor DOM
- [ ] Imperative splitter works: drag resize, proportional resize on window change, double-click reset
- [ ] Compare mode works correctly
- [ ] NavPanel works in both single and grouped modes
- [ ] Deferred rendering preserved (pages not rendered until first activation)
- [ ] All editor types work: text, grid, markdown, browser, PDF, draw, notebook, graph, MCP inspector

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/components/page-manager/AppPageManager.tsx` | **New** — portal-based page manager with grouping support |
| `src/renderer/components/page-manager/GroupContainer.ts` | **New** — imperative grouped page layout with splitter |
| `src/renderer/components/page-manager/ImperativeSplitter.ts` | **New** — imperative splitter (PointerEvents, ResizeObserver) |
| `src/renderer/ui/app/Pages.tsx` | **Major rewrite** — replace `.map()` + `RenderGroupedPages` with `<AppPageManager>` |
| `src/renderer/ui/app/RenderEditor.tsx` | Possibly minor adjustments |
