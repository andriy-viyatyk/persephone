# 04 — Persistence walkthrough

Scope: round-trip across app restart. The on-disk descriptor shape, the migration policy from today's flat `IEditorState`, the `editorId`-keyed restore call, the host/editor split inside the descriptor, the fate of the sidebar cache file under the unified `editors[]` model, async restore ordering, error handling, and cache file cleanup.

Absorbs deferrals:
- **L5** (walkthrough 01): `restoreModel` blob shape — today flat `IEditorState`; new shape needs `{ editorId, state, host? }`.
- **S10** (walkthrough 02): `editorId` migration into persistence (remove `IEditorState.type`, `.editor`, `EditorDefinition.editorType`).
- **C2** (initial design): version-bump policy; no migration shim.
- **Walkthrough 03 deferred items**: `secondaryModelDescriptors[]` shape; `_pendingActivePanel` restore timing.

**Out of scope** (own walkthroughs): multi-window page transfer (`05`), compare mode (`06`), grouped pages (`07`), Notebook per-note persistence (`29`), editor-specific cache content (`20`, `21`, `22`, …).

**Status:** Done (2026-05-19). All concerns P1–P10 resolved. Mockups updated: `PersistenceTypes.ts` (new, C1), `editorRegistry.ts` (C2 — optional `instanceId`), `EditorModel.ts` (C3 — `editorId` field + `getRestoreData` returns `EditorDescriptor` + `RestoreData<S>` shape), `IContentHost.ts` (C4 — `getDescriptor` + static `fromDescriptor` contract), `PageModel.ts` (C7 — sidebar cache machinery + page-level cache deletion both gone; new `saveState` iterates editors). C8 (orphan sweep) and C9 (new fs API) dropped per P9.

---

## What exists today

### File layout

Two persistence paths, two debounce timers, two on-disk files per page:

1. **Window-level openFiles file** — `<userData>/openFiles.txt` (template `openFilesNameTemplate`). Single JSON blob with all pages' descriptors. Written by `PagesPersistenceModel.saveStateDebounced` (500ms).
2. **Per-page sidebar cache file** — `<userData>/cache/<pageId>-nav-panel.txt`. JSON blob with sidebar state + secondary editor descriptors. Written by `PageModel._saveStateDebounced` (300ms).
3. **Per-editor cache files** — `<userData>/cache/<editorId>-*` (named by each editor). Owned by individual editor instances; cleaned up via `fs.deleteCacheFiles(editor.id)` in `EditorModel.dispose`.

### Window state (today)

`src/shared/types.ts:36-40`:
```ts
interface WindowState {
    pages: PageDescriptor[];
    groupings?: [string, string][];
    activePageId?: string;
}

interface PageDescriptor {
    id: string;
    pinned: boolean;
    modified: boolean;
    hasSidebar: boolean;
    editor: Partial<IEditorState>;  // flat — main editor only
}
```

`IEditorState` (types.ts:6-20) holds **mixed** editor + host fields:
```ts
interface IEditorState {
    id: string,                   // editor instance id (cache file key)
    type: EditorType,             // "textFile" | "pdfFile" | …  — class discriminator (S10: removed)
    title: string,                // host-derived
    modified: boolean,            // host-derived (TextFileModel) or editor-managed (BrowserPage, Graph…)
    language?: string,            // host
    filePath?: string,            // host
    pipe?: { provider, transformers, encoding? },  // host
    editor?: EditorView,          // view sub-discriminator inside `type === "textFile"` (S10: removed)
    sourceLink?: ILinkData,       // host
    secondaryEditor?: string[],   // editor — panel contribution
}
```

Notes:
- `type` and `editor` together resolve the today-mapping `(textFile, monaco) → TextEditorModel` / `(textFile, grid-json) → also TextEditorModel`. Today every text-bearing variant is one class; the `editor` field picks the view component.
- Non-text editors set `type` to their own value (`pdfFile`, `imageFile`, `browserPage`, etc.) and never set `editor`.

### Save path

`PagesPersistenceModel.saveState` (PagesPersistenceModel.ts:20-42):
```ts
pageDescriptors[i] = {
    id: page.id,
    pinned: page.pinned,
    modified: page.modified,
    hasSidebar: page.hasSidebar,
    editor: page.mainEditor?.getRestoreData() ?? {},
};
```

`EditorModel.getRestoreData()` returns the deep-cloned `state.get()`. Default implementation: `JSON.parse(JSON.stringify(state.get()))` and optionally `pipe: pipe.getDescriptor()` for text-bearing.

Trigger: `PagesModel.attachPage` subscribes to `page.mainEditor?.state` (PagesModel.ts:71-78) and to `page.state`. Any mutation calls `saveStateDebounced`. Subscription is rewired by `resubscribeEditor(page)` after `setMainEditor`.

### Restore path

`PagesPersistenceModel.restoreState` (PagesPersistenceModel.ts:63-136):
1. Read openFiles.txt; parse JSON.
2. Detect old format — top-level `type` on the page object (pre-v3.0.1 flat shape). Skip if detected.
3. Per descriptor:
   - `page = new PageModel(desc.id)`; `page.pinned = desc.pinned`.
   - If editor descriptor non-empty: `restoreModel(editorData)` → look up `editorDef.editorType === data.type` → `editorDef.loadModule()` → `newEmptyEditorModel(data.type)` → `applyRestoreData(data)` → `restore()`.
   - If `hasSidebar`: `page.restoreSidebar()` + `page.restoreSecondaryEditors(editor)`.
4. Reorder so `activePageId` lands last in `state.ordered`.
5. Restore groupings via `layout.group(left, right)` + `layout.fixGrouping()`.

### Sidebar cache file (today)

`PageModel.restoreSidebar` (PageModel.ts:518-565) reads `<pageId>-nav-panel.txt`:
```ts
interface PageSidebarSavedState {
    open: boolean;
    width: number;
    activePanel?: string;
    secondaryModelDescriptors?: { pageState: Partial<IEditorState> }[];
}
```

Restore flow:
- Set `pageNavigatorModel` open/width via `setStateQuiet` (avoids debounce).
- Migrate old-format `rootPath` field (pre-v3 archive) into a synthetic ExplorerEditorModel descriptor.
- Stash `secondaryModelDescriptors` on `pendingSecondaryDescriptors` — actual model creation deferred to `restoreSecondaryEditors(ownerEditor)`.
- Resolve `activePanel`:
  - Built-in panels (`"explorer"`, `"search"`) apply immediately.
  - Other panels (e.g., `"link-category"`) defer to `_pendingActivePanel` until secondaries are restored.

`restoreSecondaryEditors(ownerEditor)` (PageModel.ts:472-513):
- For each descriptor: dedupe against `ownerEditor.id` (Pattern B), else `lifecycle.newEditorModelFromState(desc.pageState)` → `applyRestoreData` → `restore` → push to `secondaryEditors[]`.
- Wraps per-descriptor in `try/catch` + `console.warn` on failure.
- After all secondaries land, resolve `_pendingActivePanel` if the panel id now exists in some secondary's `secondaryEditor` array.

