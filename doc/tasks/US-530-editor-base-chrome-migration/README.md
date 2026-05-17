# US-530: Editor base shared chrome — UIKit migration

## Status

**Plan ready for review.** Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration. Shared infrastructure consumed by ~14
editors; can land at any time since the public API is preserved.

## Goal

Migrate the editor-base shared chrome (`EditorError` and
`EditorToolbar` / `PageToolbar`) to UIKit primitives. After this task,
no file under `src/renderer/editors/base/` uses `@emotion/styled` or
imports from `theme/color`, and the public re-exports
(`EditorToolbar`, `PageToolbar`, `EditorToolbarProps`,
`PageToolbarProps`, `EditorError`) keep their identifiers so the ~14
downstream editor files compile and render unchanged.

## Background

### What's being migrated

Two files in `src/renderer/editors/base/`:

- **`EditorError.tsx`** — 11-line `styled.div` (margin auto, padding
  24px, `color.misc.yellow`, `whiteSpace: pre-wrap`). Used by 9
  editors as a flex-child error frame: Todo, Grid, Graph, Draw,
  Notebook, RestClient, LogView, LinkEditor. Every caller invokes it
  as `<EditorError>{error}</EditorError>` — no props.
- **`EditorToolbar.tsx`** — `EditorToolbarRoot` `styled.div` (flex
  row, alignItems center, columnGap 4, overflow hidden,
  `color.background.dark`, padding 2px/4px, flexShrink 0, conditional
  `borderTop`/`borderBottom` via `:has(.borderTop)`-style class
  selectors using `color.border.light`, `:empty { display: none }`)
  plus the `EditorToolbar` function component that composes
  `borderTop` / `borderBottom` / `className` props via `clsx`. Used by
  ~10 sites as `PageToolbar` (aliased re-export): CategoryEditor,
  ArchiveEditorView, PdfViewer, BrowserEditorView, McpInspectorView,
  VideoPlayerEditor, ScriptPanel, TextEditorView (two instances).

### Caller surface (verified by grep)

- **EditorError:** 9 call sites, all `<EditorError>{error}</EditorError>` — zero extra props.
- **PageToolbar:** ~10 call sites. Forms used: `<PageToolbar borderBottom>`, `<PageToolbar borderTop>`, `<PageToolbar>`. **Zero call sites pass `className`, `style`, or any other HTMLAttribute.**

The `extends React.HTMLAttributes<HTMLDivElement>` declaration on
`EditorToolbarProps` is therefore dead surface area — no consumer
exercises it. Migration can safely drop it.

### UIKit Panel coverage

Confirmed `src/renderer/uikit/Panel/Panel.tsx` already exposes every
prop this migration needs:

| Need                              | Panel prop                                    |
|-----------------------------------|-----------------------------------------------|
| Flex row + center align           | `direction="row" align="center"`              |
| 4 px column gap                   | `gap="sm"` (gapTokens.sm = 4)                 |
| `overflow: hidden`                | `overflow="hidden"`                           |
| Dark background                   | `background="dark"`                           |
| Padding 2 px top/bottom, 4 px L/R | `paddingY="xs" paddingX="sm"` (spacing.xs = 2, spacing.sm = 4) |
| `flex-shrink: 0`                  | `shrink={false}`                              |
| Conditional 1 px top border       | `borderTop` (color is `color.border.light` by default — matches) |
| Conditional 1 px bottom border    | `borderBottom`                                |
| `data-name` for inspector         | `name="…"` (forwarded as `data-name`)         |

The **one** Panel gap is the `:empty { display: none }` rule (see
"Open question A" below).

### Theme color parity check

`color.misc.yellow` (the current `EditorError` color) and
`color.warning.text` (what UIKit `Text color="warning"` resolves to)
share **identical hex values in 7 of 8 themes**:

