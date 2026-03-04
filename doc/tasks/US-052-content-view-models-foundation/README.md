# US-052: Content View Models Foundation — IContentHost + ContentViewModel

## Status

**Status:** Completed
**Priority:** High
**Started:** 2026-03-04
**Completed:** 2026-03-04

## Summary

Create the foundation infrastructure for the Content View Models pattern: `IContentHost` interface, `ContentViewModel` abstract base class, `ContentViewModelHost` ref-counting helper, `useContentViewModel` React hook, and extend `EditorRegistry` with view model factory support.

## Why

- Editor-specific models (Grid, Notebook, Todo) are currently created inside React via `useComponentModel`, tying them to React lifecycle
- No programmatic access — scripts cannot call `page.asGrid().addRow()`
- `NoteItemEditModel` uses unsafe `as unknown as TextFileModel` cast
- No shared interface between `TextFileModel` and `NoteItemEditModel`
- This task creates the foundation that all subsequent editor migrations (Tasks 1–11) build upon

## Architecture Reference

- [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — full architecture document

## Acceptance Criteria

- [x] `IContentHost` interface defined with `acquireViewModel()`, `releaseViewModel()`, content state, and mutation methods
- [x] `IContentHostState` type defined (content, language, editor)
- [x] `ContentViewModel<TState>` abstract base class with init/dispose lifecycle, content subscription, and `addSubscription()` cleanup
- [x] `ContentViewModelHost` helper class with ref-counting logic (acquire, release, disposeAll) — uses `EditorRegistry` for factory resolution and validation
- [x] `useContentViewModel` React hook for async acquire-on-mount / release-on-unmount
- [x] `EditorModule.createViewModel` optional field added to `EditorModule` type
- [x] `EditorRegistry` extended with `getViewModelFactory()`, `loadViewModelFactory()`, `validateForHost()`, and module caching
- [x] All new code exported from `editors/base/index.ts`
- [x] App compiles with no errors
- [x] All existing editors work unchanged (purely additive — no editor modifications)

## Technical Approach

### Key Design Decisions

**1. Editor Registry provides view model factories**

`EditorDefinition` already controls which editors are applicable (`switchOption`, `validForLanguage`). Extending it with `createViewModel` factories means:
- Single source of truth for editor availability AND model creation
- Built-in validation: calling `acquireViewModel("grid-json")` on a markdown page throws a meaningful error
- No circular dependencies: factories are registered at startup via `register-editors.ts`, not imported by IContentHost

**2. Async `acquireViewModel()`**

Content-view editors are lazy-loaded (code splitting). When a script calls `acquireViewModel("grid-json")` and the grid module hasn't been loaded yet, the factory must be loaded first. Making `acquireViewModel` async handles both paths:
- **React path (effectively instant):** AsyncEditor loads the module before the editor mounts → factory already cached → `acquireViewModel` resolves immediately
- **Script path (may need load):** Module not yet loaded → registry loads it → creates model → resolves

**3. Ref-counting via composition (`ContentViewModelHost`)**

Both `TextFileModel` (extends `PageModel`) and `NoteItemEditModel` (standalone class) need ref-counting. Since TypeScript doesn't support multiple inheritance, both compose a shared `ContentViewModelHost` instance and delegate `acquireViewModel`/`releaseViewModel` to it.

**4. Both IContentHost implementations have `acquireViewModel`**

Originally the doc had "view model accessors live on TextFileModel only." Revised: both TextFileModel and NoteItemEditModel support `acquireViewModel` via IContentHost. This means GridEditor works identically whether it's a standalone page or embedded in a notebook note. Script-accessible typed convenience methods (`page.asGrid()`) are still added later in the ScriptContext (Task 10).

**5. Module caching moves to EditorRegistry**

Currently `AsyncEditor` caches loaded modules in a local Map. Moving this cache into `EditorRegistry` makes it the single source of truth — `getViewModelFactory()` can find the factory without AsyncEditor being involved.

### Architecture Overview

```
IContentHost (interface)
  ├── id, state, changeContent, changeEditor, changeLanguage, stateStorage
  ├── acquireViewModel(editorId): Promise<ContentViewModel<any>>
  └── releaseViewModel(editorId): void

ContentViewModel<TState> (abstract class)
  ├── state: TOneState<TState>
  ├── host: IContentHost
  ├── init() → subscribes to host.state content, calls onInit()
  ├── dispose() → cleanup subscriptions, calls onDispose()
  ├── onInit(), onContentChanged(content), onDispose() — subclass hooks
  └── addSubscription(unsubscribe) — auto-cleanup on dispose

ContentViewModelHost (composition helper)
  ├── _viewModels: Map<PageEditor, { vm, refs }>
  ├── acquire(editorId, host) → validate via registry, get factory, create/cache, refs++
  ├── release(editorId) → refs--, dispose if zero
  └── disposeAll() → dispose all cached models

EditorRegistry (extended)
  ├── getViewModelFactory(editorId) → sync, returns factory if module loaded
  ├── loadViewModelFactory(editorId) → async, loads module if needed
  ├── validateForHost(editorId, host) → throws if not applicable
  └── module cache: Map<PageEditor, EditorModule>

useContentViewModel<T>(host, editorId) → React hook
  ├── useEffect: acquireViewModel (async), release on unmount
  └── returns T | null (null while loading — typically instant)
```

### Flow: React editor

```
User switches to Grid view
  → state.editor = "grid-json"
  → ActiveEditor renders AsyncEditor
  → AsyncEditor: registry.loadModule("grid-json") → loads GridEditor + GridViewModel
  → Module cached in registry
  → GridEditor mounts
  → useContentViewModel(host, "grid-json")
    → host.acquireViewModel("grid-json")
      → ContentViewModelHost.acquire()
        → registry.validateForHost() ✓ (JSON language, grid applicable)
        → registry.getViewModelFactory() → factory from cached module
        → factory(host) → new GridViewModel(host)
        → vm.init() → subscribes to content
        → cache + refs: 1
    → returns GridViewModel
  → grid.state.use() — reactive subscription
  → renders grid UI
```

### Flow: Script (module not loaded)

```
Script calls page.asGrid()
  → ScriptContext: host.acquireViewModel("grid-json")
    → ContentViewModelHost.acquire()
      → registry.validateForHost() ✓
      → registry.getViewModelFactory() → undefined (not loaded)
      → await registry.loadViewModelFactory("grid-json") → loads module
      → factory(host) → new GridViewModel(host)
      → vm.init(), cache, refs: 1
  → Script uses grid API
  → Script completes → host.releaseViewModel("grid-json") → refs: 0 → dispose
```

### Flow: Validation error

```
Script calls page.asGrid() on a markdown page
  → host.acquireViewModel("grid-json")
    → registry.validateForHost("grid-json", host)
      → def.validForLanguage("markdown") → false
      → throw Error('Editor "grid-json" is not applicable for "markdown" content')
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/editors/base/IContentHost.ts` | `IContentHost` interface, `IContentHostState` type |
| `src/renderer/editors/base/ContentViewModel.ts` | Abstract base class |
| `src/renderer/editors/base/ContentViewModelHost.ts` | Ref-counting helper (composition) |
| `src/renderer/editors/base/useContentViewModel.ts` | React hook for async acquire/release |

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/editors/types.ts` | Add optional `createViewModel` to `EditorModule` |
| `src/renderer/editors/registry.ts` | Add module cache, `getViewModelFactory()`, `loadViewModelFactory()`, `validateForHost()` |
| `src/renderer/editors/base/index.ts` | Export new items |

## Implementation Steps

### Step 1: IContentHost interface
- [x] Create `editors/base/IContentHost.ts`
- [x] Define `IContentHostState` (content, language, editor)
- [x] Define `IContentHost` interface (id, state, change*, stateStorage, acquireViewModel, releaseViewModel)

### Step 2: ContentViewModel abstract base class
- [x] Create `editors/base/ContentViewModel.ts`
- [x] Implement constructor (host, defaultState → TOneState)
- [x] Implement `init()` — subscribe to host content changes, call `onInit()`
- [x] Implement `dispose()` — cleanup subscriptions, call `onDispose()`
- [x] Implement `addSubscription()` for automatic cleanup

### Step 3: Extend EditorRegistry
- [x] Add `createViewModel` optional field to `EditorModule` in `types.ts`
- [x] Add module cache (`Map<PageEditor, EditorModule>`) to `EditorRegistry`
- [x] Add `getViewModelFactory(editorId)` — sync, returns factory if module cached
- [x] Add `loadViewModelFactory(editorId)` — async, loads module if needed, returns factory
- [x] Add `validateForHost(editorId, host)` — throws if editor not applicable
- [x] Refactor: `loadModule()` results cached in registry (AsyncEditor's local cache becomes optional)

### Step 4: ContentViewModelHost (ref-counting)
- [x] Create `editors/base/ContentViewModelHost.ts`
- [x] Implement `acquire(editorId, host)` — validate, get/load factory, create, init, cache, refs++
- [x] Implement `release(editorId)` — refs--, dispose if zero
- [x] Implement `disposeAll()` — dispose all cached models

### Step 5: useContentViewModel React hook
- [x] Create `editors/base/useContentViewModel.ts`
- [x] Async acquire in useEffect, release on cleanup
- [x] Return `T | null` (null while loading)
- [x] Handle unmount-during-load (cancelled flag)

### Step 6: Exports and verification
- [x] Export all new items from `editors/base/index.ts`
- [x] Verify app compiles (`npx tsc --noEmit` — 0 errors)
- [x] Verify all existing editors work unchanged

## Notes

### IState<T> variance

`IContentHost.state` is typed as `IState<IContentHostState>`, but `TextFileModel.state` is `IState<TextFilePageModelState>` (wider type). This works because the project does not enable `strictFunctionTypes` — TypeScript uses bivariant parameter checking. ContentViewModel only calls `get()` and `subscribe()` (covariant operations), so it's semantically correct.

If `strict: true` were ever enabled, this would need a generic `IContentHost<T extends IContentHostState>`. Accepted risk for now.

### AsyncEditor module cache

Moving module caching into EditorRegistry means `AsyncEditor`'s local `moduleCache` Map becomes redundant. We can either:
- Remove it in this task (minor change to AsyncEditor)
- Keep both caches temporarily (AsyncEditor's cache is a fast path, registry cache is the source of truth)

Decision: keep both for now, remove AsyncEditor's cache in a later task when AsyncEditor itself is updated (Task 9).

## Related

- Architecture doc: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
- Migration plan: [README.md](../../future-architecture/migration/README.md)
- Previous task: [US-051](../US-051-window-api-consolidation/)
