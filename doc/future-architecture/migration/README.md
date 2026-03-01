# Migration Plan — App Object Model

Core migration plan. Each phase has a detailed subdocument linked below.

## Goal

**Refactor the application to the new architecture.** The App Object Model (`app.settings`, `app.fs`, `app.window`, etc.) is the target code structure — not a scripting API layer on top of old code. Scripting readiness is a natural byproduct, not the primary goal.

This means: when implementing an interface, **move the actual logic** into the new location, **update all consumers** to use the new interface, and **remove the old module** (or slim it down). No thin wrappers that delegate back to old code — the interface IS the implementation.

## Approach

For each interface object, the workflow is:

1. **Define the interface** — In `/src/renderer/api/types/`. Only include methods required by existing application logic. Don't add methods "for future scripting" — refactor what exists.
2. **Move implementation code** — Into `/src/renderer/api/`. The actual logic moves here from old locations (`/store/`, `/core/`, etc.). The interface file IS the implementation, not a wrapper.
3. **Update all consumers** — Switch every import that used the old module to use the new interface. Do this in the same phase, not "gradually later".
4. **Remove or slim the old module** — If all logic moved out, delete the old file. If some unrelated logic remains, keep just that.
5. **Wire into `app` root** — Register on the singleton `app` object.

**What we DON'T do:**
- No thin wrappers that delegate to old code — move the logic itself
- No new methods "for future scripting" — only refactor existing functionality
- No big-bang folder restructuring — code moves gradually alongside interface work
- No breaking changes to existing `page` object in scripts — backward compatible

**Implementation order** follows the dependency chain (bottom-up): start with interfaces that depend on nothing, work up to `app.pages` which depends on everything.

---

## Phases

### Phase -1: Pre-Migration — Enhanced Model-View

**Goal:** Add `effect()` and `memo()` primitives to `TComponentModel` so Views become pure render functions. Migrate page editors and app shell to the new pattern before building API interfaces on top.

| Doc | Status |
|-----|--------|
| [-1.premigration.md](-1.premigration.md) | Complete |

---

### Phase 0: Infrastructure

**Goal:** Folder structure, base types, empty `app` singleton, wired into scripts.

| Doc | Status |
|-----|--------|
| [0.infrastructure.md](0.infrastructure.md) | Complete |

---

### Phase 1: Independent Interfaces

No dependencies on other interface objects. Can be done in any order.

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 1 | `app.settings` — ISettings | [1.app-settings.md](1.app-settings.md) | Complete |
| 2 | `app.editors` — IEditorRegistry | [2.app-editors.md](2.app-editors.md) | Complete |
| 3 | `app.recent` — IRecentFiles | [3.app-recent.md](3.app-recent.md) | Complete |

**Revised (US-046):** `app.settings` and `app.recent` — logic moved from old stores into `/api/` implementations, all consumers updated, old stores deleted. `app.editors` — confirmed as correct facade pattern (complex object, no code movement needed).

---

### Phase 2: File System & Window

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 4 | `app.fs` — IFileSystem | [4.app-fs.md](4.app-fs.md) | Complete |
| 5 | `app.window` — IWindow | [5.app-window.md](5.app-window.md) | Complete |

**Revised (US-047):** Full absorption — `nodeUtils` file I/O + `filesModel` data/cache/path ops merged into `api/fs.ts`. `windowIndex` moved to `IWindow`. `uuid()` replaced with `crypto.randomUUID()`. `files-store.ts` and `node-utils.ts` deleted. `watchFile`/`getFileStats` inlined into `file-watcher.ts`. 18 consumers updated.

---

### Phase 3: UI & Shell

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 6 | `app.ui` — IUserInterface | [6.app-ui.md](6.app-ui.md) | Complete |
| 7 | `app.shell` — IShell + services | [7.app-shell.md](7.app-shell.md) | Complete |

---

### Phase 4: Core Workspace

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 8 | `app.pages` — IPageCollection + IPage | 8.app-pages.md | Planned |

**Note:** Phase 4 should also address the **bootstrap lifecycle**. Currently `pagesModel.init()` runs at module load time (fragile). In Phase 1 we discovered that `app.ts` must use lazy `require()` imports for interface wrappers — static imports pull the store chain into the initial chunk and break page state restoration. Phase 4 should introduce an explicit window lifecycle: `app.init()` → main bundle loads → `app.pages.restore()` → `api.windowReady()`, replacing the current module-level `pagesModel.init()`.

---

