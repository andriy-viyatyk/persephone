# Migration Plan — App Object Model

Core migration plan. Each phase has a detailed subdocument linked below.

## Approach

For each interface object, the workflow is:

1. **API Reference first** — Define the contract in `api-reference/`. This is the source of truth.
2. **Create interface + implementation** — In `/src/renderer/api/`. Start as a thin wrapper over existing stores/services.
3. **Wire into `app` root** — Register on the singleton `app` object.
4. **Expose to scripts** — Ensure the interface is accessible via `app.xxx` in script context.
5. **Switch consumers gradually** — Not mandatory immediately. Existing direct store imports keep working. Migrate consumers file-by-file over time.

**What we DON'T do:**
- No big-bang folder restructuring — code moves gradually alongside interface work
- No forced consumer migration — wrappers delegate to existing stores, so both paths coexist
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
| [0.infrastructure.md](0.infrastructure.md) | Planned |

---

### Phase 1: Independent Interfaces

No dependencies on other interface objects. Can be done in any order.

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 1 | `app.settings` — ISettings | [1.app-settings.md](1.app-settings.md) | Planned |
| 2 | `app.editors` — IEditorRegistry | [2.app-editors.md](2.app-editors.md) | Planned |
| 3 | `app.recent` — IRecentFiles | [3.app-recent.md](3.app-recent.md) | Planned |

---

### Phase 2: File System & Window

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 4 | `app.fs` — IFileSystem | 4.app-fs.md | Planned |
| 5 | `app.window` — IWindow | 5.app-window.md | Planned |

---

### Phase 3: UI & Shell

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 6 | `app.ui` — IUserInterface | 6.app-ui.md | Planned |
| 7 | `app.shell` — IShell + services | 7.app-shell.md | Planned |

---

### Phase 4: Core Workspace

| # | Interface | Doc | Status |
|---|-----------|-----|--------|
| 8 | `app.pages` — IPageCollection + IPage | 8.app-pages.md | Planned |

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
    ├── Phase 1a: app.settings (wraps appSettings store)
    ├── Phase 1b: app.editors (wraps editorRegistry)
    └── Phase 1c: app.recent (wraps recentFiles + filesModel for cache)
              │
              ├── Phase 2a: app.fs (wraps filesModel + IPC dialogs)
              └── Phase 2b: app.window (wraps IPC window calls)
                        │
                        ├── Phase 3a: app.ui (wraps dialog components)
                        └── Phase 3b: app.shell (wraps IPC + services)
                                  │
                                  └── Phase 4: app.pages + IPage (wraps pagesModel + PageModel)
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
| `/api/` | Object Model | Public interfaces + implementations | NEW. Wrappers + eventually store logic |
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
| `/store/files-store.ts` | `/api/fs.ts` (public parts) + `/platform/` (cache internals) | Phase 2a |
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
    ├── shell.ts                      # IShell root
    ├── file-search.ts                # IFileSearchService
    ├── version.ts                    # IVersionService
    ├── encryption.ts                 # IEncryptionService
    └── scripting.ts                  # IScriptingService

/src/renderer/editors/text/api.ts     # ITextEditor (near its editor)
/src/renderer/editors/browser/api.ts  # IBrowserEditor
/src/renderer/editors/grid/api.ts     # IGridEditor
```

### Principles

1. **Move code when implementing its interface** — not as a separate "cleanup" task
2. **Update imports in the same commit** — everything compiles at every step
3. **Don't force-move files you're not refactoring** — let the structure emerge
4. **Shared utilities** (formatting, parsing, etc.) consolidate into `/platform/utils/`
5. **Subfolder details** are defined in each phase's subdocument, not upfront

---

## Status Legend

| Status | Meaning |
|--------|---------|
| Planned | Document written, not started |
| In Progress | Implementation underway |
| Complete | Implemented, tested, API reference updated |

---

## Cross-references

- [Discussion log](../discussion.md) — All architectural decisions
- [Interface objects catalog](../interface-objects.md) — High-level descriptions
- [Functionality mapping](../functionality-mapping.md) — Feature → interface mapping
- [API reference](../api-reference/) — Detailed method-level documentation
