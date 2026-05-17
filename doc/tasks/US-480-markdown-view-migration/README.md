# US-480: MarkdownView — UIKit migration

## Status

**Plan ready for review.** Investigation complete; awaiting user approval before implementation.

## Goal

Migrate `src/renderer/editors/markdown/MarkdownView.tsx` off legacy
`components/layout/`, `components/basic/`, and `@emotion/styled` so the file
contributes zero references to the four legacy folders that
[US-532](../US-532-legacy-components-removal/README.md) will delete.

A second deliverable, scoped here by US-532's own note, is the relocation of
`components/layout/Minimap.tsx` — currently consumed only by this view — to
`src/renderer/uikit/Minimap/`. The legacy file is then deleted.

The rendered markdown body (`MarkdownBlock.tsx`, `CodeBlock.tsx`) keeps its
`@emotion/styled` content CSS because it styles arbitrary HAST output from
`react-markdown` (h1/h2/p/pre/code/table/blockquote/…). There is no UIKit
analogue for "CSS reset for arbitrary HTML", and Rule 7 carve-outs do not
apply. Scope: chrome only.

## Background

### What the view currently is

`MarkdownView.tsx` (188 lines) is the page-shell for markdown preview. It owns:

- An outer flex-row container `MdViewRoot` (`styled.div`).
- A `compact` toggle `Button` rendered via `createPortal` into
  `model.editorToolbarRefLast` (the editor's right-side toolbar slot).
- A conditional `FindBar` (already UIKit — US-461).
- An inner `.md-scroll-container` (`overflowY: auto`, padding 24px / 8px compact)
  hosting `MarkdownBlock`.
- A right-side `Minimap` (legacy `components/layout/Minimap`) when
  `editorConfig.hideMinimap` is false.
- A `tabIndex={-1}` + `onKeyDown` handler for Ctrl-F / F3 / Shift-F3 / Escape
  search shortcuts.
- A dynamic `style={{ maxHeight: editorConfig.maxEditorHeight }}` (only set when
  embedded in notebook).
- Two className modifiers: `show-scrollbar` (when minimap hidden) and
  `compact`.

### Caller surface

`MarkdownView` is registered in
[`editors/register-editors.ts:223–229`](../../../src/renderer/editors/register-editors.ts)
via dynamic `import("./markdown/MarkdownView")` for `languageId === "markdown"`.
The `MdView` / `MdViewProps` backward-compat aliases at
`MarkdownView.tsx:186–187` are re-exported through `index.ts:10` but have **no
consumers** anywhere in the repo (verified by Grep `\bMdView\b`). Safe to drop.

The `MarkdownViewModel` type is imported by the script facade
(`scripting/api-wrapper/MarkdownEditorFacade.ts:1` and
`PageWrapper.ts:10`) — that public surface is unchanged by this migration.

### Minimap audit

`components/layout/Minimap.tsx` (310 lines):

- Already model-view (`TComponentModel<MinimapState, MinimapProps>`) —
  Rule 8 satisfied.
- Controlled via `scrollContainer` prop — Rule 2 satisfied.
- Uses `clsx` for two boolean classNames (`minimap-wrapper`, `isDragging` on
  the indicator) — must become `data-*` per Rule 1.
- Inline `style={{ top, height }}` on the indicator is **legitimate dynamic
  positioning** (computed from scroll math). Inside UIKit, inline `style` on
  primitive `<div>`s is allowed — Rule 7 only forbids `style=` on UIKit
  *components*. No change needed.
- CSS uses `transform: scale(0.15)`, `width: 666%`, `overflowY: auto`,
  `position: absolute` — none of this is expressible via Panel props, and
  Minimap is a self-contained primitive. Emotion stays inside the new
  `uikit/Minimap/` home.
- Reads `color.minimapSlider.*` — verified present in `color.ts` (no
  theme-token additions needed).
- Single consumer today: `MarkdownView.tsx`. The earlier suspicion that the
  notebook editors consumed it was a false positive — the four notebook
  `Minimap` matches under `editors/notebook/` are all
  `editorConfig.hideMinimap` references (the Monaco minimap flag), not the
  custom Minimap component.

### Why this task owns Minimap

[US-532 notes](../US-532-legacy-components-removal/README.md):

> The Minimap component (in `components/layout/Minimap.tsx`) is used by
> MarkdownView — US-480 must either migrate it or move it to UIKit (Storybook
> lighthouse pattern). Tracked there, not here.

The only "app code" home with no Emotion ban is `src/renderer/ui/` (chrome
exception). Minimap is not chrome — it's a reusable scroll indicator that
could plausibly be used by any virtualized view. `uikit/Minimap/` is the
correct destination.

### UIKit primitives needed

| Need | UIKit primitive | Notes |
|------|-----------------|-------|
| Outer flex-row container with `tabIndex={-1}`, `onKeyDown`, `maxHeight` | `Panel` | `direction="row"`, `flex`, `overflow="hidden"`, `maxHeight`, `...rest` carries `tabIndex` + `onKeyDown` |
| Inner scroll container | `Panel` (+ new `scrollbar` prop) | `direction="column"`, `flex`, `overflowY="auto"`, `overflowX="hidden"`, `scrollbar={showMinimap ? "hidden" : "auto"}`, `paddingX={compact ? "md" : "xxl"}` |
| Toolbar portal button | `IconButton` | `size="sm"`, `title`, `active`, `name="markdown-compact-toggle"`, `icon` |
| FindBar | unchanged | Already UIKit-based (US-461) |
| Minimap | new `uikit/Minimap/` | This task moves it |

One UIKit primitive needs extension: **`Panel` gains a `scrollbar?: "auto" |
"hidden"` prop** so a minimap-paired scroll surface can suppress its
hover-fade scrollbar. See Concern A. All other primitives already cover the
need (`Panel.maxHeight`, `Panel.flex`, `Panel.overflow*`, `Panel.paddingX`;
`IconButton.active`, `IconButton.title`, `IconButton.name`,
`IconButton.size`).

### Padding token mapping

UIKit `spacing` scale (verified in
[`uikit/tokens.ts:15-23`](../../../src/renderer/uikit/tokens.ts)):
`xs=2, sm=4, md=8, lg=12, xl=16, xxl=24, xxxl=32`.

| Current | Token | Resolves to |
|---------|-------|-------------|
| `padding: "0 24px"` (normal) | `paddingX="xxl"` | 24px ✓ |
| `padding: "0 8px"` (compact) | `paddingX="md"` | 8px ✓ |

## Implementation plan

### Step 0 — Extend `Panel` with `scrollbar` prop

See Concern A for the full code shape. Files touched:

- `src/renderer/uikit/Panel/Panel.tsx` — add `scrollbar?: "auto" | "hidden"`
  prop, destructure in View, emit `data-scrollbar="hidden"`, suppress the
  `.scroll-container` className when hidden.
- `src/renderer/theme/GlobalStyles.tsx` — append `[data-scrollbar="hidden"]`
  rule that defeats all native scrollbar rendering (cross-browser).

This is generic — any future scroll surface that pairs with a non-native
indicator (custom thumb, minimap-style overview) can use it.

### Step 1 — Create `src/renderer/uikit/Minimap/`

New files:

```
src/renderer/uikit/Minimap/
  Minimap.tsx
  MinimapModel.ts
  index.ts
```

**`MinimapModel.ts`** — copy `MinimapModel` class from
`components/layout/Minimap.tsx:64–256` verbatim. Imports adjust to
`../../core/state/model`. No behavior change.

**`Minimap.tsx`** — copy the styled root and view function, then apply UIKit
conventions:

- Drop `import clsx from "clsx"`.
- Convert `MinimapRoot` from class-keyed (`.minimap-wrapper`,
  `.minimap-content-container`, `.minimap-content`, `.minimap-viewport-indicator`)
  to `data-part="*"` keyed descendant selectors (e.g.
  `& [data-part='content']`, `& [data-part='indicator']`). The root itself
  gets `data-type="minimap"` and `data-name`.
- `isDragging` becomes `data-dragging` on the indicator (Rule 1).
- Add `name?: string` prop, destructured before spread; emit `data-name`
  (Rule 1 `name` requirement).
- Extend `PanelProps` shape minimally:
  - Props: `name?: string`, `scrollContainer: HTMLElement | null`.
  - Forward-ref to root `HTMLDivElement` (matches other UIKit primitives).
- Root `styled.div` keeps the existing CSS verbatim, only swapping class
  selectors → `data-part` selectors and `&.isDragging` → `&[data-dragging]`.
- Indicator inline `style={{ top, height }}` stays — see Rule 7 note above.

**`index.ts`**:

```ts
export { Minimap } from "./Minimap";
export type { MinimapProps } from "./Minimap";
```

Append to `src/renderer/uikit/index.ts` under "Layout primitives":

```ts
export { Minimap } from "./Minimap";
export type { MinimapProps } from "./Minimap";
```

### Step 2 — Migrate `MarkdownView.tsx`

Rewrite the file. Final shape (~120 lines):

```tsx
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { TextFileModel } from "../text";
import { CompactViewIcon, NormalViewIcon } from "../../theme/icons";
import { IconButton, Minimap, Panel } from "../../uikit";
import { useEditorConfig } from "../base";
import { FindBar } from "../shared/FindBar";
import {
    MarkdownViewModel,
    MarkdownViewState,
    defaultMarkdownViewState,
} from "./MarkdownViewModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { MarkdownBlock, MarkdownBlockHandle } from "./MarkdownBlock";

export interface MarkdownViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultMarkdownViewState;

export function MarkdownView({ model }: MarkdownViewProps) {
    const vm = useContentViewModel<MarkdownViewModel>(model, "md-view");
    const blockRef = useRef<MarkdownBlockHandle>(null);
    const editorConfig = useEditorConfig();

    const pageState: MarkdownViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );
    const { content, filePath } = model.state.use((s) => ({
        content: s.content,
        filePath: s.filePath,
    }));

    const highlightText = pageState.searchVisible && pageState.searchText
        ? pageState.searchText
        : editorConfig.highlightText || "";

    const onMatchCountChange = useCallback(/* unchanged */, [vm]);
    useEffect(/* unchanged */);
    const onKeyDown = useCallback(/* unchanged */, [vm, pageState.searchVisible]);

    const showMinimap = !editorConfig.hideMinimap;
    const compact = editorConfig.compact || pageState.compactMode;
    const showSearchBar = pageState.searchVisible && !editorConfig.highlightText;

    if (!vm) return null;

    return (
        <>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <IconButton
                        name="markdown-compact-toggle"
                        size="sm"
                        active={pageState.compactMode}
                        title={pageState.compactMode ? "Normal View" : "Compact View"}
                        icon={pageState.compactMode ? <NormalViewIcon /> : <CompactViewIcon />}
                        onClick={vm.toggleCompact}
                    />,
                    model.editorToolbarRefLast,
                )}
            <Panel
                name="markdown-view-root"
                direction="row"
                flex
                overflow="hidden"
                maxHeight={editorConfig.maxEditorHeight}
                tabIndex={-1}
                onKeyDown={onKeyDown}
            >
                <Panel
                    name="markdown-find-column"
                    direction="column"
                    flex
                >
                    {showSearchBar && (
                        <FindBar
                            text={pageState.searchText}
                            currentMatch={pageState.currentMatchIndex}
                            totalMatches={pageState.totalMatches}
                            onTextChange={vm.setSearchText}
                            onNext={vm.nextMatch}
                            onPrev={vm.prevMatch}
                            onClose={vm.closeSearch}
                        />
                    )}
                    <Panel
                        name="markdown-scroll"
                        direction="column"
                        flex
                        overflowY="auto"
                        overflowX="hidden"
                        scrollbar={showMinimap ? "hidden" : "auto"}
                        paddingX={compact ? "md" : "xxl"}
                        ref={vm.setContainer}
                        onScroll={vm.containerScroll}
                    >
                        <MarkdownBlock
                            ref={blockRef}
                            content={content}
                            highlightText={highlightText}
                            compact={compact}
                            filePath={filePath}
                            onMatchCountChange={onMatchCountChange}
                        />
                    </Panel>
                </Panel>
                {showMinimap && (
                    <Minimap
                        name="markdown-minimap"
                        scrollContainer={pageState.container}
                    />
                )}
            </Panel>
        </>
    );
}

const moduleExport = {
    Editor: MarkdownView,
};

export default moduleExport;
```

Notes on the rewrite:

- `MdView` / `MdViewProps` backward-compat re-exports are **dropped** — no
  consumers in the repo. Also drop them from `editors/markdown/index.ts:10`.
- `setContainer` previously took the `.md-scroll-container` `<div>` — now it
  receives the scroll `Panel`'s root, which IS that scroll container. The
  scroll container is what `Minimap` mirrors; this works because `Panel`
  forwards its ref to the root element (verified in `Panel.tsx:253`).
- The FindBar stays a sibling **above** the scroll surface (legacy
  behavior), achieved by nesting a column Panel that holds `[FindBar?,
  scroll Panel]` inside the row root. The scroll Panel alone gets
  `overflowY: auto` so FindBar does not scroll with content. See Concern C
  for the alternative.
- `style={{ maxHeight }}` becomes Panel `maxHeight` prop (typed `number |
  string`; passing `undefined` cleanly omits the rule).
- Two className flags (`show-scrollbar`, `compact`) disappear:
  - `compact` becomes the conditional `paddingX={compact ? "md" : "xxl"}`.
  - `show-scrollbar` becomes a no-op — see Concern A.
- `outline: "none"` from the legacy MdViewRoot is dropped — Chromium uses
  `:focus-visible`, so click-focus on a `tabIndex={-1}` element does not
  render a focus ring. See Concern D.

### Step 3 — Delete legacy

- Delete `src/renderer/components/layout/Minimap.tsx`.
- Edit `src/renderer/components/layout/index.ts:2`: remove the
  `export * from './Minimap';` line. The two remaining exports (`Elements`,
  `Splitter`) are still consumed by other legacy code and stay.

### Step 4 — Verification

- Run `npx tsc -p tsconfig.web.json --noEmit` and compare against the
  pre-task baseline (20 known errors from prior tasks; zero new errors
  expected).
- Run `npx eslint src/renderer/editors/markdown src/renderer/uikit/Minimap`
  and confirm zero new warnings.
- Manual smoke test:
  - Open any `.md` file → renders, scrolls, minimap visible, scrollbar
    behaves under hover (VSCode-style fade-in).
  - Toggle compact via toolbar button → padding shrinks, button icon swaps
    (Compact ↔ Normal), `data-active` paints the toggle.
  - Press Ctrl-F → FindBar appears inside the scroll column, focuses input.
    Type to highlight; Enter / Shift-Enter navigates; F3 / Shift-F3 works;
    Escape closes.
  - Drag the minimap indicator → scrolls main content. Click empty minimap
    area → scrolls. Mutate content (e.g. via reload) → mirror updates.
  - Open the same `.md` inside a notebook cell with `hideMinimap: true` and
    `maxEditorHeight: 400` → no minimap, container respects max height.

## Concerns

### Concern A — Scrollbar visibility coupling with minimap (BUG to fix)

**Legacy behavior.** `MdViewRoot` uses
`& .md-scroll-container::-webkit-scrollbar { display: none }` and toggles a
`.show-scrollbar` className via the parent. Net effect:

- Minimap visible → main scrollbar **fully hidden** (minimap is the only
  visual indicator).
- Minimap hidden → standard scrollbar visible.

**Regression to fix.** When the scroll container becomes a `Panel` with
`overflow*: "auto"`, Panel auto-applies `.scroll-container` (the VSCode-like
fade-in scrollbar from
[`GlobalStyles.tsx:119–127`](../../../src/renderer/theme/GlobalStyles.tsx)).
That makes a thin grey scrollbar fade in on hover **even when the minimap is
present** — two scroll indicators on the same surface. This is a bug; only
the minimap should be visible in that case.

**Resolution: extend Panel with a `scrollbar` prop.** Per the UIKit CLAUDE.md
guidance ("the right answer is 'Panel needs a new prop'"), add a small
generic prop rather than a markdown-local styled override (which is also
forbidden by Rule 7 since `editors/markdown/` is not chrome).

**Step 1A — Add Panel prop and global CSS rule.**

`src/renderer/uikit/Panel/Panel.tsx`:

```ts
// PanelProps additions:
/**
 * Scrollbar visibility for scrollable panels.
 * - "auto" (default) — global VSCode-style fade-in scrollbar via the
 *   `.scroll-container` class.
 * - "hidden" — no scrollbar at all. Use when another visual indicator
 *   (minimap, custom thumb) replaces it. Emits `data-scrollbar="hidden"`.
 */
scrollbar?: "auto" | "hidden";
```

In the View, before the `<Root>` JSX:

```ts
const scrollable =
    isScrollable(overflow) || isScrollable(overflowX) || isScrollable(overflowY);
const hideScrollbar = scrollbar === "hidden";
```

Then on `<Root>`:

```tsx
data-scrollbar={hideScrollbar ? "hidden" : undefined}
className={scrollable && !hideScrollbar ? "scroll-container" : undefined}
```

(Dropping the class when hidden is important — otherwise the
`.scroll-container:hover { scrollbar-color: <thumb> transparent }` rule
fights the override.)

`src/renderer/theme/GlobalStyles.tsx` — append after the existing
`.scroll-container` block (cross-browser, defeats any inherited rules):

```css
[data-scrollbar="hidden"] {
    scrollbar-color: transparent transparent;
    scrollbar-width: none;
}
[data-scrollbar="hidden"]::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}
```

**Step 2 call site.** Pass `scrollbar={showMinimap ? "hidden" : "auto"}` on
the inner `markdown-scroll` Panel. The minimap-visible case now has zero
scrollbar; the no-minimap case keeps the standard VSCode fade-in
scrollbar — matching legacy plus a small upgrade (legacy showed the fat
global scrollbar; new shows the thin fade-in one, consistent with the rest
of the app).

**Acceptance check.** With minimap on, hover the markdown view: **no
scrollbar**, only the minimap indicator. Toggle `hideMinimap: true` in a
notebook cell: thin scrollbar fades in on hover.

### Concern B — Padding token verification

**Current.** Non-compact mode uses `padding: "0 24px"`; compact mode uses
`padding: "0 8px"`.

**Token scale.** UIKit `spacing` is
`xs=2, sm=4, md=8, lg=12, xl=16, xxl=24, xxxl=32` (verified in
[`uikit/tokens.ts:15-23`](../../../src/renderer/uikit/tokens.ts)). So:

- 24 px → `paddingX="xxl"` ✓
- 8 px → `paddingX="md"` ✓

**Resolution.** Use `paddingX={compact ? "md" : "xxl"}`. No new tokens
needed. Re-verify the file at implementation time in case the scale shifts.

### Concern C — FindBar layout (preserves legacy "sticky above" behavior)

**Legacy.** FindBar is a sibling above the scroll container inside
`MdViewRoot`. It does **not** scroll with content.

**Naive port.** Putting FindBar inside the scroll Panel as the first child
makes it scroll away with content — minor UX regression. The legacy
behavior matches every other find bar in the app (Monaco, browser,
notebook).

**Resolution.** Use the nested-Panel layout shown in Step 2: an outer row
Panel hosts a column `markdown-find-column` (no overflow) which contains
`[FindBar?, markdown-scroll]`; only the inner `markdown-scroll` Panel
scrolls. One extra Panel, behavior preserved.

### Concern D — `outline: "none"` on focusable scroll container

**Current.** `MdViewRoot` is `tabIndex={-1}` (programmatically focusable but
not in tab order) with `outline: "none"`. Reason: prevent a focus ring when
the user clicks into the markdown view.

**Browser behavior.** Chromium honors `:focus-visible`, so click-focus on a
`tabIndex={-1}` element does **not** render a focus ring. The legacy
`outline: none` was belt-and-suspenders.

**Resolution.** Drop `outline: none`. If a focus ring appears during testing
in any theme, add `outline` as a tiny `Panel` prop (`outline?: "none"`) in a
follow-up — not a blocker for this task.

### Concern E — Dropped `MdView` / `MdViewProps` aliases

**Current.** Lines 186–187 of `MarkdownView.tsx` and line 10 of `index.ts`
re-export the old names "for backward compatibility".

**Audit.** `grep '\bMdView\b'` returns matches only inside `MarkdownView.tsx`
and `index.ts` themselves. The script facade and `register-editors.ts` both
use the new names.

**Resolution.** Delete the aliases as part of this task. Keeps the surface
clean before US-532. Trivially reversible if a hidden consumer surfaces in
testing.

## Acceptance criteria

1. `editors/markdown/MarkdownView.tsx` has zero imports from
   `components/{basic,form,layout,overlay}/`.
2. `editors/markdown/MarkdownView.tsx` has zero `import styled from
   "@emotion/styled"`, zero `style={…}`, zero `className=…` on UIKit
   components.
3. `editors/markdown/index.ts` does not re-export `MdView` / `MdViewProps`.
4. `components/layout/Minimap.tsx` is deleted; `components/layout/index.ts`
   no longer re-exports `Minimap`.
5. `uikit/Minimap/` exists with `Minimap.tsx`, `MinimapModel.ts`, `index.ts`
   and is re-exported from `uikit/index.ts`. The root carries `data-type="minimap"`
   and `data-name`; the indicator carries `data-dragging` (not `.isDragging`).
6. All Step-4 manual smoke tests pass.
7. `tsc` and `eslint` baselines unchanged (no new errors or warnings).

## Files Changed

| File | Action |
|------|--------|
| `src/renderer/uikit/Panel/Panel.tsx` | add `scrollbar?: "auto" \| "hidden"` prop + `data-scrollbar` attribute + class-suppression logic |
| `src/renderer/theme/GlobalStyles.tsx` | append `[data-scrollbar="hidden"]` rule (cross-browser scrollbar suppression) |
| `src/renderer/editors/markdown/MarkdownView.tsx` | **rewrite** — Panel + IconButton + Minimap (UIKit); drop `MdView`/`MdViewProps`, `outline`, classNames |
| `src/renderer/editors/markdown/index.ts` | drop the `MdView`/`MdViewProps` re-export line |
| `src/renderer/uikit/Minimap/Minimap.tsx` | **new** — copy from legacy, swap classNames → `data-*`, add `name` prop |
| `src/renderer/uikit/Minimap/MinimapModel.ts` | **new** — copy of `MinimapModel` class verbatim |
| `src/renderer/uikit/Minimap/index.ts` | **new** — public exports |
| `src/renderer/uikit/index.ts` | append `Minimap` + `MinimapProps` exports |
| `src/renderer/components/layout/Minimap.tsx` | **delete** |
| `src/renderer/components/layout/index.ts` | drop the `Minimap` re-export line |

## Files NOT changed

- `src/renderer/editors/markdown/MarkdownBlock.tsx` — content CSS for
  `react-markdown` output; out of scope per Goal.
- `src/renderer/editors/markdown/CodeBlock.tsx` — also content-renderer; no
  `components/*` imports today.
- `src/renderer/editors/markdown/MarkdownViewModel.ts` — public type
  consumed by the script facade; unchanged.
- `src/renderer/editors/markdown/rehypeHighlight.ts` — pure HAST plugin; no
  UI.
- `src/renderer/editors/register-editors.ts` — already imports
  `./markdown/MarkdownView` by new name.
- `src/renderer/editors/notebook/*` — the four `hideMinimap` references
  there are the `EditorConfig` boolean, not the Minimap component (false
  positives during initial Grep).
- `src/renderer/editors/base/EditorConfigContext.tsx` — only references
  "minimap" in a doc comment on `hideMinimap`; no code change.
- `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts`,
  `PageWrapper.ts` — import the model type, not the view.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Blocks: [US-532](../US-532-legacy-components-removal/README.md) (final
  cleanup; explicitly delegates Minimap to this task)
- Related precedents:
  - [US-461](../US-461-shared-findbar-consolidation/README.md) — shared
    `FindBar` UIKit-based (consumed unchanged here)
  - [US-460](../US-460-markdown-search-bar-migration/README.md) — original
    markdown search bar migration; documented Q5 deferring the rest of
    `MarkdownView.tsx` to this task