### Save trigger for sidebar

`PageModel._saveStateDebounced` (300ms) is wired from:
- `PageNavigatorModel.state.subscribe` (ensure / open / width changes).
- `setActivePanel`, `addSecondaryEditor`, `removeSecondaryEditor`, `removeSecondaryEditorWithoutDispose`.

Each secondary editor also gets saved to its own per-editor cache files when its state mutates (its own subscription, owned by the editor).

### Implicit current behavior worth preserving

| Behavior | Where |
|----------|-------|
| Old-format (pre-v3.0.1) detection silently aborts restore | `PagesPersistenceModel:73-81` |
| Per-page restore failures continue the loop with `console.warn` | `PageModel.restoreSecondaryEditors:496-498` |
| Active page lands last in `state.ordered` so it focuses on bootstrap | `PagesPersistenceModel:116-126` |
| Groupings restore after pages; `fixGrouping` cleans dangling pairs | `PagesPersistenceModel:128-135` |
| Per-editor caches survive across restarts and across multi-window transfer | Owned by editor.id; cache files independent of openFiles.txt |
| Empty pages (no `mainEditor`) with sidebar restore via separate path | `desc.hasSidebar` branch in `restoreState` |
| Active panel deferred when it refers to a not-yet-restored secondary | `_pendingActivePanel` in `restoreSidebar` + `restoreSecondaryEditors` |
| Self-referencing archive descriptor dedup (Pattern B) | `restoreSecondaryEditors:483-487` |

---

## What the new architecture needs to support

After walkthroughs 01–03, the foundation already commits to:

- **Unified `editors: EditorModel[]`** on PageModel with `_mainEditorId: string | null` flag. No separate `secondaryEditors[]`.
- **Visibility criterion** — editor kept iff `(id === _mainEditorId) || contributesPanels()`. Visibility re-evaluated on `setMainEditor` AND on per-editor `secondaryEditor`-slice changes (via TOneState selector overload).
- **Three-phase lifecycle** — `editorRegistry.createEditor(id) → (applyRestoreData OR switchFrom) → restore()`. Host construction is fully inside `restore()`.
- **`EditorModel.editorId: string`** — registry key, stable for the editor's lifetime. Replaces `IEditorState.type` + `IEditorState.editor`.
- **`EditorModel.descriptorChanged: Subscription<void>`** (A6) — per-editor "this editor's persisted shape changed" signal. Page subscribes once per editor.
- **`PagesModel.attachPage` / `resubscribeEditor`** — collapsed; `attach`/`detach` on the unified array maintain a per-editor `descriptorChanged` subscription map.
- **`IContentHost`** — host is its own model with its own state. TextFileModel host has `state.get()` returning `{ content, filePath, modified, encoding, … }` plus pipe-descriptor accessors.

Functional requirements for persistence (no regressions vs. today):

