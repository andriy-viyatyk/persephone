# US-351: Secondary Editor Registration

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, Task 1.4
**Depends on:** US-345 (shared panel components), US-348 (context menus)
**Status:** Planned

## Goal

LinkEditor component manages `model.secondaryEditor` to register its panels (Categories, Tags, Hostnames) in PageNavigator when the sidebar is open. When the sidebar is closed or no page exists (Browser context), panels render inline inside LinkEditor. On JSON mode switch, panels are removed from the sidebar.

## Background

### What exists

- **Panel components** (US-345): `LinkCategoryPanel`, `LinkTagsPanel`, `LinkHostnamesPanel` — shared between inline and secondary editor contexts
- **Secondary editor wrappers** (US-345): `LinkCategorySecondaryEditor`, `LinkTagsSecondaryEditor`, `LinkHostnamesSecondaryEditor` — registered as `"link-category"`, `"link-tags"`, `"link-hostnames"`
- **EditorModel.secondaryEditor setter** (`src/renderer/editors/base/EditorModel.ts:84-91`): Setting `model.secondaryEditor = ["link-category", ...]` automatically calls `page.addSecondaryEditor(this)`. Clearing it removes.
- **Global subscription system** (`src/renderer/core/state/events.ts`): `Subscription<D>` class with `send(data)` and `subscribe(callback)` — used for app-wide events (keyboard, browser URL, logout)

### The pattern: ZipEditorModel (Pattern B)

`ZipEditorModel` is both `mainEditor` and in `secondaryEditors[]`. It registers in `setPage()`:
```typescript
setPage(page) {
    super.setPage(page);
    if (page && this.treeProvider) {
        this.secondaryEditor = ["zip-tree"];
    }
}
```

### Key difference: LinkEditor uses TextFileModel

Unlike ZipEditorModel (custom EditorModel subclass), LinkEditor uses `TextFileModel` — a generic model. We can't override `setPage()` on TextFileModel for link-specific behavior. Instead, the **LinkEditor React component** drives registration via `useEffect`:

1. On mount (page context, navigator open): set `model.secondaryEditor = ["link-category", ...]`
2. On unmount or JSON mode switch: set `model.secondaryEditor = undefined`
3. Subscribe to `pageNavigatorModel.state.open` to toggle between inline and secondary modes

### Three rendering contexts

**Context 1 — Page with PageNavigator open:**
```
PageNavigator          │  Main Content Area
┌──────────────┐       │  ┌──────────────────────┐
│ Explorer     │       │  │  LinkEditor           │
│──────────────│       │  │  (center + pinned,    │
│ Categories   │       │  │   NO inline panels)   │
│──────────────│       │  │                       │
│ Tags         │       │  │                       │
│──────────────│       │  │                       │
│ Hostnames    │       │  │                       │
└──────────────┘       │  └──────────────────────┘
```
- `model.secondaryEditor = ["link-category", "link-tags", "link-hostnames"]`
- Inline left panel hidden
- Auto-expand `"link-category"` via `page.expandPanel()`

**Context 2 — Page with PageNavigator closed (or no page / Browser):**
```
┌──────────┬──────────────────────┬──────────┐
│Categories│                      │  Pinned  │
│──────────│    Center area       │  Panel   │
│Tags      │   (list or tiles)    │          │
│──────────│                      │          │
│Hostnames │                      │          │
└──────────┴──────────────────────┴──────────┘
```
- `model.secondaryEditor = undefined` (or not set)
- Inline left panel visible

**Context 3 — JSON mode (Monaco editor):**
- LinkEditor unmounts → cleanup `useEffect` clears `model.secondaryEditor`
- No panels anywhere

### Conditional panels: Tags and Hostnames

Per EPIC-018 Decision G, Tags and Hostnames panels are shown only when relevant data exists:
- `"link-tags"` — visible when any link has non-empty `tags[]`
- `"link-hostnames"` — visible when any link has HTTP href

When data changes (link added/removed), the panel list may need updating.

## Implementation Plan

### Step 1: Add `pageNavigatorToggled` global event

**File:** `src/renderer/core/state/events.ts`

Add a new global subscription for PageNavigator open/close events:

```typescript
export interface PageNavigatorEvent {
    pageId: string;
    isOpen: boolean;
}

/** Fired when any PageNavigator sidebar opens or closes. */
export const pageNavigatorToggled = new Subscription<PageNavigatorEvent>();
```

### Step 2: Fire the event from PageNavigatorModel

**File:** `src/renderer/ui/navigation/PageNavigatorModel.ts`

Import the event and fire it when `open` state changes. `PageNavigatorModel` needs to know its owning page ID — pass it via constructor or a setter:

```typescript
constructor(private readonly pageId: string) { ... }

toggle = () => {
    this.state.update((s) => { s.open = !s.open; });
    pageNavigatorToggled.send({ pageId: this.pageId, isOpen: this.state.get().open });
};

close = () => {
    this.state.update((s) => { s.open = false; });
    pageNavigatorToggled.send({ pageId: this.pageId, isOpen: false });
};
```

Check how `PageNavigatorModel` is created in `PageModel` to verify where `pageId` comes from.

### Step 3: Add registration logic in LinkEditor

**File:** `src/renderer/editors/link-editor/LinkEditor.tsx`

On mount:
1. Check initial state: `model.page?.pageNavigatorModel?.state.get().open`
2. Subscribe to `pageNavigatorToggled` and filter by page ID
3. On open → register panels, on close → unregister

