# US-219: Tools & Editors — sidebar panel + configurable new-page menu

## Goal

Add a "Tools & Editors" sidebar panel that shows all available tools and editors the user can create. Make the "+" menu on the tab bar configurable — it shows only user-pinned editors, with a "Show All" item that opens the full sidebar panel.

## Background

### Current new-page menu

**File:** `src/renderer/ui/tabs/PageTabs.tsx` (lines 171-255)

The "+" dropdown next to page tabs shows a hardcoded list of 11 items:
1. Script (JS) → `addEditorPage("monaco", "javascript", "untitled.js")`
2. Script (TS) → `addEditorPage("monaco", "typescript", "untitled.ts")`
3. Drawing → `addEditorPage("draw-view", "json", "untitled.excalidraw")`
4. Grid (JSON) → `addEditorPage("grid-json", "json", "untitled.grid.json")`
5. Grid (CSV) → `addEditorPage("grid-csv", "csv", "untitled.grid.csv")`
6. Notebook → `addEditorPage("notebook-view", "json", "untitled.note.json")`
7. Todo → `addEditorPage("todo-view", "json", "untitled.todo.json")`
8. Links → `addEditorPage("link-view", "json", "untitled.link.json")`
9. Force Graph → `addEditorPage("graph-view", "json", "untitled.fg.json")`
10. Browser → `showBrowserPage()`
11. Browser profile... → submenu (Incognito, named profiles, Manage profiles...)

Items are defined with `useMemo` depending on `browserProfiles` and `defaultBrowserColor`.

**Problems:**
- Not all items are frequently used (Notebook, Todo, Links, Force Graph are niche)
- MCP Inspector has no menu entry at all
- Browser profiles submenu is cumbersome
- Users can't customize the menu

### Current sidebar system

**File:** `src/renderer/ui/sidebar/MenuBar.tsx`

Static panels: Open Tabs, Recent Files, Script Library. Dynamic panels: user-configured folders from `menuFolders` API. Content rendered via switch statement on `state.leftItemId`. Folder items support drag-and-drop reordering via `react-dnd` (FolderItem.tsx). DndProvider already set up in the app.

### Editor registry

**File:** `src/renderer/editors/register-editors.ts`

23 editors registered. For this feature, we care about editors the user can **create** (not file-associated viewers like PDF/Image):

**Content-view editors** (create via `addEditorPage`):
| ID | Menu label | Editor | Language | Title |
|----|-----------|--------|----------|-------|
| `script-js` | Script (JS) | monaco | javascript | untitled.js |
| `script-ts` | Script (TS) | monaco | typescript | untitled.ts |
| `draw-view` | Drawing | draw-view | json | untitled.excalidraw |
| `grid-json` | Grid (JSON) | grid-json | json | untitled.grid.json |
| `grid-csv` | Grid (CSV) | grid-csv | csv | untitled.grid.csv |
| `notebook-view` | Notebook | notebook-view | json | untitled.note.json |
| `todo-view` | Todo | todo-view | json | untitled.todo.json |
| `link-view` | Links | link-view | json | untitled.link.json |
| `graph-view` | Force Graph | graph-view | json | untitled.fg.json |

Note: `script-js` and `script-ts` are not real editor IDs — they're virtual entries for "monaco with javascript" and "monaco with typescript". We need a concept of "creatable items" that go beyond editor IDs.

**Page-editor tools** (create via dedicated methods):
| ID | Menu label | Method |
|----|-----------|--------|
| `browser` | Browser | `showBrowserPage()` |
| `browser-incognito` | Browser (Incognito) | `showBrowserPage({ incognito: true })` |
| `browser-profile-{name}` | Browser ({name}) | `showBrowserPage({ profileName: name })` |
| `mcp-inspector` | MCP Inspector | `showMcpInspectorPage()` |

### Settings system

**File:** `src/renderer/api/settings.ts`

Settings stored in `appSettings.json`, managed by singleton `Settings` class. Key-value store with `get(key)`, `set(key, value)`, `use(key)` (React hook). Changes auto-saved with 300ms debounce.

### Browser profiles

**File:** `src/renderer/api/settings.ts` (lines 16-20)

```typescript
interface BrowserProfile { name: string; color: string; bookmarksFile?: string; }
```

Loaded via `settings.use("browser-profiles")`. Each profile generates a persistent Electron session partition.

## Implementation Plan

### Step 1: Define "Creatable Item" registry

**New file:** `src/renderer/ui/sidebar/tools-editors-registry.ts`

Define a registry of items that can be created from the Tools & Editors panel. This is NOT the editor registry — it's a UI-level concept of "things a user can create from a menu".