### Phase 5: Editor-Specific Interfaces

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 9 | `page.asText()` — ITextEditor | 9.text-editor.md | Planned |
| 10 | `page.asBrowser()` — IBrowserEditor | 10.browser-editor.md | Planned |
| 11 | `page.asGrid()` — IGridEditor | 11.grid-editor.md | Planned |
| 12 | Other editors (notebook, todo, links, markdown) | 12.other-editors.md | Planned |

---

### Phase 6: AI Integration

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 13 | Tool adapter + Claude integration | 13.ai-integration.md | Planned |

---

### Phase 7: Monaco Autocompletion

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 14 | Aggregated `.d.ts` for scripts IntelliSense | 14.monaco-autocompletion.md | Planned |

---

## Dependency Graph

```
Phase -1: Pre-Migration (enhance TComponentModel with effect/memo, migrate page editors)
    │
Phase 0: Infrastructure (base types, app singleton, ScriptContext wiring)
    │
    ├── Phase 1a: app.settings (absorbs appSettings store logic)
    ├── Phase 1b: app.editors (absorbs editorRegistry logic)
    └── Phase 1c: app.recent (absorbs recentFiles logic)
              │
              ├── Phase 2a: app.fs (absorbs nodeUtils file I/O + filesModel paths)
              └── Phase 2b: app.window (absorbs window IPC + event subscriptions)
                        │
                        ├── Phase 3a: app.ui (absorbs dialog components)
                        └── Phase 3b: app.shell (absorbs encryption, version services)
                                  │
                                  └── Phase 4: app.pages + IPage (absorbs pagesModel + PageModel)
                                            │
                                            ├── Phase 5a: ITextEditor
                                            ├── Phase 5b: IBrowserEditor
                                            ├── Phase 5c: IGridEditor
                                            └── Phase 5d: Other editors
                                                      │
                                                      ├── Phase 6: AI tool adapter
                                                      └── Phase 7: Monaco autocompletion
```

---

## Folder Restructuring Strategy

Code moves **alongside interface implementation**, not as a separate task. When implementing an interface, we move the related code into the new structure and update all imports in the same commit — so everything compiles and is testable at every step.

As structured code moves out, the remaining old folders (`/store/`, `/core/`, `/features/`) gradually empty. What's left becomes visible and we can decide: does it fit into an existing interface, or do we need a new one?

### Code Movement During Each Phase

Old modules are absorbed **during** the phase that implements their interface — not deferred to a cleanup task:

- **`appSettings`** (Phase 1a) → logic moves into `/api/settings.ts`. All 14 consumers updated.
- **`editorRegistry`** (Phase 1b) → logic moves into `/api/editors.ts`. Consumers updated.
- **`recentFiles`** (Phase 1c) → logic moves into `/api/recent.ts`. Consumers updated.
- **`nodeUtils`** (Phase 2a) → Everything absorbed. File I/O (`loadStringFile`, `saveStringFile`, `fileExists`, `deleteFile`, `preparePath`) into `/api/fs.ts`. `watchFile`/`getFileStats` into `/core/services/file-watcher.ts`. `uuid()` eliminated (replaced with `crypto.randomUUID()`). `node-utils.ts` deleted.
- **`filesModel`** (Phase 2a) → Everything absorbed into `/api/fs.ts`: init/wait, path resolution (`dataPath`/`cachePath`/`windowIndex`), all data/cache/binary operations. `files-store.ts` deleted.
- **`encryption.ts`** (Phase 3b) → moves into `/api/shell/encryption.ts`.

Goal: after each phase, old modules are slimmer or gone. No pass-through wrappers remain.

### Current Structure

```
/src/renderer/
  /app/           → App shell (MainPage, Pages, RenderEditor, EventHandler)
  /components/    → Reusable UI (TreeView, data-grid, form, layout, overlay, virtualization)
  /core/          → Mixed bag: state primitives + services + utilities
  /editors/       → Editor implementations (17 editors, each in own folder)
  /features/      → App features (tabs, sidebar, dialogs, navigation)
  /setup/         → Monaco configuration
  /store/         → All stores (pages, files, settings, recent, downloads, etc.)
  /theme/         → Color tokens, theme definitions
  /types/         → Type definitions
```

### Target Structure

```
/src/renderer/
  /api/           → Object Model: interfaces + implementations
  /editors/       → Editor implementations (stays, already well-organized)
  /ui/            → All React presentation: app shell, components, features
  /platform/      → Infrastructure: state primitives, services, utilities
  /theme/         → Styling (stays)
  /setup/         → Monaco configuration (stays)
```

**4 clear layers**, each file belongs to exactly one:

| Folder | Layer | Purpose | What moves here |
|--------|-------|---------|-----------------|
| `/api/` | Object Model | Public interfaces + implementations | NEW. Actual logic moves here from old stores/services |
| `/editors/` | Editors | Editor implementations | STAYS. Already well-organized |
| `/ui/` | Presentation | React components, app shell, features | MERGES: `/app/` + `/components/` + `/features/` |
| `/platform/` | Infrastructure | State primitives, IPC, services, utilities | MERGES: `/core/` + remaining `/store/` internals |
| `/theme/` | Design | Color tokens, theme definitions | STAYS |
| `/setup/` | Config | Monaco configuration | STAYS |

### How Old Folders Map to New

| Old | → New | When |
|-----|-------|------|
| `/store/app-settings.ts` | `/api/settings.ts` (or internal to it) | Phase 1a |
| `/store/recent-files.ts` | `/api/recent.ts` | Phase 1c |
| `/store/files-store.ts` | Deleted — fully absorbed into `/api/fs.ts` | Phase 2a (US-047) |
| `/store/pages-store.ts` | `/api/pages.ts` + `/api/page.ts` | Phase 4 |
| `/store/downloads-store.ts` | stays near browser editor | Phase 5b |
| `/store/page-factory.ts` | `/api/pages.ts` (internal) | Phase 4 |
| `/store/page-actions.ts` | `/api/` (distributed to relevant interfaces) | Phase 4 |
| `/core/state/` | `/platform/state/` | Phase 0 or 1 |
| `/core/services/scripting/` | `/platform/services/scripting/` | Phase 1 |
| `/core/services/encryption.ts` | `/api/shell/encryption.ts` | Phase 3b |
| `/core/services/file-watcher.ts` | `/platform/services/` | Phase 2a |
| `/core/utils/` | `/platform/utils/` | Phase 0 or 1 |
| `/app/MainPage.tsx` | `/ui/app/MainPage.tsx` | Phase 3+ |
| `/app/RenderEditor.tsx` | `/ui/app/RenderEditor.tsx` | Phase 3+ |
| `/components/*` | `/ui/components/*` | When touching those files |
| `/features/tabs/` | `/ui/tabs/` | Phase 4 |
| `/features/sidebar/` | `/ui/sidebar/` | Phase 3 |
| `/features/dialogs/` | `/ui/dialogs/` | Phase 3a |
| `/features/navigation/` | `/ui/navigation/` | Phase 3+ |

### `/api/` Subfolder Detail

```
/src/renderer/api/
├── types/                            # Interface declarations (source of truth)
│   ├── index.d.ts                    # Global declarations (app, page) for scripts
│   ├── common.d.ts                   # Shared types: IEvent<T>
│   ├── app.d.ts                      # IApp interface
│   ├── settings.d.ts                 # ISettings interface
│   ├── editors.d.ts                  # IEditorRegistry, IEditorInfo interfaces
│   ├── recent.d.ts                   # IRecentFiles interface
│   ├── fs.d.ts                       # IFileSystem interface
│   ├── window.d.ts                   # IWindow interface
│   ├── ui.d.ts                       # IUserInterface interface
│   ├── pages.d.ts                    # IPageCollection interface
│   ├── page.d.ts                     # IPage interface
│   └── shell.d.ts                    # IShell + sub-service interfaces
├── internal.ts                       # Implementation utilities (wrapSubscription, etc.)
├── app.ts                            # Root IApp singleton with async init
├── settings.ts                       # ISettings implementation
├── editors.ts                        # IEditorRegistry implementation
├── recent.ts                         # IRecentFiles implementation
├── fs.ts                             # IFileSystem implementation
├── window.ts                         # IWindow implementation
├── ui.ts                             # IUserInterface implementation
├── pages.ts                          # IPageCollection implementation
├── page.ts                           # IPage implementation
└── shell/                            # IShell + sub-services
    ├── index.ts                      # Shell class (IShell), composes sub-modules
    ├── encryption.ts                 # IEncryptionService (absorbed from core/services/)
    ├── version.ts                    # IVersionService (wraps IPC)
    ├── shell-calls.ts                # Direct OS calls (openExternal)
    ├── file-search.ts                # IFileSearchService (deferred)
    └── scripting.ts                  # IScriptingService (deferred)

/src/renderer/editors/text/api.ts     # ITextEditor (near its editor)
/src/renderer/editors/browser/api.ts  # IBrowserEditor
/src/renderer/editors/grid/api.ts     # IGridEditor
```

### Principles

1. **Move code when implementing its interface** — not as a separate "cleanup" task
2. **Update imports in the same commit** — everything compiles at every step
3. **Don't force-move files you're not refactoring** — let the structure emerge
4. **Keep logic in focused modules** — don't merge unrelated concerns into one super-module. Use subfolders when an interface composes distinct, independent concerns. See [Module Organization](#module-organization--keep-logic-in-focused-modules) in Design Decisions.
5. **Shared utilities** (formatting, parsing, etc.) consolidate into `/platform/utils/`
6. **Subfolder details** are defined in each phase's subdocument, not upfront

