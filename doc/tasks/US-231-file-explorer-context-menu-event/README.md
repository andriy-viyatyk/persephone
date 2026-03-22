# US-231: Add `app.events.fileExplorer.itemContextMenu` EventChannel

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22
**Depends on:** US-229 (primitives), US-230 (ContextMenuEvent refactor)

## Goal

Create the `app.events` namespace and wire the first real EventChannel — `app.events.fileExplorer.itemContextMenu` — so that scripts can subscribe to file explorer item context menu events and add/modify menu items.

## Background

### Prerequisites already done

- **US-229:** `EventChannel`, `BaseEvent`, `ContextMenuEvent` classes exist in `api/events/`
- **US-230:** All context menu handlers use `ContextMenuEvent.fromNativeEvent()` + `contextMenuEvent` on the native event. `GlobalEventService` awaits `contextMenuPromise` if present.

### Current Context Menu Flow (after US-230)

```
TreeView cell → onItemContextMenu callback
    ↓
FileExplorerModel.onItemContextMenu()
    → Creates ContextMenuEvent via fromNativeEvent(e, "file-explorer-item")
    → Builds file/folder items + extra items
    → Pushes to ctxEvent.items
    ↓
Event bubbles to FileExplorerRoot
    ↓
FileExplorerModel.onBackgroundContextMenu()
    → If enableFileOperations: adds "New File...", "New Folder..."
    ↓
Event bubbles to GlobalEventService
    → Awaits contextMenuPromise if present
    → showAppPopupMenu(x, y, event.items)
```

### Target Flow

```
TreeView cell → onItemContextMenu callback
    ↓
FileExplorerModel.onItemContextMenu()
    → Creates ContextMenuEvent<IFileTarget> via fromNativeEvent(e, "file-explorer-item")
    → Sets typed target on the event
    → Builds file/folder items + extra items → pushes to ctxEvent.items
    ↓
Event bubbles to FileExplorerRoot
    ↓
FileExplorerModel.onBackgroundContextMenu()
    → If enableFileOperations: adds "New File...", "New Folder..."
    → If targetKind is "file-explorer-item":
        fire sendAsync to app.events.fileExplorer.itemContextMenu
        attach promise to e.nativeEvent.contextMenuPromise
    ↓
Event bubbles to GlobalEventService
    → Awaits contextMenuPromise (scripts may add/modify items)
    → showAppPopupMenu(x, y, event.items)
```

### Why fire in the background handler (container), not the item handler?

1. By the time the background handler runs, ALL built-in items are collected (item items + background items)
2. Scripts see the complete menu and can insert at any position (beginning, end, middle)
3. The background handler is the last handler before GlobalEventService — perfect point to attach the async promise
4. Only item context menus fire the EventChannel (check `targetKind === "file-explorer-item"`)
5. White-space context menus (background only) are not sent to the EventChannel — can be added later as `app.events.fileExplorer.containerContextMenu`

### Key Type Mapping

`FileTreeItem` (internal) → `IFileTarget` (public API):
- `item.filePath` → `target.path`
- `item.label` → `target.name`
- `item.isFolder` → `target.isDirectory`

### API Naming

```typescript
app.events.fileExplorer.itemContextMenu     // this task
app.events.fileExplorer.containerContextMenu // future, for white-space right-click
```

## Implementation Plan

### Step 1: Create `AppEvents` namespace

Create `src/renderer/api/events/AppEvents.ts`:

```typescript
import { EventChannel } from "./EventChannel";
import type { ContextMenuEvent } from "./events";
import type { IFileTarget } from "../types/events";

export class FileExplorerEvents {
    readonly itemContextMenu = new EventChannel<ContextMenuEvent<IFileTarget>>("fileExplorer.itemContextMenu");
}

export class AppEvents {
    readonly fileExplorer = new FileExplorerEvents();
}
```

### Step 2: Add `events` to App class

**File:** `src/renderer/api/app.ts`

```typescript
import { AppEvents } from "./events/AppEvents";

// In class App:
private _events = new AppEvents();

get events(): AppEvents {
    return this._events;
}
```

No lazy initialization needed — `AppEvents` is lightweight (just creates EventChannel instances).

### Step 3: Add `events` to IApp interface and event types

**File:** `src/renderer/api/types/events.d.ts` — add:

```typescript
export interface IFileExplorerEvents {
    readonly itemContextMenu: IEventChannel<IContextMenuEvent<IFileTarget>>;
}

export interface IAppEvents {
    readonly fileExplorer: IFileExplorerEvents;
}
```

**File:** `src/renderer/api/types/app.d.ts` — add to IApp:

```typescript
import type { IAppEvents } from "./events";

// In IApp interface:
/** Application event channels for scripting integration. */
readonly events: IAppEvents;
```

### Step 4: Set typed target in onItemContextMenu

**File:** `src/renderer/components/file-explorer/FileExplorerModel.tsx`

The item handler needs to set a typed target on the event so the background handler can access it. Since `fromNativeEvent` creates a `ContextMenuEvent<unknown>` with `null` target, we need a way to set the target.