| Theme            | `--color-misc-yellow` | `--color-warning-text` |
|------------------|-----------------------|------------------------|
| default-dark     | `#cca700`             | `#cca700` ✓            |
| abyss            | `#ddbb88`             | `#ddbb88` ✓            |
| red              | `#e8c87c`             | `#e8c87c` ✓            |
| light-modern     | `#9A6700`             | `#9A6700` ✓            |
| quiet-light      | `#C18401`             | `#C18401` ✓            |
| solarized-dark   | `#b58900`             | `#b58900` ✓            |
| solarized-light  | `#b58900`             | `#b58900` ✓ (hover differs — irrelevant for EditorError) |
| tomorrow-night-blue | `#ffeead`          | `#ffeead` ✓            |
| **monokai**      | `#e6db74` (yellow)    | `#fd971f` (orange) ⚠   |

In Monokai, the error frame visually shifts from yellow `#e6db74` to
orange `#fd971f`. This is a *deliberate* semantic improvement
(warning color for a warning frame), but flag it for the smoke test.

### Stale class-name reference

`grep editor-toolbar src/` returns six matches — all internal:

- `editors/base/EditorToolbar.tsx:41` — the `clsx("editor-toolbar", …)` being removed
- `editors/text/TextToolbar.tsx:170,180` — React `key="editor-toolbar-first"` / `"editor-toolbar-last"` — React reconciliation keys, unrelated to DOM class
- `editors/notebook/note-editor/NoteItemToolbar.tsx:136,143` — same React keys
- `editors/notebook/ExpandedNoteView.tsx:309` — `name="notebook-expanded-editor-toolbar"` — UIKit `data-name` debug prop

No CSS rule, `document.querySelector`, or `closest(".editor-toolbar")`
selects this class anywhere. Dropping the `clsx("editor-toolbar", …)`
is safe.

## Implementation plan

### Step 1 — Add `hideWhenEmpty` prop to UIKit Panel

**File:** `src/renderer/uikit/Panel/Panel.tsx`

Add a small extension so `EditorToolbar` can preserve the current
`:empty { display: none }` behavior declaratively (per UIKit rule:
"extend the UIKit component, do not work around"). The hook is
needed because conditional children like `{flag && <Btn/>}` render no
DOM when `flag === false`, so React-side `Children.count` does not
help; CSS `:empty` does.

**Before:**

```tsx
export interface PanelProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    // …
    /** Dim + disable pointer events on the whole panel. */
    disabled?: boolean;
```

**After (additions only):**

1. Add `hideWhenEmpty?: boolean` to `PanelProps` (just below `disabled?`):

   ```tsx
   /**
    * Collapse to `display: none` when the panel has no DOM children.
    * Matches the legacy `:empty { display: none }` toolbar rule.
    * Works with conditional children (`{flag && <Btn/>}` rendering nothing).
    */
   hideWhenEmpty?: boolean;
   ```

2. Add an Emotion rule inside the `Root` `styled.div`:

   ```ts
   "&[data-hide-when-empty]:empty": { display: "none" },
   ```

3. Destructure `hideWhenEmpty` in the `Panel` function body alongside `disabled` and pass it as `data-hide-when-empty={hideWhenEmpty || undefined}` on `<Root>`.

No story / no consumer changes — this is a pure additive extension.

### Step 2 — Rewrite `src/renderer/editors/base/EditorError.tsx`

**Before (current 11 lines):**

```tsx
import styled from "@emotion/styled";
import color from "../../theme/color";

const EditorError = styled.div({
    whiteSpace: "pre-wrap",
    margin: "auto",
    padding: 24,
    color: color.misc.yellow,
});

export { EditorError };
```

**After:**

```tsx
import React from "react";
import { Panel } from "../../uikit/Panel";
import { Text } from "../../uikit/Text";

export interface EditorErrorProps {
    children?: React.ReactNode;
}

export function EditorError({ children }: EditorErrorProps) {
    return (
        <Panel
            name="editor-error"
            flex
            justify="center"
            align="center"
            padding="xxl"
        >
            <Text color="warning" preWrap>
                {children}
            </Text>
        </Panel>
    );
}
```

