# App Object Model — Architecture Discussion

## Goal

Design a unified Object Model for js-notepad — a set of public interface objects that encapsulate all app functionality. This object model becomes the single API surface used by scripts, future AI integration, and eventually the app itself.

Any operation a user can perform through the UI should be achievable through the Object Model. Scripts and AI become first-class citizens that can fully drive the application.

## Motivation

**Current state:** The scripting system exposes a minimal `page` object with `content`, `language`, `editor`, `data`, and `grouped`. Scripts cannot create pages, close pages, navigate the browser, manipulate grid data, access settings, show UI dialogs, or interact with most of the application.

**Problems:**
- Scripts are limited to manipulating text content of a single page
- No programmatic way to orchestrate the application (open files, switch tabs, group pages)
- Future AI integration will need the same capabilities — if we build this for scripts, AI gets it for free
- Current stores (PagesModel, FilesModel, AppSettings) are internal implementation details directly consumed by React components — no stable public API
- Editor-specific functionality (browser navigation, grid sorting) is locked inside individual editor models with no external access

---

## Vision

### Consumers

The Object Model serves multiple consumers through the same interface:

```
┌──────────────────────────────────────────────┐
│              Consumers                        │
│                                               │
│  App UI    Scripts    AI Bot    Future Plugins │
│  (React)   (F5/Panel) (Claude)  (webview)     │
├──────────────────────────────────────────────┤
│           Object Model (Public API)           │
│                                               │
│  app.pages   app.settings   app.ui   app.fs   │
│  page.content   page.browser   page.grid      │
├──────────────────────────────────────────────┤
│         Implementation (Private)              │
│                                               │
│  Stores    Models    Services    IPC          │
├──────────────────────────────────────────────┤
│         Core Infrastructure                   │
│                                               │
│  State    Events    Registry    Bootstrap     │
└──────────────────────────────────────────────┘
```

### Core Principle

**Interface = Implementation boundary.** The Object Model is not just a wrapper — it defines the contract. All specific implementation is hidden behind interface objects. If different interface objects need to communicate, they do so through services that also expose interface objects.

---

## Proposed Interfaces

### 1. Root Object: `app`

The entry point. Available in scripts as a global, passed to AI as tool descriptions.

```typescript
interface IApp {
  readonly pages: IPageCollection;    // Page/tab management
  readonly settings: ISettings;       // App settings
  readonly ui: IUserInterface;        // Dialogs, notifications
  readonly fs: IFileSystem;           // File operations
  readonly version: string;           // App version
}
```

### 2. Page Collection: `app.pages`

Manages all open pages (tabs).

```typescript
interface IPageCollection {
  // Access
  readonly active: IPage | null;       // Currently active page
  readonly all: readonly IPage[];      // All open pages
  readonly count: number;

  // Find
  find(predicate: (page: IPage) => boolean): IPage | undefined;
  findByPath(filePath: string): IPage | undefined;
  findById(id: string): IPage | undefined;

  // Create / Open
  open(filePath: string): Promise<IPage>;          // Open file
  create(options?: CreatePageOptions): IPage;       // New empty page
  createWithEditor(editor: string): Promise<IPage>; // New page with specific editor

  // Navigation
  show(page: IPage): void;             // Activate page
  showNext(): void;                    // Next tab
  showPrevious(): void;                // Previous tab

  // Organization
  close(page: IPage): Promise<boolean>;    // Close (may prompt save)
  closeAll(): Promise<boolean>;
  group(left: IPage, right: IPage): void;  // Side-by-side
  ungroup(page: IPage): void;
  move(page: IPage, toIndex: number): void;

  // Events
  onPageOpened: IEvent<IPage>;
  onPageClosed: IEvent<IPage>;
  onActiveChanged: IEvent<IPage | null>;
}
```

### 3. Individual Page: `IPage`

Represents a single open tab. Extends the current `page` concept.

```typescript
interface IPage {
  // Identity
  readonly id: string;
  readonly type: string;           // "textFile" | "pdfFile" | "browserPage" | ...
  readonly filePath: string | null;
  readonly title: string;

  // State
  content: string;                 // Read/write text content
  language: string;                // Read/write language mode
  editor: string;                  // Read/write editor type
  readonly modified: boolean;      // Has unsaved changes?

  // Data
  readonly data: Record<string, any>;  // Persistent script data

  // Grouping
  readonly grouped: IPage | null;      // Grouped page (read-only access)
  readonly isGrouped: boolean;

  // Tab management
  readonly pinned: boolean;
  pin(): void;
  unpin(): void;

  // Actions
  close(): Promise<boolean>;
  save(): Promise<boolean>;
  saveAs(filePath: string): Promise<boolean>;

  // Editor-specific (async, lazy-loaded)
  asText(): Promise<ITextPage>;          // Text/Monaco specific
  asBrowser(): Promise<IBrowserPage>;    // Browser specific
  asGrid(): Promise<IGridPage>;          // Grid specific
  // ... other editor-specific interfaces
}
```

