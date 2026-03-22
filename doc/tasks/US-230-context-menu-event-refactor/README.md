# US-230: Refactor Context Menu to Use ContextMenuEvent on Native Event

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22

## Goal

Replace `e.nativeEvent.menuItems: MenuItem[]` with `e.nativeEvent.contextMenuEvent: ContextMenuEvent<unknown>` across all bubbling context menu handlers. This prepares the context menu system for EventChannel integration by making the event object the single carrier of menu state — including an optional async promise for handlers that need to await script pipelines.

## Background

### Current Pattern

Every context menu handler mutates `e.nativeEvent.menuItems` array directly:

```typescript
// Every handler does this:
if (!e.nativeEvent.menuItems) {
    e.nativeEvent.menuItems = [];
}
e.nativeEvent.menuItems.push(...items);
```

`GlobalEventService` reads the array synchronously:

```typescript
handleContextMenu = (e: PointerEvent) => {
    showAppPopupMenu(e.clientX, e.clientY, e.menuItems || []);
    e.preventDefault();
};
```

### Problem

When we integrate EventChannels (async `sendAsync()`), the items won't be ready by the time `GlobalEventService` reads them synchronously. We need:

1. A **stable event object** on the native event (not just an array reference)
2. An optional **promise** that `GlobalEventService` can await before showing the menu
3. A unified pattern where all handlers work through `ContextMenuEvent` API (`addItem()`, `addGroupItem()`)

### Target Pattern

```typescript
// Handler creates or reuses event:
if (!e.nativeEvent.contextMenuEvent) {
    e.nativeEvent.contextMenuEvent = new ContextMenuEvent(null);
}
e.nativeEvent.contextMenuEvent.addItem({ label: "...", onClick: () => {} });

// Handler that needs async (future EventChannel integration):
const promise = app.events.fileExplorer.onContextMenu.sendAsync(event);
e.nativeEvent.contextMenuPromise = promise;

// GlobalEventService awaits if needed:
handleContextMenu = async (e: PointerEvent) => {
    e.preventDefault();
    if (e.contextMenuPromise) {
        await e.contextMenuPromise;
    }
    const event = e.contextMenuEvent;
    if (event) {
        showAppPopupMenu(e.clientX, e.clientY, event.items);
    }
};
```

## Handlers to Migrate (Bubbling Handlers Only)

Non-bubbling handlers (Browser, Graph, AVGrid) call `showAppPopupMenu()` directly — they don't use `e.nativeEvent.menuItems` and are **out of scope**.

| # | File | Line | Component | What it does |
|---|------|------|-----------|-------------|
| 1 | `ui/tabs/PageTab.tsx` | 248 | PageTab | Adds 15+ tab items (Close, Pin, Save, etc.) |
| 2 | `components/file-explorer/FileExplorerModel.tsx` | 459 | File item | Adds file/folder items + extra items |
| 3 | `components/file-explorer/FileExplorerModel.tsx` | 476 | Explorer background | Adds New File, New Folder |
| 4 | `ui/sidebar/FolderItem.tsx` | 122 | Sidebar folder | Adds items from parent callback |
| 5 | `ui/sidebar/MenuBar.tsx` | 400 | Left panel root | Adds "Add Folder" |
| 6 | `editors/markdown/MarkdownBlock.tsx` | 415 | Markdown links | Adds "Copy Link" + open items |

### Consumer

| File | Line | What |
|------|------|------|
| `api/internal/GlobalEventService.ts` | 26 | Reads `e.menuItems`, shows popup |

## Implementation Plan

### Step 1: Update type augmentation

**File:** `src/renderer/types/events.d.ts`

Change from:
```typescript
import { MenuItem } from '../api/types/events';

declare global {
    interface MouseEvent {
        menuItems?: MenuItem[];
    }
}
```

To:
```typescript
import { ContextMenuEvent } from '../api/events/events';

declare global {
    interface MouseEvent {
        contextMenuEvent?: ContextMenuEvent<unknown>;
        contextMenuPromise?: Promise<boolean>;
    }
}
```

Remove `menuItems` — forces compile errors everywhere it's used, ensuring we migrate all handlers.

### Step 2: Create helper for getting/creating event from native event

To avoid repeating `if (!e.nativeEvent.contextMenuEvent)` boilerplate in every handler, add a static helper to `ContextMenuEvent`:

**File:** `src/renderer/api/events/events.ts`

```typescript
/** Get or create a ContextMenuEvent on the native mouse event. */
static fromNativeEvent(e: React.MouseEvent, targetKind: ContextMenuTargetKind): ContextMenuEvent<unknown> {
    if (!e.nativeEvent.contextMenuEvent) {
        e.nativeEvent.contextMenuEvent = new ContextMenuEvent(targetKind, null);
    }
    return e.nativeEvent.contextMenuEvent;
}
```

Note: The first handler to call `fromNativeEvent()` sets the `targetKind`. Subsequent handlers in the bubbling chain reuse the same event. This means the `targetKind` always reflects the deepest (most specific) component.

This makes each handler a one-liner setup:
```typescript
const event = ContextMenuEvent.fromNativeEvent(e, "page-tab");
event.items.push({ label: "...", onClick: () => {} });
```

### Step 3: Migrate each handler

#### 3a. PageTab.tsx (line 248)

Before:
```typescript
if (!e.nativeEvent.menuItems) {
    e.nativeEvent.menuItems = [];
}
// ... build menuItems array ...
e.nativeEvent.menuItems.push(...menuItems);
```

After:
```typescript
const event = ContextMenuEvent.fromNativeEvent(e, "page-tab");
// ... build menuItems array (same logic) ...
event.items.push(...menuItems);
```

#### 3b. FileExplorerModel.tsx — onItemContextMenu (line 459)

Before:
```typescript
if (!e.nativeEvent.menuItems) {
    e.nativeEvent.menuItems = [];
}
const menuItems = item.isFolder ? this.getFolderMenuItems(item) : this.getFileMenuItems(item);
const extraItems = this.props.getExtraMenuItems?.(item.filePath, item.isFolder);
if (extraItems?.length) {
    menuItems.push(...extraItems);
}
e.nativeEvent.menuItems.push(...menuItems);
```

After:
```typescript
const event = ContextMenuEvent.fromNativeEvent(e, "file-explorer-item");
const menuItems = item.isFolder ? this.getFolderMenuItems(item) : this.getFileMenuItems(item);
const extraItems = this.props.getExtraMenuItems?.(item.filePath, item.isFolder);
if (extraItems?.length) {
    menuItems.push(...extraItems);
}
event.items.push(...menuItems);
```

#### 3c. FileExplorerModel.tsx — onBackgroundContextMenu (line 476)

Before:
```typescript
if (!e.nativeEvent.menuItems) {
    e.nativeEvent.menuItems = [];
}
e.nativeEvent.menuItems.push({ label: "New File...", ... }, { label: "New Folder...", ... });
```

After:
```typescript
const event = ContextMenuEvent.fromNativeEvent(e, "file-explorer-background");
event.items.push(
    { label: "New File...", icon: <NewFileIcon />, onClick: () => this.createNewFile(this.props.rootPath) },
    { label: "New Folder...", icon: <NewFolderIcon />, onClick: () => this.createNewFolder(this.props.rootPath) },
);
```

#### 3d. FolderItem.tsx (line 122)

Before:
```typescript
const menuItems = getContextMenu?.(folder, index);
if (menuItems) {
    if (!e.nativeEvent.menuItems) {
        e.nativeEvent.menuItems = [];
    }
    e.nativeEvent.menuItems.push(...menuItems);
}
```

After:
```typescript
const menuItems = getContextMenu?.(folder, index);
if (menuItems) {
    const event = ContextMenuEvent.fromNativeEvent(e, "sidebar-folder");
    event.items.push(...menuItems);
}
```

#### 3e. MenuBar.tsx — onLeftPanelContextMenu (line 400)

Before:
```typescript
if (e.nativeEvent.menuItems === undefined) {
    e.nativeEvent.menuItems = [{ label: "Add Folder", ... }];
}
```

Note: This handler only adds "Add Folder" if NO other handler has added items (it checks `=== undefined`). This is the "background" menu for the left panel. With the new pattern:

After:
```typescript
if (!e.nativeEvent.contextMenuEvent) {
    const event = ContextMenuEvent.fromNativeEvent(e, "sidebar-background");
    event.items.push({ label: "Add Folder", icon: <FolderPlusIcon />, onClick: () => this.addFolder() });
}
```

Same logic preserved — only adds item when no child handler created the event.

