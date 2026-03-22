# State Management

## Overview

js-notepad uses a custom reactive state system built on Zustand + Immer:
- Immutable updates via Immer's `produce()`
- React hooks for subscriptions with shallow comparison
- Type-safe state access via `TOneState<T>`

All state primitives live in `/src/renderer/core/state/`.

## When to Use What

| Primitive | Use case | Location |
|-----------|----------|----------|
| `TOneState<T>` | Simple reactive value (standalone or inside a model) | Anywhere |
| `TGlobalState<T>` | Application-wide state (cleared on logout) | `api/` modules |
| `TComponentState<T>` | Component-scoped state (with `useComponentModel`) | React components |
| `TModel<T>` | Stateful business logic (non-React) | Models, services |
| `TComponentModel<T, P>` | React component model with props, effects, memos | React components |
| `TDialogModel<T, R>` | Dialog/modal with async result | Dialogs |
| `ContentViewModel<T>` | Editor view state with ref-counting | Content-view editors |

## Core Primitives

### TOneState\<T\>

Foundation of all state. Wraps Zustand store with Immer updates.

```typescript
const count = new TOneState(0);
count.get();              // 0
count.set(5);             // direct set
count.update(s => s + 1); // Immer update (for objects/arrays)
count.use();              // React hook — re-renders on change
count.use(s => s > 3);    // Selective subscription with shallow compare
count.subscribe(() => {}); // Non-React listener
count.clear();            // Reset to default
```

### TGlobalState\<T\>

Extends `TOneState` — identical API, but auto-clears on logout. Used for application-wide state in Object Model implementations.

```typescript
const globalState = new TGlobalState<AppState>(defaultState);
globalState.update(s => { s.pages.push(newPage); });
```

### TComponentState\<T\>

Extends `TOneState` — identical API. Used with `useComponentModel` for component-scoped state that persists across re-renders.

```typescript
const state = new TComponentState<MyState>({ name: '', items: [] });
state.update(s => {
    s.name = 'Hello';
    s.items.push('item');
});
```

**Design Note:** Both `TGlobalState` and `TComponentState` extend `TOneState` with the same API. The distinction is organizational — `TGlobalState` clears on logout, `TComponentState` is scoped to a React component's lifetime via `useComponentModel`.

## Model Classes

### TModel\<T\>

Base class for stateful business logic. Holds a `state` property.

```typescript
class MyModel extends TModel<MyState> {
    doSomething() {
        this.state.update(s => { s.value = 'changed'; });
    }
}
```

### TComponentModel\<T, P\>

React component model with props tracking, effects, and memos. Used with the `useComponentModel` hook.

```typescript
class MyComponentModel extends TComponentModel<State, Props> {
    init() {
        // Called once after first render
        this.effect(() => {
            console.log("value changed:", this.props.value);
        }, () => [this.props.value]);
    }

    dispose() {
        // Called on unmount
    }
}

// In component:
const model = useComponentModel(props, MyComponentModel, defaultState);
```

**Lifecycle:**
1. Mount: creates model, stores in React ref
2. Each render: `setPropsInternal(props)` — updates props, evaluates effects
3. After first render: `init()` called via `useEffect` — registers effects
4. Unmount: `dispose()` called, all effects cleaned up

**Primitives:**
- `this.effect(callback, depsFactory?)` — side effect with dependency tracking (like `useEffect`)
- `this.memo(computeFn, depsFactory)` — cached computation (like `useMemo`)

See [Model-View Pattern](/doc/standards/model-view-pattern.md) for full documentation.

### TDialogModel\<T, R\>

For dialog/modal patterns with async result.

```typescript
class MyDialog extends TDialogModel<State, Result> {
    // close(result) resolves the result promise
    // canClose(result) — optional guard before closing
}
```

## ContentViewModel Pattern

Located in `/src/renderer/editors/base/`. Used by content-view editors (Grid, Markdown, Notebook, Todo, Link, Log View, SVG, HTML, Mermaid) to manage view state separately from the shared text content.

### ContentViewModel\<TState\>

Abstract base class for editor view models. Subscribes to host content changes and manages its own state.

```typescript
class GridViewModel extends ContentViewModel<GridState> {
    protected onInit(): void {
        // Parse initial content, set up state
        this.parseContent(this.host.state.get().content);
    }

    protected onContentChanged(content: string): void {
        // React to host content updates
        this.parseContent(content);
    }
}
```

**Lifecycle:**
1. Created by `ContentViewModelHost.acquire(editorId, host)`
2. `init()` subscribes to host content changes, calls `onInit()`
3. Lives as long as at least one consumer holds a reference
4. `dispose()` cleans up subscriptions, calls `onDispose()`

**Subclass hooks:**
- `onInit()` — parse initial content, set up internal state
- `onContentChanged(content)` — react to host content updates
- `onDispose()` — optional custom cleanup
- `addSubscription(unsub)` — register subscriptions for auto-cleanup

### ContentViewModelHost

Ref-counting manager for content view models. Composed by `TextFileModel` and `NoteItemEditModel`.

```typescript
class TextFileModel implements IContentHost {
    private _vmHost = new ContentViewModelHost();

    acquireViewModel(editorId) { return this._vmHost.acquire(editorId, this); }
    releaseViewModel(editorId) { this._vmHost.release(editorId); }
    dispose() { this._vmHost.disposeAll(); }
}
```