### 4. Editor-Specific Interfaces (Lazy-Loaded)

Loaded on demand. Provide editor-specific capabilities.

```typescript
// Text/Monaco editor operations
interface ITextPage extends IPage {
  readonly selections: ISelection[];
  readonly lineCount: number;
  find(text: string, options?: FindOptions): IMatch[];
  replace(search: string, replacement: string, options?: ReplaceOptions): number;
  insertAt(line: number, column: number, text: string): void;
  getLine(lineNumber: number): string;
  setSelection(start: IPosition, end: IPosition): void;
}

// Browser editor operations
interface IBrowserPage extends IPage {
  readonly currentUrl: string;
  readonly tabs: IBrowserTabCollection;
  navigate(url: string): Promise<void>;
  back(): void;
  forward(): void;
  reload(): void;
  // ...
}

// Grid editor operations
interface IGridPage extends IPage {
  readonly rows: any[];
  readonly columns: IColumn[];
  sort(column: string, direction?: "asc" | "desc"): void;
  filter(predicate: string): void;
  getCell(row: number, column: string): any;
  setCell(row: number, column: string, value: any): void;
  // ...
}
```

### 5. UI Interface: `app.ui`

Dialogs and user interaction.

```typescript
interface IUserInterface {
  showMessage(text: string, title?: string): Promise<void>;
  showConfirm(text: string, title?: string): Promise<boolean>;
  showInput(prompt: string, defaultValue?: string): Promise<string | null>;
  showNotification(text: string, type?: "info" | "warning" | "error"): void;
}
```

### 6. Settings: `app.settings`

```typescript
interface ISettings {
  get<T>(key: string): T;
  set<T>(key: string, value: T): void;
  readonly theme: string;
  // ... commonly used settings as typed properties
}
```

### 7. File System: `app.fs`

```typescript
interface IFileSystem {
  read(filePath: string, encoding?: string): Promise<string>;
  write(filePath: string, content: string, encoding?: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  delete(filePath: string): Promise<void>;
  showOpenDialog(options?: OpenDialogOptions): Promise<string | null>;
  showSaveDialog(options?: SaveDialogOptions): Promise<string | null>;
}
```

---

## Design Decisions

### 1. Interface Layer Strategy — Gradual Migration

Start with wrappers over existing stores (overlay approach), then for each new feature build through interface objects. Gradually move existing code to use interfaces. Eventually stores become private implementation details.

### 2. Synchronous vs. Asynchronous

- **Core properties synchronous** (content, language, editor) — keeps scripts simple
- **Actions async** (open, save, close) — returns Promises
- **Editor-specific interfaces async** (asText(), asBrowser()) — triggers lazy loading

### 3. Event System — Subscription

Keep existing `Subscription<D>` pattern. Group related events and expose through interface objects where applicable (e.g., `app.pages.onPageOpened`, `app.pages.onActiveChanged`).

### 4. AI Tooling — Flat Adapter over Object Model

Object Model is hierarchical (library-style with dot access for scripts). A separate flat "tool adapter" layer maps AI tool calls to object model methods. Same underlying implementation, different access pattern.

### 5. Root Naming — `app`

Root namespace is `app` (short, clear — it IS everything in js-notepad).

### 6. Scope — Start Small, Grow Organically

No fixed scope tier. Start with the most useful pieces and expand based on actual needs.

---

## Relationship to Existing Backlog

This architecture subsumes and expands several backlog items:
- **Script Service Enhancements** — hooks, toolbar builder, expanded context
- **Script Output Mode** — manual output mode
- **Custom Editor Plugins** — `jsNotepad` API injected into webviews

All of these become natural extensions of the Object Model.

---

## Migration Path (High-Level)

### Phase 1: Foundation
- Define core interfaces (IApp, IPageCollection, IPage, IUserInterface)
- Implement as wrappers over existing stores
- Wire into ScriptContext (alongside existing `page` object)
- Backward compatible — `page.content` still works