Notes on the design:

- `flex` (= `flex: 1 1 auto`) replicates the original `margin: auto`
  growth-and-center behavior, since every consumer (verified —
  TodoEditor, GridEditor, etc.) returns `<EditorError>` from a
  flex-column page body.
- `justify="center" align="center"` replaces both-axis `margin: auto`.
- `padding="xxl"` = `spacing.xxl` = 24 px — exact match.
- `Text color="warning"` = `color.warning.text` (hex-identical to
  `color.misc.yellow` in 7 / 8 themes — see parity table).
- `preWrap` replaces `whiteSpace: pre-wrap`.

No `@emotion/styled`, no `theme/color` import.

### Step 3 — Rewrite `src/renderer/editors/base/EditorToolbar.tsx`

**Before (current 51 lines):**

```tsx
import clsx from "clsx";

import styled from "@emotion/styled";
import color from "../../theme/color";

export interface EditorToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
    borderTop?: boolean;
    borderBottom?: boolean;
}

const EditorToolbarRoot = styled.div({
    display: "flex",
    alignItems: "center",
    columnGap: 4,
    flexWrap: "nowrap",
    overflow: "hidden",
    backgroundColor: color.background.dark,
    padding: "2px 4px",
    flexShrink: 0,
    "&.borderTop":    { borderTop:    `1px solid ${color.border.light}` },
    "&.borderBottom": { borderBottom: `1px solid ${color.border.light}` },
    "&:empty":        { display: "none" },
});

export function EditorToolbar({
    children,
    borderTop,
    borderBottom,
    className,
    ...rest
}: EditorToolbarProps) {
    return (
        <EditorToolbarRoot
            {...rest}
            className={clsx("editor-toolbar", className, { borderTop, borderBottom })}
        >
            {children}
        </EditorToolbarRoot>
    );
}

export { EditorToolbar as PageToolbar };
export type { EditorToolbarProps as PageToolbarProps };
```

**After:**

```tsx
import React from "react";
import { Panel } from "../../uikit/Panel";

export interface EditorToolbarProps {
    /** Optional debug label emitted as `data-name` on the root element. */
    name?: string;
    borderTop?: boolean;
    borderBottom?: boolean;
    children?: React.ReactNode;
}

export function EditorToolbar({
    name,
    borderTop,
    borderBottom,
    children,
}: EditorToolbarProps) {
    return (
        <Panel
            name={name ?? "editor-toolbar"}
            direction="row"
            align="center"
            gap="sm"
            overflow="hidden"
            background="dark"
            paddingX="sm"
            paddingY="xs"
            shrink={false}
            borderTop={borderTop}
            borderBottom={borderBottom}
            hideWhenEmpty
        >
            {children}
        </Panel>
    );
}

export { EditorToolbar as PageToolbar };
export type { EditorToolbarProps as PageToolbarProps };
```

Notes on the design:

- `clsx` import removed; no className composition needed.
- `EditorToolbarProps` no longer `extends HTMLAttributes<HTMLDivElement>` — verified zero callers use HTMLAttributes today.
- Default `name="editor-toolbar"` gives every legacy call site a stable `data-name` for DOM inspection (replaces the dropped `editor-toolbar` className).
- `borderTop`/`borderBottom` flow straight through to `Panel` — `color.border.light` is Panel's default border color (`borderColor="subtle"`).
- `hideWhenEmpty` (added in Step 1) preserves the `:empty` rule.
- All `re-exports (PageToolbar / PageToolbarProps)` preserved verbatim.

### Step 4 — `src/renderer/editors/base/index.ts`

No changes. The four exported identifiers (`EditorToolbar`,
`PageToolbar`, `EditorToolbarProps`, `PageToolbarProps`) keep the same
names; their type signatures narrow slightly (no `HTMLAttributes`) but
no current consumer depends on the dropped fields.

### Step 5 — Verification sweep