#### 3f. MarkdownBlock.tsx (line 415)

Before:
```typescript
if (!e.nativeEvent.menuItems) {
    e.nativeEvent.menuItems = [];
}
e.nativeEvent.menuItems.push({ label: "Copy Link", ... });
appendLinkOpenMenuItems(e.nativeEvent.menuItems!, href);
```

After:
```typescript
const event = ContextMenuEvent.fromNativeEvent(e, "markdown-link");
event.items.push({ label: "Copy Link", icon: <CopyIcon />, onClick: () => navigator.clipboard.writeText(href) });
appendLinkOpenMenuItems(event.items, href);
```

Note: `appendLinkOpenMenuItems` takes `MenuItem[]` and pushes to it — works fine with `event.items` since it's the same array reference.

### Step 4: Update GlobalEventService

**File:** `src/renderer/api/internal/GlobalEventService.ts`

Before:
```typescript
private handleContextMenu = (e: PointerEvent) => {
    showAppPopupMenu(e.clientX, e.clientY, e.menuItems || []);
    e.preventDefault();
};
```

After:
```typescript
private handleContextMenu = async (e: PointerEvent) => {
    e.preventDefault();
    if (e.contextMenuPromise) {
        await e.contextMenuPromise;
    }
    const event = e.contextMenuEvent;
    showAppPopupMenu(e.clientX, e.clientY, event?.items || []);
};
```

Key changes:
- Now `async` to support awaiting promises
- `preventDefault()` moved first (must be synchronous)
- Reads from `contextMenuEvent.items` instead of `menuItems`
- Awaits `contextMenuPromise` if present (future EventChannel use)

### Step 5: Sync IntelliSense types

`assets/editor-types/events.d.ts` is auto-synced by Vite plugin. Verify the updated `IContextMenuEvent` (with mutable `items` property, no `addItem`/`addGroupItem` methods) is reflected.

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/types/events.d.ts` | Modify | Replace `menuItems` with `contextMenuEvent` + `contextMenuPromise` |
| `src/renderer/api/events/events.ts` | Modify | Add `fromNativeEvent()` static helper |
| `src/renderer/api/internal/GlobalEventService.ts` | Modify | Async handler, read from `contextMenuEvent` |
| `src/renderer/ui/tabs/PageTab.tsx` | Modify | Use `ContextMenuEvent.fromNativeEvent()` |
| `src/renderer/components/file-explorer/FileExplorerModel.tsx` | Modify | Both handlers migrated |
| `src/renderer/ui/sidebar/FolderItem.tsx` | Modify | Use `ContextMenuEvent.fromNativeEvent()` |
| `src/renderer/ui/sidebar/MenuBar.tsx` | Modify | Use `ContextMenuEvent.fromNativeEvent()` |
| `src/renderer/editors/markdown/MarkdownBlock.tsx` | Modify | Use `ContextMenuEvent.fromNativeEvent()` |
| `assets/editor-types/events.d.ts` | Auto-sync | Updated types |

## Concerns / Open Questions

### 1. `ContextMenuEvent<unknown>` target is always `null` for now

All migrated handlers create `ContextMenuEvent(null)` since they don't have a typed target yet. When EventChannels are wired (US-231), each handler will create a properly typed event (e.g., `ContextMenuEvent<IFileTarget>`). The `fromNativeEvent()` helper uses `unknown` which accommodates this.

### 2. `appendLinkOpenMenuItems` function

This utility pushes directly to a `MenuItem[]` array. It works with `event.items` since that's the same mutable array. No changes needed to this function.

### 3. Import of ContextMenuEvent in component files

Components will need to import `ContextMenuEvent` from `api/events/events`. This is a direct import (not through barrel) per coding standards. The import is lightweight — just the class, no editor code.

## Acceptance Criteria

- [ ] `e.nativeEvent.menuItems` is no longer used anywhere in the codebase
- [ ] All 6 bubbling handlers use `ContextMenuEvent.fromNativeEvent(e)` + `event.items.push()`
- [ ] `GlobalEventService` reads from `e.contextMenuEvent.items`
- [ ] `GlobalEventService` awaits `e.contextMenuPromise` when present
- [ ] Non-bubbling handlers (Browser, Graph, AVGrid) are unchanged
- [ ] Existing context menu behavior is identical (same items, same order)
- [ ] TypeScript compiles clean
