# US-505: Archive editor — UIKit migration

## Status

**Plan ready for review.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4
per-screen migration.

## Goal

Migrate the Archive editor surface (ZIP / RAR / 7z / TAR viewer) chrome to
UIKit primitives. After this task, no file under
`src/renderer/editors/archive/` imports from
`components/basic|form|layout|overlay/` and no `@emotion/styled`
definitions remain in those files.

The embedded `TreeProviderView` (from `components/tree-provider/`) is **out
of scope** — it migrates separately under
[US-497](../US-497-treeproviderview-migration/README.md). This task changes
only the editor's own chrome (root container, page toolbar buttons,
secondary-editor header portal).

## Background

### Files in scope (rendering)

- `src/renderer/editors/archive/ArchiveEditorView.tsx` — main editor view
  (toolbar + tree).
- `src/renderer/editors/archive/ArchiveSecondaryEditor.tsx` — secondary
  panel rendered into the page sidebar via `createPortal(headerContent,
  headerRef)`.

### Files NOT changed

- `src/renderer/editors/archive/ArchiveEditorModel.ts` — pure model code,
  no JSX.
- `src/renderer/editors/archive/index.ts` — editor module registration; no
  JSX changes.
- `src/renderer/editors/register-editors.ts` — secondary-editor registry
  entry `{ id: "archive-tree", ..., loadComponent: () =>
  import("./archive/ArchiveSecondaryEditor") }` is unchanged.
- `src/renderer/editors/base/EditorToolbar.tsx` — `PageToolbar` is
  editor-base infrastructure and is kept (matches `McpInspectorView`
  post-US-502, which continues to import `PageToolbar` from
  `editors/base`).
- `src/renderer/components/tree-provider/TreeProviderView.tsx` — out of
  scope (US-497).

### Reference implementation

`src/renderer/editors/mcp-inspector/McpInspectorView.tsx` is the most
recent migration of this exact pattern — UIKit `Panel` as the column-flex
root, `PageToolbar` retained from `editors/base`, UIKit primitives
inside. Mirror its conventions:

```tsx
<Panel direction="column" flex={1} overflow="hidden">
    <PageToolbar borderBottom>
        {/* UIKit IconButton / Button / Input */}
    </PageToolbar>
    {/* body */}
</Panel>
```

### UIKit primitives mapping

| Old | New |
|---|---|
| `styled.div` (`ArchiveEditorViewRoot`) | UIKit `Panel` (`direction="column" flex={1} overflow="hidden" background="default"`) |
| `<div style={{ padding: 16, color: color.text.light }}>` (empty state) | UIKit `Panel padding="xl"` + `Text color="light"` |
| `components/basic/Button` `type="icon" size="small"` | UIKit `IconButton size="sm"` (icon passed via `icon` prop) |
| `components/layout/Elements.FlexSpace` | UIKit `Spacer` |
| `<span className="panel-spacer" />` (secondary header portal) | UIKit `Spacer` |
| `theme/color` reads (`background.default`, `text.light`) | dropped — Panel `background="default"` and Text `color="light"` |

### Spacing tokens

`spacing.xl = 16` in `uikit/tokens.ts` matches the existing empty-state
`padding: 16`. Use `padding="xl"` directly; no token additions needed.

### Icon sizing

In current code, `<CollapseAllIcon width={14} height={14} />` is rendered
inside `Button` with `size="small"`, whose `& svg { width: 16; height: 16
}` rule **already overrides** the inline `width={14}` to 16 via CSS. UIKit
`IconButton size="sm"` applies the same 16px svg sizing through its own
`'&[data-size="sm"]' '& svg'` rule. Drop the inline `width`/`height`
props when migrating; the visual size is unchanged.

## Implementation plan

### Step 1 — `ArchiveEditorView.tsx`

**Imports.** Remove:

```tsx
import styled from "@emotion/styled";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import color from "../../theme/color";
```

Add:

```tsx
import { Panel } from "../../uikit/Panel";
import { IconButton } from "../../uikit/IconButton";
import { Spacer } from "../../uikit/Spacer";
import { Text } from "../../uikit/Text";
```

**Drop** the `ArchiveEditorViewRoot` styled component definition (lines
18–25).

**Empty-state branch** (lines 49–57). Replace:

```tsx
if (!provider) {
    return (
        <ArchiveEditorViewRoot>
            <div style={{ padding: 16, color: color.text.light }}>
                No archive loaded.
            </div>
        </ArchiveEditorViewRoot>
    );
}
```

with:

```tsx
if (!provider) {
    return (
        <Panel
            direction="column"
            flex={1}
            overflow="hidden"
            background="default"
            padding="xl"
        >
            <Text color="light">No archive loaded.</Text>
        </Panel>
    );
}
```

**Main render branch** (lines 59–95). Replace:

```tsx
return (
    <ArchiveEditorViewRoot>
        <PageToolbar borderBottom>
            <Button
                type="icon"
                size="small"
                title="File Explorer"
                onClick={handleToggleNavigator}
            >
                <NavPanelIcon />
            </Button>
            <FlexSpace />
            <Button
                type="icon"
                size="small"
                title="Collapse All"
                onClick={handleCollapseAll}
            >
                <CollapseAllIcon width={14} height={14} />
            </Button>
            <Button
                type="icon"
                size="small"
                title="Refresh"
                onClick={handleRefresh}
            >
                <RefreshIcon width={14} height={14} />
            </Button>
        </PageToolbar>
        <TreeProviderView
            ref={treeRef}
            provider={provider}
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemClick}
        />
    </ArchiveEditorViewRoot>
);
```

with:

```tsx
return (
    <Panel
        direction="column"
        flex={1}
        overflow="hidden"
        background="default"
    >
        <PageToolbar borderBottom>
            <IconButton
                size="sm"
                title="File Explorer"
                icon={<NavPanelIcon />}
                onClick={handleToggleNavigator}
            />
            <Spacer />
            <IconButton
                size="sm"
                title="Collapse All"
                icon={<CollapseAllIcon />}
                onClick={handleCollapseAll}
            />
            <IconButton
                size="sm"
                title="Refresh"
                icon={<RefreshIcon />}
                onClick={handleRefresh}
            />
        </PageToolbar>
        <TreeProviderView
            ref={treeRef}
            provider={provider}
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemClick}
        />
    </Panel>
);
```

`PageToolbar`, `TreeProviderView`, and the three `useCallback` handlers
are unchanged.

### Step 2 — `ArchiveSecondaryEditor.tsx`

**Imports.** Remove:

```tsx
import { Button } from "../../components/basic/Button";
```

Add:

```tsx
import { IconButton } from "../../uikit/IconButton";
import { Spacer } from "../../uikit/Spacer";
```

**`headerContent` JSX** (lines 38–53). Replace:

```tsx
const headerContent = (
    <>
        Archive
        <span className="panel-spacer" />
        {!isActivePagePanel && (
            <Button type="icon" size="small" title="Close"
                onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    archiveModel.page?.removeSecondaryEditor(archiveModel);
                }}
            >
                <CloseIcon width={14} height={14} />
            </Button>
        )}
    </>
);
```

with:

```tsx
const headerContent = (
    <>
        Archive
        <Spacer />
        {!isActivePagePanel && (
            <IconButton
                size="sm"
                title="Close"
                icon={<CloseIcon />}
                onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    archiveModel.page?.removeSecondaryEditor(archiveModel);
                }}
            />
        )}
    </>
);
```

The `<TreeProviderView />` element below the portal is unchanged.

### Step 3 — Verify

- `npm run lint` — no new warnings/errors.
- `npx tsc --noEmit` — no new errors. (UIKit `Panel`/`IconButton`/`Text`
  forbid `style` and `className` at the type level, so any leftover
  Emotion escape hatch surfaces immediately.)
- Manual smoke test (see Test surface below).

## Concerns

All previously open questions have been resolved during investigation —
listed here for reviewer visibility.

1. **TreeProviderView height behavior.** TreeProviderView's root uses
   `width: 100%; height: 100%; overflow: hidden` (see
   `components/tree-provider/TreeProviderView.tsx:50–57`). It renders
   correctly today as a child of the existing `display: flex;
   flex-direction: column; height: 100%; overflow: hidden` root. Replacing
   the root with `<Panel direction="column" flex={1} overflow="hidden">`
   produces the same flex column with the same overflow behavior, so
   TreeProviderView keeps working without a wrapping Panel. **No wrapper
   needed.** (`McpInspectorView` uses the identical pattern and ships in
   US-502.)

2. **PageToolbar retention.** `PageToolbar` is exported from
   `editors/base/EditorToolbar.tsx`, which is *not* under
   `components/basic|form|layout|overlay/`. The Phase 4 acceptance rule
   bans imports from those four folders only. `editors/base/` is
   editor-base infrastructure and is intentionally kept post-migration.
   `McpInspectorView` (US-502) imports `PageToolbar` from `editors/base`
   and is a passing reference. **No changes to PageToolbar.**

3. **Empty-state padding match.** The old empty-state used
   `padding: 16`. `spacing.xl = 16`, so `padding="xl"` is a literal pixel
   match. **No token additions needed.**

4. **Icon visual size.** The old code passes `width={14} height={14}` on
   `CollapseAllIcon` / `RefreshIcon` / `CloseIcon`. Inside the old
   `Button.small`, the CSS rule `& svg { width: 16; height: 16 }`
   overrides the inline 14 to 16. UIKit `IconButton size="sm"` applies
   the same 16px sizing via its own `'&[data-size="sm"]' '& svg'` rule.
   **Visual size unchanged.** Drop the inline `width`/`height` props on
   icons in the migration.