---

## Status Legend

| Status | Meaning |
|--------|---------|
| Planned | Document written, not started |
| In Progress | Implementation underway |
| Revision Needed | Interface created as thin wrapper; needs code movement + consumer migration |
| Complete | Logic moved, consumers updated, old module removed/slimmed, API reference updated |

---

## Design Decisions

### React Hooks and Script Safety

**Problem:** Some interface implementations expose `.use()` methods (React hooks from Zustand stores). These must not be called from scripts — React throws an error if hooks are called outside a component render.

**Decision:** Hide from IntelliSense, don't guard at runtime.

- `.d.ts` files (public interface for scripts) do NOT include `.use()` methods
- Implementation classes keep `.use()` for internal React component use
- If a script calls `.use()` despite no IntelliSense, React's own error fires — the script gets an exception, the app does not crash
- No runtime guard flag — a global flag would break during async script execution (`await` yields to event loop, app renders, flag is still set)

### Interface Scope

**Principle:** Interfaces include only methods required by existing application logic. Do not add methods "for future scripting" or "nice to have". Each method on an interface should have at least one existing consumer in the codebase.

New script-only methods (e.g., `showMessage()`, `showPick()`) can be added after the migration is complete, as separate enhancements.

### Thin Wrappers for Complex Objects

**Not all code should be moved into the interface implementation.** Complex objects like editors have heavy models with many internal methods. For these:

- The interface exposes only what is currently used by **other parts of the code** (cross-component API)
- Internal logic stays encapsulated inside the editor/model — the interface is a thin public API over a complex internal implementation
- This is different from the "thin wrapper" anti-pattern: the wrapper delegates to code in the **same module/folder**, not to a distant old store

Example: `IEditorRegistry` exposes `getAll()`, `getById()`, `resolve()` — what other code needs. The editor registration machinery, lazy loading, and module resolution stay internal to the editors folder.

Later, when adding scripting support, we decide what additional methods to expose. But during migration: only what's needed now.

### Module Organization — Keep Logic in Focused Modules

**Don't merge everything into one large implementation file.** When an interface absorbs logic from existing modules, keep logically distinct concerns in separate files. The interface implementation composes them.

**Principles:**

1. **Keep already-consolidated logic in its own module** — If a source module encapsulates a specific concern (e.g., encryption, version checking), move it to a dedicated file under the interface folder, not into a catch-all implementation file.
2. **Split by area of responsibility** — Each module should encapsulate code for a specific, logically related functionality. Individual modules stay small and focused.
3. **Don't create super-modules** — Mixing unrelated concerns (crypto internals + IPC wrappers + Electron calls) in one file creates a mess. Separate them.
4. **Interface implementation composes sub-modules** — The `index.ts` (or root implementation file) imports from focused sub-modules and wires them into the interface. It can be a thin composition layer or re-export.

**Example: `app.shell` (IShell)**

```
api/shell/
├── encryption.ts      # AES-GCM crypto logic (absorbed from core/services/encryption.ts)
├── version.ts         # IPC wrappers for version/update service
├── shell-calls.ts     # Direct Electron OS calls (openExternal)
└── index.ts           # Shell class: composes encryption + version + shell-calls → IShell
```

`encryption.ts` stays self-contained — same crypto logic, same internal helpers, just a new home. `index.ts` creates the `Shell` class that implements `IShell` by composing `EncryptionService`, `VersionService`, and the `openExternal` call. Consumers import `{ shell }` from `api/shell` — they don't know about the internal structure.

**Counter-example: `app.fs` (IFileSystem)**

`api/fs.ts` is a single file because all its functionality (file read/write, path resolution, data/cache operations) is tightly interrelated — they share private fields (`_dataPath`, `_cachePath`, `_windowIndex`) and the init/wait pattern. Splitting would create artificial boundaries between code that naturally belongs together.

**When to use a subfolder vs a single file:**

| Structure | When to use |
|-----------|------------|
| Single file (`api/foo.ts`) | All functionality is tightly coupled, shares private state, or is small enough (~200-300 lines) |
| Subfolder (`api/foo/`) | Interface composes distinct, independent concerns that don't share internal state |

---

## Cross-references

- [Discussion log](../discussion.md) — All architectural decisions
- [Interface objects catalog](../interface-objects.md) — High-level descriptions
- [Functionality mapping](../functionality-mapping.md) — Feature → interface mapping
- [API reference](../api-reference/) — Detailed method-level documentation