**Reference counting:**
- `acquire(editorId, host)` — first call creates + inits the VM; subsequent calls increment ref count
- `release(editorId)` — decrements ref count; disposes when it reaches 0
- `tryGet(editorId)` — peek at cached VM without changing ref count
- `disposeAll()` — force-dispose all VMs (when host is disposed)

### useContentViewModel Hook

React hook for acquiring/releasing a ContentViewModel from a host.

```typescript
function GridEditor({ host }: { host: IContentHost }) {
    const vm = useContentViewModel<GridViewModel>(host, "grid-json");
    if (!vm) return null; // loading (usually just first render)
    return <GridView vm={vm} />;
}
```

On mount: calls `host.acquireViewModel(editorId)`. On unmount: calls `host.releaseViewModel(editorId)`. Handles unmount-during-async-load safely.

## Disposable Pattern

Located in `/src/renderer/api/types/common.d.ts` and `/src/renderer/api/internal.ts`.

### IDisposable

Universal cleanup contract. Matches Monaco's own `IDisposable`.

```typescript
interface IDisposable {
    dispose(): void;
}
```

### IEvent\<T\>

Subscribable event. Returns `IDisposable` for uniform cleanup.

```typescript
interface IEvent<T> {
    subscribe(handler: (data: T) => void): IDisposable;
}
```

### DisposableCollection

Groups multiple disposables for bulk cleanup. Used by Object Model implementations.

```typescript
const disposables = new DisposableCollection();
disposables.add(event.subscribe(handler));
disposables.add(anotherEvent.subscribe(otherHandler));
// Later: disposables.dispose();
```

### wrapSubscription

Adapts the older `Subscription<T>` (from `core/state/events.ts`) to the `IEvent<T>` interface.

```typescript
import { wrapSubscription } from "../api/internal";
const onChanged: IEvent<string> = wrapSubscription(mySubscription);
```

### Subscription\<T\>

Event system in `core/state/events.ts`. Built on `EventTarget`. Used internally.

```typescript
const event = new Subscription<string>();
event.send("hello");                    // emit
const sub = event.subscribe(data => {}); // listen
sub.unsubscribe();                       // cleanup
```

### EventChannel\<T\>

Scriptable event channel in `api/events/EventChannel.ts`. Supports both fire-and-forget and async pipeline patterns. Designed for events that user scripts can subscribe to.

```typescript
const channel = new EventChannel<ContextMenuEvent<IFileTarget>>({ name: "fileExplorer.itemContextMenu" });

// Fire-and-forget (sync, event frozen — subscribers observe only)
channel.send(event);

// Async pipeline (subscribers can modify event, short-circuits on handled)
const ok = await channel.sendAsync(event);

// Subscribe (sync or async handlers)
const sub = channel.subscribe((event) => { event.items.push({ label: "Custom", onClick: () => {} }); });

// Default handler (runs last, skipped if event.handled)
channel.subscribeDefault((event) => { showMenu(event.items); });
```

Unlike `Subscription<T>`, `EventChannel` uses a handler array (not `EventTarget`), supports async pipelines with sequential execution, and provides `subscribeDefault()` for fallback behavior.

## Object Model State Pattern

The Object Model (`/src/renderer/api/`) uses these primitives internally. Each API module owns its state and exposes it through typed interfaces.

```typescript
// api/settings.ts — uses TGlobalState internally
class Settings implements ISettings {
    private _state = new TGlobalState<SettingsState>(defaults);

    get theme(): string { return this._state.get().theme; }
    set(key, value) { this._state.update(s => { s[key] = value; }); }
}

// api/pages/ — PagesModel extends TModel
class PagesModel extends TModel<PagesState> {
    // Submodels (PagesQueryModel, PagesNavigationModel, etc.)
    // access this.state for page collection state
}
```

**Key point:** Consumers (React components, scripts) access state through Object Model interfaces (`app.settings`, `app.pages`), not through raw state primitives.

## Using State in Components

### Via Object Model

```typescript
function MyComponent() {
    const theme = app.settings.use("theme");  // subscribe via Object Model
    return <div>Theme: {theme}</div>;
}
```

### Via Model State (direct)

```typescript
function EditorView({ model }: { model: TextFileModel }) {
    const { content, modified } = model.state.use(s => ({
        content: s.content,
        modified: s.modified,
    }));
    return <Editor value={content} />;
}
```

### Via useComponentModel

```typescript
function MyWidget(props: WidgetProps) {
    const model = useComponentModel(props, WidgetModel, defaultState);
    const { count } = model.state.use(s => ({ count: s.count }));
    return <div onClick={() => model.increment()}>{count}</div>;
}
```

## Best Practices

### 1. Minimize Subscriptions

```typescript
// GOOD — subscribe to what you need
const { title } = state.use(s => ({ title: s.title }));

// BAD — subscribe to everything (re-renders on any change)
const state = model.state.use();
```

### 2. Use Immer Updates

```typescript
// GOOD — Immer mutation syntax
state.update(s => { s.items.push(newItem); });

// BAD — manual immutable update
state.set({ ...state.get(), items: [...state.get().items, newItem] });
```

### 3. Prefer Object Model Over Raw State

Access state through `app.*` interfaces when available. Only use raw `state.use()` inside the component/editor that owns the state.

### 4. ContentViewModel for Editor Views

When creating a new content-view editor, extend `ContentViewModel<T>` and register its factory in the editor registry. Don't create standalone state — use the host + ref-counting pattern.
