# Pages Architecture

How pages (tabs) work in persephone. Covers the window bootstrap lifecycle,
page lifecycle, action taxonomy, and internal submodel structure.

**Source code:** [`/src/renderer/api/pages/`](../../src/renderer/api/pages/)
**Type declarations:** [`/src/renderer/api/types/pages.d.ts`](../../src/renderer/api/types/pages.d.ts)

---

## 1. Window Bootstrap Lifecycle

The renderer initializes in a strict 3-layer sequence before React renders.
This ensures all systems are ready before the UI appears — no race conditions,
no flash of empty state.

```mermaid
graph TD
    A["App Start"] -->|Electron loaded| B["renderer.tsx bootstrap()"]
    B -->|Parallel load| C["import Renderer Code<br/>+ app.init"]
    C -->|Side effects| C1["configure-monaco<br/>register-editors"]
    B -->|await| D["app.initServices<br/>Layer 1"]
    D -->|Load 8 APIs| D1["settings, editors, recent,<br/>fs, window, shell, ui, downloads"]
    D1 --> E["app.initPages<br/>Layer 2"]
    E -->|Phase 1: Restore| E1["app.pages.restore<br/>Load persisted pages"]
    E1 -->|Phase 2: HandleArgs| E2["app.pages.handleArgs<br/>--file, --url, --diff"]
    E2 -->|Phase 3: Ready| F["app.initEvents<br/>Layer 3"]
    F -->|Initialize services| F1["GlobalEventService<br/>KeyboardService<br/>WindowStateService<br/>RendererEventsService"]
    F1 --> G["api.windowReady<br/>Signal window ready"]
    G -->|React renders| H["MainPage<br/>Tabs + Active Editor"]
    H -->|User interactions| I["Page operations"]

    E1 -->|✓ Success| E1a["Pages loaded from storage"]
    E1 -->|✗ Error| E1b["Notify user, create empty"]
    E1a --> E2
    E1b --> E2
    E2 -->|File args| E2a["Open requested files"]
    E2 -->|URL args| E2b["Open browser with URL"]
    E2a --> F
    E2b --> F
    E2 -->|No args| F

    style B fill:#fff3e0
    style D fill:#fff3e0
    style E fill:#fff3e0
    style F fill:#fff3e0
    style H fill:#c8e6c9
```

**Layer 1 — Services** (`app.initServices()`): Loads 8 core APIs in parallel via dynamic imports: settings, editors, recent, fs, window, shell, ui, downloads. After this layer, the notification system is ready for error reporting.

**Layer 2 — Pages** (`app.initPages()`): Restores pages from persistent storage, then processes CLI arguments (`--file`, `--url`, `--diff`). Ensures at least one page exists.

**Layer 3 — Events** (`app.initEvents()`): Initializes 4 internal event services (GlobalEventService, KeyboardService, WindowStateService, RendererEventsService) that subscribe to DOM events and IPC channels.

**Ready signal** (`api.windowReady()`): Tells the main process this window is fully initialized. The main process waits for this before sending IPC events like `eMovePageIn` (page transfer between windows). This is critical for multi-window operations.

**Implementation:** [`/src/renderer.tsx`](../../src/renderer.tsx), [`/src/renderer/api/app.ts`](../../src/renderer/api/app.ts)

---

## 2. Page Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> Created: newPageModel(...)

    Created --> Initialized: restore() async
    Created --> [*]: error

    Initialized --> Active: show(pageId)
    Initialized --> Active: user activates tab

    Active --> Inactive: show(other)
    Inactive --> Active: show(pageId)

    Active --> Disposed: close()
    Inactive --> Disposed: close()

    Disposed --> [*]: cleanup complete

    note right of Created
        - Page object created
        - No data loaded yet
        - Model not initialized
    end note

    note right of Initialized
        - Data loaded from file/storage
        - Monaco editor ready
        - Page model ready to use
    end note

    note right of Active
        - Page visible in UI
        - User can interact
        - Subscriptions active
    end note

    note right of Disposed
        - Cleanup in progress
        - Resources freed
        - Subscriptions removed
    end note
