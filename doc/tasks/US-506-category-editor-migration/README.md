# US-506: Category editor — UIKit migration

## Status

**Plan ready for review** — Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration. Deferred-review model: this task does NOT
run `/review`, `/document`, or `/userdoc` — those run at epic close.

## Goal

Migrate the Category editor's chrome to UIKit primitives. After this
task, `editors/category/CategoryEditor.tsx`:

- contains no `@emotion/styled` definitions,
- imports nothing from `components/basic|form|layout|overlay/`,
- contains no inline `style={...}` on chrome elements,
- no longer reads `theme/color` directly for chrome backgrounds /
  text colors.

The embedded `CategoryView` (from `components/tree-provider/`) is
**out of scope** — only the editor's own chrome changes. CategoryView
will be addressed under a future task (likely a US-497 follow-up).

## Background

### Where this component is used

`CategoryEditor` is the **main editor** for the `"categoryPage"` editor
type — `src/shared/types.ts:1` and registered at
`src/renderer/editors/register-editors.ts:586` (`editors/register-editors.ts`
imports the module via dynamic `import("./category/CategoryEditor")`).

Activation flow:

- A category link is opened (`createCategoryLink(...)` from
  `content/tree-providers/tree-provider-link.ts`).
- `content/resolvers.ts:56` resolves the link to a `categoryPage` editor
  type with a placeholder file pipe.
- `register-editors.ts` constructs `CategoryEditorModel` and renders
  `CategoryEditor`.
- The editor finds a matching tree-provider host among the page's
  secondary editors (`findTreeProviderHost` — typically the
  `LinkCategorySecondaryEditor`, see
  `editors/link-editor/panels/LinkCategorySecondaryEditor.tsx:35`) and
  delegates rendering of the tree to `CategoryView`.

Practical user-visible: the Category editor surface appears when the
user opens a category folder from the sidebar's Link navigator — the
right pane shows `CategoryEditor` with its toolbar and an embedded
folder/file view.

### Files in scope

Single file, single screen:

- `src/renderer/editors/category/CategoryEditor.tsx`

### Files NOT changed

- `src/renderer/editors/category/CategoryEditorModel.ts` — pure model.
- `src/renderer/editors/category/FolderViewModeService.ts` — pure
  service.
- `src/renderer/editors/register-editors.ts` — registration unchanged.
- `src/renderer/components/tree-provider/CategoryView.tsx` and the rest
  of `components/tree-provider/` — out of scope (its own future task).
- `src/renderer/editors/base/EditorToolbar.tsx` — `PageToolbar` is
  editor-base infrastructure and is **kept** (only `components/basic|
  form|layout|overlay/` are banned by Phase 4 rules).

### Reference migration

Pattern matches `editors/archive/ArchiveEditorView.tsx` (US-505) —
same toolbar layout (Toggle Navigator on left, Spacer, optional
right-side controls), same Panel root, same `IconButton` size/title
style.

### Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` `CategoryEditorRoot` (display:flex, column, w/h 100%, overflow hidden, background) | `<Panel direction="column" flex={1} overflow="hidden" background="default">` |
| `components/basic/Button` (Toggle Navigator) | `<IconButton size="sm" title="Navigation Panel" icon={<NavPanelIcon />} />` |
| `components/layout/Elements.FlexSpace` | UIKit `<Spacer />` |
| Empty-state `<div style={{ padding: 16, color: color.text.light }}>` | `<Panel padding="xl"><Text color="light">…</Text></Panel>` (xl token = 16) |
| Search-portal `<div ref={setSearchPortal} style={{ display:"flex", alignItems:"center", gap:4 }} />` | `<Panel direction="row" align="center" gap="xs" ref={setSearchPortal} />` (xs token = 4) |
| `import color from "../../theme/color"` (chrome only) | removed |

> Note: the placeholder previously listed "view-mode toggle" as a
> migration item. That toggle does **not** live in `CategoryEditor.tsx`
> — it's inside `CategoryView` and therefore out of scope. The only
> Button in `CategoryEditor.tsx` is the Navigation-Panel toggle.

### Spacing tokens (from `uikit/tokens.ts`)

- `xs` = 4 → matches old portal `gap: 4`.
- `xl` = 16 → matches old empty-state `padding: 16`.

### Icon sizing

