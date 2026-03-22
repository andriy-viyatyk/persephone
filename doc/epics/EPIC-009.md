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
// Autoload registration script with lazy module loading:
export function register() {
    app.events.fileExplorer.itemContextMenu.subscribe((event) => {
        if (event.target.name === "package.json") {
            event.items.unshift({
                icon: "🔗",
                label: "Generate Dependencies Graph",
                onClick: () => {
                    const { generateGraph } = require("library/file-scripts/package-dep-graph");
                    generateGraph(event.target.path);
                },
            });
        }
    });
}
```

### Type System

All script-facing types in `api/types/events.d.ts`:
- `MenuItem` — single source of truth (removed duplicate from `api/events/MenuItem.ts`)
- `IBaseEvent`, `IContextMenuEvent<T>`, `IEventChannel<T>`, `ISubscriptionObject`
- `IFileTarget`, `FileContextMenuEvent`, `ContextMenuTargetKind`
- `IAppEvents`, `IFileExplorerEvents`

`IApp` interface includes `readonly events: IAppEvents` for IntelliSense.

### Script Context Isolation (US-232, US-234, US-235, US-236)

Per-instance `ScriptContext` that owns all context state (`app`, `page`, `customRequire`, `console`, etc.). Multiple contexts coexist — long-lived autoload context + short-lived F5 contexts don't interfere.

**Two injection mechanisms:**
- **Top-level scripts:** `fn.call(context)` with `SCRIPT_PREFIX` reading from `this` — `var app=this.app, page=this.page, require=this.customRequire, ...`
- **Library modules (via require):** Extension handler reads `globalThis.__activeScriptContext__` (set by `customRequire` before native require) and injects `MODULE_CONTEXT_PREFIX`

**Context-bound require chain:** Each `ScriptContext` creates a `customRequire` function bound to itself. Injected as local `require` in every script and module. When a module calls `require("library/X")`, it goes through `customRequire` → sets `__activeScriptContext__` → native require → extension handler injects context prefix → sub-module gets same `customRequire`. The chain propagates through the entire dependency tree.

**Stack-based `ui` getter:** Each ScriptContext saves the previous `globalThis.ui` descriptor and restores it on dispose. Autoload's `ui` getter survives F5 script runs.

**Always-fresh require cache:** `customRequire()` deletes the specific module from `require.cache` before every load. Library modules are reloaded with the current context's bindings on each require. No shared module state between script executions — use `page.data` or `app.settings` for persistent state.

**Auto-cleanup:** `AppWrapper.events` returns a recursive proxy that intercepts `subscribe()`/`subscribeDefault()` calls and pushes `unsubscribe()` handles to `releaseList`. `ScriptContext.dispose()` runs the entire list — scripts never need to manually unsubscribe.

See [/doc/architecture/scripting.md](../architecture/scripting.md) for full architecture.

### Script Autoloading (US-233)

Registration scripts in the Script Library's `autoload/` subfolder are loaded automatically when the window opens:

```
script-library/
├── autoload/                  ← Registration scripts (loaded at startup)
│   ├── 01-package-tools.ts
│   └── 02-browser-hooks.ts
├── file-scripts/              ← Heavy modules (lazy-loaded by handlers)
│   ├── package-dep-graph.ts
│   └── module-dep-graph.ts
├── script-panel/              ← Scripts shown in script panel UI
└── utils/                     ← Shared library code
```

**Convention:** Scripts must export a named `register` function. Files without it are skipped (utility modules).

**Implementation:** `AutoloadRunner` in `scripting/AutoloadRunner.ts`. Uses `context.customRequire()` to load each module — propagates correct context through the require chain. One shared `ScriptContext` for all autoload scripts with all-or-nothing error handling.

**Reload:** `LibraryService` detects file changes → `markNeedsReload()` → yellow refresh button in header. User clicks to reload (disposes old context + subscriptions, loads fresh). Also triggers when scripts first appear in an empty autoload folder.

**Bootstrap:** Deferred in `app.initEvents()` via `setTimeout(1500)` to not block window rendering.

## What's Next

### More EventChannels

Additional events to wire as needed:
- `app.events.fileExplorer.containerContextMenu` — white-space right-click in file explorer
- `app.events.browser.onBookmark` — bookmark creation, YouTube image URL fix
- `app.events.onOpenLink` — link interception, video scraping
- `app.events.pages.onOpen` / `onClose` / `onBeforeSave` — page lifecycle
- Other context menus: tab, browser, grid, graph, link editor

Each new EventChannel follows the same pattern documented in [context-menu.md](../architecture/context-menu.md#for-eventchannel-integration-scriptable-context-menu).

### Hypothetical Use Cases

1. **YouTube bookmark image fix** — Script subscribes to `app.events.browser.onBookmark`, detects YouTube URLs, replaces expiring thumbnail URL with public one
2. **Video link interception** — Script subscribes to `app.events.onOpenLink`, matches known video hosting patterns, cancels default behavior, scrapes `.m3u8` URL, opens built-in player
3. **Auto-format on save** — Script subscribes to `app.events.pages.onBeforeSave`, runs formatter on content
4. **Custom keyboard shortcuts** — Script subscribes to `app.events.onKeyDown`, adds custom hotkeys
5. **Page template injection** — Script subscribes to `app.events.pages.onCreated`, pre-fills content based on file extension

### Cancellation mechanism (not yet implemented)

- After ~300ms, show blocking semi-transparent overlay with "Cancel" button
- On cancel: resolve pipeline immediately, silently ignore hung handler's result
- UX safety net, not a guarantee

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

### Script context isolation (US-232, US-234, US-235, US-236)

- **Per-instance `ScriptContext`** — owns `app`, `page`, `customRequire`, `console`. Serves as `this` for `fn.call(context)`. Multiple instances coexist independently.
- **`ScriptRunnerBase` stays stateless singleton** — pure execution engine, takes context as parameter.
- **Two injection mechanisms:** `fn.call(context)` + `SCRIPT_PREFIX` for top-level scripts; `__activeScriptContext__` + `MODULE_CONTEXT_PREFIX` for library modules.
- **Context-bound `customRequire`** chain — each module gets the same context's require injected, propagating through the entire dependency tree. Synchronous `require()` ensures no interleaving.
- **Stack-based `ui` getter on `globalThis`** — each context saves/restores previous descriptor. Autoload survives F5 dispose.
- **Always-fresh require cache** — `customRequire` deletes specific module from `require.cache` before every load. No shared module state. Trade-off documented: use `page.data` or `app.settings` for persistent state.
- **No `with(this)` proxy chain** — removed. No `lexicalObjects`. Native constructors (`Array`, `Buffer`, `URL`) work directly.
- **`console` override scoped per-context** — MCP mode gets capturing console, regular scripts get native. No globalThis.console replacement.
- **Alternatives evaluated and rejected:** AsyncLocalStorage (event handler propagation issue), vm module (require incompatible), worker threads (can't share live objects), stack-based global (async interleaving).

### Registration scripts lifecycle (US-233)

- **`autoload/` subfolder** in Script Library — user creates scripts there
- **Named `register` export** — modules must export `register` function (not default export), so utility modules without `register` are not accidentally invoked
- **All-or-nothing error handling** — if any `register()` throws, unsubscribe everything, show error
- **User-controlled reload** — file watcher shows yellow indicator in header, user clicks to reload
- **Auto-cleanup via AppWrapper.events proxy** — scripts only subscribe, system handles unsubscribe on reload
- **Lazy module loading** — registration scripts should be lightweight facades; heavy modules (graph generators, DB clients) lazy-loaded inside event handlers via `require("library/...")`
- **No scope isolation, no dependency system** — developer responsibility
- **Bootstrap deferred** — `setTimeout(1500)` in `app.initEvents()` to not block rendering

## Ideas Worth Investigating

1. **Event logging/debugging** — Log all events to Log View for debugging handlers
2. **Per-editor scripts** — Scripts embedded in editor files (e.g., `.link.json` with custom handlers). Scoped to editor lifecycle.
3. **Cancellation overlay** — Semi-transparent overlay with "Cancel" button for long-running async event handlers

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-229 | App Event Primitives | Done |
| US-230 | Context Menu ContextMenuEvent Refactor | Done |
| US-231 | File Explorer Item Context Menu EventChannel | Done |
| US-232 | Script Scope — Auto-Cleanup of Event Subscriptions | Done |
| US-234 | Fix Script Context in Library Modules | Done |
| US-235 | Unified Script Context Injection | Done |
| US-233 | Script Autoloading from Script Library | Done |
| US-236 | Script Context Coexistence | Done |
| US-237 | Progress Dialog Component | Done |