Add a `setTarget` method or make target writable on the event class. Simpler: make `target` not readonly in the class (it's already `readonly` in the IContextMenuEvent interface for scripts, which is the right constraint).

**File:** `src/renderer/api/events/events.ts` — change `readonly target` to `target`:

```typescript
export class ContextMenuEvent<T> extends BaseEvent {
    readonly targetKind: ContextMenuTargetKind;
    target: T;  // mutable in implementation, readonly in script-facing interface
    items: MenuItem[];
    ...
}
```

Then in `onItemContextMenu`:

```typescript
onItemContextMenu = (item: FileTreeItem, e: React.MouseEvent) => {
    const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "file-explorer-item");

    // Set typed target for EventChannel subscribers
    ctxEvent.target = {
        path: item.filePath,
        name: item.label,
        isDirectory: item.isFolder,
    };

    const menuItems: MenuItem[] = item.isFolder
        ? this.getFolderMenuItems(item)
        : this.getFileMenuItems(item);

    const extraItems = this.props.getExtraMenuItems?.(item.filePath, item.isFolder);
    if (extraItems?.length) {
        menuItems.push(...extraItems);
    }

    ctxEvent.items.push(...menuItems);
};
```

### Step 5: Fire EventChannel in onBackgroundContextMenu

**File:** `src/renderer/components/file-explorer/FileExplorerModel.tsx`

```typescript
onBackgroundContextMenu = (e: React.MouseEvent) => {
    const ctxEvent = e.nativeEvent.contextMenuEvent;

    // Add background items if file operations enabled
    if (!ctxEvent && !this.props.enableFileOperations) return;
    if (this.props.enableFileOperations) {
        const bgEvent = ContextMenuEvent.fromNativeEvent(e, "file-explorer-background");
        bgEvent.items.push(
            { label: "New File...", icon: <NewFileIcon />, onClick: () => this.createNewFile(this.props.rootPath) },
            { label: "New Folder...", icon: <NewFolderIcon />, onClick: () => this.createNewFolder(this.props.rootPath) },
        );
    }

    // Fire EventChannel only for item context menus
    if (ctxEvent && ctxEvent.targetKind === "file-explorer-item") {
        const promise = app.events.fileExplorer.itemContextMenu.sendAsync(
            ctxEvent as ContextMenuEvent<IFileTarget>
        );
        e.nativeEvent.contextMenuPromise = promise;
    }
};
```

Key points:
- Background items are added first (as before)
- Then, if this is an item context menu, fire the EventChannel
- The promise is attached to `contextMenuPromise` — GlobalEventService awaits it
- Scripts see ALL items (file items + background items) and can modify freely
- If `event.handled` is set to `true` by a subscriber, `sendAsync` short-circuits — but the items are still on the event. GlobalEventService will still show whatever items are there. If the script wants to suppress the menu entirely, it can clear `event.items`.

### Step 6: Update barrel exports

**File:** `src/renderer/api/events/index.ts` — add:

```typescript
export { AppEvents, FileExplorerEvents } from "./AppEvents";
```

### Step 7: Sync IntelliSense types

Vite plugin auto-syncs `api/types/*.d.ts` → `assets/editor-types/`. Verify `events.d.ts` and `app.d.ts` are updated.

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/api/events/AppEvents.ts` | **Create** | AppEvents, FileExplorerEvents classes |
| `src/renderer/api/events/events.ts` | Modify | Make `target` mutable |
| `src/renderer/api/events/index.ts` | Modify | Add exports |
| `src/renderer/api/app.ts` | Modify | Add `events` property |
| `src/renderer/api/types/app.d.ts` | Modify | Add `events: IAppEvents` to IApp |
| `src/renderer/api/types/events.d.ts` | Modify | Add IAppEvents, IFileExplorerEvents |
| `src/renderer/components/file-explorer/FileExplorerModel.tsx` | Modify | Set target in item handler, fire EventChannel in background handler |
| `assets/editor-types/events.d.ts` | Auto-sync | Updated types |
| `assets/editor-types/app.d.ts` | Auto-sync | Updated types |

## Concerns / Open Questions

### 1. Type cast for sendAsync

The `ctxEvent` from the native event is typed as `ContextMenuEvent<unknown>`, but `sendAsync` expects `ContextMenuEvent<IFileTarget>`. We cast with `as ContextMenuEvent<IFileTarget>` — safe because Step 4 sets the target with the correct shape.

### 2. Background handler guards

When right-clicking empty space, `ctxEvent` is `undefined` (no item handler ran). The background handler creates it. The `targetKind` check (`=== "file-explorer-item"`) ensures we only fire the EventChannel for item menus. When right-clicking empty space, the targetKind will be `"file-explorer-background"` and the EventChannel won't fire.

### 3. Import of `app` in FileExplorerModel

`FileExplorerModel` is in `components/` layer, which normally doesn't import from `api/`. However, `app` is the global singleton and this file already imports from `api/` (e.g., `pagesModel`, `ui`, `api`). So importing `app` is consistent.

## Acceptance Criteria

- [ ] `app.events.fileExplorer.itemContextMenu` exists and is an EventChannel
- [ ] Right-clicking a file/folder in file explorer fires the event with correct `IFileTarget`
- [ ] Event contains built-in menu items (file/folder items + background items)
- [ ] Scripts can subscribe and modify `event.items` (push, splice, replace)
- [ ] Scripts can set `event.handled = true` to short-circuit the pipeline
- [ ] White-space right-click does NOT fire the EventChannel
- [ ] IntelliSense works for `app.events.fileExplorer.itemContextMenu` in Monaco
- [ ] Existing context menu behavior unchanged when no scripts are subscribed
- [ ] TypeScript compiles clean