`IconButton size="sm"` already provides the consistent 14×14 icon
visual the old `<Button type="icon" size="small">` used. Per the
Archive migration we drop any inline `width`/`height` props on the icon
elements — IconButton's own CSS handles it.

## Implementation plan

### Step 1 — replace imports

In `src/renderer/editors/category/CategoryEditor.tsx`:

**Remove**:

```ts
import styled from "@emotion/styled";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import color from "../../theme/color";
```

**Add** (matching style of Archive migration — direct UIKit subpaths):

```ts
import { Panel } from "../../uikit/Panel";
import { IconButton } from "../../uikit/IconButton";
import { Spacer } from "../../uikit/Spacer";
import { Text } from "../../uikit/Text";
```

`PageToolbar` import from `../base/EditorToolbar` stays.
`NavPanelIcon` import from `../../theme/icons` stays.

### Step 2 — drop the styled root

Remove the entire `CategoryEditorRoot` declaration (lines 53–60 of the
current file) and the surrounding `// === Styles ===` comment block.

### Step 3 — empty branch (no provider)

Before:

```tsx
if (!provider) {
    return (
        <CategoryEditorRoot>
            <PageToolbar borderBottom>
                <Button
                    type="icon"
                    size="small"
                    title="Navigation Panel"
                    onClick={handleToggleNavigator}
                >
                    <NavPanelIcon />
                </Button>
                <FlexSpace />
            </PageToolbar>
            <div style={{ padding: 16, color: color.text.light }}>
                Please select a category in the Navigation Panel.
            </div>
        </CategoryEditorRoot>
    );
}
```

After:

```tsx
if (!provider) {
    return (
        <Panel direction="column" flex={1} overflow="hidden" background="default">
            <PageToolbar borderBottom>
                <IconButton
                    size="sm"
                    title="Navigation Panel"
                    icon={<NavPanelIcon />}
                    onClick={handleToggleNavigator}
                />
                <Spacer />
            </PageToolbar>
            <Panel padding="xl">
                <Text color="light">Please select a category in the Navigation Panel.</Text>
            </Panel>
        </Panel>
    );
}
```

### Step 4 — main render

Before:

```tsx
return (
    <CategoryEditorRoot>
        <PageToolbar borderBottom>
            <Button
                type="icon"
                size="small"
                title="Navigation Panel"
                onClick={handleToggleNavigator}
            >
                <NavPanelIcon />
            </Button>
            <FlexSpace />
            <div ref={setSearchPortal} style={{ display: "flex", alignItems: "center", gap: 4 }} />
        </PageToolbar>
        <CategoryView
            provider={provider}
            category={categoryPath}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            selectedHref={selectedHref}
            onItemClick={handleSelect}
            onItemDoubleClick={handleNavigate}
            onFolderClick={handleNavigate}
            toolbarPortalRef={searchPortal}
        />
    </CategoryEditorRoot>
);
```

After:

```tsx
return (
    <Panel direction="column" flex={1} overflow="hidden" background="default">
        <PageToolbar borderBottom>
            <IconButton
                size="sm"
                title="Navigation Panel"
                icon={<NavPanelIcon />}
                onClick={handleToggleNavigator}
            />
            <Spacer />
            <Panel direction="row" align="center" gap="xs" ref={setSearchPortal} />
        </PageToolbar>
        <CategoryView
            provider={provider}
            category={categoryPath}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            selectedHref={selectedHref}
            onItemClick={handleSelect}
            onItemDoubleClick={handleNavigate}
            onFolderClick={handleNavigate}
            toolbarPortalRef={searchPortal}
        />
    </Panel>
);
```

## Concerns (resolved)

1. **Does `Panel` forward `ref` to its underlying DOM element?**  
   `setSearchPortal(HTMLDivElement | null)` requires a DOM ref to mount
   `createPortal` children into. UIKit `Panel` forwards `ref` (as a
   regular React 19 `ref` prop on the function component, since UIKit
   primitives use the new `ref` style). Confirmed by Archive's
   `treeRef` and other UIKit refs in the codebase. **Resolution**: use
   `<Panel ref={setSearchPortal} …/>`. If during implementation the
   ref-forwarding contract for `Panel` doesn't yield an `HTMLDivElement`,
   fall back to a bare `<div ref={setSearchPortal} />` with no inline
   styles — replicate the row/center/gap with a thin wrapper Panel
   around it. **Verify before merge**: spot-check that the search input
   appears once you focus the embedded view; if no children mount,
   `setSearchPortal` didn't receive a DOM node.