```typescript
export interface CreatableItem {
    /** Unique stable ID for settings persistence. */
    id: string;
    /** Display label in menus and sidebar. */
    label: string;
    /** Optional icon component. */
    icon?: ReactNode;
    /** Create the page/tab. */
    create: () => void;
    /** Category for grouping in the sidebar list. */
    category: "editor" | "tool";
}
```

Provide a function `getCreatableItems()` that builds the full list:
- Static items (Script JS, Script TS, Drawing, grids, Notebook, Todo, Links, Force Graph, MCP Inspector)
- Dynamic browser items: Browser (default), Browser (Incognito), Browser ({profile}) for each configured profile

This function needs `browserProfiles` and `defaultBrowserColor` as inputs (or reads from settings).

### Step 2: Add `pinned-editors` setting

**File:** `src/renderer/api/settings.ts`

Add a new setting key `pinned-editors` of type `string[]` (array of creatable item IDs).

Default value:
```typescript
["script-js", "script-ts", "draw-view", "grid-json", "grid-csv", "browser"]
```

Add to `AppSettingsKey` type. Add to settings comments map for human-readable JSON.

### Step 3: Create ToolsEditorsPanel sidebar component

**New file:** `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx`

Right panel content for the "Tools & Editors" sidebar option. Layout:

```
┌─────────────────────────────┐
│ ⭐ Pinned                    │
│ ┌─────────────────────────┐ │
│ │ 📌 Script (JS)      [≡] │ │  ← drag handle, click to create, unpin button
│ │ 📌 Script (TS)      [≡] │ │
│ │ 📌 Drawing           [≡] │ │
│ │ 📌 Grid (JSON)      [≡] │ │
│ │ 📌 Grid (CSV)       [≡] │ │
│ │ 📌 Browser           [≡] │ │
│ └─────────────────────────┘ │
│                              │
│ All Editors & Tools          │
│ ┌─────────────────────────┐ │
│ │ Notebook          [pin] │ │  ← click to create, pin button
│ │ Todo              [pin] │ │
│ │ Links             [pin] │ │
│ │ Force Graph       [pin] │ │
│ │ MCP Inspector     [pin] │ │
│ │ Browser (Incognito)[pin]│ │
│ │ Browser (evergreen)[pin]│ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

Behavior:
- **Click item** → create the page, close sidebar
- **Pin button** → add item ID to `pinned-editors` setting, item moves to Pinned section
- **Unpin button** → remove item ID from `pinned-editors` setting, item moves to All section
- **Drag pinned items** → reorder via `react-dnd` (same pattern as FolderItem.tsx), save new order to settings
- **"All" section** excludes items that are already pinned
- Browser profile items are dynamic — regenerated when profiles change

### Step 4: Register sidebar panel in MenuBar

**File:** `src/renderer/ui/sidebar/MenuBar.tsx`

1. Add new static folder entry between "Recent Files" and "Script Library":
   ```typescript
   const toolsEditorsId = "tools-editors";
   const staticFolders: MenuFolder[] = [
       { id: openTabsId, name: "Open Tabs" },
       { id: recentFilesId, name: "Recent Files" },
       { id: toolsEditorsId, name: "Tools & Editors" },
       { id: scriptLibraryId, name: "Script Library" },
   ];
   ```

2. Add icon for the new panel (use a grid/puzzle icon or similar from `icons.tsx`).

3. Add case to `renderRightList` switch:
   ```typescript
   case toolsEditorsId:
       return <ToolsEditorsPanel onClose={props.onClose} />;
   ```

### Step 5: Refactor new-page menu in PageTabs

**File:** `src/renderer/ui/tabs/PageTabs.tsx`

Replace the hardcoded menu items with a dynamic list based on `pinned-editors` setting:

1. Read `settings.use("pinned-editors")` to get pinned item IDs
2. Use `getCreatableItems()` to get full item definitions
3. Build menu items from pinned IDs (preserving order)
4. Append separator + "Show All" item at the end
5. Remove the browser profiles submenu entirely

```typescript
const addPageMenuItems = useMemo((): MenuItem[] => {
    const allItems = getCreatableItems(browserProfiles, defaultBrowserColor);
    const pinnedIds = settings.use("pinned-editors");

    const pinned = pinnedIds
        .map(id => allItems.find(item => item.id === id))
        .filter(Boolean);

    return [
        ...pinned.map(item => ({
            label: item.label,
            icon: item.icon,
            onClick: item.create,
        })),
        {
            label: "Show All…",
            startGroup: true,
            onClick: () => openSidebarToToolsEditors(),
        },
    ];
}, [browserProfiles, defaultBrowserColor, pinnedEditors]);
```

### Step 6: Expose sidebar panel selection on `app.window` API

The "Show All" menu item needs to open the sidebar with "Tools & Editors" pre-selected. Currently `app.window` has `toggleMenuBar()` and `menuBarOpen` but no way to select a specific panel.

**File:** `src/renderer/api/window.ts`

Add `menuBarPanelId` state field and methods:
```typescript
// In WindowState:
menuBarPanelId: string;  // "" means "keep current selection"

