# US-301: Redesign PageNavigator with Collapsible Panel Headers

**Status:** Planned
**Epic:** EPIC-015 (Phase 3)
**Depends on:** US-296 (PageNavigator)

## Goal

Refactor PageNavigator's flat toolbar into a collapsible panel header pattern using the existing `CollapsiblePanelStack` component. The current single toolbar with buttons becomes a labeled panel header ("Explorer") with inline action buttons. This prepares the layout for US-302 where a secondary panel (Archive/Links) will appear below.

## Background

### Current PageNavigator layout

```
┌─────────────────────────┐
│ [↑]         [⊟] [↻] [✕]│  ← flat toolbar
│ ┌─────────────────────┐ │
│ │ TreeProviderView     │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

### Target layout (single panel, this task)

```
┌─────────────────────────┐
│ Explorer  [↑] [⊟][↻][✕]│  ← panel header with label + buttons
│ ┌─────────────────────┐ │
│ │ TreeProviderView     │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

### Target layout (with secondary panel, US-302)

```
┌─────────────────────────┐
│ Explorer  [↑] [⊟][↻][✕]│  ← expanded
│ ┌─────────────────────┐ │
│ │ TreeProviderView     │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│ Archive         [⊟] [↻]│  ← collapsed, no Close button
└─────────────────────────┘
```

No chevron icons — the expanded/collapsed state is self-evident from the panel content being visible or not.

### Approach: Extend CollapsiblePanelStack

Reuse the existing `CollapsiblePanelStack` (`components/layout/CollapsiblePanelStack.tsx`) by adding two optional props to `CollapsiblePanel`:

- `icon?: ReactNode` — optional icon before the title
- `buttons?: ReactNode` — action buttons rendered at the right side of the header

This avoids duplicating the panel stack logic. Usage:

```tsx
<CollapsiblePanelStack activePanel={activePanel} setActivePanel={setActivePanel}>
    <CollapsiblePanel
        id="explorer"
        title="Explorer"
        buttons={<>
            <Button ...><FolderUpIcon /></Button>
            <Button ...><CollapseAllIcon /></Button>
            <Button ...><RefreshIcon /></Button>
            <Button ...><CloseIcon /></Button>
        </>}
    >
        <TreeProviderView ... />
    </CollapsiblePanel>
</CollapsiblePanelStack>
```

The `Button` component already calls `e.stopPropagation()` in its click handler (Button.tsx line 164), so button clicks won't trigger the panel header's toggle handler.

### Design decisions

1. **No chevron icons** — expanded/collapsed state is visible from the content. Chevrons add visual noise without information.
2. **No `handleTogglePanel` for this task** — with only one panel, there's nothing to toggle. Keep it simple, add interactivity in US-302.
3. **Keep `require("path")`** — the `fpDirname` rule was for transparent zip path handling in the old `app.fs` system. With the new pipe+transformer approach, `path.dirname`/`path.basename` is correct for filesystem paths used by FileTreeProvider.
4. **Panel label is contextual** — "Explorer" for FileTreeProvider, "Archive" for Zip, "Links" for Link. Not always "Explorer" — if opening `https://site.net/data.zip` there may be no filesystem explorer, only the archive panel.

## Implementation Plan

### Step 1: Extend CollapsiblePanelStack

Add optional props to `CollapsiblePanelProps`:

```typescript
export interface CollapsiblePanelProps {
    id: string;
    title: string;
    children: ReactNode;
    /** Optional icon before the title */
    icon?: ReactNode;
    /** Optional action buttons rendered at the right of the header */
    buttons?: ReactNode;
}
```

Update `CollapsiblePanelStack` rendering to include these:

```tsx
<div className="panel-header" onClick={() => handleToggle(panel.id)}>
    {panel.icon}
    {panel.title}
    {panel.buttons && (
        <>
            <span className="panel-spacer" />
            {panel.buttons}
        </>
    )}
</div>
```

Remove the chevron icons (ChevronDownIcon / ChevronRightIcon) from CollapsiblePanelStack headers.

Add `.panel-spacer` style: `{ flex: "1 1 auto" }`.

Extract `icon` and `buttons` from panel children props alongside `id`, `title`, `children`.

### Step 2: Update PageNavigator to use CollapsiblePanelStack

Replace the flat toolbar with a single-panel CollapsiblePanelStack:

```tsx
import { CollapsiblePanelStack, CollapsiblePanel } from "../../components/layout/CollapsiblePanelStack";

// In component:
const [activePanel, setActivePanel] = useState("explorer");

return (
    <PageNavigatorRoot>
        <CollapsiblePanelStack
            activePanel={activePanel}
            setActivePanel={setActivePanel}
        >
            <CollapsiblePanel
                id="explorer"
                title="Explorer"
                buttons={
                    <>
                        {provider?.navigable && (
                            <Button type="icon" size="small" title={...} onClick={handleNavigateUp} disabled={!canNavigateUp}>
                                <FolderUpIcon width={14} height={14} />
                            </Button>
                        )}
                        <Button type="icon" size="small" title="Collapse All" onClick={handleCollapseAll}>
                            <CollapseAllIcon width={14} height={14} />
                        </Button>
                        <Button type="icon" size="small" title="Refresh" onClick={handleRefresh}>
                            <RefreshIcon width={14} height={14} />
                        </Button>
                        <Button type="icon" size="small" title="Close Panel" onClick={navModel.close}>
                            <CloseIcon width={14} height={14} />
                        </Button>
                    </>
                }
            >
                <TreeProviderView
                    ref={treeProviderRef}
                    key={rootFilePath}
                    provider={provider}
                    selectedHref={selectedHref ?? undefined}
                    onItemClick={handleItemClick}
                    onItemDoubleClick={handleItemClick}
                    onContextMenu={handleContextMenu}
                    initialState={initialState}
                    onStateChange={handleStateChange}
                />
            </CollapsiblePanel>
        </CollapsiblePanelStack>
    </PageNavigatorRoot>
);
```

### Step 3: Adjust PageNavigator styles

Remove old `pn-header` and `pn-header-spacer` styles. The `pn-content` style may also be removed if CollapsiblePanelStack handles the flex layout.

Ensure PageNavigatorRoot's flex column layout works with CollapsiblePanelStack inside it (the stack should take `flex: 1 1 auto` and `overflow: hidden`).

### Step 4: Verify CollapsiblePanelStack behavior with single panel

With only one panel, `handleToggle` cycles to the next panel which is... the same panel (index wraps around). This means clicking the header is effectively a no-op. That's correct for this task.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/components/layout/CollapsiblePanelStack.tsx` | Add `icon` and `buttons` optional props, remove chevron icons, add spacer, extract new props from children |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Replace flat toolbar with CollapsiblePanelStack + CollapsiblePanel |

## Files NOT Changed

- `src/renderer/ui/navigation/NavigationData.ts` — no changes needed
- `src/renderer/ui/navigation/nav-panel-store.ts` — no changes needed

## Acceptance Criteria

- [ ] CollapsiblePanel supports `icon` and `buttons` optional props
- [ ] CollapsiblePanelStack renders buttons at the right of the header
- [ ] No chevron icons in panel headers
- [ ] PageNavigator shows panel header with "Explorer" label and action buttons
- [ ] Buttons in header work correctly (collapse all, refresh, navigate up, close)
- [ ] Button clicks don't trigger panel toggle (Button already calls stopPropagation)
- [ ] Visual appearance: label left, buttons right, consistent with existing header
- [ ] No functional regression — all existing PageNavigator behavior preserved
- [ ] Existing CollapsiblePanelStack consumers (LinkEditor) still work correctly
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
