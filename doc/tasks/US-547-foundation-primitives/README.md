# US-547: Foundation primitives (Phase A · EPIC-028)

Part of [EPIC-028 — Unified Editor Architecture](../../epics/EPIC-028.md). First task in **Phase A (Foundation)**. Lands the architectural primitives **inert** — no runtime consumers, no behavioral change. US-548 starts wiring them in.

## Goal

Add seven foundation primitives — `ComponentQueue`, `TOneState` selector-subscribe overload, the new v4 `EditorModel` base, the new v4 `IContentHost` interface, the new v4 `editorRegistry`, `CONTENT_HOST_TRAIT`, and the v4 persistence types (`EditorDescriptor` / `HostDescriptor` / `PageDescriptor` / `WindowState`). Old code keeps working unchanged; the new primitives compile alongside as the empty foundation US-548 builds upon.

## Background

### Why the design defers consumers

EPIC-028 is a strangler-fig migration: the new architecture coexists with the old one for phases A–C, then US-559 retires the legacy code path. The very first step must add the new shape **without disturbing any existing editor or page code** — otherwise we cannot test that the old code path still passes its smoke tests between tasks.

That constraint dictates the file layout:

- **Shared primitives** (`ComponentQueue`, `TOneState.subscribe` selector overload) live at their final paths from day one. They are not legacy duplicates — they're new utilities.
- **v4 editor primitives** (new `EditorModel`, `IContentHost`, `editorRegistry`, `CONTENT_HOST_TRAIT`, `EditorStateStorage`) live under a dedicated `src/renderer/editors/base/v4/` folder. The old `src/renderer/editors/base/EditorModel.ts` / `IContentHost.ts` and `src/renderer/editors/registry.ts` stay untouched. US-559 deletes the legacy files and lifts v4 contents up.
- **v4 persistence types** live in a new file `src/shared/persistence-v4.ts`. Today's `PageDescriptor` and `WindowState` in `src/shared/types.ts` stay untouched; US-548's dual-read picks one or the other based on `schemaVersion`.

### Inputs

- Mockups under [`/doc/epics/EPIC-028-editor-architecture/mockups/`](../../epics/EPIC-028-editor-architecture/mockups/):
  - [`EditorModel.ts`](../../epics/EPIC-028-editor-architecture/mockups/EditorModel.ts) — new base class shape
  - [`IContentHost.ts`](../../epics/EPIC-028-editor-architecture/mockups/IContentHost.ts) — slimmed interface
  - [`ComponentQueue.ts`](../../epics/EPIC-028-editor-architecture/mockups/ComponentQueue.ts) — fire-and-forget + request/reply
  - [`TOneState.ts`](../../epics/EPIC-028-editor-architecture/mockups/TOneState.ts) — selector-subscribe overload
  - [`editorRegistry.ts`](../../epics/EPIC-028-editor-architecture/mockups/editorRegistry.ts) — simplified registry
  - [`PersistenceTypes.ts`](../../epics/EPIC-028-editor-architecture/mockups/PersistenceTypes.ts) — v4 descriptors
  - [`traits.ts`](../../epics/EPIC-028-editor-architecture/mockups/traits.ts) — `CONTENT_HOST_TRAIT`
- [`concerns.md`](../../epics/EPIC-028-editor-architecture/concerns.md) — all design-phase resolutions, especially C1 (host-capability via `instanceof`), C2 (no migration shim), C3 (descriptor shape), C9 (cache-file id transfer), B1/S10 (editorId as registry key), P1–P10 (persistence shape), N1 (selector subscribe), SF6 (request/reply queue).
- Current source code that v4 primitives parallel:
  - `src/renderer/editors/base/EditorModel.ts` (legacy base; stays put)
  - `src/renderer/editors/base/IContentHost.ts` (legacy interface; stays put)
  - `src/renderer/editors/registry.ts` (legacy registry; stays put)
  - `src/renderer/core/state/state.ts` (TOneState; selector overload added in-place)
  - `src/renderer/core/state/events.ts` (`Subscription` — reused by new EditorModel.descriptorChanged)
  - `src/renderer/core/traits/traits.ts` (`TraitKey`, `TraitSet` — reused for `CONTENT_HOST_TRAIT`)
  - `src/shared/types.ts` (legacy `PageDescriptor` / `WindowState`; stays put)

