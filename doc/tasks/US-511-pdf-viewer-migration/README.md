# US-511: PDF Viewer — UIKit migration

## Status

**Implemented — pending manual smoke.** Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the PDF viewer chrome (root container, single toolbar button)
to UIKit primitives. After this task,
`src/renderer/editors/pdf/PdfViewer.tsx` contains no `@emotion/styled`
definitions and imports nothing from `components/basic|form|layout|overlay/`.

The embedded pdf.js viewer (loaded into an `<object>` element via
`app-asset://pdfjs/web/viewer.html`) is **not in scope** — its zoom /
page-navigation / search controls live inside the pdf.js HTML, not in
our React chrome, and are unaffected by this migration.

## Background

### Files in scope (rendering)

- `src/renderer/editors/pdf/PdfViewer.tsx` — the only rendering file in
  the editor. Contains:
  - `PdfViewerRoot` styled.div (lines 18–24)
  - `PageToolbar` with a single `Button type="icon" size="small"` for
    NavPanel toggle, plus `<FlexSpace />` (lines 126–140)
  - An `<object data={viewerUrl}>` embedding pdf.js (lines 143–148)

The `PdfEditorModel` class in this same file is pure model code — no
JSX, no styling — and is not modified.

### Files NOT changed

- `src/renderer/editors/pdf/index.ts` — module registration; no JSX.
- `src/renderer/editors/base/EditorToolbar.tsx` — `PageToolbar` is
  editor-base infrastructure and stays (matches `McpInspectorView`
  US-502 and `ArchiveEditorView` US-505 — both keep this import).
- pdf.js worker plumbing, `assets/pdfjs/`, the `safe-file://` protocol
  handler — out of scope.

### Reference implementations

- `src/renderer/editors/archive/ArchiveEditorView.tsx` (US-505) — same
  pattern: `styled.div` root, `PageToolbar`, `Button type="icon"
  size="small"` with `<NavPanelIcon />`, `<FlexSpace />`. Direct
  mapping for this task.
- `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` (US-502) —
  reference for `<Panel direction="column" flex={1} overflow="hidden">`
  as the column-flex editor root with `PageToolbar borderBottom`.

### UIKit primitives mapping

| Old | New |
|---|---|
| `styled.div` (`PdfViewerRoot`) | UIKit `Panel` (`direction="column" flex={1} overflow="hidden"`) |
| `components/basic/Button` `type="icon" size="small"` | UIKit `IconButton size="sm"` (icon passed via `icon` prop) |
| `components/layout/Elements.FlexSpace` | UIKit `Spacer` |

### Icon sizing (verified)

Old `Button` with `type="icon" size="small"` applies CSS rule
`& svg { width: 16; height: 16 }`. UIKit `IconButton size="sm"` applies
`& svg { width: height.iconMd /* 16 */; height: 16 }` (see
`uikit/IconButton/IconButton.tsx:62-69`, `uikit/tokens.ts:55-64`). The
`<NavPanelIcon />` in `PdfViewer.tsx:136` is rendered without inline
`width`/`height`, so no inline override exists to drop. **Visual size
unchanged.**

### Layout / sizing of the embedded `<object>`

The `<object>` element renders with `style={{ width: "100%", height:
"100%" }}` (line 145). For `height: 100%` to resolve, its parent
container must have a definite block size. Today, `PdfViewerRoot` is
`flex: 1 1 auto` inside the editor's column-flex host — that gives it
a definite resolved height, so the `<object>` fills it.

Replacing the root with `<Panel direction="column" flex={1}
overflow="hidden">` produces the same flex item (`flex: 1 1 auto`) in
the same column-flex context. The `<object>`'s `height: 100%` will
resolve identically. **No wrapper or `height={0}` trick needed for the
single child.**

The `<object>` element is plain HTML, not a UIKit component — its
inline `style={{ width: "100%", height: "100%", border: "none" }}` is
permitted under UIKit Rule 7 (the no-style rule applies only to UIKit
components in app code).

### Stale CSS in current root

`PdfViewerRoot` declares `height: 200` alongside `flex: "1 1 auto"`
(line 22). In a column-flex context, `flex: 1 1 auto` resolves the
height from the parent's available space — the literal `height: 200`
is dead code (a leftover; flex calculations override it and the
viewer is never 200px tall in practice). Drop it cleanly with the
styled component.

