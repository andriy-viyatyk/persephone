# US-305: CollapsiblePanelStack — Expand History

**Status:** Planned
**Epic:** EPIC-015 (Phase 4)
**Depends on:** —

## Goal

Add expand history tracking to CollapsiblePanelStack. When the currently expanded panel header is clicked, the **previously** expanded panel re-expands (instead of cycling to the next panel). This provides natural back-navigation with 3+ panels (Explorer, Search, Archive).

## Background

### Current behavior

When user clicks the currently expanded panel:
```typescript
const currentIndex = panels.findIndex(p => p.id === panelId);
const nextIndex = (currentIndex + 1) % panels.length;
setActivePanel(panels[nextIndex].id);
```
This cycles to the **next** panel by index. With 2 panels this effectively toggles. With 3+ panels (Explorer → Search → Archive), clicking the expanded panel always goes forward — user can't easily return to where they were.

### Target behavior

Clicking the expanded panel returns to the **previously** expanded panel:
- User is on Explorer → clicks Search → Search expands
- User clicks Search header (already expanded) → Explorer re-expands (previous)
- User is on Explorer → clicks Archive → Archive expands
- User clicks Archive header → Explorer re-expands (previous)

### Where state lives

The expand history is managed **inside CollapsiblePanelStack** (internal state), not by the parent. The parent still controls `activePanel` and `setActivePanel` — the component just changes which panel it passes to `setActivePanel` when toggling.

### Consumers

| Consumer | Panels | Impact |
|---|---|---|
| PageNavigator | Explorer, (Search future), (Secondary) | Primary motivation — 3 panels |
| LinkEditor | Tags, Hostnames, Categories | 3 panels — benefits from history |
| NotebookEditor | Tags, Categories | 2 panels — history = toggle (same as now) |

## Implementation Plan

### Step 1: Track previous panel in CollapsiblePanelStack

Add a `useRef` to store the previously expanded panel:

```typescript
export function CollapsiblePanelStack({ activePanel, setActivePanel, ... }) {
    const previousPanelRef = useRef<string | null>(null);

    const handleToggle = (panelId: string) => {
        if (activePanel === panelId) {
            // Clicking expanded panel — go back to previous
            if (previousPanelRef.current && panels.some(p => p.id === previousPanelRef.current)) {
                setActivePanel(previousPanelRef.current);
            } else {
                // No valid previous — fall back to first panel that isn't current
                const fallback = panels.find(p => p.id !== panelId);
                if (fallback) setActivePanel(fallback.id);
            }
        } else {
            // Expanding a different panel — record current as previous
            previousPanelRef.current = activePanel;
            setActivePanel(panelId);
        }
    };
    ...
}
```

### Step 2: Handle panel removal

When a panel disappears (e.g., secondary panel removed because user selected non-archive file), the `previousPanelRef` might reference a panel that no longer exists. The `panels.some(p => p.id === previousPanelRef.current)` check handles this — falls back to first available panel.

### Step 3: Handle `activePanel` changed externally

The parent can change `activePanel` without going through `handleToggle` (e.g., async panel switch in PageNavigator). We need to track this:

```typescript
const lastActivePanelRef = useRef(activePanel);

useEffect(() => {
    if (activePanel !== lastActivePanelRef.current) {
        previousPanelRef.current = lastActivePanelRef.current;
        lastActivePanelRef.current = activePanel;
    }
}, [activePanel]);
```

This ensures that even when `activePanel` changes from outside, the previous panel is recorded.

## Concerns

None — this is a self-contained change within CollapsiblePanelStack. No API changes. All consumers get the improved behavior automatically.

The `useRef` approach keeps the history as internal component state (not persisted, not exposed). This is correct — expand history is ephemeral UI state, not worth persisting.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/components/layout/CollapsiblePanelStack.tsx` | Add `previousPanelRef`, `lastActivePanelRef`, update `handleToggle` logic |

## Acceptance Criteria

- [ ] Clicking expanded panel returns to previously expanded panel
- [ ] With 2 panels: behaves as toggle (same as before)
- [ ] With 3+ panels: clicking expanded panel goes back, not forward
- [ ] Panel removal doesn't break history (falls back gracefully)
- [ ] External `activePanel` changes are tracked in history
- [ ] Existing consumers (LinkEditor, NotebookEditor, PageNavigator) work correctly
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