5. **Spacer in portaled secondary header.** UIKit `<Spacer />` renders a
   `<span style={{ flex: "1 1 auto" }}>`, which is functionally identical
   to the `<span className="panel-spacer" />` it replaces
   (CollapsiblePanelStack's `.panel-spacer` rule is also
   `flex: 1 1 auto`). The portal target is a `<div>` inside
   CollapsiblePanelStack — UIKit components render normally inside it.
   **Safe drop-in replacement.**

6. **Tooltip wrapping.** Old `Button` wraps in its own `Tooltip`
   primitive when `title` is set; UIKit `IconButton` wraps in
   `uikit/Tooltip` when `title` is set. The tooltip primitive changes,
   but the user-facing UX (hover/focus tooltip) is preserved. No action
   needed.

7. **Sidebar header pattern across editors.** ExplorerSecondaryEditor and
   SearchSecondaryEditor (US-507) and the link-editor secondary panels
   use the same `<span className="panel-spacer" />` + `Button` portal
   pattern. The migration choices made here (Spacer + IconButton + drop
   icon dimensions) should be reused by US-507 for consistency.

## Acceptance criteria

- [ ] No `@emotion/styled` import or usage in
      `src/renderer/editors/archive/ArchiveEditorView.tsx` or
      `ArchiveSecondaryEditor.tsx`.
- [ ] No imports from `components/basic/`, `components/form/`,
      `components/layout/`, or `components/overlay/` in either file.
      `components/tree-provider/` (TreeProviderView) imports remain — its
      migration is US-497.
- [ ] `<TreeProviderView />` element and its props are unchanged.
- [ ] `npm run lint` is clean (no new warnings/errors).
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke test (see below) all pass.

## Test surface (manual smoke)

- Open a `.zip` file: archive tree renders; `ArchiveEditorView` toolbar
  shows three icon buttons (File Explorer, Collapse All, Refresh).
- Click a file in the tree: file opens in a new tab (delegated through
  `app.events.openRawLink.sendAsync` via `handleItemClick`).
- Toolbar **File Explorer** button toggles the page navigator
  (`page.toggleNavigator()`).
- Toolbar **Collapse All** collapses every node (root re-expands per
  TreeProviderView's existing logic).
- Toolbar **Refresh** rebuilds the tree (`treeRef.current?.refresh()`).
- Hovering each toolbar button shows the UIKit Tooltip with the correct
  label.
- Open a `.zip` from a context where the archive is the secondary editor
  (e.g. open a file inside the archive to make a different model the main
  editor): the **Archive** secondary panel appears in the sidebar with
  the **Close** icon button on the right. Click Close — secondary editor
  removes via `removeSecondaryEditor(archiveModel)`.
- When the archive *is* the active main editor, the Close button is not
  rendered (`!isActivePagePanel` branch).
- Drag-drop / context menu on tree items still work (these go through
  `TreeProviderView` — should be unaffected).
- Open an archive in the absence of a `treeProvider` (edge case — restore
  before init): **No archive loaded.** message renders centered-ish
  inside the editor frame, with `Text color="light"` rendering.

## Files changed

| File | Change |
|---|---|
| `src/renderer/editors/archive/ArchiveEditorView.tsx` | Remove `styled.div` root + 4 imports (`@emotion/styled`, `Button`, `FlexSpace`, `color`). Replace root + empty-state with UIKit `Panel` + `Text`. Replace 3 toolbar `Button`s with `IconButton`. Replace `FlexSpace` with `Spacer`. Drop inline icon `width`/`height`. |
| `src/renderer/editors/archive/ArchiveSecondaryEditor.tsx` | Remove `Button` import, add `IconButton` + `Spacer`. Replace `<span className="panel-spacer" />` with `<Spacer />`. Replace Close `Button` with `IconButton`. Drop inline icon `width`/`height`. |

## Files unchanged (do not investigate)

- `src/renderer/editors/archive/ArchiveEditorModel.ts`
- `src/renderer/editors/archive/index.ts`
- `src/renderer/editors/register-editors.ts`
- `src/renderer/editors/base/EditorToolbar.tsx`
- `src/renderer/components/tree-provider/**` (US-497)

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Reference implementation:
  `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` (US-502)
- Related: [US-497](../US-497-treeproviderview-migration/README.md) —
  `TreeProviderView` itself migrates separately
- Related: [US-507](../US-507-explorer-secondary-editors-migration/README.md)
  — same secondary-header `IconButton` + `Spacer` pattern
- Deferred review: this task does NOT run `/review`, `/document`, or
  `/userdoc` — those run at EPIC-025 close per the deferred-review model.