## Implementation plan

Land in roughly this order so each step compiles before the next builds on it.

### Step 1 — `ComponentQueue` primitive

Create `src/renderer/core/state/ComponentQueue.ts`. Full implementation from the mockup — both channels (`send` / `subscribe` / `use` for fire-and-forget; `execute` / `register` / `useRequest` for request/reply). Approximately 260 lines.

Key details to get right:
- `subscribe(handler)` drains the queued events FIFO into the handler **before** storing the handler, so the drain order is deterministic.
- `register(handler)` mirrors `subscribe` for the request channel: drain `_pendingRequests` FIFO, resolve each via the handler synchronously (handler throws → reject).
- `dispose()` rejects pending requests with `new Error("ComponentQueue disposed before request was handled")` — important so script awaits don't hang when an editor closes mid-query.
- `use(handler)` and `useRequest(handler)` are React hooks. The mockup's `useEffect(() => this.subscribe(handler), [this])` body is sketchy — implement properly with a ref so a changing handler doesn't churn the subscription:

  ```ts
  use(handler: (event: E) => void): void {
      const handlerRef = useRef(handler);
      handlerRef.current = handler;
      useEffect(() => this.subscribe(ev => handlerRef.current(ev)), [this]);
  }
  ```

  Same pattern for `useRequest`.
- `dispose()` clears `_handler` and `_requestHandler` after rejecting/draining so a late call doesn't fire on a dead component.

No consumers — the file just exists to be imported by US-548 and later.

### Step 2 — `TOneState.subscribe` selector overload

Edit `src/renderer/core/state/state.ts`. Two changes:

1. Update the `IState<T>` type at lines 14-21 to declare both overload signatures:

   ```ts
   export type IState<T> = {
       get: () => T;
       set: React.Dispatch<SetStateAction<T>>;
       use: IUse<T>;
       update: (updateDraft: (state: T) => void) => void;
       clear: () => void;
       subscribe: {
           (listener: () => void): () => void;
           <R>(listener: (value: R) => void, selector: (state: T) => R): () => void;
       };
   };
   ```

2. Update the `TOneState.subscribe` implementation at lines 93-98 to dispatch on argument count:

   ```ts
   subscribe = ((...args: unknown[]) => {
       if (args.length >= 2) {
           const listener = args[0] as (value: unknown) => void;
           const selector = args[1] as (state: T) => unknown;
           let last = selector(this.store.getState());
           const wrapped = () => {
               const next = selector(this.store.getState());
               if (!compareSelection(last, next)) {
                   last = next;
                   listener(next);
               }
           };
           this.listeners.push(wrapped);
           return () => { this.listeners = this.listeners.filter(l => l !== wrapped); };
       }
       const listener = args[0] as () => void;
       this.listeners.push(listener);
       return () => { this.listeners = this.listeners.filter(l => l !== listener); };
   }) as IState<T>["subscribe"];
   ```

Existing zero-arg-listener callers stay binary-compatible (all hundreds of them across the codebase). The selector overload is purely additive — nothing in US-547 uses it. US-548's `PageModel.attach()` is the first consumer.

`compareSelection` (state.ts:34-52) is already module-local — the wrapped handler closes over it. No export needed.

### Step 3 — v4 persistence types

Create `src/shared/persistence-v4.ts` with `PipeDescriptor`, `HostDescriptor`, `EditorDescriptor`, `PageDescriptor` (v4 shape — same name in a separate file, importers pick by path), `WindowState` (v4 — with `schemaVersion: 4`).