// In Window class:
get menuBarPanelId(): string {
    return this._state.get().menuBarPanelId;
}

openMenuBar(panelId?: string): void {
    this._state.update(s => {
        s.menuBarOpen = true;
        if (panelId) s.menuBarPanelId = panelId;
    });
}
```

**File:** `src/renderer/api/types/window.d.ts`

Add to `IWindow`:
```typescript
/** Open the sidebar, optionally selecting a panel by ID. */
openMenuBar(panelId?: string): void;
```

**File:** `assets/editor-types/window.d.ts` — same change.

**File:** `src/renderer/ui/sidebar/MenuBar.tsx`

React to `app.window.menuBarPanelId` changes — when set, update `state.leftItemId` and clear the field.

This way any part of the app (PageTabs, scripts, MCP agents) can open the sidebar to a specific panel:
```javascript
app.window.openMenuBar("tools-editors");
```

## Concerns (Resolved)

### 1. Item IDs

Each creatable item gets a hardcoded stable ID in the registry array (e.g., `"script-js"`, `"script-ts"`, `"draw-view"`, `"browser"`, `"mcp-inspector"`). These are UI-level menu item IDs, not editor registry IDs. `MenuItem` type gets an optional `id` field if it doesn't have one already. Browser profile items get dynamic IDs like `"browser-profile-{name}"`.

### 2. Dynamic browser profile items

Profile items are generated dynamically and appended to the creatable items array with combined IDs `"browser-profile-{name}"`. When rendering, filter out pinned IDs that don't have a matching item in the current array (profile was deleted). Don't auto-remove stale IDs from settings — profile might come back.

### 3. Sidebar ↔ PageTabs communication

Expose `app.window.openMenuBar(panelId?)` on the Window API. This opens the sidebar and selects the specified panel. Works for PageTabs ("Show All"), scripts (`app.window.openMenuBar("tools-editors")`), and MCP agents. MenuBar reacts to state changes.

### 4. Default pinned editors

Default value `["script-js", "script-ts", "draw-view", "grid-json", "grid-csv", "browser"]` used only when the setting doesn't exist yet (first launch or upgrade). Once the user pins/unpins anything, their array is saved and never overwritten with defaults.

## Acceptance Criteria

- [ ] New "Tools & Editors" panel in sidebar between "Recent Files" and "Script Library"
- [ ] Panel shows all creatable editors and tools in two sections: Pinned and All
- [ ] Clicking an item creates the page and closes sidebar
- [ ] Pin/unpin buttons move items between sections
- [ ] Pinned items can be dragged to reorder
- [ ] Pin state and order persisted in `pinned-editors` setting
- [ ] Default pinned: Script (JS), Script (TS), Drawing, Grid (JSON), Grid (CSV), Browser
- [ ] "+" menu shows only pinned items + "Show All" at bottom
- [ ] "Show All" opens sidebar with "Tools & Editors" selected
- [ ] Browser profiles submenu removed from "+" menu
- [ ] Browser (Incognito) and Browser ({profile}) items in Tools & Editors panel
- [ ] MCP Inspector available in Tools & Editors panel
- [ ] Dynamic browser profile items update when profiles change

## Files Changed Summary

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Create | CreatableItem interface + getCreatableItems() |
| `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` | Create | Sidebar panel component (pinned + all sections, DnD) |
| `src/renderer/ui/sidebar/MenuBar.tsx` | Edit | Add "Tools & Editors" static folder, render panel, react to panelId |
| `src/renderer/ui/tabs/PageTabs.tsx` | Edit | Replace hardcoded menu with pinned-editors setting |
| `src/renderer/api/settings.ts` | Edit | Add `pinned-editors` setting key + default |
| `src/renderer/api/window.ts` | Edit | Add `menuBarPanelId` state, `openMenuBar(panelId?)` method |
| `src/renderer/api/types/window.d.ts` | Edit | Add `openMenuBar()` to IWindow |
| `assets/editor-types/window.d.ts` | Edit | Same |
| `src/renderer/theme/icons.tsx` | Edit | Add icon for Tools & Editors sidebar option (if needed) |
| `src/renderer/components/overlay/PopupMenu.tsx` | Edit | Add optional `id` to MenuItem (if not present) |
