# US-229: App Event Primitives

**Epic:** EPIC-009 (Scriptable Application Events)
**Status:** Done

## Goal

Define and implement the core event classes for the scriptable event system: a unified `EventChannel` class with `send()` / `sendAsync()` methods, a `BaseEvent` class with `handled` support, and well-defined event subclasses (e.g., `ContextMenuEvent<T>`). These primitives will be used by all future event integrations across the application.

## Background

### Existing System

The current `Subscription<D>` class in `/src/renderer/core/state/events.ts`:
- Based on `EventTarget` / `CustomEvent` — fire-and-forget, no return values
- `send(data)` dispatches synchronously to all listeners
- `subscribe(callback)` returns `{ unsubscribe() }`
- Used in 26 instances across the codebase (global events, settings, pages, grid)
- Already has a primitive `handled` pattern: `BrowserUrlEvent.handled`

The new system needs to be **separate** from the existing `Subscription` class — the existing class works well for its current use cases (grid events, state change notifications) and should not be modified.

### Related Code

| File | Relevance |
|------|-----------|
| `/src/renderer/core/state/events.ts` | Existing Subscription class — do NOT modify |
| `/src/renderer/api/internal.ts` | `wrapSubscription()`, `IEvent`, `IDisposable`, `DisposableCollection` |
| `/src/renderer/api/types/common.d.ts` | Public script API types: `IEvent<T>`, `IDisposable` |
| `/src/renderer/api/types/app.d.ts` | `IApp` interface — will need `events` property |
| `/src/renderer/api/types/index.d.ts` | Barrel for all type definitions |

### Design Decisions (from EPIC-009)

1. **One class, two send methods:** `send()` (sync, fire-and-forget) and `sendAsync()` (async pipeline)
2. **`send()` freezes/clones the event** so subscribers cannot modify the original
3. **`sendAsync()` iterates sequentially**, awaiting only thenable results (sync handlers have no overhead)
4. **`handled` flag short-circuits `sendAsync()`** — skips remaining subscribers, returns immediately
5. **Error isolation:** Each subscriber wrapped in try-catch; on error: log, notify, continue to next
6. **No middleware/next() pattern** — just mutable event + `handled` flag

### Folder Location

**Implementations** go in `/src/renderer/api/events/` — this is where all `app.*` functionality lives.

**Type definitions** (`.d.ts`) go in `/src/renderer/api/types/` — Vite auto-copies these to assets for script IntelliSense.

**Why not `core/`?** The event target interfaces (`FileTarget`, `LinkTarget`, etc.) need to be globally accessible from scripts without importing real editor classes. The `api/types/` folder is the established pattern for this. Keeping implementations in `api/` alongside types is consistent with how `settings.ts`, `pages/`, `fs.ts` etc. are organized.

## Implementation Plan

### Step 1: Create folder structure

Create `/src/renderer/api/events/` with:
- `EventChannel.ts` — the main event channel class
- `BaseEvent.ts` — base event class with `handled` property
- `events.ts` — well-defined event subclasses (ContextMenuEvent, etc.)
- `index.ts` — barrel export

### Step 2: Implement `BaseEvent`

```typescript
/** Base class for all app events. */
export class BaseEvent {
    /** Set to `true` by a subscriber to short-circuit the pipeline in sendAsync(). */
    handled = false;
}
```

Keep it minimal. Subclasses add domain-specific properties.

### Step 3: Implement `EventChannel<TEvent extends BaseEvent>`

Core class with:
- **`subscribe(handler: (event: TEvent) => void | Promise<void>): SubscriptionObject`**
  - Accepts both sync and async handlers
  - Stores handlers in an ordered array
  - Returns `{ unsubscribe() }` that removes the handler from the array

- **`send(event: TEvent): void`** (fire-and-forget)
  - Freezes or clones the event (so subscribers cannot mutate)
  - Iterates over all subscribers synchronously
  - Each call wrapped in try-catch (log error, continue)
  - No `handled` check — all subscribers always run
  - Returns void

- **`sendAsync(event: TEvent): Promise<boolean>`** (async pipeline)
  - Iterates over subscribers sequentially
  - Calls handler — if result is thenable, awaits it; otherwise continues immediately
  - After each handler: checks `event.handled` — if true, stops iteration
  - Each call wrapped in try-catch (log error, show notification, continue to next)
  - Returns `true` if completed normally, `false` if cancelled (future: overlay cancellation)

- **`subscribeDefault(handler: (event: TEvent) => void | Promise<void>): SubscriptionObject`**
  - Registers a **default handler** that runs **last**, after all regular subscribers
  - Only one default handler per channel — calling again **overrides** the previous one
  - Returns `{ unsubscribe() }` that clears the default handler
  - The default handler receives the event in its final state (after all regular subscribers modified it)
  - If `event.handled === true` (set by a regular subscriber), the default handler is **skipped**
  - Accepts both sync and async handlers (same as `subscribe()`)

  This enables two usage patterns:
  1. **Send and process:** Sender calls `sendAsync()`, awaits result, inspects modified event, acts on it
  2. **Send and forget:** Sender calls `sendAsync()` and doesn't care about the result — the default handler has the final event and processes it (e.g., `app.pages` subscribes as default handler for file-open events)