Confirm via grep that the two migrated files no longer import
`@emotion/styled`, `theme/color`, or `clsx`:

```
rg "from\s+\"@emotion/styled\"|from\s+\"\.\./\.\./theme/color\"|from\s+\"clsx\"" src/renderer/editors/base/
```

Expect zero matches under `editors/base/`.

## Concerns

### A. `:empty { display: none }` — keep or drop?

The current rule collapses a toolbar with zero DOM children. This is
load-bearing in practice: the default "new page" renders a
`PageToolbar` with no buttons, and the dark band must NOT appear in
that case. Without `:empty` the empty toolbar would still occupy
~4 px of vertical space + the dark fill.

**Decision (confirmed by user):** preserve via `hideWhenEmpty` Panel
extension (Step 1). The Panel-prop extension is small, well-scoped,
future-proof for new callers, and matches the legacy behavior
exactly. Cost: ~6 added lines in `Panel.tsx`.

### B. `EditorToolbarProps extends HTMLAttributes<HTMLDivElement>` — preserve or drop?

Today's signature implies callers may pass `className`, `style`,
`onClick`, `data-*`, etc. Grep across all ~10 call sites confirms
none do. The wider type is dead.

**Decision:** drop. Narrowing to `{ name?, borderTop?, borderBottom?,
children? }` is observable but does not break any current consumer.
If a future consumer needs an HTMLAttribute, that consumer can request
the prop be added explicitly (the Rule-7 / Panel-prop pattern).

### C. Monokai EditorError color shift (yellow → orange)

In Monokai only, the migration shifts `EditorError` text from
`#e6db74` (misc yellow) to `#fd971f` (warning orange). This is a
**deliberate semantic improvement** (warning colour for a warning
frame), but it is a user-visible change in one theme.

**Decision:** accept the shift. Add Monokai to the smoke-test matrix
(open an editor in error state in Monokai theme; verify the orange
warning text reads acceptably).

### D. `EditorError` centering depends on flex-column parent

`margin: auto` on the original styled.div two-axis-centers when the
parent is flex. Every audited caller returns `<EditorError>` directly
from an editor's render — the editor body is mounted inside a flex
container (`ContentViewModelHost`-rooted page layout). The new
implementation uses `flex justify="center" align="center"`, which
relies on the same flex-parent assumption.

**Decision:** no risk. The smoke test covers each consumer (Todo,
Grid, Graph, Draw, Notebook, RestClient, LogView, LinkEditor); if any
caller turns out to mount outside a flex parent (none do today), this
task wraps the Panel in a higher-level `flex={1}` parent, but the
audit found none.

### E. `data-name="editor-toolbar"` default — naming clash?

The migration emits `data-name="editor-toolbar"` on every toolbar
(unless the caller overrides via the new `name` prop). One known
caller already supplies its own name:
`ExpandedNoteView.tsx:309 name="notebook-expanded-editor-toolbar"` —
overrides correctly via `name ?? "editor-toolbar"`. No conflict
expected.

**Decision:** ship as-is.

## Test surface (manual smoke)

- **Toolbar — `borderBottom`:** Open a Text page. The top toolbar
  renders with 1 px bottom border, dark band background, 4 px column
  gap between buttons, 2 px top/bottom padding, vertically centered
  content. Identical to today.
- **Toolbar — `borderTop`:** Open a Text page with a script panel
  (`TextEditorView.tsx:56`). The bottom toolbar shows the 1 px top
  border.
- **Toolbar — no border:** Open the Run-Script panel
  (`ScriptPanel.tsx:369`). Toolbar renders without top/bottom
  borders.
- **Toolbar — `:empty`:** Spot test by temporarily wrapping the
  toolbar's children in `{false && …}` — the dark band should NOT
  appear (verifies `hideWhenEmpty`). Revert afterwards.
- **Toolbar — second consumer (BrowserEditorView, McpInspectorView,
  PdfViewer, VideoPlayerEditor, CategoryEditor, ArchiveEditorView):**
  open at least three; each renders normally.