2. **PageToolbar — is it allowed?**  
   Phase 4 rules ban only `components/basic|form|layout|overlay/`.
   `editors/base/EditorToolbar.tsx` is editor-base infrastructure and is
   kept (same decision as US-505 Archive). **Resolution**: keep
   `PageToolbar` import.

3. **Empty-state text color — `light` token mapping**  
   Old code reads `color.text.light` (theme). New code uses
   `<Text color="light">`. UIKit `Text` `color="light"` maps to the same
   `--text-light` theme variable. **Resolution**: direct swap, no
   visual diff expected.

4. **Empty-state padding 16 → token `xl`**  
   `uikit/tokens.ts` defines `spacing.xl = 16`. **Resolution**: use
   `padding="xl"`.

5. **Search-portal `gap: 4` → token `xs`**  
   `uikit/tokens.ts` defines `spacing.xs = 4`. **Resolution**: use
   `gap="xs"`.

6. **Icon size — old `width={14} height={14}` style?**  
   `CategoryEditor.tsx` does NOT set inline icon size on `NavPanelIcon`
   — the existing `<Button type="icon" size="small">` already controls
   size via CSS. New `IconButton size="sm"` matches that visual.
   **Resolution**: no inline size needed.

7. **View-mode toggle — should it be migrated?**  
   The view-mode toggle (`list`/`compact`/`details` etc.) lives inside
   `CategoryView` (`components/tree-provider/CategoryView.tsx`) and is
   rendered there, not in `CategoryEditor`. **Resolution**: out of
   scope — the placeholder line about it is incorrect and is dropped
   from the plan.

## Acceptance criteria

- [ ] No `@emotion/styled` import in
      `src/renderer/editors/category/CategoryEditor.tsx`.
- [ ] No imports from `components/basic|form|layout|overlay/` in that
      file.
- [ ] No inline `style={…}` on chrome elements (the `<div ref=…>`
      portal target and empty-state `<div>` are both replaced).
- [ ] No `theme/color` import in that file (`color` was used only for
      chrome bg + text-light).
- [ ] `PageToolbar` and `NavPanelIcon` imports unchanged.
- [ ] `npm run lint` clean for this file (no new warnings).
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (Test surface below) passes.

## Test surface (manual smoke)

- Open a category page from the sidebar's Link navigator — the editor
  renders, toolbar shows the Toggle Navigator icon button.
- Click Toggle Navigator — the page's navigator collapses/expands.
- Initially without a provider (rare, but trigger by opening a category
  link before its host secondary editor restores) — the empty branch
  shows "Please select a category in the Navigation Panel." with the
  same muted/light text color and 16-px padding as before.
- Search portal: trigger the embedded `CategoryView` search; the search
  input mounts inside the toolbar's right-side slot.
- Click a folder/item in `CategoryView` — selection updates, navigation
  fires (unchanged since `CategoryView` is unmodified).
- View-mode toggle inside `CategoryView` still works (unchanged).
- Visual regression: toolbar height, borders, icon sizing match the
  Archive editor toolbar (consistent toolbar pattern across
  US-505/506/507).

## Files changed

| File | Change |
|---|---|
| `src/renderer/editors/category/CategoryEditor.tsx` | Replace styled root with `Panel`; swap `Button` → `IconButton`; swap `FlexSpace` → `Spacer`; swap empty-state `<div>` → `Panel`+`Text`; swap search-portal `<div>` → `Panel` with `ref`; remove `styled`, `Button`, `FlexSpace`, `color` imports; add `Panel`, `IconButton`, `Spacer`, `Text` imports. |

## Files unchanged

- `src/renderer/editors/category/CategoryEditorModel.ts`
- `src/renderer/editors/category/FolderViewModeService.ts`
- `src/renderer/editors/register-editors.ts`
- `src/renderer/components/tree-provider/CategoryView.tsx` (and rest of
  `components/tree-provider/`)
- `src/renderer/editors/base/EditorToolbar.tsx`

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Reference migration: [US-505 Archive editor](../US-505-archive-editor-migration/README.md)