```typescript
const [isNavigatorOpen, setIsNavigatorOpen] = useState(() =>
    model.page?.pageNavigatorModel?.state.get().open ?? false
);

useEffect(() => {
    if (!vm) return;
    const pageId = model.page?.id;
    if (!pageId) return; // No page (Browser context) — skip

    const sub = pageNavigatorToggled.subscribe((event) => {
        if (event?.pageId === pageId) {
            setIsNavigatorOpen(event.isOpen);
        }
    });
    return () => sub.unsubscribe();
}, [vm, model]);
```

Then use `isNavigatorOpen` to drive registration:

```typescript
const hasPage = !!model.page;
const hasTags = pageState.tags.length > 0;
const hasHostnames = pageState.hostnames.length > 0;

useEffect(() => {
    if (!vm || !hasPage || !isNavigatorOpen) {
        if (model.secondaryEditor?.length) {
            model.secondaryEditor = undefined;
        }
        return;
    }

    const panels = buildPanelList(hasTags, hasHostnames);
    model.secondaryEditor = panels;

    return () => {
        model.secondaryEditor = undefined;
    };
}, [vm, hasPage, isNavigatorOpen, hasTags, hasHostnames]);
```

Where `buildPanelList`:
```typescript
function buildPanelList(hasTags: boolean, hasHostnames: boolean): string[] {
    const panels = ["link-category"];
    if (hasTags) panels.push("link-tags");
    if (hasHostnames) panels.push("link-hostnames");
    return panels;
}
```

### Step 4: Auto-expand categories panel

```typescript
const autoExpandedRef = useRef(false);

useEffect(() => {
    if (isNavigatorOpen && hasPage && !autoExpandedRef.current && model.secondaryEditor?.length) {
        autoExpandedRef.current = true;
        model.page?.expandPanel("link-category");
    }
}, [isNavigatorOpen, hasPage]);
```

### Step 5: Conditionally hide/show inline panels

**File:** `src/renderer/editors/link-editor/LinkEditor.tsx`

When panels are in the sidebar, hide the inline panel stack:

```tsx
{!(hasPage && isNavigatorOpen) && (
    <>
        <CollapsiblePanelStack ...>
            ...inline panels...
        </CollapsiblePanelStack>
        <Splitter ... />
    </>
)}
```

### Step 6: Verify restoration on app restart

When the app restarts and a `.link.json` tab is restored:
1. `TextFileModel` is restored with persisted state
2. `restoreSecondaryEditors()` in `PageModel` restores the secondary editor descriptors
3. The deduplication guard handles the case where `model.secondaryEditor` is set again by LinkEditor mount
4. The `pageNavigatorToggled` event fires after restoration when PageNavigator state is applied

Verify during testing.

## Concerns

### 1. PageNavigatorModel needs pageId — RESOLVED

`PageNavigatorModel` currently doesn't know its owning page. Pass `pageId` via constructor. Check `PageModel` to see where `PageNavigatorModel` is created — likely `new PageNavigatorModel()` in the constructor. Change to `new PageNavigatorModel(this.id)`.

### 2. `setStateQuiet` should also fire event — RESOLVED

`PageNavigatorModel.setStateQuiet()` is used by `PageModel.restoreSidebar()` during restoration. It should also fire `pageNavigatorToggled` so that LinkEditor picks up the restored state. Or alternatively, LinkEditor checks initial state on mount (already done in Step 3 via `useState` initializer).

**Resolution:** Don't fire from `setStateQuiet` — it's called before LinkEditor mounts. The `useState` initializer reads the current state, which is correct after restoration.

### 3. Panel auto-expand timing — RESOLVED

Guard with ref so `expandPanel` is called once on first registration, not on every effect re-run.

### 4. BookmarksDrawer compatibility — RESOLVED

`model.page` is null in Browser context → `pageId` is undefined → subscription skipped → inline panels render.

### 5. JSON ↔ Links mode switching — RESOLVED

LinkEditor unmounts → `useEffect` cleanup → `model.secondaryEditor = undefined` → panels removed. LinkEditor mounts again → effect re-runs → panels registered.

## Acceptance Criteria

- [ ] PageNavigator open + page context → panels in sidebar, inline panels hidden
- [ ] PageNavigator closed + page context → panels inline, not in sidebar
- [ ] No page (Browser context) → panels inline
- [ ] JSON mode switch → panels removed from sidebar
- [ ] Tags panel shown only when links have tags
- [ ] Hostnames panel shown only when links have HTTP hrefs
- [ ] Auto-expand Categories panel on first registration
- [ ] App restart restores panels correctly
- [ ] BookmarksDrawer works unchanged
- [ ] No TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/core/state/events.ts` | Add `PageNavigatorEvent` interface + `pageNavigatorToggled` subscription |
| `src/renderer/ui/navigation/PageNavigatorModel.ts` | Accept `pageId` in constructor, fire `pageNavigatorToggled` on toggle/close |
| `src/renderer/api/pages/PageModel.ts` | Pass `this.id` to `PageNavigatorModel` constructor |
| `src/renderer/editors/link-editor/LinkEditor.tsx` | Subscribe to event, manage secondaryEditor, conditional inline panels |

### Files NOT changed

- `src/renderer/editors/link-editor/panels/*` — already exist, no changes
- `src/renderer/editors/register-editors.ts` — already registered
- `src/renderer/editors/base/EditorModel.ts` — existing setter sufficient
- `src/renderer/ui/navigation/PageNavigator.tsx` — existing rendering loop handles new panels