```

**Key transitions:**
- **Created → Initialized:** `restore()` loads content from file or persistent storage. For text files this reads content through the content pipe (primary pipe for source, cache pipe for unsaved modifications). Pipe state (`IPipeDescriptor`) is restored from persisted page state. If no pipe exists (legacy state), one is created from `filePath`.
- **Initialized ↔ Active:** Controlled by `show(pageId)`. Only one page is active at a time (or two when grouped side-by-side).
- **Active/Inactive → Disposed:** `close()` prompts save if modified, then disposes all resources (content pipes, editor model, script context, navigation panel, cache files).

**Portal-based rendering:** Pages are rendered through `AppPageManager` (`src/renderer/components/page-manager/AppPageManager.tsx`) using React portals with imperatively managed placeholder divs. Each page gets a stable placeholder that is never destroyed until the page closes. This prevents iframes, webviews, and canvas elements from reloading when pages are closed, reordered, grouped, or ungrouped. Placeholders are never reparented (moved between containers) — grouping is achieved purely via CSS absolute positioning within the same container. See `GroupContainer` and `ImperativeSplitter` in the same folder.

**Multi-window transfer:** A page can be serialized and transferred to another window via IPC. The source window calls `movePageOut()` (removes from collection without disposing), and the target window calls `movePageIn()` (reconstructs from serialized data). See [`PagesLifecycleModel`](../../src/renderer/api/pages/PagesLifecycleModel.ts).

---

## 3. Page Actions Taxonomy

All page operations are categorized into 5 groups, each handled by a dedicated submodel.

```mermaid
graph TD
    API["IPageCollection<br/>(Public API)"]

    API --> Q["Queries<br/>(Read-Only)"]
    API --> L["Lifecycle<br/>(Create/Destroy)"]
    API --> N["Navigation<br/>(Visibility)"]
    API --> LAY["Layout<br/>(Arrangement)"]
    API --> P["Persistence<br/>(Storage)"]

    Q --> Q1["pages: IPage[]"]
    Q --> Q2["active: IPage | null"]
    Q --> Q3["find(id)"]
    Q --> Q4["getGrouped(id)"]

    L --> L1["create(type)→IPage"]
    L --> L2["open(path)→Promise"]
    L --> L3["close(id)→Promise"]
    L --> L4["navigate(id, path)"]

    N --> N1["show(id)"]
    N --> N2["showNext()"]
    N --> N3["showPrev()"]

    LAY --> LAY1["move(id, idx)"]
    LAY --> LAY2["pin(id)"]
    LAY --> LAY3["unpin(id)"]
    LAY --> LAY4["group(l, r)"]
    LAY --> LAY5["ungroup(id)"]

    P --> P1["restore()→Promise"]
    P --> P2["save()→Promise"]

    style API fill:#e1f5ff
    style Q fill:#f3e5f5
    style L fill:#f3e5f5
    style N fill:#f3e5f5
    style LAY fill:#f3e5f5
    style P fill:#f3e5f5
```

**Public interface:** [`/src/renderer/api/types/pages.d.ts`](../../src/renderer/api/types/pages.d.ts) — `IPageCollection` and `IPageInfo`

---

## 4. Internal Submodel Architecture

The pages system uses category-based decomposition. `PagesModel` holds shared state, composes 5 submodels for specific operation categories, and delegates all public methods through a flat API.

```mermaid
graph TD
    Base["PagesModel<br/>(Base State + Core)"]

    Base --> LC["PagesLifecycleModel<br/>create, open, close, navigate"]
    Base --> Nav["PagesNavigationModel<br/>show, showNext, showPrev"]
    Base --> Lay["PagesLayoutModel<br/>move, pin, group, ungroup"]
    Base --> Persist["PagesPersistenceModel<br/>save, restore"]
    Base --> Query["PagesQueryModel<br/>find, getActive, getGrouped"]

    Base -->|delegates| IPC["IPageCollection<br/>(Public Interface)"]

    Base -->|state| S["OpenFilesState<br/>pages[], ordered[], groupings"]
    LC -->|uses| S
    Nav -->|uses| S
    Lay -->|uses| S
    Persist -->|uses| S
    Query -->|uses| S

    style Base fill:#fff3e0
    style LC fill:#f3e5f5
    style Nav fill:#f3e5f5
    style Lay fill:#f3e5f5
    style Persist fill:#f3e5f5
    style Query fill:#f3e5f5
    style IPC fill:#e1f5ff
    style S fill:#ffe0b2