### Phase 2: Editor Interfaces
- Define ITextPage, IBrowserPage, IGridPage
- Implement async lazy-loading pattern
- Add `page.asText()`, `page.asBrowser()`, etc.

### Phase 3: Events & Hooks
- Add event system to interfaces
- Implement script hooks (onFileOpen, onLanguageChange, etc.)
- Enable reactive scripts

### Phase 4: AI Integration
- Design tool adapter that maps Object Model to AI tool descriptions
- Implement Claude integration using the Object Model
- AI can call any operation through the same interfaces

### Phase 5: Internal Migration (Optional, Long-term)
- Gradually move React components to use Object Model
- Stores become implementation details
- Single path for all operations

---

## Open Questions

(none currently — all resolved in discussion log)

---

## Discussion Log

### 2026-02-28 — Session 1

**Decisions made:**
- Migration: gradual (wrappers first → internal migration over time)
- Sync for core props, async for actions and editor-specific interfaces
- Event system: keep Subscription pattern, group and expose through interface objects
- AI: flat tool adapter layer over hierarchical object model
- Root name: `app`
- Scope: start small, grow based on actual needs

### 2026-02-28 — Session 2

**Q1: `page` variable in scripts — is it an IPage?**

Yes. `page` in scripts IS an `IPage` instance — the same object accessible through `app.pages.active`. It's just a convenience context variable pointing to the page the script is running from. Not all scripts run in context of a page (e.g., global/automated scripts), in which case `page` is `null`/`undefined`.

**Q2: Where does the Object Model code live?**

Core Object Model code goes in a separate folder. But editor-specific interfaces (like `IBrowserPage`) live alongside their editor implementation (e.g., in the `browser/` folder). Interface type declarations (`.d.ts` or a declarations file) are collected into one place and loaded into Monaco for autocompletion — so scripts get full IntelliSense for `app.*`, `page.*`, etc.

**Q3: Renderer ↔ Main process communication**

Organize as a set of "renderer API" ↔ "backend controller" service pairs. Each service encapsulates a specific area of renderer-main interaction with:
- **Methods** — renderer calls backend controller (request/response)
- **Renderer events** — main process can subscribe to
- **Backend events** — renderer can subscribe to (Subscription-style)

Each such service pair has its own interface object. This formalizes the current ad-hoc IPC into typed, discoverable service contracts.

```
┌─────────────────────┐         ┌─────────────────────┐
│   Renderer API      │  IPC    │  Backend Controller  │
│   (interface obj)    │ ◄────► │  (main process)      │
│                     │         │                      │
│  • methods          │         │  • handlers          │
│  • renderer events  │         │  • backend events    │
└─────────────────────┘         └─────────────────────┘
```

**Q4: Error handling strategy**

Mixed approach, tailored per method:
- **Methods that should always work** → throw on unexpected errors
- **Methods with expected failure modes** → return nullable result, optionally with error callback parameter
- **Interface properties** → internal `lastError` property for troubleshooting
- **All methods** → fully documented so scripts/AI know what to expect

Documentation is the key — every interface object, property, and method must document its error behavior.

### 2026-02-28 — Session 3

**Functionality audit and gap resolution:**

1. **Downloads** → `app.downloads` (IDownloads). Revised in US-049: downloads are global infrastructure (main process managed, shared across all windows), not editor-specific. `IDownloads` is a standalone interface on `app`, initialized in `app.initServices()`.

2. **Recent files** → `app.recent` (IRecentFiles). Small interface: list, add, remove, clear.

3. **Sidebar folders** → subinterface of `app.ui` (`app.ui.folders`).

4. **File search, version/updates, encryption, scripting** → services under `app.shell`:
   - `app.shell.fileSearch` — search file content across folders
   - `app.shell.version` — app version, runtime info, update check
   - `app.shell.encryption` — encrypt/decrypt content
   - `app.shell.scripting` — execute scripts programmatically (for AI bot)

5. **Shell integration** → `app.shell` (IShell) — OS-level operations: showInFolder, openExternal, spawn process, register as default browser.

6. **Language mapping** → part of `app.editors` for now.

7. **About page, Settings page** → simple IPage instances, no editor-specific interface. They use services directly.

**New interface objects added:** `app.recent`, `app.shell` (with 4 sub-services), `ITodoEditor`, `ILinksEditor`.

See [interface-objects.md](interface-objects.md) and [functionality-mapping.md](functionality-mapping.md) for full details.

### 2026-02-28 — Session 4

**Migration plan and API reference started.**

