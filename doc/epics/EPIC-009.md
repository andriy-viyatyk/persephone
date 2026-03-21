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

## Key Ideas

### 1. Pipeline Event Model

The current `Subscription<D>` class is fire-and-forget: it sends data to subscribers but cannot collect results. We need a **pipeline** variant where:

- The event object is passed **by reference** through all subscribers
- Subscribers can **modify properties** of the event (add menu items, set `handled = true`, replace a URL)
- The sender **inspects the event after all subscribers run** to act on modifications
- Support both **sync** and **async** pipelines (some handlers may need to fetch data)

```typescript
// Conceptual example — not final API
const event = new ContextMenuEvent({ target: fileItem, items: [...builtInItems] });
await app.events.fileExplorer.onContextMenu.send(event);
// Now event.items may contain extra items added by scripts
showContextMenu(event.items);
```

This is similar to middleware pipelines (Express, VS Code event model). The existing `BrowserUrlEvent` with its `handled` flag is already a primitive version of this.

### 2. Well-Defined Event Classes

Instead of ad-hoc plain objects, define typed event classes with helper constructors:

- **ContextMenuEvent** — `{ target, items[], addItem(), addSeparator() }` — reusable for file explorer, browser, editor, grid, etc.
- **LinkOpenEvent** — `{ url, handled, cancel(), replaceUrl() }` — for intercepting link/URL navigation
- **BookmarkEvent** — `{ url, title, imageUrl, setImageUrl() }` — for bookmark creation/modification
- **PageLifecycleEvent** — `{ page, action }` — for page open/close/focus
- **Generic patterns** — base classes or mixins for common behaviors (cancellable, modifiable, etc.)

Goal: integrating events into a new place should be 1-2 lines of code on the sender side.

### 3. Event Namespace on `app.events`

Expose a structured event registry on the `app` object:

```typescript
app.events.browser.onBookmark.subscribe(handler)
app.events.browser.onNavigate.subscribe(handler)
app.events.fileExplorer.onContextMenu.subscribe(handler)
app.events.pages.onOpen.subscribe(handler)
app.events.onOpenLink.subscribe(handler)
// etc.
```

- Namespace by feature area (browser, fileExplorer, pages, editor, etc.)
- Each event is a typed pipeline subscription
- Exposed to scripts via the existing IApp type definition system

### 4. Registration Scripts (Auto-loading)

Scripts that load when the js-notepad window opens:

- **Location:** A designated subfolder in Script Library (e.g., `startup/` or `autoload/`)
- **Convention:** Each script exports a default `register()` function
- **Loading:** js-notepad compiles and calls `register()` for each script at startup
- **Order:** Alphabetical by filename (user can prefix with `01-`, `02-` to control order)
- **Access:** Registration function receives `app` object, subscribes to events

```typescript
// Example: Script Library/startup/youtube-bookmarks.ts
export default function register() {
    app.events.browser.onBookmark.subscribe((event) => {
        if (event.url.includes("youtube.com/watch")) {
            const videoId = new URL(event.url).searchParams.get("v");
            event.setImageUrl(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
        }
    });
}
```

### 5. Hypothetical Use Cases

1. **File explorer context menu for package.json** — Script subscribes to `app.events.fileExplorer.onContextMenu`, checks if target file is `package.json`, adds "Generate Dependency Graph" item with an onClick that runs the graph script
2. **YouTube bookmark image fix** — Script subscribes to `app.events.browser.onBookmark`, detects YouTube URLs, replaces expiring thumbnail URL with public one
3. **Video link interception** — Script subscribes to `app.events.onOpenLink`, matches known video hosting patterns, cancels default behavior, scrapes `.m3u8` URL, opens built-in player
4. **Auto-format on save** — Script subscribes to `app.events.pages.onBeforeSave`, runs formatter on content
5. **Custom keyboard shortcuts** — Script subscribes to `app.events.onKeyDown`, adds custom hotkeys
6. **Page template injection** — Script subscribes to `app.events.pages.onCreated`, pre-fills content based on file extension

## Design Decisions (Resolved)

### Two Event Types: FireAndForget vs Awaited

One unified class with two send methods, covering both fire-and-forget and async pipeline use cases:

#### `send(event)` — Fire-and-Forget (sync)
- For high-frequency events (keydown, mouse, scroll)
- Iterates over subscribers **without awaiting** — handlers run but sender doesn't wait
- **Clones or freezes** the event object so subscribers cannot modify the original (engine throws on mutation attempt)
- Returns `void`
- No `handled` check, no short-circuit

#### `sendAsync(event)` — Awaited Pipeline (async)
- For behavior-modifying events (context menu, bookmark, link open)
- Iterates over subscribers **sequentially, awaiting** each one
- Subscribers **can modify** the event object (add items, cancel default, replace URLs)
- **Short-circuit:** if any subscriber sets `event.handled = true`, skips remaining subscribers
- Returns `Promise<boolean>` — `true` = completed normally, `false` = cancelled (via timeout overlay)