1. **One openFiles.txt format containing everything per page.** Page descriptor must cover main + panel-contributors + sidebar metadata; either inline or as a small reference.
2. **Restore from descriptor reconstructs a fully working `PageModel.editors[]` + `_mainEditorId`** under the unified-array model.
3. **Each editor descriptor knows which class to instantiate.** Replace `type` lookup with `editorId`. Per S10/C2: bump major version, no migration shim.
4. **Each editor descriptor carries enough state to round-trip.** For text-bearing editors: editor-specific state slice + host descriptor (content/filePath/pipe/encoding).
5. **Pipe descriptor must round-trip through the host** (not the editor). After refactor, the pipe lives on the host.
6. **Active panel restore must wait for secondaries.** The deferred-restore pattern survives the unified-array shape.
7. **Per-page sidebar metadata** (`open`, `width`, `activePanel`) needs a home. Two candidate placements: inside `PageDescriptor` (fold today's cache file into the unified descriptor) or keep a separate cache file.
8. **Per-editor cache files** (`<editor.id>-*`) survive — owned by editors, written/cleaned per C9.
9. **Save trigger composes both editor-state mutations and host-state mutations** via `descriptorChanged` (A6 already covers this).
10. **Error handling per-editor**: `console.warn` + continue on per-descriptor restore failure (matches today). Per-page failure (e.g., unrecognized `editorId` for ALL editors in the page) skips the whole page.

---

## How the foundation mockups handle this

What's already in the mockups:

- `editorRegistry.createEditor(editorId)` — instantiates the class by registry key (A7).
- `EditorModel.applyRestoreData(data: Partial<T>)` — phase 2: remember setup data, no I/O.
- `EditorModel.restore()` — phase 3: realize host + restore editor-only state + wire `descriptorChanged` forwarder.
- `EditorModel.getRestoreData()` — emits the persisted blob; subclasses override to include host descriptor.
- `EditorModel.editorId: string` (B1, walkthrough 02) — registry key.
- `EditorModel.descriptorChanged: Subscription<void>` (A6).
- `PageModel.editors[]` + `_mainEditorId`; `attach` / `detach` / `setMainEditor` (A8, walkthrough 01).
- `PageModel.panelEditors` getter (filters `editors[]` by `contributesPanels()`).

What walkthrough 04 must add or commit to:

- **Descriptor shape** for editors (with optional `host` sub-blob) and for pages (with editors array, mainEditorId, sidebar metadata).
- **Restore call site** in `PagesPersistenceModel.restoreState` — three-phase per descriptor; attach into PageModel; set `_mainEditorId`; restore sidebar fields.
- **Migration shim**: detect old format → console.warn + skip. No re-mapping table.
- **Async ordering**: editors restore in parallel within a page? Sequentially? Across pages?
- **`_pendingActivePanel`** semantics under the unified flow.

---

## Concerns surfaced (persistence-specific)

Each concern presented with the problem, options on the table, and a **proposed** decision (subject to review).

### P1 — Persisted descriptor shape — **RESOLVED 2026-05-19**

**Problem.** Today's `PageDescriptor` carries a flat `Partial<IEditorState>` that conflates editor and host fields. After refactor the host is a separate model; `type` and `editor` are gone (S10). The unified `editors[]` shape from walkthrough 01 needs all editors (main + panel-contributors) persisted, not just main.

**Proposed shape:**

```ts
// src/shared/types.ts (rewrite — version bump, no migration)

interface WindowState {
    schemaVersion: 4;                  // NEW — bumps with every shape break (P10)
    pages: PageDescriptor[];
    groupings?: [string, string][];
    activePageId?: string;
}

interface PageDescriptor {
    id: string;                        // page UUID
    pinned: boolean;
    modified: boolean;                 // aggregate over editors[]
    mainEditorId: string | null;       // points to one editor.id in editors[], or null for sidebar-only
    editors: EditorDescriptor[];       // unified — was: editor + sidebar.secondaryModelDescriptors
    sidebar?: {                        // present iff pageNavigatorModel exists
        open: boolean;
        width: number;
        activePanel: string;           // "explorer", "search", or a panel id from one of the editors
    };
}

interface EditorDescriptor {
    editorId: string;                  // registry key (S10) — picks the EditorModel subclass
    id: string;                        // editor instance UUID (cache file key — C9)
    state: Record<string, unknown>;    // editor-specific state (subclass-defined shape, opaque to the page layer)
    host?: HostDescriptor;             // present for editors with IContentHost
}

interface HostDescriptor {
    kind: "textFile";                  // host class discriminator (only TextFileModel for now; future hosts add cases)
    state: Record<string, unknown>;    // host state slice (content/filePath/modified/encoding/etc.)
    pipe?: PipeDescriptor;             // serialized content pipe (provider + transformers + encoding)
}

type PipeDescriptor = {                // unchanged from today's IEditorState.pipe
    provider: { type: string; config: Record<string, unknown> };
    transformers: { type: string; config: Record<string, unknown> }[];
    encoding?: string;
};
```

Notes:
- `EditorDescriptor.state` is intentionally opaque — the persistence layer never reads inside it. Each editor's `applyRestoreData` interprets its own shape.
- `HostDescriptor.state` is opaque to the editor's persistence layer too — only the host's own restore logic reads inside it.
- `HostDescriptor.kind` discriminates which host class to instantiate. Today there's only `"textFile"`. NoteItemEditModel (walkthrough 29) is transient, never persisted at the page level. Future host types add discriminator values.
- `mainEditorId` is `string | null` to express sidebar-only pages cleanly.

**Removes:**
- `IEditorState` (the type itself) — gone. Each editor defines its own state slice shape locally.
- `EditorType` / `EditorView` string-literal unions (S10) — gone.
- `PageDescriptor.editor: Partial<IEditorState>` — replaced by `editors: EditorDescriptor[]`.
- `PageDescriptor.hasSidebar: boolean` — replaced by presence of `sidebar?`.

**Options considered.**
- (a) Keep flat `IEditorState` shape and add a `host` field to it. Rejected — `IEditorState` is the legacy carrier; cleaner to retire it.
- **(b) — chosen.** New `EditorDescriptor` + `HostDescriptor` types. Editor state and host state cleanly separated. Page descriptor's `editors[]` covers main + panel-contributors uniformly.
- (c) Two arrays: `mainEditor: EditorDescriptor | null` and `panelEditors: EditorDescriptor[]`. Rejected — the unified-array decision in walkthrough 01 already commits to one array; descriptor mirrors model.

### P2 — Old-format detection & version-stamping — **RESOLVED 2026-05-19**

**Problem.** Today's restore detects old format by checking `data.pages[0]?.type` (top-level `type` field on a page object — the pre-v3.0.1 flat shape). After refactor, the new shape removes the `type` field from EditorDescriptor too. A robust detector must distinguish:
- Pre-v3.0.1 flat shape (top-level `type` on page).
- v3.0.1–v3.x shape (`PageDescriptor.editor.type`).
- v4.x new shape (`PageDescriptor.editors[]`, `WindowState.schemaVersion === 4`).

**Proposed approach:**

```ts
const data = parseObject(await appFs.getDataFile(openFilesNameTemplate));
if (!data || !Array.isArray(data.pages)) return;

// Version check — accept only the current schema.
if (data.schemaVersion !== 4) {
    console.warn(
        `[PagesPersistenceModel] openFiles.txt schema version ${data.schemaVersion ?? "unknown"} ` +
        `is not v4; starting empty. Old session will be overwritten on first save.`,
    );
    return;
}
// …proceed with v4 restore…
```

`schemaVersion` is the single discriminator. Anything else (missing, pre-v4, future) → skip + warn. Detection is robust and self-documenting.

On save: always write `schemaVersion: 4`. Today's save format gets bumped to v4 with the new descriptor shape on first user interaction.

**Per-page restore failures** stay non-fatal: per-page `try/catch` + `console.warn`, then `continue` the loop. No `ui.notify` (matches C2 — restore happens before user is ready; notifications would startle).

**Migration shim:** **NONE.** Per C2 + S10: this is a deliberate major-version break. Users on v3.x re-create their session naturally as they open files. Documented in user-facing release notes (walkthrough's `userdoc` step at epic close).

**Options considered.**
- (a) Multi-version detection (handle v2, v3, v4 with shape-shaping). Rejected — C2 already chose "no migration."
- **(b) — chosen.** Single `schemaVersion: 4` check (integer). Anything else → empty start.
- (c) No version field at all; detect by structure (look for `editors[]` vs `editor`). Rejected — fragile if future shapes happen to be structurally similar.

**Sub-question — integer vs. semver string.** Stays integer. Schema-version semantics are "shape-incompatible bumps" — semver minor / patch granularity is not meaningful for a single typed JSON descriptor (additive optional fields don't bump; everything else is a major). An integer reads cleanly at the check site (`!== 4`) and stays unambiguous when read back from the data file across years.

### P3 — Fold sidebar cache file into the WindowState page descriptor — **RESOLVED 2026-05-19**

**Problem.** Today: two files per page (openFiles.txt + `<pageId>-nav-panel.txt`). The sidebar cache holds `secondaryModelDescriptors[]` and sidebar metadata; the openFiles holds the main editor descriptor. After walkthrough 01's unification, both kinds of editors live in one array — does the persistence layer follow suit, or stay split?

**Proposed: fold sidebar cache into PageDescriptor.**

Rationale:
- Single source of truth for "what does this page contain?" — restore reads one file per window, not 1 + N (where N = page count).
- Atomic save: no partial-restore race where main loaded but panels did not (or vice-versa) from a half-written cache file.
- Sidebar metadata (`open`, `width`, `activePanel`) is small (~50 bytes per page) — embedding it doesn't bloat openFiles meaningfully.
- Eliminates the entire `PageSidebarSavedState` type and the `_saveStateDebounced` (300ms) → `_saveState` chain on PageModel.

**What survives:**
- **Per-editor cache files** (`<editor.id>-*`) — own large state per C9 (host content blob, Monaco decorations blob, script panel state, etc.). Still owned by editors; still cleaned up per-editor.
- **Page-level cache files** keyed on `<page.id>-*` — none left after this fold. PageModel's `_cacheName = "nav-panel"` and `fs.deleteCacheFiles(this.id)` in `dispose()` become no-ops (or are removed entirely).

**Changes:**
- Remove `PageModel._saveState`, `_saveStateDebounced`, `_cacheName`, `_skipSave`, `restoreSidebar`, `pendingSecondaryDescriptors`, `_pendingActivePanel` (P5 reshapes this), `restoreSecondaryEditors`, `flushSave`.
- The page-level debounce signal (page metadata changes — sidebar open/width/activePanel, pinned, editor list) routes to `PagesPersistenceModel.saveStateDebounced` via `page.state.subscribe` (already wired in `PagesModel.attachPage`).
- Subscription map: `PagesModel.attachPage` walks `editors[]` and subscribes to each editor's `descriptorChanged` (A6). When `attach`/`detach` runs, the map is updated.

**Options considered.**
- (a) Keep both files. Reduces openFiles size by ~N×(50 bytes + nested descriptor count) — trivial savings, doubles I/O paths and bug surface.
- **(b) — chosen.** Fold. Single file per window for the descriptor; per-editor cache files for large state.
- (c) Move everything (including large host content) into openFiles.txt — rejected, content blobs are megabytes-sized and would defeat debounced incremental writes.

**Debounce cadence implication.** The 300ms `PageModel._saveStateDebounced` disappears; sidebar mutations (open/width/activePanel) ride the 500ms `PagesPersistenceModel.saveStateDebounced`. 200ms longer worst-case delay before disk write — imperceptible in practice; both timers are far below the user's quit-typing-and-close-app threshold. Acceptable trade for the single-source-of-truth simplification.

### P4 — Pipe descriptor lives on the host — **RESOLVED 2026-05-19**

**Problem.** Today's `IEditorState.pipe` lives on the editor (because TextFileModel IS both). After refactor, the pipe is owned by the TextFileModel host (it's the thing reading/writing bytes). Descriptor location follows ownership.

**Proposed: `pipe` lives on `HostDescriptor`, not `EditorDescriptor`.**

```ts
interface HostDescriptor {
    kind: "textFile";
    state: { content?, modified, filePath?, encoding?, … };  // host state slice
    pipe?: PipeDescriptor;                                     // host owns pipe lifecycle
}

interface EditorDescriptor {
    editorId: string;
    id: string;
    state: { /* editor-only — e.g., scrollTop, decorations, view-specific settings */ };
    host?: HostDescriptor;                                     // text-bearing editors only
}
```

Save: `editor.getRestoreData()` calls `this._host?.getDescriptor()` for text-bearing editors. The host's `getDescriptor()` packs `{ state, pipe }`.

Restore: `editor.applyRestoreData(desc)` stashes `desc.host` for use in `restore()`. Inside `restore()`, host is reconstructed from `desc.host?.state` and `desc.host?.pipe` (today's `TextFileIOModel` pipe-restore logic, relocated under the host).

**No-host editors** (PDF, Image, Browser, MCP Inspector, etc.) don't set `host` on their descriptor. Their entire persisted state lives in `EditorDescriptor.state`.

**Options considered.**
- (a) Keep `pipe` on `EditorDescriptor` for backward shape-affinity. Rejected — leaks host concept into the editor.
- **(b) — chosen.** Pipe on `HostDescriptor`. Clean ownership; matches A1/A7.

### P5 — `_pendingActivePanel` under async restore — **RESOLVED 2026-05-19**

**Problem.** Today's flow is two-step:
1. `restoreSidebar` parses sidebar cache, stashes `pendingSecondaryDescriptors` + `_pendingActivePanel`.
2. `restoreSecondaryEditors(ownerEditor)` runs after main editor is restored, instantiates secondaries, then applies `_pendingActivePanel`.

Under P3 (folded) + unified-array, the descriptor lists all editors in one array. Restore happens per-page. Active panel may reference a panel id from any of the editors. The descriptor is fully known up front; the only thing that has to wait is the async `restore()` call on each editor.

**Proposed:**

Restore each page like this:

```ts
async restorePage(desc: PageDescriptor): Promise<PageModel | null> {
    const page = new PageModel(desc.id);
    page.pinned = desc.pinned;

    // Phase 1: build all editors in parallel (no DOM, no I/O ordering dependencies)
    const editors = await Promise.all(
        desc.editors.map(async (d) => {
            try {
                const editor = await editorRegistry.createEditor(d.editorId);
                editor.applyRestoreData({ ...d.state, host: d.host, id: d.id });
                await editor.restore();
                return editor;
            } catch (err) {
                console.warn(`[restore] Failed to restore editor ${d.editorId}:`, err);
                return null;
            }
        }),
    );

    // Phase 2: attach in descriptor order; skip failures
    for (const editor of editors) {
        if (editor) page.attach(editor);
    }

    // Phase 3: set main editor id (must reference one of the attached editors)
    if (desc.mainEditorId && page.editors.some(e => e.id === desc.mainEditorId)) {
        page._mainEditorId = desc.mainEditorId;
        page.state.update(s => { s.mainEditorId = desc.mainEditorId; });
    }

    // Phase 4: sidebar metadata — applied last, all panels guaranteed present (or skipped on failure)
    if (desc.sidebar) {
        const nav = page.ensurePageNavigatorModel();
        nav.setStateQuiet({ open: desc.sidebar.open, width: desc.sidebar.width });
        const panel = desc.sidebar.activePanel;
        const valid =
            panel === "explorer" ||
            panel === "search" ||
            page.editors.some(e => e.contributesPanels() && e.secondaryEditor?.includes(panel));
        page.activePanel = valid ? panel : "explorer";
    }

    return page.editors.length > 0 || desc.sidebar ? page : null;
}
```

`_pendingActivePanel` disappears — panels are guaranteed present (or known-missing) by the time we apply the active panel, because their restores already finished.

**Parallelism.** Per-page editor restores run in parallel (`Promise.all`). Independent — each editor instantiates its own host. Cross-page: pages can also restore in parallel (`Promise.all(data.pages.map(restorePage))`). This is faster than today's sequential loop (today serializes everything in one for-loop).

**Open caveat — order-sensitive editors?** Walkthrough 03 / N5 noted CategoryEditor restores depending on a sibling ExplorerEditorModel. Today's flow restores main first, then secondaries — CategoryEditor (as main) renders a placeholder, then re-scans when its sibling lands. In the new arch the same race exists in a milder form: all editors restore in parallel within a page, but they all complete before `attach` runs. CategoryEditor's view (per N5) subscribes to `page.state` and re-scans on attach; the unified flow puts all attaches in tight succession, so the placeholder window is microscopic. **No special ordering needed.**

**Options considered.**
- (a) Sequential per-editor restore within a page; keep `_pendingActivePanel`. Rejected — slower and the variable becomes redundant once main and panels are in one descriptor.
- **(b) — chosen.** Parallel per-editor restore; apply mainEditorId + sidebar after all editors attached.
- (c) Restore main first, then panels (preserve today's order). Rejected — no semantic reason; the unified-array model treats main as an editor in the same array.

### P6 — `getRestoreData()` / `applyRestoreData()` contract under host split — **RESOLVED 2026-05-19**

**Problem.** Today's `applyRestoreData(data: Partial<IEditorState>)` accepts a flat object. After refactor, the data shape is `EditorDescriptor` with a nested `host`. What does the contract look like? Does the editor know about `host` directly, or does the host see its own slice?

**Proposed contract:**

Each `EditorModel` subclass defines its own state type. `applyRestoreData` takes a partial of that type, plus an optional `host?: HostDescriptor` if the editor is text-bearing:

```ts
// Base EditorModel (mockup, walkthrough 01):
abstract applyRestoreData(data: Partial<EditorState>): void;

// Text-bearing editors extend the type:
type RestoreData<S extends EditorState> = Partial<S> & {
    host?: HostDescriptor;
    revealLine?: number;       // ComponentQueue passthroughs (S4, walkthrough 02)
    highlightText?: string;
};

class MonacoEditor extends EditorModel {
    private _pendingHost: HostDescriptor | undefined;
    private _pendingState: Partial<MonacoEditorState> | undefined;

    applyRestoreData(data: RestoreData<MonacoEditorState>): void {
        const { host, revealLine, highlightText, ...editorState } = data;
        this._pendingHost = host;
        this._pendingState = editorState;
        if (revealLine !== undefined) this.queue.send({ type: "revealLine", line: revealLine });
        if (highlightText !== undefined) this.queue.send({ type: "highlightText", text: highlightText });
    }

    async restore(): Promise<void> {
        // …if no _host yet, build from _pendingHost or create empty:
        if (!this._host) {
            this._host = this._pendingHost
                ? await TextFileModel.fromDescriptor(this._pendingHost)
                : new TextFileModel();
        }
        // …editor-specific restore from _pendingState…
        // …wire descriptorChanged forwarder…
    }
}
```

`getRestoreData()`:

```ts
class MonacoEditor extends EditorModel {
    getRestoreData(): EditorDescriptor {
        return {
            editorId: this.editorId,
            id: this.id,
            state: this._editorState(),    // editor-specific state slice
            host: this._host?.getDescriptor(),  // host's getDescriptor returns HostDescriptor
        };
    }
}

class TextFileModel implements IContentHost {
    getDescriptor(): HostDescriptor {
        return {
            kind: "textFile",
            state: this._snapshotState(),    // { content, modified, filePath, encoding, … }
            pipe: this._pipe?.getDescriptor(),
        };
    }
    static async fromDescriptor(desc: HostDescriptor): Promise<TextFileModel> {
        // Reconstruct host: deserialize state, instantiate pipe, set initial fields.
        // Does NOT call any async I/O — pipe.readText happens during host.restore().
    }
}
```

**Symmetry with A7.** This is what A7 (three-phase) already implied — `applyRestoreData` stashes; `restore()` realizes. The new shape just makes the host portion explicit instead of intermixed.

**Options considered.**
- (a) Pass the full `EditorDescriptor` (including `editorId` and `id`) to `applyRestoreData`. Rejected — `editorId` is identity (the registry already used it to pick the class); `id` is the instance UUID that should be set on the editor at creation time, not applyRestoreData.
- **(b) — chosen.** `applyRestoreData(data)` receives state + host + optional ComponentQueue passthroughs. Editor's `id` set separately (see below).

**`EditorDescriptor.id` handoff.** Where does the editor get its `id` from? Two clean options:
- (i) `editorRegistry.createEditor(editorId, instanceId?)` — accepts an optional override.
- (ii) `editor.id = desc.id` set inside the restore loop, after `createEditor` but before `applyRestoreData`.

(i) is cleaner — the id is set at construction, no post-construction mutation of an identity field. **Chosen: (i).** Mockup `editorRegistry.ts` updated accordingly.

### P7 — Restore failure: per-editor vs. per-page granularity — **RESOLVED 2026-05-19**

**Problem.** Today's restore has two failure modes:
- Whole-window-skip on old-format detection (`isOldFormat`).
- Per-secondary-descriptor `try/catch + console.warn` in `restoreSecondaryEditors`.

The main editor descriptor has NO per-page try/catch — if `restoreModel` throws, the loop's outer iteration handles it implicitly because the failed `restoreModel` returns null and the page is skipped via `if (!editor) continue`.

After P5, restore is parallel within a page. Failure granularity choices:
- (a) Whole-page-skip on any editor failure.
- (b) Per-editor `console.warn + continue`; salvage what's left of the page; if zero editors AND no sidebar, skip the page.
- (c) Hybrid: main editor failure skips the page; panel-editor failure salvages.

**Proposed: option (b) — per-editor salvage.** Reasoning:
- Matches today's secondary-editor behavior.
- Common failure case: a panel-contributor's class was renamed/removed. Salvaging the main editor preserves user's work.
- Empty-array case: if all editors fail AND no sidebar → skip the page (drop). If some succeed → keep the page.
- `mainEditorId` reference resolution: if the named main editor didn't make it into `editors[]`, leave `_mainEditorId = null` (the page becomes sidebar-only). User can recreate or close.

**Console warning shape:**
```
[restore] Failed to restore editor monaco (id=<uuid>) in page <pageId>: <err.message>
```

**Options considered.**
- (a) Whole-page-skip. Rejected — overzealous; loses sibling editors' state.
- **(b) — chosen.** Per-editor salvage.
- (c) Hybrid (main-fail skips). Rejected — added complexity; the salvage path already handles main-missing cleanly.

### P8 — Empty-pages persistence shape — **RESOLVED 2026-05-19**

**Problem.** Today's "empty page with sidebar" (folder explorer, link collection, archive root) has `mainEditor === null` and `hasSidebar === true`. Restore branches on `editorData && Object.keys(editorData).length > 0` to decide whether to restore a main editor.

Under the new shape, the analog is:
- `mainEditorId: null`
- `editors[]` may still have entries (Explorer, ArchiveTree, etc.) — they contribute panels but aren't main.
- `sidebar?` present (since the page has visible sidebar metadata).

**Proposed:** No special branch needed. The restore flow from P5 handles it naturally:
- `editors[]` is iterated; panel-contributors restore like any editor.
- `mainEditorId` is null in the descriptor → no main-set step.
- `sidebar` block applied; active panel valid against the restored editors' panel ids.

This is a benefit of the unified-array shape: empty-pages-with-sidebar stop being a special case.

**Sidebar-only-no-editors edge case** (page with PageNavigatorModel but zero editor contributors — does this exist today?). After scanning: no. Every page with `hasSidebar` has at least an ExplorerEditorModel or the legacy `rootPath` shape that gets migrated. **Decision: not supported.** A page with `sidebar` but `editors.length === 0` after restore is invalid; the restore drops it with a warn.

### P9 — Cache file cleanup on restore (orphans) — **RESOLVED 2026-05-19**

**Problem.** Per-editor cache files (`<editor.id>-host.txt`, `<editor.id>-decorations.json`, etc.) survive across app restarts. If a page descriptor is removed (user closed a tab; next app start has no descriptor for that editor.id), the cache files are orphaned. Today the cleanup is event-driven: `EditorModel.dispose` calls `fs.deleteCacheFiles(this.id)`, so as long as the dispose flow runs, files are cleaned up.

**Risk if we sweep.** A sweep relies on the in-memory model accurately reflecting "every live editor.id". If a restore bug (failed `applyRestoreData`, race during attach, etc.) leaves a useful editor out of `editors[]` while its descriptor is still in openFiles.txt, the sweep would treat the live file as orphaned and delete it — turning a recoverable hiccup into actual data loss. The reverse case (orphaned files accumulating on disk) is just disk-space drift.

**Decision: option (a) — do nothing.** Asymmetric risk:
- **Sweeping** = small benefit (recover some disk space) but real data-loss potential if the in-memory model lies during a restore bug.
- **Not sweeping** = a handful of stale files on disk (likely tens of KB total, growing slowly). Harmless.

Per-editor cleanup stays event-driven via `EditorModel.dispose → fs.deleteCacheFiles(this.id)`. That handles the common case (user closes a tab → editor disposes → cache files deleted). The drift cases — crash between dispose and flush, descriptor failed P7 salvage — leak a few files. Acceptable.

If disk bloat ever becomes a real problem (it won't; cache content is small), we can revisit with a more conservative sweep mechanism that double-checks against openFiles.txt directly rather than the live model.

**Options considered.**
- **(a) — chosen.** Do nothing. Accept slow drift; reject the data-loss risk that any sweep introduces.
- (b) Per-restore confirmation prompt. Rejected — restore happens before user is ready (C2 reasoning).
- (c) Opportunistic background sweep on bootstrap. Rejected — even the conservative version can delete real files when the in-memory model is wrong during a restore bug.
- (d) Time-based TTL (delete files older than X days). Rejected — same risk as (c) plus invents a metadata pass; not worth solving a non-problem.

### P10 — Schema version field — **RESOLVED 2026-05-19**

**Problem.** Future shape changes need a clean detection path (P2's reasoning). Today there's no explicit version field — the migration relies on shape sniffing.

**Proposed: `WindowState.schemaVersion: number`** — set to `4` for this epic's new shape. Restore reads it as the single discriminator (per P2). Future schema bumps increment this number.

Documented contract: changes to descriptor field shapes require a `schemaVersion` bump. Additive optional fields don't.

The `4` is the new value; v3.x today does not write this field (which is why `data.schemaVersion === undefined` → "not v4" → skip).

**Options considered.**
- (a) No version field — keep structural sniffing. Rejected — fragile (P2).
- **(b) — chosen.** Single integer field at the top of `WindowState`.

---

## Proposed mockup adjustments

Pre-review. **None applied yet.**

### C1 — New types in `src/shared/types.ts`

Resolves: P1, P2, P4, P10.

Replace the file's exported types with:

```ts
// Removed:
// export type EditorType = …
// export type EditorView = …
// export interface IEditorState …

import type { ILinkData } from "../renderer/api/types/io.link-data";

export type PipeDescriptor = {
    provider: { type: string; config: Record<string, unknown> };
    transformers: { type: string; config: Record<string, unknown> }[];
    encoding?: string;
};

export interface HostDescriptor {
    kind: "textFile";  // future hosts add cases
    state: Record<string, unknown>;
    pipe?: PipeDescriptor;
}

export interface EditorDescriptor {
    editorId: string;
    id: string;
    state: Record<string, unknown>;
    host?: HostDescriptor;
}

export interface PageDescriptor {
    id: string;
    pinned: boolean;
    modified: boolean;
    mainEditorId: string | null;
    editors: EditorDescriptor[];
    sidebar?: { open: boolean; width: number; activePanel: string };
}

export interface WindowState {
    schemaVersion: 4;
    pages: PageDescriptor[];
    groupings?: [string, string][];
    activePageId?: string;
}

// Unchanged: WindowPages, PageDragData, FileStats
export interface WindowPages { pages: PageDescriptor[]; windowIndex: number; }
export interface PageDragData { … }
export interface FileStats { … }

// Note: sourceLink lives inside HostDescriptor.state (host-owned), not at the top of the descriptor.
```

### C2 — `editorRegistry.createEditor` accepts an optional instance id

Resolves: P6 (id handoff).

Mockup `editorRegistry.ts`:
```ts
interface EditorRegistry {
    createEditor(editorId: string, instanceId?: string): Promise<EditorModel>;
    // …
}
```

`createEditor` reads the registry entry for `editorId`, calls the constructor, and if `instanceId` is provided, sets it on the editor before returning. Restore path uses `instanceId` (so cache files keyed on `editor.id` survive); other paths (new page, switch) omit it (fresh UUID).

### C3 — `EditorModel.getRestoreData` returns `EditorDescriptor`

Resolves: P1, P6.

Mockup `EditorModel.ts`:
```ts
abstract class EditorModel<S, Q extends ComponentQueueEvent = …> {
    abstract readonly editorId: string;
    readonly id: string;

    getRestoreData(): EditorDescriptor {
        return {
            editorId: this.editorId,
            id: this.id,
            state: this._editorState(),     // override in subclasses; default = state.get() clone minus host fields
            host: this._host?.getDescriptor(),  // text-bearing editors only
        };
    }
}
```

`applyRestoreData` typed per-subclass (no longer accepts `Partial<IEditorState>`); subclass `RestoreData<S>` type passes `host` and ComponentQueue passthroughs.

### C4 — `IContentHost.getDescriptor()` and `fromDescriptor()`

Resolves: P4, P6.

Mockup `IContentHost.ts` adds:
```ts
interface IContentHost {
    // existing fields + state…
    getDescriptor(): HostDescriptor;
}

interface IContentHostClass {
    fromDescriptor(desc: HostDescriptor): Promise<IContentHost>;
}
```

`TextFileModel` provides both. Static `fromDescriptor` reconstructs the host (without doing async I/O — that happens during `host.restore()` triggered from the editor's `restore()`).

### C5 — `PagesPersistenceModel.restoreState` rewrite

Resolves: P2, P5, P7.

```ts
restoreState = async () => {
    const data = parseObject(await appFs.getDataFile(openFilesNameTemplate));
    if (!data || !Array.isArray(data.pages)) return;

    if (data.schemaVersion !== 4) {
        console.warn(`[restore] Schema version ${data.schemaVersion ?? "missing"} ≠ 4; starting empty.`);
        return;
    }

    const restored = await Promise.all(
        (data.pages as PageDescriptor[]).map(async (desc) => {
            try {
                return await this.restorePage(desc);
            } catch (err) {
                console.warn(`[restore] page ${desc.id}:`, err);
                return null;
            }
        }),
    );

    const pages = restored.filter((p): p is PageModel => p !== null);
    for (const page of pages) this.model.attachPage(page);

    const active = pages.find(p => p.id === data.activePageId);
    const ordered = active ? [...pages.filter(p => p !== active), active] : pages;
    this.model.state.update(s => { s.pages = pages; s.ordered = ordered; });

    if (data.groupings) {
        for (const [l, r] of data.groupings) this.model.layout.group(l, r);
        this.model.layout.fixGrouping();
    }
};

private async restorePage(desc: PageDescriptor): Promise<PageModel | null> {
    const page = new PageModel(desc.id);
    page.pinned = desc.pinned;

    const editors = await Promise.all(
        desc.editors.map(async (d) => {
            try {
                const editor = await editorRegistry.createEditor(d.editorId, d.id);
                editor.applyRestoreData({ ...d.state, host: d.host });
                await editor.restore();
                return editor;
            } catch (err) {
                console.warn(`[restore] editor ${d.editorId} in page ${desc.id}:`, err);
                return null;
            }
        }),
    );
    for (const editor of editors) if (editor) page.attach(editor);

    if (desc.mainEditorId && page.editors.some(e => e.id === desc.mainEditorId)) {
        page._mainEditorId = desc.mainEditorId;
        page.state.update(s => { s.mainEditorId = desc.mainEditorId; });
    }

    if (desc.sidebar) {
        const nav = page.ensurePageNavigatorModel();
        nav.setStateQuiet({ open: desc.sidebar.open, width: desc.sidebar.width });
        const panel = desc.sidebar.activePanel;
        const valid =
            panel === "explorer" || panel === "search" ||
            page.editors.some(e => e.secondaryEditor?.includes(panel));
        page.activePanel = valid ? panel : "explorer";
    }

    if (page.editors.length === 0 && !desc.sidebar) return null;
    return page;
}
```

### C6 — `PagesPersistenceModel.saveState` rewrite

Resolves: P1, P3.

```ts
saveState = async (): Promise<void> => {
    const { pages, leftRight } = this.model.state.get();
    const pageDescriptors: PageDescriptor[] = pages.map(page => ({
        id: page.id,
        pinned: page.pinned,
        modified: page.modified,
        mainEditorId: page._mainEditorId,
        editors: page.editors.map(e => e.getRestoreData()),
        sidebar: page.pageNavigatorModel
            ? {
                open: page.pageNavigatorModel.state.get().open,
                width: page.pageNavigatorModel.state.get().width,
                activePanel: page.activePanel,
            }
            : undefined,
    }));

    const storedState: WindowState = {
        schemaVersion: 4,
        pages: pageDescriptors,
        groupings: Array.from(leftRight.entries()),
        activePageId: this.model.query.activePage?.id,
    };

    await appFs.saveDataFile(openFilesNameTemplate, JSON.stringify(storedState, null, 4));
};
```

### C7 — `PageModel` cleanup (cache file pieces gone)

Resolves: P3.

Remove from `PageModel.ts`:
- `_cacheName`, `_skipSave`, `_unsubscribe`
- `restoreSidebar`, `_saveState`, `_saveStateDebounced`, `flushSave`
- `pendingSecondaryDescriptors`, `_pendingActivePanel`
- `restoreSecondaryEditors`
- `_notifyMainEditorOfSecondaryChange` (already removed by walkthrough 03)
- `confirmSecondaryRelease` (walkthrough 03 N7 already replaced via `close()` rewrite)
- `fs.deleteCacheFiles(this.id)` call in `dispose()` (page-level caches gone)

`ensurePageNavigatorModel` no longer subscribes for save-on-change — the page-level subscription on `page.state` (already in `PagesModel.attachPage`) covers `open`/`width`/`activePanel` via state mutations.

`saveState()` on PageModel becomes:
```ts
async saveState(): Promise<void> {
    await Promise.all(this.editors.map(e => e.saveState?.()));
}
```

Iterates `editors[]` for per-editor cache flush (still per-editor responsibility per C9).

### ~~C8 — Orphan cache sweep on bootstrap~~ — **DROPPED**

P9 resolved as "do nothing." No sweep, no `sweepOrphanCaches` method. `PagesPersistenceModel.init` keeps its current shape (restore → CLI → checkEmptyPage).

### ~~C9 — `app.fs` cache utilities~~ — **DROPPED**

No longer needed — without a sweep, `listCacheFiles` / `deleteCacheFile` have no caller in this walkthrough. Per-editor `fs.deleteCacheFiles(this.id)` in `EditorModel.dispose` continues to use today's existing API.

---

## Open questions for review

1. ~~**P1 — descriptor shape.**~~ **Resolved 2026-05-19** — option (b): new `EditorDescriptor` + `HostDescriptor` types. `sourceLink` lives inside `HostDescriptor.state` (host-owned).
2. ~~**P2 — version field.**~~ **Resolved 2026-05-19** — option (b): integer `schemaVersion: 4`. Single discriminator; semver/CalVer not meaningful for a typed JSON descriptor.
3. ~~**P3 — fold sidebar cache.**~~ **Resolved 2026-05-19** — option (b): fold. `<pageId>-nav-panel.txt` eliminated. Sidebar metadata + panel descriptors live in the unified `PageDescriptor`. PageModel loses `_saveState` / `_saveStateDebounced` / `_cacheName` / `_skipSave` / `restoreSidebar` / `pendingSecondaryDescriptors` / `_pendingActivePanel` / `restoreSecondaryEditors` / `flushSave`. Sidebar mutations ride the 500ms window-level debounce (200ms slower worst-case — acceptable).
4. ~~**P5 — parallel restore.**~~ **Resolved 2026-05-19** — option (b): `Promise.all` per page (and across pages). `_pendingActivePanel` retired — the active-panel resolution runs after all editors have attached. Cross-editor restore-time dependencies (e.g., LinkEditor's `pageNavigatorToggled` subscription firing before sibling Explorer attaches) handled by view-side `page.state` subscriptions (N5 pattern) — the unified attach pass closes the placeholder window to microseconds.
5. ~~**P7 — salvage on per-editor failure.**~~ **Resolved 2026-05-19** — option (b): per-editor salvage. Page drops only when ALL editors fail AND no sidebar. Missing main editor leaves the page sidebar-only (`_mainEditorId = null`).
6. ~~**P9 — orphan sweep.**~~ **Resolved 2026-05-19** — option (a): do nothing. The data-loss risk of sweeping during a restore bug outweighs the disk-space drift of a few orphaned cache files. Per-editor cleanup stays event-driven via `EditorModel.dispose → fs.deleteCacheFiles(this.id)`.
7. ~~**C9 — `app.fs.listCacheFiles` / `deleteCacheFile`.**~~ Dropped — no caller without the sweep.
8. **Bumped major version (v3.0.x → v4.0.0).** Confirms C2. Release notes call out: existing users' open files window resets to empty on first launch of v4.

---

## Adjustments to current code (non-mockup)

Logged for the implementation phase:

- `src/shared/types.ts` — rewrite per C1. Remove `EditorType`, `EditorView`, `IEditorState`. Add `EditorDescriptor`, `HostDescriptor`, `PipeDescriptor`. Rewrite `PageDescriptor`. Add `WindowState.schemaVersion`.
- `src/renderer/api/pages/PagesPersistenceModel.ts` — rewrite `saveState` (C6), `restoreState` (C5), add `restorePage` private method. Remove `restoreModel` (logic moves into `restorePage`).
- `src/renderer/api/pages/PageModel.ts` — remove sidebar cache machinery per C7. `saveState()` iterates `editors[]`. `dispose()` no longer calls `fs.deleteCacheFiles(this.id)` (page-level caches removed by P3; per-editor caches still cleaned by each `editor.dispose()` in the dispose loop).
- `src/renderer/api/pages/PagesModel.ts` — `attachPage` already covered by walkthrough 01 (E4) + walkthrough 03 (per-editor `descriptorChanged` subs). No new change here.
- `src/renderer/api/fs.ts` — no change (orphan-sweep dropped per P9).
- `src/renderer/editors/registry.ts` — `createEditor(editorId, instanceId?)` accepts optional instance UUID (C2).
- `src/renderer/editors/base/EditorModel.ts` — `getRestoreData` returns `EditorDescriptor` (C3). `applyRestoreData` typed per-subclass.
- `src/renderer/content/ContentPipe.ts` — `getDescriptor()` exists today; confirms `PipeDescriptor` shape matches.
- `src/renderer/editors/text/TextFileIOModel.ts` (or wherever host pipe restore lives after refactor) — pipe restoration moves under `TextFileModel.fromDescriptor` per walkthrough 20.
- `<userData>/openFiles.txt` — bumps to v4 shape on first save. Existing user v3.x files are detected (no `schemaVersion === 4`) and skipped per C2.
- `<userData>/cache/<pageId>-nav-panel.txt` — these files become orphaned after v3 → v4 transition. They are NOT cleaned up automatically (P9 — no sweep). Acceptable: each file is tiny (~hundreds of bytes) and the count is bounded by the number of pages the user had open at v3 upgrade time. Users who care can clear the cache directory manually.

---

## Files / concepts that are NOT changing

- `src/renderer/api/fs.ts` cache directory layout — `<userData>/cache/<id>-<name>.<ext>` naming convention survives.
- Per-editor cache file ownership — `EditorModel.dispose` still calls `fs.deleteCacheFiles(this.id)` (already in mockup `EditorModel.ts`).
- `ContentPipe` serialization (`getDescriptor`) — already returns the right shape; the field just relocates from editor to host in the on-disk blob.
- Cache file content for individual editors (Monaco decorations, Grid column state, script panel state, etc.) — per-editor concern, walkthroughs 20/21/22/26.
- `groupings` round-trip — unchanged shape (`[string, string][]` of page id pairs).
- Multi-window page transfer descriptor — walkthrough 05; this walkthrough's `EditorDescriptor` becomes its transport blob.
- `pageNavigatorToggled`, `panelExpanded` global event channels — unchanged.
- `appFs.saveDataFile` / `getDataFile` API — used as-is.

---

## Second-pass review (Tier 1 end — 2026-05-19)

Re-read against walkthroughs 05–07 and the final mockup shape. P1–P10 all hold; the descriptor design absorbed every downstream requirement without reshape.

### Downstream confirmations

- **From 05 / M1**: IPC drag payload picks up the new `PageDescriptor` shape automatically. No `schemaVersion` on the drag payload — the schema discriminator lives only at file boundaries (openFiles.txt). This walkthrough's P2 reasoning ("integer schemaVersion as single discriminator") stays scoped correctly to persistence; no leak into transient IPC.
- **From 05 / M2**: `restorePage(desc)` is the shared entry for bootstrap restore, IPC `movePageIn`, and `duplicatePage` (fresh ids). C5's sketch promoted from "private helper" to a public method on `PagesPersistenceModel` — same body, broader caller set. No structural change.
- **From 05 / M3**: `PageModel.saveState()` (added in C7) is now flushed by both `handleBeforeQuit` AND `movePageOut`. The walkthrough-04 invariant ("`saveState` is an awaitable flush, not fire-and-forget") survives — walkthrough 05 just adds a second consumer.
- **From 05 / M5**: `createEditor(id, instanceId?)` (C2) is now the single mechanism for cache-file id continuity in BOTH bootstrap restore (P6) AND multi-window transfer. The live `mockups/editorRegistry.ts` comment was extended in 05 / C1 to flag the dual use; no walkthrough-04 decision changes.
- **From 05 / M9**: "host content (`content` string) MUST NOT be in `HostDescriptor.state`; it belongs in `<editor.id>-host.txt`." Walkthrough 04 / C7 already establishes the per-editor cache convention; 05 / M9 cites it as the invariant for walkthrough 20's Monaco implementation. No change here.
- **From 06 / CK9**: Compare-mode persistence intentionally dropped — `WindowState` shape stays exactly as P1 defines it. No `compareGroups?` field added. P10's "additive optional fields don't bump schemaVersion" contract holds (vacuously, since nothing was added).
- **From 06 / CK7**: `setMainEditor` cleanup hook for non-text host swap is at PageModel level (real code), unrelated to persistence shape.
- **From 07 / GK6**: `ImperativeSplitter.widthK` persistence is deferred — could land as additive `WindowState.splitRatios?` later per P10's contract. Confirms the additive-fields-don't-bump rule has practical headroom for downstream UX work.
- **From 07 / GK1**: `WindowState.groupings?: [string, string][]` shape unchanged. Already in `PersistenceTypes.ts` from P1; no rework.

### Mockup snapshot vs. doc

Every C-adjustment landed in a foundation mockup file (PersistenceTypes.ts new, editorRegistry.ts comments extended in 05, EditorModel.ts `editorId` + `getRestoreData` shape, IContentHost.ts `getDescriptor` + `fromDescriptor` contract, PageModel.ts sidebar-cache + page-cache-deletion removal). C8 (sweep) and C9 (new fs API) dropped per P9. Live mockups match.

### Implicit invariant for walkthrough 20

P6 / C3 specifies `applyRestoreData(data: RestoreData<S>)` where `RestoreData<S> = Partial<S> & { host?: HostDescriptor; revealLine?: number; highlightText?: string }`. Walkthrough 20 (Monaco) will need to finalize the exact split between `host.state` fields (filePath, language, modified, encoding, sourceLink, content) and the editor-only state slice (cursor position, decorations, scroll). Walkthrough 04 stays agnostic — each editor decides its own state shape — but flags the split as walkthrough-20 territory.

### No new concerns

The persistence design is the load-bearing piece of the Tier 1 redesign — it threads identity, capability, and lifecycle into a single round-trippable shape. Every downstream walkthrough (05, 06, 07) consumed it without asking for changes. The major-version bump (no migration shim, detect-and-skip per C2 / P2) is the only user-facing trade-off; release notes call it out at epic close.

---

## Status

- [x] Analysis written
- [x] Reviewed by user
- [x] Concerns resolved (decisions captured) — P1–P10 all resolved
- [x] Mockups updated per resolutions — `PersistenceTypes.ts` (new, C1), `editorRegistry.ts` (C2), `EditorModel.ts` (C3 + B1 `editorId`), `IContentHost.ts` (C4), `PageModel.ts` (C7). C8 / C9 dropped per P9.
- [x] Logged in `concerns.md`
- [x] Marked `[x]` in `progress.md`
- [x] Second-pass review (2026-05-19) — confirmed against 05/06/07; no decision drift