The legacy `PageDescriptor` and `WindowState` in `src/shared/types.ts` stay. US-548 will read both formats and write v4; US-559 will delete the legacy types.

Name-collision avoidance: the v4 file's `PageDescriptor` and `WindowState` have the same names as the legacy ones. Import from `../../shared/persistence-v4` to get v4, from `../../shared/types` to get legacy. v4 file does not re-export — call sites pick.

### Step 4 — `CONTENT_HOST_TRAIT` and `IPageHost` interface

Create the v4 folder and two small files:

- `src/renderer/editors/base/v4/IPageHost.ts` — a minimal forward-declared interface for what the new `EditorModel.page` reference exposes. US-548's `PageModel` adapter layer implements it; US-547's `EditorModel` only depends on the interface. Avoids a circular import in the inert phase. Minimum surface (deduce from mockup usage):

  ```ts
  // Forward-declared interface — narrows what EditorModel.page calls during
  // its own lifecycle. US-548 implements this on the new PageModel.
  export interface IPageHost {
      readonly id: string;
      // US-548 will widen as needed.
  }
  ```

- `src/renderer/editors/base/v4/editor-traits.ts` — `CONTENT_HOST_TRAIT` and `IContentHostTrait`:

  ```ts
  import { TraitKey } from "../../../core/traits/traits";
  import type { IContentHost } from "./IContentHost";

  export interface IContentHostTrait {
      extractContentHost(): IContentHost;
  }

  export const CONTENT_HOST_TRAIT = new TraitKey<IContentHostTrait>("content-host");
  ```

  Re-uses the existing `TraitKey<T>` and `TraitSet` from `src/renderer/core/traits/traits.ts`.

### Step 5 — v4 `EditorStateStorage` (name-only shape)

Create `src/renderer/editors/base/v4/EditorStateStorage.ts`:

```ts
// Editor-scoped storage. Editor's id is captured at the call site (via
// stateStorage on the editor instance), so the interface only takes `name`.
//
// Distinct from the legacy `EditorStateStorage` at
// `src/renderer/editors/base/EditorStateStorageContext.tsx` which takes
// (id, name). Path-disambiguated; both coexist until US-559.
export interface EditorStateStorage {
    getState(name: string): Promise<string | undefined>;
    setState(name: string, state: string): Promise<void>;
}
```

### Step 6 — v4 `IContentHost`

Create `src/renderer/editors/base/v4/IContentHost.ts`. Implement the slim interface from the mockup. Key differences from the legacy interface at `src/renderer/editors/base/IContentHost.ts`:

- **Removed**: `editor?: EditorView` field, `changeEditor`, `acquireViewModel`, `acquireViewModelSync`, `prepareViewModel`, `releaseViewModel`.
- **Added**: `dispose(): Promise<void>` on the interface, `getDescriptor(): HostDescriptor`, `setStorage(storage: EditorStateStorage)`, optional `handleKeyDown?(e: React.KeyboardEvent)`.

Static factory contract (`static fromDescriptor(desc): Promise<IContentHost>`) is documented in the file's preamble (TypeScript interfaces cannot enforce statics — convention only; first consumer is US-551's `TextFileModel.fromDescriptor`).

Imports `EditorStateStorage` from `./EditorStateStorage` (the v4 shape) and `HostDescriptor` from `../../../../shared/persistence-v4`.

### Step 7 — v4 `EditorModel`

Create `src/renderer/editors/base/v4/EditorModel.ts`. Full new base class from the mockup. Resolve one mockup discrepancy: the mockup declares `class EditorModel` (non-abstract) but `abstract readonly editorId: string`. Fix by marking the class `abstract`:

```ts
export abstract class EditorModel<
    T extends EditorStateBase = EditorStateBase,
    R = unknown,
    E extends ComponentQueueEvent = ComponentQueueEvent,
> extends TDialogModel<T, R> {
    abstract readonly editorId: string;
    // ...
}
```