```

**Files:**

| Submodel | File | Responsibility |
|----------|------|----------------|
| Base | [`PagesModel.ts`](../../src/renderer/api/pages/PagesModel.ts) | Shared state (`pages[]`, `ordered[]`, `groupings`), core helpers |
| Lifecycle | [`PagesLifecycleModel.ts`](../../src/renderer/api/pages/PagesLifecycleModel.ts) | create, open, close, navigate, movePageIn/Out |
| Navigation | [`PagesNavigationModel.ts`](../../src/renderer/api/pages/PagesNavigationModel.ts) | show, showNext, showPrev |
| Layout | [`PagesLayoutModel.ts`](../../src/renderer/api/pages/PagesLayoutModel.ts) | moveTab, pin/unpin, group/ungroup |
| Persistence | [`PagesPersistenceModel.ts`](../../src/renderer/api/pages/PagesPersistenceModel.ts) | save/restore window state to disk |
| Query | [`PagesQueryModel.ts`](../../src/renderer/api/pages/PagesQueryModel.ts) | find, activePage, getGrouped, isLastPage |

`PagesModel` delegates all submodel methods as its own (46 public methods). Exported as a singleton:

```typescript
import { pagesModel } from "../api/pages";
```

---

## 5. Internal vs. Public Operations

### Public (in IPageCollection, exposed to scripts)

- `all`, `activePage`, `find()`, `getGrouped()` — queries
- `openFile()`, `addEmpty()`, `addEditor()` — lifecycle
- `show()`, `showNext()`, `showPrevious()` — navigation
- `moveTab()`, `pin()`, `unpin()`, `group()`, `ungroup()` — layout

### Internal (not in .d.ts, private implementation)

- `movePageIn()` / `movePageOut()` — multi-window drag-drop (IPC-driven)
- `attachPage()` / `detachPage()` / `removePage()` — state management
- `fixGrouping()` / `fixCompareMode()` — invariant repair
- `checkEmptyPage()` — auto-create empty page when last one closes
- `addEmptyPageWithNavPanel(folderPath)` — creates an empty page with a pre-attached NavigationPanel (used by sidebar double-click and archive browsing). Intentionally skips `restore()` to avoid a race condition where the async restore would see `hasNavPanel=true` and create a new NavPanelModel that overwrites the one we just attached.
- `openFileAsArchive(filePath)` — opens an archive for browsing. Creates an empty page with NavPanel root set to the archive root. Reuses existing tab if the archive is already open. ZIP archives use `!` separator (e.g., `doc.zip!word/document.xml`) via `archive-service.ts`; `.asar` archives use the regular path directly (e.g., `app.asar`) via Electron's native fs patching — see `file-path.ts`.
- `save()` / `restore()` — persistence (called by bootstrap, not by scripts)
- Submodel instances — private composition detail

---

## 6. Error Handling

```
During restore (initialization):  catch and notify, don't crash
During user actions:              throw, let caller handle
```

- **Initialization errors** (restore, handleArgs): caught in `app.initPages()`, user gets a notification, an empty page is created as fallback.
- **User action errors** (open file, navigate): the method throws, and the caller (keyboard service, renderer events service, or UI component) catches and shows a notification.

---

## 7. Multi-Window Page Transfer

When a tab is dragged to another window:

1. **Source window:** `movePageOut(pageId)` serializes the page data and removes it from the collection (no dispose — resources are transferred, not destroyed).
2. **Main process:** Routes the serialized data to the target window via IPC.
3. **Target window:** `movePageIn(data)` reconstructs the page model from serialized data and adds it to the collection.

**Critical dependency:** The target window must have called `api.windowReady()` before the main process sends `eMovePageIn`. The main process holds a `whenReady` promise per window and awaits it before forwarding events.

**Implementation:** [`/src/main/open-windows.ts`](../../src/main/open-windows.ts) (main process), [`PagesLifecycleModel.ts`](../../src/renderer/api/pages/PagesLifecycleModel.ts) (renderer)

## 8. Well-Known Pages

Some pages are **singletons** — they should exist as a single instance and be found by a stable ID rather than a random UUID. The well-known pages system provides this.

**Source:** [`/src/renderer/api/pages/well-known-pages.ts`](../../src/renderer/api/pages/well-known-pages.ts)

### How it works

1. **Registry:** Well-known pages are defined in `well-known-pages.ts` with a fixed ID, editor, language, and title:
   ```typescript
   registerWellKnownPage({
       id: "mcp-ui-log",
       editor: "log-view",
       language: "jsonl",
       title: "MCP Log",
   });
   ```

2. **Get-or-create:** Use `pagesModel.requireWellKnownPage(id)` to get the page:
   - If a page with this ID exists → focuses and returns it
   - If not → creates a new page with the predefined config and the well-known ID (not a UUID)
   - The existing `addPage()` deduplication ensures no duplicates

3. **Session restore:** Well-known pages are persisted with their fixed ID. On restore, they're recreated with the same ID. Next `requireWellKnownPage()` call finds the restored page.

### Current well-known pages

| ID | Editor | Purpose |
|----|--------|---------|
| `mcp-ui-log` | `log-view` | MCP `ui_push` log — shared between MCP handler and script execution |
| `mcp-server-log` | `log-view` | MCP server incoming request log — logs every incoming MCP command with method, params, result, error, duration. Capped at 200 entries. Opened by clicking the MCP indicator in the title bar. |

### Pre-existing singleton pages

About and Settings pages use a similar pattern with hardcoded IDs directly in their modules:
- `ABOUT_PAGE_ID = "about-page"` in `AboutPage.tsx`
- `SETTINGS_PAGE_ID = "settings-page"` in `SettingsPage.tsx`

These work as singletons through the same `addPage()` deduplication — `newEmptyPageModel()` always creates with the same ID.

### When to use well-known pages

Use this pattern when:
- A page should be a **singleton** (one instance at a time)
- Multiple code paths need to **find the same page** (e.g., MCP handler and ScriptContext both need the same log page)
- The page has a **fixed configuration** (editor, language, title) that callers shouldn't need to know

Do NOT use for:
- User-created pages (scripts, file open) — these should have unique UUIDs
- Pages that can be opened multiple times (browser tabs, text files)

### Adding a new well-known page

1. Add a `registerWellKnownPage()` call in `well-known-pages.ts`
2. Use `await pagesModel.requireWellKnownPage("your-id")` wherever you need the page
3. No other changes needed — `addPage()` handles deduplication automatically

**Note:** `requireWellKnownPage` is an internal API — not exposed to scripts or the MCP handler's `create_page` command.