#### Why one class?
- Same `subscribe(handler)` method for both — handler can be sync or async, subscribers don't know how they'll be called
- `sendAsync()` checks if handler result is **thenable** — awaits only if needed, so sync handlers have no overhead
- An event originally dispatched via `send()` can be switched to `sendAsync()` later without changing subscriber code
- Shared subscriber list and registration logic

```typescript
// Both are valid:
app.events.browser.onBookmark.subscribe((event) => {
    // sync — simple URL replacement, no await needed
    event.imageUrl = fixYoutubeUrl(event.url);
});

app.events.onOpenLink.subscribe(async (event) => {
    // async — needs to fetch remote page
    const html = await fetch(event.url).then(r => r.text());
    const videoUrl = scrapeM3u8(html);
    if (videoUrl) { event.handled = true; openVideoPlayer(videoUrl); }
});
```

#### Return value design
- Modifications live in the event object itself — sender inspects `event.items`, `event.imageUrl`, etc.
- The `boolean` return on `sendAsync()` is only for cancellation signaling:
  ```typescript
  if (!await app.events.browser.onBookmark.sendAsync(event)) return; // cancelled
  // event.imageUrl now contains the fixed URL
  ```
- `send()` returns nothing — fire-and-forget by definition

### Cancellation Mechanism for Long-Running Handlers

When an Awaited event fires and a handler takes too long (e.g., fetching a remote page):

- After **~300ms**, show a **blocking semi-transparent overlay** with a "Cancel" button
- On cancel: resolve the pipeline immediately with the event in its current state (or `null`/`undefined` — sender must check)
- The hung handler's eventual result is **silently ignored**
- This is a UX safety net — not a guarantee. It's the script author's responsibility to write responsive handlers.

### Ordering: No Priority System

No explicit priority mechanism for now. Subscribers execute in the order they were registered. Since registration scripts load alphabetically, users can prefix filenames (`01-`, `02-`) to control order if needed. We'll revisit if real use cases demand explicit priority.

### Error Isolation: Try-Catch Per Subscriber

Each subscriber call is wrapped in try-catch. If a subscriber throws:
- Log the error
- Show an error notification (non-blocking)
- **Continue** passing the event to remaining subscribers
- Never cancel the pipeline due to a subscriber error

### Registration Script Lifecycle: Proxy-Based Auto-Cleanup

Scripts only subscribe — they never need to call `unsubscribe()`. The system handles cleanup transparently:

1. **Before calling `register()`** for each script, create a **proxy `app.events` object** specific to that script's run
2. When the script subscribes to any event, the proxy:
   - Subscribes to the **real** event on the actual `app.events`
   - Stores the returned `unsubscribe()` handle internally
3. **On reload** (file change detected, or manual trigger):
   - Call all stored `unsubscribe()` handles — removes all subscriptions from the old run
   - Discard the old proxy (old handlers become eligible for garbage collection)
   - Create a fresh proxy, re-compile and re-run `register()`

This means script authors write simple code:
```typescript
export default function register() {
    app.events.browser.onBookmark.subscribe((event) => { /* ... */ });
    // No cleanup needed — system handles it
}
```

### Scope Isolation: None (By Design)

No sandboxing. All scripts run in the same scope as the application and share the same `app` object. This is a developer notepad — the developer is responsible for their scripts. A script can crash the application, but the developer knows where the script folder is and can fix or remove the broken script.

### Error Handling During Registration: All-or-Nothing

If any `register()` call throws (syntax error, runtime error):
- **Unsubscribe everything** — all subscriptions from all scripts registered so far
- **Show error notification** identifying the failed script
- **Stop loading** — no scripts are registered at all
- The user fixes the broken script, then triggers reload (which re-runs all scripts from scratch)

### Script Reload: User-Controlled

Registration scripts are just facades — the real logic lives in other modules throughout the Script Library. Any file change in the library could affect handler behavior, so auto-reload would be disruptive and unpredictable.

Instead:
- **Library file watcher** detects changes (already exists in `library-service.ts`)
- If registration scripts are currently loaded, show a **reload indicator** (e.g., a small badge or status bar hint)
- User clicks to trigger reload — this unsubscribes everything and re-runs all `register()` functions from scratch
- User can also trigger reload manually at any time (menu item, keyboard shortcut, or command)

This gives the developer control: edit multiple files, then reload once when ready.

### Script Dependencies: Developer Responsibility

No dependency declaration system. Scripts should be independent. If a developer creates inter-script dependencies, managing load order (via filename prefixes) and correctness is their responsibility.

### Integration Effort

- **Existing callback patterns:** Several places already use callbacks (LinkViewModel.onInternalLinkOpen, FileExplorerModel.getExtraMenuItems). These need migration to the event system, or the event system should wrap them transparently.
- **Context menu pattern:** Currently context menus are built differently in every editor (file explorer, grid, graph, browser). The ContextMenuEvent pattern could unify them, but migrating existing menus is scope creep — we should define the pattern and adopt it incrementally.
- **Per-integration concerns:** Each place where we add events will have its own challenges. We'll review these case by case as we integrate — no need to solve all upfront.

### Script API Surface