Migration order follows dependency chain (bottom-up):
1. Phase 0: Infrastructure (`/src/renderer/api/` folder, base types, wire `app` global)
2. Phase 1: Independent interfaces (`app.settings`, `app.editors`, `app.recent`)
3. Phase 2: File system & window (`app.fs`, `app.window`)
4. Phase 3: UI & shell (`app.ui`, `app.shell` + sub-services)
5. Phase 4: Core workspace (`app.pages` + `IPage` — the big one)
6. Phase 5: Editor-specific interfaces (lazy, one at a time)
7. Phase 6: AI integration (tool adapter)
8. Phase 7: Monaco autocompletion

API reference folder created at `api-reference/`. First two docs written: `settings.md` and `fs.md`.

See [migration/](migration/) and [api-reference/](api-reference/) for details.

### 2026-02-28 — Session 5

**Migration documentation restructured into `migration/` folder.**

Old `migration-plan.md` replaced by hierarchical `migration/` folder with:
- `README.md` — core plan, approach, phase links, dependency graph
- `0.infrastructure.md` — Phase 0 detailed plan
- `1.app-settings.md` — Phase 1a detailed plan
- `2.app-editors.md` — Phase 1b detailed plan
- `3.app-recent.md` — Phase 1c detailed plan
- Further subdocuments to be written as we approach each phase

**Circular reference avoidance strategy:**

Each API wrapper imports its backing store directly, never through `app.ts`. The `app.ts` is a leaf assembler — it imports all wrappers, nothing imports it (except bootstrap and ScriptContext). Dependency arrows all point one way. Cross-interface calls go through backing stores, not through `app`. This makes circular references structurally impossible for Phases 0–2 and manageable for later phases.

**Async initialization:**

`app.init()` — explicit async method that completes before React renders. Uses `Promise.all` to run independent initialization in parallel (read settings, resolve paths, load recent files). Bootstrap calls `await app.init()` then starts React. This is an improvement over current fire-and-forget store init — guarantees readiness, prevents race conditions.

**Folder restructuring strategy:**

Code moves alongside interface implementation, not as a separate task. Target structure has 4 clear layers:
- `/api/` — Object Model (interfaces + implementations) — NEW
- `/editors/` — Editor implementations — STAYS
- `/ui/` — All React presentation — MERGES `/app/` + `/components/` + `/features/`
- `/platform/` — Infrastructure — MERGES `/core/` + remaining `/store/` internals
- `/theme/`, `/setup/` — STAY

Old folders (`/store/`, `/core/`, `/features/`, `/app/`) gradually empty as code migrates. Import updates happen in the same commit as code moves.

See [migration/README.md](migration/README.md) for full folder mapping table.

**Page lifecycle documentation:**

Defined the complete lifecycle of a page (`IPage`) and documented it in [api-reference/page-lifecycle.md](api-reference/page-lifecycle.md). Lifecycle states:

1. **Creating** — model instantiated, no file access yet
2. **Restoring** — content loaded, file watcher started, caches read
3. **Attaching** — page added to workspace, subscriptions wired
4. **Active** — normal operation (editing, file monitoring, cache persistence)
5. **Saving** — write to disk, clear cache, recreate watcher if new path
6. **Closing** — prompt save, dispose (watcher → editor → script → nav panel → cache), remove from workspace
7. **Moving between windows** — serialize, transfer via IPC, reconstruct in target window (no dispose on send)
8. **App quit** — flush all caches, save window state, signal ready (no dispose)

Proposed lifecycle events for `IPage` and `IPageCollection` — enables reactive scripts and AI agent visibility. See the lifecycle document for full event list.

**Application lifecycle documentation:**

Documented the full application lifecycle in [api-reference/app-lifecycle.md](api-reference/app-lifecycle.md). Key areas:

1. **Main process boot** — single-instance lock → app ready → IPC setup → services → restore windows → tray → pipe server
2. **Window creation** — BrowserWindow with position restore → event subscriptions → load renderer HTML → whenReady promise
3. **Renderer boot** — current scattered init (fire-and-forget) vs new centralized `app.init()` with staged parallel initialization
4. **Window lifecycle states** — Creating → Initializing → Active → Closing/Hidden/Destroyed
5. **Window close flow** — eBeforeQuit → save state → setCanQuit → last window hides (tray mode) vs close
6. **Multi-window coordination** — windows communicate only via main process IPC, page transfer serializes and reconstructs
7. **Settings sync** — shared file on disk + FileWatcher per window (eventual consistency)
8. **Named pipe server** — single-instance coordination on Windows