## Implementation plan

### Step 1 — `PdfViewer.tsx` imports

Remove (lines 1, 8, 9):

```tsx
import styled from "@emotion/styled";
...
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
```

Add (with the other imports near the top of the file):

```tsx
import { Panel } from "../../uikit/Panel";
import { IconButton } from "../../uikit/IconButton";
import { Spacer } from "../../uikit/Spacer";
```

Other imports (`IEditorState`, `EditorModel`, `PageToolbar`, `FileIcon`,
`NavPanelIcon`, model-side `fpBasename`, `appFs`, `ContentPipe`,
`FileProvider`, `ArchiveTransformer`, `TComponentState`) stay
unchanged.

### Step 2 — Drop the styled root

Delete the `PdfViewerRoot` styled component definition (lines 18–24):

```tsx
const PdfViewerRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    height: 200,
    position: "relative",
});
```

`position: relative` was defensive but has no effect — pdf.js viewer
runs inside the `<object>` element's own browsing context, so CSS
positioning on this root cannot influence it. No descendants of the
React root use absolute positioning. Drop with the styled component.

### Step 3 — Migrate the `PdfViewer` render body

Replace the render body (lines 124–151):

**Before:**

```tsx
return (
    <>
        <PageToolbar borderBottom>
            {(model.page?.canOpenNavigator(model.pipe, filePath) || filePath) && (
                <Button
                    type="icon"
                    size="small"
                    title="File Explorer"
                    onClick={() => {
                        model.page?.toggleNavigator(model.pipe, filePath);
                    }}
                >
                    <NavPanelIcon />
                </Button>
            )}
            <FlexSpace />
        </PageToolbar>
        <PdfViewerRoot>
            {viewerUrl && (
                <object
                    data={viewerUrl}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    type="text/html"
                />
            )}
        </PdfViewerRoot>
    </>
);
```

**After:**

```tsx
return (
    <>
        <PageToolbar borderBottom>
            {(model.page?.canOpenNavigator(model.pipe, filePath) || filePath) && (
                <IconButton
                    size="sm"
                    title="File Explorer"
                    icon={<NavPanelIcon />}
                    onClick={() => {
                        model.page?.toggleNavigator(model.pipe, filePath);
                    }}
                />
            )}
            <Spacer />
        </PageToolbar>
        <Panel direction="column" flex={1} overflow="hidden">
            {viewerUrl && (
                <object
                    data={viewerUrl}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    type="text/html"
                />
            )}
        </Panel>
    </>
);
```

The model class, the `useState`-style `model.state.use` reads, the
`fileUrl` / `viewerUrl` derivation, and the `<object>`'s inline style
(plain HTML, not UIKit) all stay unchanged.

### Step 4 — Verify

- `npm run lint` — no new warnings/errors.
- `npx tsc --noEmit` — no new errors. (UIKit `Panel` / `IconButton`
  forbid `style`/`className` at the type level, so any leftover
  Emotion escape hatch surfaces immediately.)
- Manual smoke (see Test surface below).

## Concerns

All items below were investigated and resolved during planning; listed
for reviewer visibility.

1. **`<object>` height resolution.** The embedded `<object>` uses
   `height: 100%`. With `<Panel direction="column" flex={1}
   overflow="hidden">` as the parent, the panel becomes a `flex: 1 1
   auto` item in the editor's column-flex host — same resolved height
   as the existing `PdfViewerRoot`. The `<object>`'s `height: 100%`
   resolves identically. No wrapper, no `height={0}`, no `minHeight={0}`
   workaround needed. (US-509 used `height={0}` for nested column flex
   children that flex-grow without overflow; this case is a single
   non-flex child, so the rule does not apply.)

2. **`position: relative` removal is safe.** The original root
   declared it, but no descendant uses absolute positioning, and pdf.js
   runs in the `<object>` element's own browsing context where outer
   CSS positioning does not apply. Drop it.

3. **`height: 200` removal is safe.** Dead code — `flex: 1 1 auto`
   resolves the height from the parent's available space and overrides
   the literal `height: 200`. The viewer has never been 200px tall in
   practice.