- **What events to expose first?** We shouldn't try to eventify everything at once. Start with 2-3 high-value events that validate the pattern.
- **Type definitions:** Events need `.d.ts` declarations so scripts get IntelliSense in the Monaco editor. This is important for usability.
- **Security:** Registration scripts run with full Node.js access (same as regular scripts). This is by design — js-notepad trusts user scripts — but worth noting.

## Ideas Worth Investigating

1. **Can the existing `Subscription` class be extended, or do we need a new `PipelineEvent` class?** — The current class fires CustomEvents through EventTarget. A pipeline needs sequential handler execution with shared mutable state. These may be fundamentally different primitives.

2. **VS Code extension API as inspiration** — VS Code uses `vscode.commands.registerCommand`, `vscode.workspace.onDidSaveTextDocument`, etc. Their pattern of `Disposable` returns and `ExtensionContext.subscriptions` array is proven. Worth studying what they got right.

3. **How does the Script Library watcher interact with registration scripts?** — `library-service.ts` already watches for file changes and invalidates the require cache. Can we piggyback on this to detect when a registration script changes and re-register it?

4. **Should registration scripts be a special script type or just a convention?** — Currently Script Library files are organized by language. Registration scripts could be a new "category" visible in the script panel, or just files in a magic folder.

5. **Event logging/debugging** — Users will need to debug their event handlers. A way to log all events passing through the system (perhaps to the Log View) would be valuable.

6. ~~**Middleware-style `next()` pattern**~~ — **Rejected.** Too complex. Instead, the Awaited pipeline checks `event.handled` after each subscriber. If a subscriber sets `handled = true`, the pipeline skips remaining subscribers and returns immediately. This reuses the pattern already established by `BrowserUrlEvent.handled`.

7. **`subscribeDefault()` — Default handler pattern.** `EventChannel` has `subscribeDefault(handler)` — one default handler per channel, runs last (after all regular subscribers), skipped if `event.handled === true`. Enables "send and forget" pattern: sender fires the event, default handler processes the final result. Example: instead of calling `app.pages.openFile()` directly, fire `app.events.openFile.sendAsync(event)` — scripts can intercept, and `app.pages` is the default handler. **Included in US-229.**

## Investigation Tasks (not implementation)

These are research/design tasks to resolve open questions before implementation planning:

- [ ] **Prototype PipelineEvent class** — Build a minimal proof-of-concept for the sync and async pipeline patterns. Test with a simple event (e.g., context menu) to validate the API ergonomics.
- [ ] **Audit all existing extension points** — Catalog every place where callbacks, events, or hooks already exist. Determine which ones should become scriptable events first.
- [ ] **Design registration script lifecycle** — Flesh out: folder location, loading sequence, hot-reload behavior, error handling, unsubscription on reload.
- [ ] **Define event class hierarchy** — Design the base event types and specialized classes (ContextMenuEvent, etc.). Decide on the type definition approach for script IntelliSense.
- [ ] **Study VS Code extension activation model** — Their `activationEvents` system is relevant. Extract applicable patterns.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-229 | App Event Primitives | Done |

## Notes

### 2026-03-21
- Epic created with high-level ideas and open questions
- No implementation planning yet — need to resolve design questions first
- Key risk: over-engineering the event system before validating with real use cases
- Principle: start with the simplest thing that could work for 2-3 concrete cases, then generalize
- **Resolved:** Two event types — FireAndForget (sync, observe-only) and Awaited (async, modifiable pipeline)
- **Resolved:** All Awaited events are async by default — no sync pipeline variant
- **Resolved:** No priority system — alphabetical script loading order is sufficient for now
- **Resolved:** Error isolation — try-catch per subscriber, log + notify + continue
- **Resolved:** Cancellation UX — 300ms timeout overlay for long-running handlers
- **Deferred:** Per-integration concerns reviewed case by case, not upfront
- **Resolved:** Proxy-based auto-cleanup for registration scripts — scripts only subscribe, system handles unsubscribe on reload
- **Resolved:** No scope isolation — developer responsibility, by design
- **Resolved:** Error during register() → unsubscribe ALL handlers (all scripts), stop loading, show error. All-or-nothing.
- **Resolved:** No dependency system between scripts — developer responsibility
- **Resolved:** Script reload is user-controlled — show indicator on library file changes, user clicks to reload all
- **Rejected:** Middleware `next()` pattern — too complex. Use `event.handled = true` to short-circuit the pipeline instead
- **Resolved:** One unified class, two send methods: `send()` (sync, cloned/frozen event) and `sendAsync()` (async pipeline, `Promise<boolean>` for cancellation)
- **Resolved:** Class named `EventChannel` (not `AppSubscription`)
- **Resolved:** `Object.freeze()` for `send()` — easy to change later
- **Resolved:** `MenuItem` interface moved to `api/types/` as global type
- **Resolved:** Error notifications via `app.ui` — useful for debugging
- **Resolved:** Only `IFileTarget` initially — add other targets per integration
- **Resolved:** `subscribeDefault()` included in US-229 — runs last, skipped if `handled`, enables "send and forget" pattern
