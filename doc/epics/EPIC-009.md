# EPIC-009: Scriptable Application Events

## Status

**Status:** Active
**Created:** 2026-03-21

## Overview

Make scripting a first-class citizen throughout js-notepad by designing an event-driven extension system. Instead of adding one-off script hooks in various places, define a unified pattern (types, base classes, conventions) that any part of the application can adopt to become scriptable. Users write registration scripts that subscribe to application events and modify behavior — context menus, bookmark handling, link opening, and more.

## Motivation

js-notepad already has a powerful scripting engine (ScriptRunner, app API, Script Library with transpilation). However, scripts can only run on-demand from the script panel or via MCP. There is no way for scripts to:

- React to application events (page opened, bookmark added, link clicked)
- Extend UI elements (add context menu items, toolbar buttons)
- Intercept and modify default behavior (cancel link opening, transform URLs)

The goal is to bridge the gap between "scripts that run when you press Execute" and "scripts that integrate into the application lifecycle."

## Goals

- Define reusable event patterns that are easy to adopt in any part of the codebase
- Enable user scripts to subscribe to events and modify application behavior
- Implement script auto-loading at window startup (registration scripts)
- Keep the core lightweight — events are opt-in per feature area

## What's Implemented

### EventChannel System (US-229)

`EventChannel<T>` class in `api/events/EventChannel.ts` with:
- `subscribe(handler)` — register sync or async handler, returns `{ unsubscribe() }`
- `subscribeDefault(handler)` — default handler that runs last, skipped if `event.handled`
- `send(event)` — fire-and-forget, freezes event (subscribers observe only)
- `sendAsync(event)` — async pipeline, subscribers modify event sequentially, short-circuits on `handled`

`BaseEvent` class with `handled` boolean flag.

### Context Menu System (US-230)

All context menu handlers unified through `ContextMenuEvent` on the native DOM event:

```typescript
// How handlers work (12 handlers migrated):
const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "file-explorer-item");
ctxEvent.items.push(...menuItems);
// Event bubbles to GlobalEventService which shows the menu
```

Key pieces:
- `ContextMenuEvent<T>` — carries `targetKind`, `target`, and mutable `items` array
- `ContextMenuTargetKind` — 15 string literals identifying the source of each menu
- `ContextMenuEvent.fromNativeEvent(e, kind)` — static helper, creates or reuses event on native DOM event
- `e.nativeEvent.contextMenuPromise` — optional Promise that GlobalEventService awaits before showing menu
- GlobalEventService is async — awaits promise, then shows `PopupMenu`

See [/doc/architecture/context-menu.md](../architecture/context-menu.md) for full architecture.

### app.events Namespace (US-231)

`app.events` property on the App object, with typed EventChannels:

```typescript
// Current API:
app.events.fileExplorer.itemContextMenu  // EventChannel<ContextMenuEvent<IFileTarget>>
```

Implementation: `AppEvents` class in `api/events/AppEvents.ts`, `FileExplorerEvents` class.

**How it works for file explorer:**
1. Item handler sets `ctxEvent.target` with `IFileTarget` data (path, name, isDirectory)
2. Background handler (container) fires `sendAsync()` after all built-in items are collected
3. Promise attached to `contextMenuPromise` — GlobalEventService awaits it
4. Scripts see all items and can push, remove, or replace them

```typescript
// Script subscription:
app.events.fileExplorer.itemContextMenu.subscribe((event) => {
    if (event.target.name === "package.json") {
        event.items.push({ label: "Generate Deps Graph", onClick: () => { ... } });
    }
});
```

### Type System

All script-facing types in `api/types/events.d.ts`:
- `MenuItem` — single source of truth (removed duplicate from `api/events/MenuItem.ts`)
- `IBaseEvent`, `IContextMenuEvent<T>`, `IEventChannel<T>`, `ISubscriptionObject`
- `IFileTarget`, `FileContextMenuEvent`, `ContextMenuTargetKind`
- `IAppEvents`, `IFileExplorerEvents`

`IApp` interface includes `readonly events: IAppEvents` for IntelliSense.

## What's Next

### Registration Scripts (Auto-loading)

Scripts that load when the js-notepad window opens. This is the key missing piece — without it, scripts can't subscribe to events automatically.

**Design decisions (resolved):**

- **Location:** A designated subfolder in Script Library (e.g., `startup/` or `autoload/`)
- **Convention:** Each script exports a default `register()` function
- **Loading:** js-notepad compiles and calls `register()` for each script at startup
- **Order:** Alphabetical by filename (user can prefix with `01-`, `02-` to control order)
- **Proxy-based auto-cleanup:** Before calling `register()`, create a proxy `app.events` object. The proxy intercepts `subscribe()` calls and stores `unsubscribe()` handles. On reload, call all stored handles — scripts never need to unsubscribe manually.
- **Error handling:** All-or-nothing. If any `register()` throws, unsubscribe ALL handlers from all scripts, show error, stop loading. User fixes the broken script, triggers reload.
- **Reload trigger:** User-controlled. Library file watcher detects changes and shows a reload indicator. User clicks to reload all scripts.
- **No scope isolation:** Scripts run in the same scope as the application. Developer responsibility.
- **No dependency system:** Scripts should be independent. Developer manages load order via filename prefixes.