Key insight for `app.init()`: each window has its own `app` object (same as stores are per-window). `app.init()` runs in 3 stages: platform (paths) → services (settings, recent) → workspace (pages). All independent work parallelized.

See [api-reference/app-lifecycle.md](api-reference/app-lifecycle.md) for full diagrams and flow descriptions.

**Type declarations — single source for TypeScript + Monaco:**

Interface declarations (`.d.ts` files) serve three purposes from a single source:
1. **TypeScript compilation** — implementations `import type` and `implements` these interfaces, compiler enforces correctness
2. **Monaco autocompletion** — build step copies `.d.ts` files to `assets/editor-types/`, loaded via `addExtraLib()` for script IntelliSense
3. **Documentation** — JSDoc comments become hover tooltips in the script editor

Source of truth: `/src/renderer/api/types/` folder with separate `.d.ts` files per interface (common.d.ts, app.d.ts, settings.d.ts, etc.). The `/types/` folder contains ONLY pure declarations — no implementation code. Helper utilities like `wrapSubscription` live in `/src/renderer/api/internal.ts`.

The existing `configure-monaco.ts` loading mechanism via `app-asset://` protocol stays unchanged — only the source of the files changes. A build step copies from `api/types/` to `assets/editor-types/` and auto-generates `_imports.txt`.

This replaces the current hand-maintained `assets/editor-types/` files that are not type-checked and can drift from implementations. See [migration/0.infrastructure.md](migration/0.infrastructure.md) for implementation details.

**Disposable pattern — unified resource cleanup:**

Adopted `IDisposable` as the universal cleanup interface for the Object Model. Currently the codebase uses 4 different patterns for cleanup: `.dispose()` methods, `.unsubscribe()` on subscription objects, calling returned functions directly, and Monaco's `IDisposable`. We unify all of these under one contract: `IDisposable { dispose(): void }`.

Key design decisions:
- `IDisposable` defined in `types/common.d.ts` — part of the public API, visible in Monaco autocompletion
- `IEvent.subscribe()` returns `IDisposable` (not `() => void` or `{ unsubscribe() }`) — every subscription is a disposable
- `DisposableCollection` in `internal.ts` — groups multiple disposables, bulk cleanup in one `.dispose()` call. Interface implementations use this to track all their resources
- `wrapSubscription()` adapter bridges existing `Subscription<T>` (returns `{ unsubscribe() }`) to the new `IDisposable` return type
- Script auto-cleanup: ScriptContext collects all disposables created during script execution, auto-disposes when script ends. Prevents leaks from user scripts
- `app` object is NOT disposable (lives for window lifetime). `IPage`, editor interfaces, and subscription-holding objects ARE disposable
- Matches Monaco's own `IDisposable` — already familiar to the codebase

This is a Phase 0 decision because it affects `IEvent` signatures from day one. Adding it later would require changing APIs.

See [migration/0.infrastructure.md](migration/0.infrastructure.md) for implementation details.

**Pre-migration: Enhanced Model-View pattern (Phase -1):**

Before building API interfaces, enhance the existing `TComponentModel` with two new primitives so that Views become pure render functions with zero logic:

1. **`this.effect(callback, depsFactory?)`** — useEffect replacement in the Model. Registers a side effect that re-runs when dependencies change. Cleanup is automatic on deps change and unmount. No deps = runs once. This eliminates all `useEffect(() => { model.init(); return () => model.dispose(); }, [])` boilerplate from Views.

2. **`this.memo(computeFn, depsFactory)`** — useMemo replacement in the Model. Returns a cached value that recomputes only when dependencies change. Eliminates `useMemo` from Views.

Both built on a shared `depsChanged(prev, next)` function (shallow comparison, same algorithm as React).

Additionally, `useComponentModel` auto-calls `init()` on first use and `dispose()` on unmount — no more lifecycle boilerplate in Views.

**Migration scope:** 12 page editor models + 3 app shell models. Skip reusable UI components (data grid, tree view, etc.) — they work fine and aren't on the API critical path. Inventory found 21 TComponentModel classes total, 6 PageModel subclasses, and 6 standalone TModel classes.

**Key insight:** ImageViewModel (3 useEffects in View) is the best demonstration of `this.effect()` value. MarkdownViewModel (useMemo for syntax highlighting) is the best demonstration of `this.memo()` value.

See [migration/-1.premigration.md](migration/-1.premigration.md) for full task list and component inventory.
