# US-202: Drawing editor — theme sync & UI polish

**Epic:** [EPIC-007](../../epics/EPIC-007.md)
**Status:** Planned

## Goal

Sync Excalidraw's dark/light theme with js-notepad's active theme and polish the UI (hide irrelevant Excalidraw actions, ensure correct layout in split/grouped pages).

## Background

### Current state (US-201)

The `DrawView` component passes no `theme` prop to Excalidraw, so it always renders in its default light theme regardless of js-notepad's current theme. Excalidraw's built-in theme toggle button is visible but disconnected from the app theme.

### Theme system in js-notepad

- **9 themes** defined in `/src/renderer/theme/themes/` — each has `isDark: boolean`
- **`isCurrentThemeDark()`** in `/src/renderer/theme/themes/index.ts:95` returns whether the active theme is dark
- **`settings.use("theme")`** is the React hook that triggers component re-render when theme changes
- **Graph editor pattern** ([GraphView.tsx:505-508](../../../src/renderer/editors/graph/GraphView.tsx)): uses `useEffect(() => { vm?.refreshColors(); })` with no deps to re-resolve CSS variables on every render

### Excalidraw theme support

- **`theme` prop:** accepts `"dark" | "light"` — Excalidraw adjusts all internal colors
- **`THEME` constant:** exported from `@excalidraw/excalidraw`, has `THEME.LIGHT` and `THEME.DARK`
- **`UIOptions.canvasActions.toggleTheme`:** boolean to show/hide Excalidraw's built-in theme toggle (should be hidden since we control theme)

### Excalidraw UI customization props

Relevant props for polish:
- `UIOptions.canvasActions.toggleTheme: false` — hide Excalidraw's theme toggle
- `UIOptions.canvasActions.loadScene: false` — already hidden in US-201
- `UIOptions.canvasActions.saveToActiveFile: false` — already hidden in US-201
- `UIOptions.canvasActions.export: false` — already hidden in US-201
- `UIOptions.tools.image: false` — optionally hide image insertion tool (images are base64-embedded, could bloat files)

## Implementation plan

### Step 1: Add theme sync to DrawView

**File:** `/src/renderer/editors/draw/DrawView.tsx`

```typescript
import { isCurrentThemeDark } from "../../theme/themes";
import { settings } from "../../api/settings";
import { THEME } from "@excalidraw/excalidraw";

// Inside DrawView component:
settings.use("theme"); // subscribe to theme changes → triggers re-render
const excalidrawTheme = isCurrentThemeDark() ? THEME.DARK : THEME.LIGHT;

// Pass to Excalidraw:
<Excalidraw
    theme={excalidrawTheme}
    ...
/>
```

**Key detail:** Excalidraw's `theme` prop is reactive — changing it re-renders the canvas in the new theme without remounting the component or losing state.

### Step 2: Hide Excalidraw's theme toggle

**File:** `/src/renderer/editors/draw/DrawView.tsx`

Add to `UIOptions.canvasActions`:

```typescript
UIOptions={{
    canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        export: false,
        toggleTheme: false,  // hide — controlled by app theme
    },
}}
```

### Step 3: Test with split/grouped pages

Verify the Excalidraw canvas:
- Fills its container correctly when the page is in a split (grouped) layout
- Resizes correctly when the split divider is dragged
- Handles window resize without layout glitches

The current `DrawViewRoot` uses `flex: 1 1 auto` which should work, but verify.

### Step 4: CSS polish (if needed)

Excalidraw imports its own CSS (`@excalidraw/excalidraw/index.css`). Check for:
- Scrollbar style conflicts with js-notepad's custom scrollbars
- Font-size or z-index conflicts
- Any Excalidraw elements bleeding outside the container
- Excalidraw's toolbar overlapping with js-notepad's TextToolbar

Apply scoped CSS overrides in `DrawViewRoot` if needed:
```typescript
const DrawViewRoot = styled.div({
    // ... existing styles ...
    "& .excalidraw .some-conflicting-class": {
        // override
    },
});
```

### Step 5: Consider hiding image tool (optional)

Excalidraw's image insertion embeds images as base64 in the JSON, which can bloat `.excalidraw` files significantly. Consider:
- Hiding the image tool: `UIOptions: { tools: { image: false } }`
- Or keeping it but noting the file size concern

**Decision needed:** Should we hide the image tool to keep files small, or allow it?

## Concerns / Open questions

### 1. Excalidraw background color vs theme

When switching themes, Excalidraw changes its canvas background. But the `appState.viewBackgroundColor` stored in the file might be a light color (e.g., `#ffffff`). When the user switches to dark theme, the stored background color stays white — creating a bright rectangle. Options:
- Let Excalidraw handle it (it overrides viewBackgroundColor based on theme)
- Or force viewBackgroundColor based on theme (may modify file content)

Need to test actual behavior with the `theme` prop to see if Excalidraw adjusts automatically.

### 2. Image tool

Base64 images can make `.excalidraw` files very large. We should decide whether to:
- Keep the image tool (full Excalidraw experience)
- Hide it (`tools: { image: false }`) to keep files manageable
- Keep it but add a file size warning when saving large drawings (future)

## Files changed summary

| File | Change |
|------|--------|
| `src/renderer/editors/draw/DrawView.tsx` | Add `theme` prop, `settings.use("theme")`, hide `toggleTheme`, CSS fixes if needed |

## Acceptance criteria

- [ ] Dark themes show Excalidraw in dark mode, light themes show light mode
- [ ] Theme changes apply immediately without remounting or losing drawing state
- [ ] Excalidraw's built-in theme toggle button is hidden
- [ ] Editor fills container correctly in split/grouped page layout
- [ ] No CSS conflicts between Excalidraw and js-notepad styles
- [ ] No console errors related to theme switching