- **`hasSubscribers: boolean`** (read-only getter)
  - Returns whether any handlers are registered (including default handler)
  - Useful for senders to skip event construction entirely when nobody is listening

Implementation notes:
- Do NOT use `EventTarget` — use a simple handler array. The `EventTarget` approach adds overhead and makes sequential async iteration difficult.
- Handler type: `(event: TEvent) => void | Promise<void>` — allows both sync and async without forcing `async` keyword.
- Thenable check: `const result = handler(event); if (result && typeof result.then === 'function') await result;`

### Step 4: Implement event subclasses

Start with a small set of reusable event classes that cover the hypothetical use cases.

**`ContextMenuEvent<T>`** — Generic, reusable for any context menu source:
```typescript
export class ContextMenuEvent<T> extends BaseEvent {
    readonly target: T;
    readonly items: MenuItem[];

    constructor(target: T, items: MenuItem[] = []) { ... }

    addItem(item: MenuItem): void { ... }
    addSeparator(): void { ... }
}
```

Target interfaces are defined globally in `api/types/events.d.ts` so any part of the app (and scripts) can use them without importing editor code:

```typescript
// In api/types/events.d.ts

interface IFileTarget {
    /** Full file path. */
    path: string;
    /** File name with extension. */
    name: string;
    /** True if this is a directory. */
    isDirectory: boolean;
}

// Concrete event type alias
type FileContextMenuEvent = ContextMenuEvent<IFileTarget>;
```

This keeps editors lazy-loadable — they don't export their own target types, they use the shared interfaces. More target types (`ILinkTarget`, etc.) and event subclasses (`LinkOpenEvent`, `BookmarkEvent`) will be added in future tasks when we integrate those areas.

### Step 5: Create script API type definitions

Create `/src/renderer/api/types/events.d.ts` with:

- **Event interfaces:** `IBaseEvent`, `IContextMenuEvent<T>`
- **Target interfaces:** `IFileTarget`
- **Subscription interface:** `IEventChannel<T>` — exposes only `subscribe()` (scripts should not call `send`/`sendAsync`)
- **Type aliases:** `FileContextMenuEvent`
- **MenuItem interface** — moved from `PopupMenu.tsx` to global types

Add to `/src/renderer/api/types/index.d.ts` barrel export.

The `IApp` interface in `app.d.ts` will eventually get an `events` property, but that's a separate task (when we wire up the event registry).

### Step 6: Export from api/app-events

Create `/src/renderer/api/events/index.ts` barrel exporting all classes.

## Resolved Concerns

1. **Event cloning vs freezing for `send()`:** Use `Object.freeze()`. Simple, throws on mutation in strict mode (clear error). Easy to change later if needed.

2. **MenuItem type:** Currently defined in `/src/renderer/components/overlay/PopupMenu.tsx:81`. It's a pure data interface (`label`, `onClick`, `disabled`, `icon`, `invisible`, `startGroup`, `hotKey`, `selected`, `id`, `items`, `minor`). Move it to `api/types/` as a global interface — it's not just component-related but a core interface for the event system. `PopupMenu.tsx` and all other consumers will import from the new location.

3. **Notification on subscriber error:** Use `app.ui` notifications. Useful for debugging during development of new event integrations.

4. **`sendAsync` cancellation:** Always return `true` for now. Cancellation overlay is a separate future task.

5. **Naming:** Use **`EventChannel`** — the class acts as a channel with subscribers. Avoids conflict with existing `AppEvent` class.

6. **Target interfaces:** Only `IFileTarget` for now — it's the first integration point. Add other targets (link, bookmark, etc.) when we implement those integrations.

## Open Questions

1. **MenuItem move scope:** Moving `MenuItem` interface to `api/types/` requires updating all existing imports (~20+ files). Should this be a sub-step of this task, or a separate small task? Leaning toward including it here since it's a prerequisite for `ContextMenuEvent`.

## Acceptance Criteria

- [ ] `BaseEvent` class with `handled` property
- [ ] `EventChannel<TEvent>` class with `subscribe()`, `send()`, `sendAsync()` methods
- [ ] `send()` freezes event, iterates sync, try-catch per handler
- [ ] `sendAsync()` iterates sequentially, awaits thenables, checks `handled`, try-catch per handler
- [ ] `subscribe()` accepts both sync and async handlers, returns `{ unsubscribe() }`
- [ ] `subscribeDefault()` — runs last, skipped if `handled`, one per channel, overrides previous
- [ ] `hasSubscribers` getter (includes default handler)
- [ ] `ContextMenuEvent<T>` with generic target type
- [ ] `IFileTarget` interface in `api/types/events.d.ts`
- [ ] `MenuItem` interface moved to `api/types/` (global), all existing imports updated
- [ ] Script API type definitions (`.d.ts`) with `IEventChannel<T>` exposing only `subscribe()`
- [ ] Exports from `api/events/index.ts`
- [ ] Error notification via `app.ui` on subscriber errors
- [ ] No modifications to existing `Subscription` class or its consumers