The class is abstract; no instances exist until US-548 adds `LegacyEditorAdapter`. Inert.

Key surface (matches the mockup):
- `abstract readonly editorId: string` (registry key — replaces today's `state.type`)
- `readonly queue: ComponentQueue<E>`
- `readonly traits = new TraitSet()`
- `readonly descriptorChanged = new Subscription<void>()` (from `core/state/events`)
- `readonly stateStorage: EditorStateStorage` (v4 shape — `getState(name)` / `setState(name, value)`; binds the editor's id via closure)
- `page: IPageHost | null = null` + `setPage(page)`
- Three-phase lifecycle: `applyRestoreData(data: RestoreData<T>)`, `switchFrom(oldEditor: EditorModel)`, `restore(): Promise<void>`
- Reaction hooks: `beforeNavigateAway(newModel)`, `onMainEditorChanged(newMain)`, `onPanelExpanded(panelId)`
- Panel contribution: `secondaryEditor` getter/setter (pure state mutation, no side effects), `contributesPanels()`
- Switch widget support: `findCompatibleEditors(): string[]` (default empty)
- `isFreshEmpty()`: false default
- Standard getters: `id`, `title`, `modified` (derive from state)
- v4-specific getters: `get contentHost(): IContentHost | null` (default null), `getNavigatorTarget()`, optional `hasTextSelection?()`, `focus()` no-op base
- Persistence: `getRestoreData(): EditorDescriptor` (default — text-bearing subclasses extend with `host: this._host?.getDescriptor()`)
- Release/dispose: `confirmRelease(closing?)`, `dispose()` (calls `this.queue.dispose()`; subclasses extend)
- Auxiliary: `scriptData: Record<string, unknown>`, `getIcon?`, `noLanguage = false`, `skipSave = false`

The base class auto-forwards state mutations to `descriptorChanged` in the constructor:

```ts
constructor(modelState: IState<T> | (new (defaultState: T) => IState<T>), defaultState?: T) {
    super(modelState, defaultState);
    this.state.subscribe(() => this.descriptorChanged.send());
}
```

Subscription `send` signature is `(data: D) => void` — for `Subscription<void>`, pass `undefined`: `this.descriptorChanged.send(undefined)`. (Confirmed at `src/renderer/core/state/events.ts:22-24`.)

### Step 8 — v4 `editorRegistry`

Create `src/renderer/editors/base/v4/editorRegistry.ts`. Full new registry from the mockup. Empty by default — no editors registered in US-547.

Key API:
- `register(def: EditorDefinition)` — stores definition by id
- `getById(id)`, `getAll()`
- `resolveForFile(fileName, language?, mode?)` — returns best id (default "monaco")
- `findEditorsAccepting(host: IContentHost): string[]` — for switch widget
- `createEditor(id, instanceId?): Promise<EditorModel>` — lazy-loads module, instantiates, optionally sets the instance UUID at construction

The `EditorDefinition` interface:
- `id: string`, `name: string`
- `accepts(input: AcceptanceInput): number` (the single unified predicate)
- `hasContentHost: boolean` (collapsible to trait introspection later — keep explicit in US-547 for clarity)
- `loadModule(): Promise<EditorModule>`

`AcceptanceInput`: `{ fileName?, language?, host?, mode?: "edit" | "view" }`.
`EditorModule`: `{ createEditor(): EditorModel; Component: React.ComponentType<{ model: EditorModel }> }`.

Export the singleton: `export const editorRegistry = new EditorRegistry();` — empty. US-548 registers the first adapter-wrapped editors.

### Step 9 — Barrel `index.ts`

Create `src/renderer/editors/base/v4/index.ts`:

```ts
export { EditorModel, type EditorStateBase, type RestoreData } from "./EditorModel";
export type { IContentHost, IContentHostState } from "./IContentHost";
export type { EditorStateStorage } from "./EditorStateStorage";
export type { IPageHost } from "./IPageHost";
export { CONTENT_HOST_TRAIT, type IContentHostTrait } from "./editor-traits";
export { editorRegistry, type EditorDefinition, type EditorModule, type AcceptanceInput } from "./editorRegistry";
```

Lets US-548 import everything via `from "../base/v4"`. Cleaner than seven separate paths.

### Step 10 — Smoke verification

After all files compile:

1. `npm run lint` — must pass with no new warnings.
2. `npm start` — app launches, opens an empty page, opens a file (e.g., a `.md`), switches view (Monaco ↔ Markdown preview), closes the page, reopens. Old code path entirely.
3. Open a `.note.json` (notebook), a `.todo.json` (todo), a `.grid.json` (grid). All still work.
4. Restart the app — pages restore as before.
5. Open dev tools console — no new warnings or errors compared to the pre-task baseline.

No automated tests added — the primitives are inert; manual verification covers the regression risk (which is "did the additive type changes break anything").

## Files changed

| File | Change |
|------|--------|
| `src/renderer/core/state/ComponentQueue.ts` | **new** — fire-and-forget + request/reply mailbox |
| `src/renderer/core/state/state.ts` | modified — `IState.subscribe` overloads; `TOneState.subscribe` dispatch on arity |
| `src/shared/persistence-v4.ts` | **new** — `PipeDescriptor`, `HostDescriptor`, `EditorDescriptor`, `PageDescriptor` (v4), `WindowState` (v4) |
| `src/renderer/editors/base/v4/IPageHost.ts` | **new** — forward-declared interface |
| `src/renderer/editors/base/v4/editor-traits.ts` | **new** — `CONTENT_HOST_TRAIT`, `IContentHostTrait` |
| `src/renderer/editors/base/v4/EditorStateStorage.ts` | **new** — `(name)`-only storage interface |
| `src/renderer/editors/base/v4/IContentHost.ts` | **new** — slimmed interface, dispose + getDescriptor |
| `src/renderer/editors/base/v4/EditorModel.ts` | **new** — abstract base class with three-phase lifecycle |
| `src/renderer/editors/base/v4/editorRegistry.ts` | **new** — simplified registry (empty in US-547) |
| `src/renderer/editors/base/v4/index.ts` | **new** — barrel re-exports |

### Files that stay untouched (so the legacy path keeps working)

- `src/renderer/editors/base/EditorModel.ts` (legacy base — every existing editor extends this)
- `src/renderer/editors/base/IContentHost.ts` (legacy interface — `TextFileModel`/`NoteItemEditModel` implement this)
- `src/renderer/editors/base/EditorStateStorageContext.tsx` (legacy `(id, name)` storage)
- `src/renderer/editors/registry.ts` (legacy registry — `register-editors.ts` populates it)
- `src/renderer/editors/types.ts` (legacy `EditorDefinition`, `EditorModule`)
- `src/renderer/editors/register-editors.ts` (legacy registration calls)
- `src/shared/types.ts` (legacy `EditorType`, `EditorView`, `IEditorState`, `PageDescriptor`, `WindowState`)
- All editor subclasses, `PageModel`, `PagesModel`, scripting facades, MCP handler, persistence loader

US-548 introduces `LegacyEditorAdapter` that bridges old subclasses into the new `EditorModel` interface and starts populating the new `editorRegistry`. US-547 just lays the empty table.

## Concerns

### Resolved during investigation

- **File layout (where does v4 live?)** — Decided: dedicated `src/renderer/editors/base/v4/` subfolder for editor-side primitives that have a renamed/incompatible v4 shape (`EditorModel`, `IContentHost`, `EditorStateStorage`, `editor-traits`, `editorRegistry`, `IPageHost`). Shared utilities with no legacy counterpart (`ComponentQueue`) ship at final paths from day one. Persistence schemas go to `src/shared/persistence-v4.ts`. US-559 deletes the legacy files and lifts v4/ contents up — explicit boundary makes that cleanup mechanical.
- **`EditorModel` class abstract?** — The mockup has the field marked abstract but the class is not. TypeScript requires `abstract` on the class to allow abstract members. Mark `EditorModel` abstract; no instances exist until US-548's `LegacyEditorAdapter` extends it.
- **`EditorModel.page` typing without circular import** — The new PageModel doesn't exist yet (lands in US-548). Use a forward-declared minimal interface `IPageHost` in v4/ that US-548 implements. Keeps US-547 self-contained.
- **TOneState selector overload — risk to existing callers?** — Existing signature is `subscribe: (listener: () => void) => () => void`. Hundreds of callers pass `() => void`. The overload is additive: the runtime check on `arguments.length >= 2` distinguishes selector-form from listener-only. Zero behavioral change for the listener-only path.
- **EditorStateStorage shape collision** — Legacy interface at `src/renderer/editors/base/EditorStateStorageContext.tsx` takes `(id, name)`. The v4 shape takes `(name)` only because the editor's id is captured at the closure level. Same name, different path; importers disambiguate. Acceptable; less ambiguous than renaming since US-559 will rename the v4 file to the canonical name anyway.
- **PageDescriptor name collision in v4 vs legacy** — Same approach as above: identical name in `src/shared/persistence-v4.ts` vs `src/shared/types.ts`. Path-disambiguated. US-548's dual-read explicitly imports both with `import { PageDescriptor as PageDescriptorV4 } from "../../shared/persistence-v4"` style aliases; US-559 deletes legacy.
- **ComponentQueue `use()` / `useRequest()` React-hook implementation** — Mockup body sketches `useEffect(() => this.subscribe(handler), [this])`, which would re-subscribe on every handler-change and lose the drain semantics. Use the standard handler-ref pattern: capture handler in a ref that updates on every render, subscribe once per `this`.
- **Unit tests for the new primitives?** — Codebase convention is to skip unit tests (no Jest harness in the repo; MCP `qa/` tests are integration-only). Verify ComponentQueue and the selector overload via the manual smoke test in Step 10. If a regression surfaces in US-548, add coverage there.
- **PageDescriptor field divergence** — Legacy has `editor: Partial<IEditorState>` and `hasSidebar: boolean`. v4 has `mainEditorId: string | null`, `editors: EditorDescriptor[]`, and `sidebar?: { open, width, activePanel }`. Field set is intentionally non-overlapping — US-548's dual-read detects v4 by the `schemaVersion: 4` discriminator on `WindowState`, not by inspecting `PageDescriptor` shape.

### Open — none

All decisions above are final for this task. Edge cases that surface during US-548 (e.g., the exact `IPageHost` surface needed by the adapter) can widen the interface in US-548 without rework here.

## Acceptance criteria

1. Every file in the **Files changed** table exists with the content described.
2. `npm run lint` passes with zero new warnings or errors.
3. The TypeScript compiler reports no errors when the renderer builds (Electron Forge dev server starts cleanly).
4. The new primitives have **no runtime consumers** — verified by grep:
   - `Grep "ComponentQueue"` returns hits only inside `src/renderer/core/state/ComponentQueue.ts` and `doc/`.
   - `Grep "from.*base/v4"` returns hits only inside `src/renderer/editors/base/v4/` and `doc/`.
   - `Grep "persistence-v4"` returns hits only inside `src/shared/persistence-v4.ts` and `doc/`.
5. The full smoke test from **Step 10** passes — app launches, opens / edits / switches / restarts / re-opens a file in every legacy editor type. No new console warnings.
6. The selector overload of `TOneState.subscribe` is callable from TypeScript (verified with a temporary `// @ts-expect-error`-free snippet in a scratch file or `model.ts` consumer, then removed before commit).