**Still to investigate:**
- Exact subfolder name and how it integrates with Script Library UI
- How the reload indicator looks (badge? status bar?)
- Whether `register()` should receive parameters or just use globals

### More EventChannels

Additional events to wire as needed:
- `app.events.fileExplorer.containerContextMenu` — white-space right-click in file explorer
- `app.events.browser.onBookmark` — bookmark creation, YouTube image URL fix
- `app.events.onOpenLink` — link interception, video scraping
- `app.events.pages.onOpen` / `onClose` / `onBeforeSave` — page lifecycle
- Other context menus: tab, browser, grid, graph, link editor

Each new EventChannel follows the same pattern documented in [context-menu.md](../architecture/context-menu.md#for-eventchannel-integration-scriptable-context-menu).

### Hypothetical Use Cases

1. **File explorer context menu for package.json** — Script subscribes to `app.events.fileExplorer.itemContextMenu`, checks if target file is `package.json`, adds "Generate Dependency Graph" item
2. **YouTube bookmark image fix** — Script subscribes to `app.events.browser.onBookmark`, detects YouTube URLs, replaces expiring thumbnail URL with public one
3. **Video link interception** — Script subscribes to `app.events.onOpenLink`, matches known video hosting patterns, cancels default behavior, scrapes `.m3u8` URL, opens built-in player
4. **Auto-format on save** — Script subscribes to `app.events.pages.onBeforeSave`, runs formatter on content
5. **Custom keyboard shortcuts** — Script subscribes to `app.events.onKeyDown`, adds custom hotkeys
6. **Page template injection** — Script subscribes to `app.events.pages.onCreated`, pre-fills content based on file extension

## Design Decisions (Resolved)

### EventChannel class (US-229)

- **One unified class, two send methods:** `send()` (sync, frozen event) and `sendAsync()` (async pipeline, `Promise<boolean>`)
- **subscribe() accepts sync or async handlers.** `sendAsync()` checks if result is thenable — awaits only if needed.
- **`subscribeDefault(handler)`** — runs last, skipped if `event.handled`. Enables "send and forget" pattern.
- **Error isolation:** try-catch per subscriber, log + notify + continue. Never cancel pipeline due to subscriber error.
- **No priority system.** Alphabetical script loading order is sufficient for now.
- **`Object.freeze()` for `send()`** — easy to change later if needed.

### ContextMenuEvent (US-230)

- **`ContextMenuEvent<T>` on native DOM event** — stable object reference, not just an array. Carries `targetKind`, `target`, and mutable `items`.
- **`fromNativeEvent(e, kind)` helper** — creates or reuses event. First handler sets `targetKind`.
- **`contextMenuPromise` on native event** — GlobalEventService awaits it. Preserves DOM bubbling architecture.
- **`items` is directly mutable** — no `addItem()`/`addGroupItem()` methods. Subscribers push, splice, or replace freely.
- **`MenuItem` interface** — single source of truth in `api/types/events.d.ts`. Removed duplicate from `api/events/`.
- **15 `ContextMenuTargetKind` values** — identifies every context menu source in the app.

### app.events integration (US-231)

- **Naming:** `app.events.fileExplorer.itemContextMenu` (not `onContextMenu`). Leaves room for `containerContextMenu`.
- **Fire point:** Background handler (container level), after all built-in items collected. Scripts see the complete menu.
- **Only item menus fire EventChannel.** White-space clicks do not — they have no `IFileTarget`.
- **`target` is mutable on class, `readonly` on interface.** Implementation sets it; scripts read it.

### Registration scripts lifecycle (design only, not implemented)

- **Proxy-based auto-cleanup** — scripts only subscribe, system handles unsubscribe on reload
- **All-or-nothing error handling** — if any `register()` fails, unsubscribe everything, show error
- **User-controlled reload** — file watcher shows indicator, user triggers reload
- **No scope isolation, no dependency system** — developer responsibility

### Cancellation mechanism (design only, not implemented)

- After ~300ms, show blocking semi-transparent overlay with "Cancel" button
- On cancel: resolve pipeline immediately, silently ignore hung handler's result
- UX safety net, not a guarantee

## Ideas Worth Investigating

1. **VS Code extension API as inspiration** — Their `activationEvents` and `Disposable` patterns are proven. Worth studying.
2. **Event logging/debugging** — Log all events to Log View for debugging handlers.
3. **Should registration scripts be a special script type or just a convention?** — Files in a magic folder vs. a new "category" in the script panel.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-229 | App Event Primitives | Done |
| US-230 | Context Menu ContextMenuEvent Refactor | Done |
| US-231 | File Explorer Item Context Menu EventChannel | Done |
| US-232 | Script Scope — Auto-Cleanup of Event Subscriptions | Done |
| US-234 | Fix Script Context in Library Modules | Done |
| US-235 | Unified Script Context Injection | Planned |
| US-233 | Script Autoloading from Script Library | Planned |