- **EditorError — default theme:** Corrupt a `.todo.json` then open it
  — Todo editor enters error state; yellow text, centered both axes,
  24 px padding, line breaks preserved (set the error string to
  contain `\n` if needed via a debugger statement to verify
  `pre-wrap`).
- **EditorError — Monokai theme:** Switch to Monokai and trigger the
  same error path. Confirm the new orange (`#fd971f`) reads
  acceptably as a warning color.
- **EditorError — other consumers:** Trigger an error in at least one
  more (Grid: open a malformed CSV; Notebook: open a corrupt
  `.notebook.json`).
- **DOM inspection (debug naming):** Open DevTools, inspect a Text
  page's top toolbar — should see `data-type="panel"`
  `data-name="editor-toolbar"` `data-border-bottom` on the root. Open
  an EditorError state — should see `data-type="panel"`
  `data-name="editor-error"` on the outer Panel and `data-type="text"
  data-color="warning" data-pre-wrap` on the inner Text.

## Acceptance criteria

- [ ] `src/renderer/uikit/Panel/Panel.tsx` exports a `hideWhenEmpty?: boolean` prop, emits `data-hide-when-empty`, and has a matching `&[data-hide-when-empty]:empty { display: none }` CSS rule.
- [ ] `src/renderer/editors/base/EditorError.tsx` does not import `@emotion/styled` or `theme/color`. Renders via UIKit `Panel` + `Text` only.
- [ ] `src/renderer/editors/base/EditorToolbar.tsx` does not import `@emotion/styled`, `theme/color`, or `clsx`. Renders via UIKit `Panel` only.
- [ ] `src/renderer/editors/base/index.ts` is unchanged.
- [ ] Public re-exports `EditorToolbar`, `PageToolbar`, `EditorToolbarProps`, `PageToolbarProps`, `EditorError` still resolve at the same import paths.
- [ ] All ~14 downstream consumer files compile **without source changes**.
- [ ] `npm run lint` clean (no new warnings, no new errors).
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke test (see "Test surface" above) passes across at least: one editor with `borderBottom` toolbar, one with `borderTop`, one with no border, EditorError in default-dark theme, EditorError in Monokai theme.

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the epic's deferred-review model.

## Files Changed

| File                                                  | Change       | Notes                                      |
|-------------------------------------------------------|--------------|--------------------------------------------|
| `src/renderer/uikit/Panel/Panel.tsx`                  | modified     | Add `hideWhenEmpty?: boolean` prop         |
| `src/renderer/editors/base/EditorError.tsx`           | rewritten    | Panel + Text; no Emotion                   |
| `src/renderer/editors/base/EditorToolbar.tsx`         | rewritten    | Panel; no Emotion, no clsx                 |
| `src/renderer/editors/base/index.ts`                  | unchanged    | Re-exports preserved                       |
| `src/renderer/editors/*` (~14 consumer files)         | unchanged    | Public API preserved                       |

## Files explicitly NOT changed

- Any file under `src/renderer/editors/{todo,grid,graph,draw,notebook,rest-client,log-view,link-editor,category,archive,browser,mcp-inspector,video,text,pdf}/` — public API of EditorToolbar / PageToolbar / EditorError preserved.
- `src/renderer/components/basic/`, `components/form/`, `components/layout/`, `components/overlay/` — none of these are touched by this task; their removal is [US-532](../US-532-legacy-components-removal/README.md).
- `src/renderer/theme/color.ts` and themes under `src/renderer/theme/themes/` — no new tokens needed (existing `color.warning.text` is the target).
- `src/renderer/uikit/Text/Text.tsx` — `color="warning"` and `preWrap` already exist.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration (shared infrastructure)
- Related: every per-screen editor migration that uses `PageToolbar` or `EditorError` benefits from this, but none are blocked on it — the public API stays identical.
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md) once every other per-screen migration also lands.