4. **`PageToolbar` retention.** `PageToolbar` is exported from
   `editors/base/EditorToolbar.tsx`, which is **not** under
   `components/basic|form|layout|overlay/`. The Phase 4 ban targets
   those four folders only; `editors/base/` is editor-base
   infrastructure and is intentionally kept post-migration. US-502 and
   US-505 set this precedent. **No changes to PageToolbar.**

5. **Icon visual size unchanged.** No inline `width`/`height` on
   `<NavPanelIcon />` to drop. UIKit `IconButton size="sm"` applies the
   same 16px svg sizing as the old `Button.small`.

6. **Tooltip wrapping.** Old `Button` wrapped its `title` in a private
   tooltip primitive; UIKit `IconButton` wraps `title` in
   `uikit/Tooltip`. The tooltip primitive changes, but the user-facing
   UX (hover/focus tooltip with the "File Explorer" label) is preserved.

7. **`<object>` inline `style=` is allowed.** It's a plain HTML element,
   not a UIKit component — Rule 7's no-`style` clause doesn't apply.
   Leave the `width: 100%; height: 100%; border: none` inline style
   exactly as-is.

8. **Outermost render is still a fragment.** The `PdfViewer` function
   returns `<>...</>` because the editor host provides its own
   column-flex container; the toolbar and the body live as siblings of
   the host's flex column. Keep the fragment — do not wrap toolbar +
   body in an extra Panel.

## Acceptance criteria

- [x] No `@emotion/styled` import or usage in
      `src/renderer/editors/pdf/PdfViewer.tsx`.
- [x] No imports from `components/basic/`, `components/form/`,
      `components/layout/`, or `components/overlay/` in that file.
- [x] `<object>` element's `data`, `type`, and inline style are
      unchanged.
- [x] `PdfEditorModel` class (the model-side code in the same file) is
      unchanged.
- [x] `npm run lint` is clean for `PdfViewer.tsx` (no new
      warnings/errors introduced).
- [x] `npx tsc --noEmit` reports no new errors for `PdfViewer.tsx`.
- [ ] Manual smoke (below) all pass — pending user testing.

## Test surface (manual smoke)

- Open a `.pdf` file from the explorer: pdf.js viewer renders and
  fills the editor's body area; pages scroll inside it.
- Toolbar shows a single **File Explorer** icon button on the left when
  the page can open a navigator; the rest of the toolbar bar is empty
  (filled by `<Spacer />`).
- Click **File Explorer** — the page navigator toggles
  (`page.toggleNavigator(...)`) exactly as before.
- Hover **File Explorer** — UIKit Tooltip shows "File Explorer".
- Open a PDF inside an archive (e.g. `.zip!folder/foo.pdf`): the
  ArchiveTransformer cache path resolves and the viewer renders the
  cached PDF.
- Open a PDF over HTTP (if the route is reachable): cache file is
  written and the viewer renders.
- Switch to another tab and back: the embedded pdf.js viewer keeps its
  scroll position (this is pdf.js's own behavior — confirm no
  regression introduced by chrome changes).
- Zoom / page navigation / search inside the pdf.js viewer all still
  work (those controls are inside the embedded HTML — unchanged by
  this migration).
- Resize the window: the viewer body resizes with the editor host
  (`flex={1}` works as before).

## Files changed

| File | Change |
|---|---|
| `src/renderer/editors/pdf/PdfViewer.tsx` | Remove `@emotion/styled`, `Button`, `FlexSpace` imports; add UIKit `Panel`, `IconButton`, `Spacer`. Drop `PdfViewerRoot` styled.div. Replace toolbar `Button` → `IconButton`, `FlexSpace` → `Spacer`. Replace body `<PdfViewerRoot>` → `<Panel direction="column" flex={1} overflow="hidden">`. |

## Files unchanged (do not investigate)

- `src/renderer/editors/pdf/index.ts`
- `src/renderer/editors/base/EditorToolbar.tsx`
- `assets/pdfjs/**` (vendored pdf.js)
- `src/main/` protocol handlers for `safe-file://` / `app-asset://`

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Reference implementation:
  [US-505 Archive editor](../US-505-archive-editor-migration/README.md) —
  near-identical pattern (root + PageToolbar + single icon button).
- Reference implementation:
  `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` (US-502) —
  column-flex editor root pattern.
- Deferred review: this task does NOT run `/review`, `/document`, or
  `/userdoc` — those run at EPIC-025 close per the deferred-review
  model.
