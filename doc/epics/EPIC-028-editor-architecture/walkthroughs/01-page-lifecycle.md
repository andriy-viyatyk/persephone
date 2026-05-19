# 01 — Page lifecycle walkthrough

Scope: create, restore, focus, close, dispose. Bootstrap flow. Empty-page auto-create. **Out of scope** (own walkthroughs): main-editor swap (`02`), secondary editors (`03`), persistence round-trip details (`04`), multi-window (`05`), compare (`06`), grouping (`07`).

**Status:** Done (2026-05-19). Mockups updated — see A1, A3, A6, A7, A8 in [`mockups/`](../mockups/). L5 deferred to walkthrough 04. Q5 deferred to walkthrough 04.

---

## What exists today

### Bootstrap

`src/renderer.tsx:9-27` — `RootComponent.bootstrap()` runs:
1. `import("./renderer/index")` in parallel with `app.init()` + `app.initSetup()`
2. `app.initServices()` — loads `settings`, `editors`, `fs`, `ui`, etc.
3. `app.initPages()` — `appFs.wait()` then `pages.init()` (PagesPersistenceModel)
4. `app.initEvents()` — registers `openRawLink`/`openLink`/`openContent` handlers (LIFO) + global/keyboard/IPC services
5. `api.windowReady()` after a 0-tick, signaling main process the window can receive `eMovePageIn` etc.

### Page creation paths

All routed through `PagesLifecycleModel.addPage(editor, existingPage?)` (PagesLifecycleModel.ts:136-159):
- Optionally takes a pre-built `PageModel` (used when callers need to set up sidebar/secondary first).
- Sets `page.mainEditor = editor` and `editor.setPage(page)` if both present.
- Dedupes by `page.id`.
- Calls `this.model.attachPage(page)` — installs `page.onClose`, subscribes to `mainEditor.state` + `page.state` for debounce-save.
- Pushes onto `state.pages` and `state.ordered`.
- Triggers `persistence.saveState()`.

Wrappers calling `addPage`:
- `addEmptyPage()` — `newTextFileModel("")` + restore + addPage
- `addEmptyPageWithNavPanel(folderPath)` — creates `PageModel`, `createExplorer(folderPath)`, `ensurePageNavigatorModel()`, addPage with `editor=null`
- `addEditorPage(editor, language, title, content?)` — branches on `editorDef.category === "standalone"` (throws), then creates `newTextFileModel("")` with `state.editor = validateForLanguage(editor, language)`
- `requireWellKnownPage(id)` — same shape as `addEditorPage` but pre-creates `PageModel(id)` so the page ID matches the well-known ID; first calls `editorRegistry.loadViewModelFactory(def.editor)`
- `openFile(filePath, pipe, options)` — dedupe by `mainEditor.filePath`, then `createEditorFromFile` + addPage + `recent.add` + `closeFirstPageIfEmpty`
- `openLinks(links, title)` — creates `TextFileModel` configured for `link-view`, then **adds it as a secondary editor, not main** (`page.addSecondaryEditor(editorModel)`, `expandPanel("link-category")`, addPage with `editor=null`)
- `_openZipArchive(filePath)` — creates `ArchiveFileModel` as main, ensures sidebar, sets `secondaryEditor = ["archive-tree"]`
- `_openAsarArchive(filePath)` — uses `addEmptyPageWithNavPanel(archiveRoot)` (no main editor)
- `showAboutPage`/`showSettingsPage`/`showStorybookPage` — fixed page ID; addPage with the loaded model
- `showBrowserPage`/`showMcpInspectorPage`/`showVideoPlayerPage` — addPage without fixed ID
- `openImageInNewTab`/`addDrawPage` — domain-specific addPage
- `movePageIn(desc, targetPageId)` — reconstructs a `PageModel(desc.id)` from another window; restores editor via `newEditorModelFromState` and (if `desc.hasSidebar`) `restoreSidebar` + `restoreSecondaryEditors`

### Restore on bootstrap

`PagesPersistenceModel.restoreState` (PagesPersistenceModel.ts:63-136):
1. Read `openFilesNameTemplate` data file. Detect "old format" (flat `IEditorState` at top level) and skip — first user interaction will save the new format.
2. For each `PageDescriptor`:
   - `page = new PageModel(desc.id)`, `page.pinned = desc.pinned`
   - If `editorData` non-empty: `restoreModel(editorData)` → `editorDef.newEmptyEditorModel(data.type)` → `applyRestoreData(data)` → `restore()`. Then `page.mainEditor = editor`, `editor.setPage(page)`.
   - If `desc.hasSidebar`: `page.restoreSidebar()` + `page.restoreSecondaryEditors(editor)` (or `null` for empty pages with sidebar only).
   - `attachPage(page)`, push to `models`.
3. Reorder so the persisted `activePageId` is last in `ordered` (most-recently-used end).
4. Restore groupings via `layout.group(left, right)` + `layout.fixGrouping()`.

`PagesPersistenceModel.init()` (PagesPersistenceModel.ts:142-156):
- `restoreState()`, then handle CLI `getFileToOpen` / `getUrlToOpen` via `openRawLink.sendAsync`, then `checkEmptyPage()`.

### Focus

`PagesNavigationModel.showPage(pageId)` — moves the page to the end of `state.ordered`, fires `onShow.send(page)` and `onFocus.send(page)`. `MainPage` and `PageTabs` subscribe.

After `addPage`, the new page is **not** automatically focused — callers either rely on `showPage` being called explicitly, or on the page being at the top of `ordered` because of `state.update`. (Most creators don't explicitly focus; the test for that is `closeFirstPageIfEmpty` running and the new page being shown because it's the only one left.)

### Close

`PageModel.close()` (PageModel.ts:212-223):
1. If `mainEditor`: `confirmSecondaryRelease()` loops modified secondary editors and asks save. Then `mainEditor.confirmRelease()` (TextFileModel prompts save dialog if modified).
2. If both succeed, call `this.onClose?.()` — set by `PagesModel.attachPage(page)`:
   ```
   page.onClose = () => { detachPage(page); removePage(page); page.dispose(); }
   ```
3. `detachPage` — unsubscribe the editor + page state subscriptions, clear `page.onClose`.
4. `removePage` — filter from `state.pages` / `state.ordered`, `layout.fixGrouping()`, `persistence.saveState()`, if active fire `onShow`/`onFocus` for the last in `ordered`, `checkEmptyPage()`.

### Dispose

`PageModel.dispose()` (PageModel.ts:599-618):
1. Unsubscribe local navigator-model subscription.
2. For each secondary editor: `setPage(null)` + `dispose()`.
3. `pageNavigatorModel?.dispose()`.
4. `mainEditor.setPage(null)` + `await mainEditor.dispose()`.
5. `fs.deleteCacheFiles(this.id)` — clears page-level cache (sidebar state).

Each editor's `dispose` (EditorModel.ts:115-119) disposes its pipe and deletes its own cache files (keyed on `editor.state.id`, distinct from `page.id`).

### Auto-create empty page

`PagesModel.checkEmptyPage()` (PagesModel.ts:128-134):
- `setTimeout(0)` then `if (state.pages.length === 0) lifecycle.addEmptyPage()`.
- Called after `removePage` and at the end of `persistence.init`.

`PagesModel.closeFirstPageIfEmpty()` (PagesModel.ts:143-160):
- After most open-flows, if there are exactly 2 pages and the first is an unmodified, untitled, content-less, `type === "textFile"` page, close it. Lets the auto-empty-page get replaced silently when the user opens their first real file.

---

## What the new architecture needs to support

Functional requirements (no regressions vs. today):

1. **Single `addPage` entry** that takes any `EditorModel | null` plus an optional pre-built `PageModel`. The page doesn't care what subclass the editor is.
2. **Pages with `mainEditor === null`** must remain a supported shape — for explorer-only pages, archive-root pages, link-collection pages (today's `openLinks`), and future sidebar-only shapes.
3. **Fixed-page-ID creation** for well-known pages (`mcp-ui-log`, `mcp-server-log`, About, Settings, Storybook). Today the caller passes `new PageModel(id)` as `existingPage`.
4. **Restore from session** — for each persisted `PageDescriptor`:
   - Create a `PageModel(desc.id)`.
   - If `desc.editor` non-empty, instantiate the right `EditorModel` subclass from `state.type` (today) → from `state.editorId` (new) and apply restore data including the wrapped host's content/filePath/pipe.
   - If `desc.hasSidebar`, restore sidebar + secondary editors.
5. **Close** with save-prompt confirmation for both main editor and any modified secondary editors. Dispose lifecycle unchanged.
6. **`checkEmptyPage` fallback** must produce a sensible empty page (today: `newTextFileModel("")` → `addPage`). New arch: needs to produce a Monaco editor wrapping an empty `TextFileModel` host.
7. **`closeFirstPageIfEmpty`** needs to identify "fresh empty Monaco page" without baking `type === "textFile"` into the page layer. Either a capability the editor exposes, or the check moves into MonacoEditor itself.
8. **Persistence-debounce subscription** — `attachPage` subscribes to the editor's state. After refactor, edits flow through *both* the editor's state (e.g., Grid column widths) *and* the host's state (`content`, `modified`). Both must trigger debounce-save.

---

## How the foundation mockups handle this

- `EditorModel` mockup keeps `page`/`setPage`, lifecycle hooks (`beforeNavigateAway`, `onMainEditorChanged`, `onPanelExpanded`), `secondaryEditor` getter/setter, `confirmRelease`, `restore`, `dispose`, `getRestoreData`, `applyRestoreData`. All page-lifecycle paths that touch `editor.*` continue to work polymorphically.
- `PageModel` mockup only documents the new `switchMainEditor` addition; the rest of today's `PageModel` is explicitly unchanged. The lifecycle methods we rely on (`addSecondaryEditor`, `restoreSidebar`, `restoreSecondaryEditors`, `setMainEditor`, `close`, `dispose`, `notifyMainEditorChanged`) are not shown but assumed to survive.
- `editorRegistry` mockup adds `createEditor(id)` and `createEditorFromFile(path, pipe)`. Old `newEmptyEditorModel`/`newEditorModelFromState`/`loadViewModelFactory`/`validateForLanguage` are gone.
- `TextFileModel` mockup is **a host, not an editor**. No `setPage`, no `secondaryEditor`, no `beforeNavigateAway`.

**Mapping today → new:**

| Today | New |
|-------|-----|
| `addEmptyPage()` builds a `TextFileModel("")` and adds it as mainEditor | `addEmptyPage()` calls `editorRegistry.createEditor("monaco")` → MonacoEditor inherits a fresh `TextFileModel` host |
| `addEditorPage(editor, language, title, content)` builds `TextFileModel` with `state.editor = X` | `addEditorPage(editorId, language, title, content)` calls `editorRegistry.createEditor(editorId)` → editor inherits `TextFileModel({content, language, title})` |
| `requireWellKnownPage(id)` builds `TextFileModel` with `state.editor = X` and `PageModel(id)` | Same as addEditorPage, but `existingPage = new PageModel(id)` |
| `openFile(filePath, pipe, options)` calls `createEditorFromFile` → returns an `EditorModel`-shaped `TextFileModel` | `editorRegistry.createEditorFromFile(filePath, pipe)` returns the right editor subclass wrapping a `TextFileModel` host built from the file |
| `openLinks(links)` puts a configured `TextFileModel` into `page.addSecondaryEditor` (no main) | `LinkEditor` is its own subclass and wraps a `TextFileModel` host. The page either makes it main (then it survives as secondary on demote, via the existing `beforeNavigateAway` flow), or it's main from the start. **Decision deferred to walkthrough 24 — Link.** |
| `restoreState()` calls `restoreModel(data)` → `editors.find(e => e.editorType === data.type).newEmptyEditorModel(...).applyRestoreData(...).restore()` | `restoreState` calls `editorRegistry.createEditor(data.editorId)` then `editor.applyRestoreData(data)` + `editor.restore()`. The editor itself reconstructs its host from `data.host` (or whatever the persisted shape is — `04 — Persistence` resolves the exact format). |
| `checkEmptyPage()` calls `lifecycle.addEmptyPage()` | Same call site, different `addEmptyPage` body |
| `closeFirstPageIfEmpty()` checks `editorState.type === "textFile" && !editorState.content && !editorState.filePath && !editorState.modified` | Becomes a capability/check on the editor — see L3 below |

---

## Concerns surfaced (lifecycle-specific)

### L1 — `addEmptyPage` must instantiate the default editor through the registry — **RESOLVED 2026-05-19**

**Problem.** Today's `addEmptyPage` constructs a `TextFileModel("")` directly (PagesLifecycleModel.ts:161-165). After refactor, "empty page" = MonacoEditor wrapping an empty TextFileModel host. There's no longer a generic "empty editor" — the empty page must commit to a specific editor type.

**Why it matters.** `checkEmptyPage` runs in two paths (post-close fallback, post-init fallback). Both currently get a `TextFileModel`. After refactor, the empty editor must be a real `MonacoEditor`. If we don't pin down the default, `checkEmptyPage` has no concrete editor to instantiate.

**Decision: option (a) — hardcode `"monaco"`.** Persephone is a Windows Notepad replacement by design; the empty page is and will remain Monaco. No setting, no `getDefaultEditor()` helper. `addEmptyPage` calls `editorRegistry.createEditorWithEmptyHost("monaco")` (A2 still applies for the host-seeding step — see L4).

**Options considered.**
- **(a) — chosen.** Hardcode `"monaco"` inside `addEmptyPage()`.
- (b) Make it a setting — rejected; product design fixes Monaco as the empty default.
- (c) Add `editorRegistry.getDefaultEditor()` — rejected; unnecessary indirection when the value never changes.

### L2 — Persistence subscription must hook editor state AND host state — **RESOLVED 2026-05-19**

**Problem.** `PagesModel.attachPage` (PagesModel.ts:63-82) subscribes to `page.mainEditor?.state.subscribe(...)`. Today's `TextFileModel` is both editor and host, so a single subscription catches content edits AND editor-local state. After refactor, content lives on the host and the editor has its own state — but the page only sees `editor.state`. Content edits won't trigger debounce-save.

**Why it matters.** The whole point of `attachPage`'s subscription is auto-persist on user edits. Missing host-state changes silently breaks restore-after-app-restart.

**What `saveStateDebounced` actually persists** (PagesPersistenceModel.ts:20-42): page descriptors built from `page.mainEditor?.getRestoreData()`. So the trigger needs to fire whenever `editor.getRestoreData()` would return a different blob. Today that's `JSON.parse(JSON.stringify(state.get()))` + `pipe` descriptor — caught by a single subscription. After refactor it becomes `{ editorState, host: { hostState, pipe } }` — two reactive sources.

**Decision: option (d) — `EditorModel.descriptorChanged: Subscription<void>`.**

The editor exposes a `descriptorChanged` `Subscription<void>` (using the primitive at `src/renderer/core/state/events.ts:13-39`). The base class auto-fires it on every state mutation. Text-bearing editors additionally forward host-state mutations on `inheritContentHost` and detach the forwarder on `extractContentHost`. `attachPage` subscribes to this signal — never to underlying state.

Benefits:
- The page layer is host-agnostic. No trait queries inside `attachPage`/`resubscribeEditor`.
- Each editor controls what counts as "persistence-worthy". Frees editors to add reactive UI state (cursor position, ephemeral flags) without dirtying every keystroke into a save cycle.
- No-host editors (PDF, Browser) work identically — they fire `descriptorChanged` on their own state mutations.
- Survives `extractContentHost`/`inheritContentHost` cleanly — re-attaching the host re-attaches the forwarder.

**Options considered.**
- (a) Each editor exposes `editor.state` as a façade that forwards host-state — rejected; conflates layers.
- (b) `attachPage` subscribes to both `editor.state` AND `host.state` via a trait reader — rejected; pushes host knowledge into the page layer.
- (c) Editors are required to bump their own state on host change — rejected; invents bookkeeping.
- **(d) — chosen.** `descriptorChanged` Subscription on `EditorModel`. Page subscribes once per editor.

**Implication for A1.** The trait still needs `getContentHost(): IContentHost | null`, but the *rationale* narrows: not for persistence, but for the switch widget (walkthrough 09) which needs to call `editorRegistry.findEditorsAccepting(host)` to populate options. See revised A1 below.

### L3 — `closeFirstPageIfEmpty` heuristic baked into PagesModel — **RESOLVED 2026-05-19**

**Problem.** `PagesModel.closeFirstPageIfEmpty` (PagesModel.ts:143-160) literally reads `editorState.type === "textFile" && !editorState.content && !editorState.filePath`. After refactor, neither `content` nor `filePath` lives on the editor's state; both are on the host. The check belongs to whichever editor counts as "the empty default".

**Why it matters.** The page-collection layer shouldn't know about editor-internal shape. Today's coupling is ugly already.

**Decision: option (a) — `EditorModel.isFreshEmpty(): boolean`.** Base returns `false`. Monaco overrides to return `true` when its host has no content, no filePath, and is not modified. `closeFirstPageIfEmpty` becomes a one-liner that doesn't know editor internals. See A3 mockup adjustment.

**Options considered.**
- **(a) — chosen.** `editor.isFreshEmpty(): boolean` on base (default false), Monaco overrides.
- (b) Marker trait `FRESH_EMPTY_TRAIT` (no methods, just presence) — rejected; trait is heavyweight for a boolean.
- (c) Auto-empty flag bookkeeping inside the empty editor — rejected; invents state.

### L4 — Fixed-page-ID flows need a registry path that doesn't immediately create a host — **RESOLVED 2026-05-19**

**Problem (reframed).** The original framing asked "do we need a helper that creates editor + empty host together?" The reframe: **host creation is the editor's own concern; the page should know nothing about hosts.** Different lifecycle entirely.

**Decision: three-phase model lifecycle.** Every editor goes through `createEditor → (applyRestoreData OR switchFrom OR nothing) → restore()`. Host construction lives entirely inside `restore()`, where the editor decides what to do based on phase-2 setup. The Page class is fully host-agnostic — it just orchestrates the three phases in known order.

**Resolutions on sub-questions:**
- **`restore` name kept.** Semantics evolve: when called after `switchFrom`, the host is already restored — the editor checks the host's existing `restored` flag (already a field on today's TextFileModel state) and skips host restore. Only editor-specific state is restored in that case.
- **`switchFrom` throws on incompatible old editor.** Default base implementation throws. Text-bearing editors override to extract host from old's CONTENT_HOST_TRAIT. A throw means the registry mis-advertised the switch as compatible — surface the bug.
- **Error rollback handled inside `restore()`** via try/catch with empty-host fallback **and a user-visible error notification** (`ui.notify(msg, "error")`). Data loss is acceptable for this edge case; the failure mode is "host construction crashed" which shouldn't happen in practice — but the user must be told so they don't think the file silently opened fine. The owner does not need rollback logic.

**Falls away.**
- A2 `createEditorWithEmptyHost` — superseded; `restore()` builds the host on its own.
- `createEditorFromFile` on the registry — superseded; open-file flow does `createEditor → applyRestoreData({filePath, pipe}) → restore()`.
- `switchEditorViaContentHost` standalone helper — gone; PageModel does `createEditor → switchFrom → restore → setMainEditor` directly. Notebook (walkthrough 29) does the same shape for note-level switching.
- Trait methods `inheritContentHost` and `getContentHost` — both become editor-private; only `extractContentHost` survives on the trait.

**Survives.**
- `CONTENT_HOST_TRAIT` — used internally by editor `switchFrom` implementations to extract host from old editor. Shrinks to a single method.
- `descriptorChanged` (A6) — wired up at the end of `restore()` once host exists.
- `isFreshEmpty` (A3) — reads from host inside Monaco, unchanged.

**The four creation paths collapse to the same shape:**

| Path | Code |
|------|------|
| `addEmptyPage()` | `e = createEditor("monaco")` → `e.restore()` (Monaco builds empty host inside restore) |
| `openFile(path, pipe)` | `e = createEditor(resolveForFile(path))` → `e.applyRestoreData({filePath, pipe})` → `e.restore()` |
| Restore from session | `e = createEditor(desc.editorId)` → `e.applyRestoreData(desc)` → `e.restore()` |
| Switch | `e = createEditor(newId)` → `e.switchFrom(oldEditor)` → `e.restore()` → `page.setMainEditor(e)` |

### L5 — `restoreModel` shape must accommodate editor + host — **DEFERRED to walkthrough 04**

**Problem.** `PagesPersistenceModel.restoreModel(data)` (PagesPersistenceModel.ts:46-61) reads `data.type`, looks up the editor by `editorType`, calls `newEmptyEditorModel`, then `applyRestoreData(data) + restore()`. The persisted blob today is flat: `data.content`, `data.filePath`, `data.editor` all sit at the top. After refactor: the editor's state is one object, the host's state is another. Need to decide the on-disk shape.

**Decision: deferred to walkthrough 04 — Persistence.** Lifecycle just needs to know that `restoreModel` becomes a three-phase call (`createEditor → applyRestoreData → restore` per A7). The on-disk shape, the migration shim from today's flat blob, and the host-vs-editor split inside the descriptor are all walkthrough-04 territory.

**What lifecycle does need:** the three-phase call site already documented in A7. It survives whatever shape walkthrough 04 settles on, because each phase's responsibility is editor-internal.

### L6 — `dispose` ordering when secondary editor IS the main editor (Pattern B) — **RESOLVED 2026-05-19**

**Problem (original).** `PageModel.dispose()` iterates `secondaryEditors`, calls `setPage(null)` + `dispose()` on each, THEN handles `mainEditor` separately. Pattern B (same model in both `_mainEditor` and `secondaryEditors`) would cause double-dispose.

**Decision: unified-array Page model.** PageModel keeps a single `editors: EditorModel[]` array. A `_mainEditorId: string | null` flag picks which editor in the array is the main. No separate `secondaryEditors[]` field on PageModel. Pattern B dissolves — it's not expressible.

#### Unified PageModel sketch

```ts
class PageModel {
    readonly id: string;

    /** All editors attached to the page. Order matches sidebar panel order. */
    readonly editors: EditorModel[] = [];

    /** Which editor in the array is the main (content area). Null = sidebar-only page. */
    private _mainEditorId: string | null = null;

    readonly state = new TOneState<IPageState>({
        pinned: false,
        hasSidebar: false,
        mainEditorId: null,
    });

    // ── Derived getters ────────────────────────────────────────────

    get mainEditor(): EditorModel | null {
        return this._mainEditorId
            ? this.editors.find(e => e.id === this._mainEditorId) ?? null
            : null;
    }

    get title(): string { return this.mainEditor?.title ?? "Empty"; }
    get modified(): boolean { return this.editors.some(e => e.modified); }
    get hasSidebar(): boolean {
        // Detail of how panels are contributed defers to walkthrough 03.
        return this.editors.some(e => e.contributesPanels?.()) || this.pageNavigatorModel !== null;
    }

    // ── Operations ────────────────────────────────────────────────

    /** Add an editor to the page. */
    attach(editor: EditorModel): void {
        if (this.editors.includes(editor)) return;
        this.editors.push(editor);
        editor.setPage(this);
        // PagesModel subscribes to editor.descriptorChanged (A6) on attach.
    }

    /** Remove an editor (does not dispose). */
    detach(editor: EditorModel): void {
        const idx = this.editors.indexOf(editor);
        if (idx < 0) return;
        this.editors.splice(idx, 1);
        editor.setPage(null);
        if (this._mainEditorId === editor.id) {
            this._mainEditorId = null;
            this.state.update(s => { s.mainEditorId = null; });
        }
    }

    /** Swap the main editor. Old main goes through beforeNavigateAway;
     *  if it has no panel contribution, it's detached + disposed. */
    async setMainEditor(newEditor: EditorModel | null): Promise<void> {
        const oldMain = this.mainEditor;
        if (oldMain && newEditor) {
            oldMain.beforeNavigateAway(newEditor);
        }
        if (newEditor && !this.editors.includes(newEditor)) {
            this.attach(newEditor);
        }
        this._mainEditorId = newEditor?.id ?? null;
        this.state.update(s => { s.mainEditorId = this._mainEditorId; });

        if (oldMain && oldMain !== newEditor && !oldMain.contributesPanels?.()) {
            this.detach(oldMain);
            setTimeout(() => oldMain.dispose(), 0);  // defer for Monaco unmount
        }
        this.notifyMainEditorChanged();
    }

    /** Dispose all attached editors. Clean loop — no Pattern B dedup needed. */
    async dispose(): Promise<void> {
        for (const editor of this.editors) {
            editor.setPage(null);
            await editor.dispose();
        }
        this.editors.length = 0;
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
        await fs.deleteCacheFiles(this.id);
    }
}
```

`notifyMainEditorChanged` iterates `editors.filter(e => e !== this.mainEditor)` and calls `onMainEditorChanged(this.mainEditor)` on each.

#### What survives, what dissolves

| Today | After |
|-------|-------|
| `_mainEditor` field + `secondaryEditors[]` field | `editors[]` + `_mainEditorId` flag |
| `addSecondaryEditor(m)` | `attach(m)` (panel contribution declared by editor itself) |
| `removeSecondaryEditor(m)` | `detach(m); m.dispose()` |
| `removeSecondaryEditorWithoutDispose(m)` | `detach(m)` |
| `promoteSecondaryToMain(m)` complexity (`_prePromotePanels`, queueMicrotask) | `_mainEditorId = m.id`; old main goes through `beforeNavigateAway` then auto-detaches if no panels |
| Pattern B dual membership | One membership in `editors`; `id === _mainEditorId` AND `contributesPanels()` is true |
| `EditorModel.secondaryEditor` setter side-effects (`addSecondaryEditor`/`removeSecondaryEditorWithoutDispose`) | Pure state setter; PageNavigator reads contributions on render — see walkthrough 03 |
| Dispose dedup risk | Clean loop |
| L6 / A4 (Pattern B assertion) | **Dropped — not expressible.** |

#### Resolution on edge cases

- **E1 — array order.** Insertion order. Main editor sits wherever it was inserted; no special slot.
- **E2 — `setMainEditor(newEditor)` when not yet attached.** `attach()` first, then set the flag. Documented in the sketch.
- **E3 — demote (`setMainEditor(null)`).** Flag clears; if old main has no panel contribution, detach + dispose.
- **E4 — Subscription bookkeeping.** `PagesModel.attachPage` walks `editors` and subscribes to `editor.descriptorChanged` (A6) on each. As editors join/leave the array, `PagesModel` maintains a per-editor sub-map keyed on editor id. **A6 implementation note.**
- **E5 — `notifyMainEditorChanged`.** Iterates `editors.filter(e => e !== this.mainEditor)`. Main editor not notified of its own change.
- **E6 — `EditorModel.secondaryEditor` setter side effects.** Drop them. Setting `secondaryEditor` becomes a pure state mutation; `PageNavigator` re-reads contributions on the next render via the version-bump pattern. Walkthrough 03 will decide the exact contribution API.

#### Deferred to walkthrough 03

How editors *expose* their panel contributions to PageNavigator. Options on the table:
- Today's `secondaryEditor: string[]` (panel IDs into `secondary-editor-registry`).
- Each editor owns nested sub-models (`LinkEditor.panels: { category, tags, hostnames }`) and PageNavigator collects them.
- A method like `editor.contributedPanels(): PanelDescriptor[]` that returns either string IDs or models.

Walkthrough 01 stays agnostic — it just commits to "PageNavigator walks `page.editors` and asks each one for its contribution."

---

## Proposed mockup adjustments

Pre-review. **None applied yet.**

### A1 — Trait shrinks to `extractContentHost` only

Resolves: L4 reframe.

Today's mockup:
```ts
export interface IContentHostTrait {
    extractContentHost(): IContentHost;
    inheritContentHost(host: IContentHost): void;
}
```

Proposed:
```ts
export interface IContentHostTrait {
    /** Detach and return the host. The new editor calls this on the OLD
     *  editor's trait inside its own switchFrom(). One-shot — calling
     *  again throws (host already gone). */
    extractContentHost(): IContentHost;
}
```

`inheritContentHost` becomes an **editor-private method** (the new editor adopts the host inside its own `switchFrom` implementation). `getContentHost` is also editor-private — `findCompatibleEditors()` on the editor reads its own host without going through the trait. The trait is reduced to one observable capability: "this editor can give up its host to another editor."

### A2 — ~~Registry helper for empty-host creation~~ — **SUPERSEDED**

~~Replaces today's category check with a registry helper.~~ Dropped — superseded by A7 (three-phase lifecycle). The editor builds its own host inside `restore()`; `addEmptyPage` calls `createEditor("monaco") + restore()`. No registry helper needed.

### A3 — `EditorModel.isFreshEmpty()` optional method

Resolves: L3.

Add to `EditorModel` mockup:
```ts
/** True if this editor wraps a never-touched, never-saved empty document.
 *  Used by PagesModel.closeFirstPageIfEmpty to silently replace the
 *  auto-created empty page when the user opens their first real file.
 *  Default: false. Override on the default-empty editor (Monaco) only. */
isFreshEmpty(): boolean { return false; }
```

MonacoEditor's override (sketched, lives in walkthrough 20):
```ts
isFreshEmpty(): boolean {
    const host = this.contentHost;
    if (!host) return false;
    const s = host.state.get();
    return !host.modified && !host.filePath && !s.content;
}
```

Then `closeFirstPageIfEmpty` becomes:
```ts
closeFirstPageIfEmpty = () => {
    const pages = this.state.get().pages;
    if (pages.length !== 2) return;
    const first = pages[0];
    if (first.pinned) return;
    if (first.mainEditor?.isFreshEmpty() === true) first.close();
};
```

### A4 — ~~Pattern B invariant assertion in `PageModel.dispose`~~ — **DROPPED**

Resolves: L6 — but no longer needed.

L6 was resolved by the unified-array PageModel redesign (`editors[]` + `_mainEditorId` flag). Pattern B is no longer expressible — a model has exactly one membership in `editors`, with separate flags for "is main" and "contributes panels". `dispose()` is a clean loop over `editors` with no dedup logic.

**Dropped.**

### A8 — Unified-array `PageModel`

Resolves: L6 (by structural redesign).

Replaces the dual-field `_mainEditor` + `secondaryEditors[]` shape in today's `PageModel` (PageModel.ts:60-79) with a single `editors: EditorModel[]` array plus a `_mainEditorId: string | null` flag. Full sketch is inline in L6 above; not duplicated here.

Key implementation rules:
1. `attach(editor)` / `detach(editor)` are the only membership-mutation primitives.
2. **Visibility criterion** — an editor is kept in `editors[]` iff `(editor.id === _mainEditorId) || editor.contributesPanels()`. Otherwise PageModel auto-detaches + disposes. Evaluated at two firing points:
   - When `setMainEditor` changes `_mainEditorId` — old main re-evaluated.
   - When an editor's panel contribution changes (notification mechanism: walkthrough 03).
3. `setMainEditor(newEditor)` updates `_mainEditorId`, ensures the new editor is attached, and applies the visibility criterion to the old main.
4. `dispose()` is a clean loop: `for (e of editors) await e.dispose()`. No dedup. No Pattern B branch.
5. `EditorModel.secondaryEditor` setter loses its `addSecondaryEditor`/`removeSecondaryEditorWithoutDispose` side effects — becomes a pure state mutation. The PageNavigator re-reads contributions on render (walkthrough 03 defines the API).
6. `PagesModel.attachPage` (the page-level persistence subscription) walks `editors` and subscribes to `descriptorChanged` (A6) on each, maintaining a per-editor sub-map.

Mockup change scope: `PageModel.ts` mockup gets a substantial rewrite; `EditorModel.ts` mockup loses the `secondaryEditor` side-effect code in its setter. Walkthroughs 02/03/05 inherit the unified-array shape.

### A7 — Three-phase model lifecycle

Resolves: L4.

Add to `EditorModel` base (mockup):
```ts
import { Subscription } from "../../core/state/events";

class EditorModel<...> extends TDialogModel<...> {
    // ── Phase 2 — caller picks ONE (or neither for fresh-empty) ────────

    /** Remember persisted/file setup data for use in restore(). Sync.
     *  Does NOT do I/O. Default just stashes the data; subclasses may
     *  parse minimal fields they need before restore(). */
    applyRestoreData(data: Partial<T>): void { /* override */ }

    /** Pull whatever is transferable from `oldEditor`. Text-bearing
     *  editors extract host via oldEditor.traits.get(CONTENT_HOST_TRAIT).
     *  Throws if the old editor cannot give up what this editor needs. */
    switchFrom(_oldEditor: EditorModel): void {
        throw new Error(`${this.constructor.name} does not implement switchFrom`);
    }

    // ── Phase 3 — finalize ────────────────────────────────────────────

    /** Realize the editor. Creates the host if not already inherited from
     *  switchFrom; restores from cache/disk; subscribes; wires
     *  descriptorChanged forwarding. After restore() resolves, the editor
     *  is fully usable. Errors INSIDE this method are caught and fallback
     *  to empty host with a ui.notify("...", "error") notification. */
    async restore(): Promise<void> { /* override */ }

    // ── Switch widget support ────────────────────────────────────────

    /** Editor ids the user can switch to from this editor. Default empty
     *  (no switching). Text-bearing editors return
     *  editorRegistry.findEditorsAccepting(this._host). */
    findCompatibleEditors(): string[] { return []; }
}
```

Text-bearing editor sketch (lives in walkthrough 20):
```ts
class MonacoEditor extends EditorModel {
    private _host: TextFileModel | null = null;
    private _pending: Partial<IEditorState> | null = null;
    private _hostUnsub?: () => void;

    constructor() {
        super();
        this.traits.add(CONTENT_HOST_TRAIT, {
            extractContentHost: () => {
                if (!this._host) throw new Error("No host to extract");
                this._hostUnsub?.();
                this._hostUnsub = undefined;
                const h = this._host;
                this._host = null;
                return h;
            },
        });
    }

    applyRestoreData(data: Partial<IEditorState>): void {
        this._pending = data;
    }

    switchFrom(oldEditor: EditorModel): void {
        const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
        if (!trait) throw new Error("Cannot switchFrom: old editor has no CONTENT_HOST_TRAIT");
        this._host = trait.extractContentHost() as TextFileModel;
        // Host arrives already-restored (its `restored` flag is true).
    }

    async restore(): Promise<void> {
        // 1. Ensure host exists
        if (!this._host) {
            try {
                this._host = await this._buildHostFromPending();
            } catch (err) {
                ui.notify(`Failed to construct content; opening empty: ${err.message}`, "error");
                this._host = new TextFileModel();
            }
        }
        // 2. Restore host only if not already restored
        if (!this._host.state.get().restored) {
            try {
                await this._host.restore();
            } catch (err) {
                ui.notify(`Failed to restore content; opening empty: ${err.message}`, "error");
                await this._host.dispose();
                this._host = new TextFileModel();
                await this._host.restore();
            }
        }
        // 3. Editor-specific state (cursor, decorations, etc.)
        await this._restoreEditorOnlyState();
        // 4. Wire descriptorChanged forwarding (A6)
        this._hostUnsub = this._host.state.subscribe(
            () => this.descriptorChanged.send()
        ).unsubscribe;
    }

    findCompatibleEditors(): string[] {
        return this._host ? editorRegistry.findEditorsAccepting(this._host) : [];
    }
}
```

`PageModel.switchMainEditor`:
```ts
async switchMainEditor(newEditorId: string): Promise<void> {
    const oldEditor = this._mainEditor;
    if (!oldEditor) return;
    const newEditor = await editorRegistry.createEditor(newEditorId);
    newEditor.switchFrom(oldEditor);          // extracts host from old's trait
    await newEditor.restore();                // host already restored; only editor-state restored
    await this.setMainEditor(newEditor);      // disposes old (its host reference is null now)
}
```

`addEmptyPage`:
```ts
addEmptyPage = async (): Promise<PageModel> => {
    const editor = await editorRegistry.createEditor("monaco");
    await editor.restore();                   // Monaco creates empty TextFileModel inside restore
    return this.addPage(editor);
};
```

`openFile`:
```ts
const editor = await editorRegistry.createEditor(editorRegistry.resolveForFile(filePath));
editor.applyRestoreData({ filePath, pipe, sourceLink, title });
await editor.restore();
this.addPage(editor);
```

Restore from session (`PagesPersistenceModel.restoreState`):
```ts
const editor = await editorRegistry.createEditor(desc.editor.editorId);
editor.applyRestoreData(desc.editor);
await editor.restore();
page.mainEditor = editor;
```

### A6 — `EditorModel.descriptorChanged: Subscription<void>`

Resolves: L2.

Add to `EditorModel` mockup:
```ts
import { Subscription } from "../../core/state/events";

class EditorModel<...> extends TDialogModel<...> {
    /** Fired when this editor's persisted shape (getRestoreData blob) changes.
     *  PagesModel subscribes to drive saveStateDebounced. Each editor decides
     *  when its descriptor is dirty — base class auto-fires on every state
     *  mutation; subclasses with additional reactive surfaces (e.g., the
     *  content host) MUST forward those onto this Subscription. */
    readonly descriptorChanged = new Subscription<void>();

    constructor(...) {
        super(...);
        // Default behavior: any state mutation is a persistence-worthy change.
        this.state.subscribe(() => this.descriptorChanged.send());
    }
}
```

Text-bearing editor sketch (lives in walkthrough 20 — Monaco):
```ts
class MonacoEditor extends EditorModel {
    private _host: IContentHost | null = null;
    private _hostUnsub?: () => void;

    constructor() {
        super();
        this.traits.add(CONTENT_HOST_TRAIT, {
            getContentHost: () => this._host,
            extractContentHost: () => {
                this._hostUnsub?.();
                this._hostUnsub = undefined;
                const h = this._host!;
                this._host = null;
                return h;
            },
            inheritContentHost: (host) => {
                this._host = host;
                this._hostUnsub = host.state.subscribe(
                    () => this.descriptorChanged.send()
                ).unsubscribe;
            },
        });
    }
}
```

`PagesModel.attachPage` / `resubscribeEditor`:
```ts
attachPage = (page: PageModel) => {
    const editor = page.mainEditor;
    const descUnsub = editor?.descriptorChanged.subscribe(
        () => this.persistence.saveStateDebounced()
    );
    const pageUnsub = page.state.subscribe(
        () => this.persistence.saveStateDebounced()
    );
    this.pageSubscriptions.set(page.id, () => {
        descUnsub?.unsubscribe();
        pageUnsub();
    });
    page.onClose = () => { ... };
};
```

### A5 — `restoreModel` shape (deferred to 04)

Resolves: L5.

No mockup change in this walkthrough. Logged as a forward-pointer to walkthrough 04. The lifecycle code path remains:
```ts
const editor = await this.restoreEditorFromDescriptor(desc.editor);
page.mainEditor = editor;
editor.setPage(page);
```
…where `restoreEditorFromDescriptor` is whatever walkthrough 04 defines.

---

## Open questions for review

1. ~~**L1/A2 — default editor.**~~ **Resolved 2026-05-19** — hardcode `"monaco"`.
2. ~~**L3/A3 — `isFreshEmpty` placement.**~~ **Resolved 2026-05-19** — on `EditorModel` base, default false, Monaco overrides.
3. ~~**L6/A4 — Pattern B assertion strength.**~~ **Resolved 2026-05-19** — unified-array PageModel (A8) makes Pattern B inexpressible; A4 dropped.
4. ~~**`openLinks` shape.**~~ **Resolved 2026-05-19** — yes, `_mainEditorId === null` with editors in `editors[]` is a first-class shape (explorer-only, archive-root, openLinks). Plus the **visibility criterion** for editor lifetime in `editors[]`: an editor is kept iff (it is the main editor) OR (it contributes panels shown in PageNavigator). Otherwise PageModel detaches + disposes. See A8 update.
5. **Scope of bootstrap restore in this walkthrough.** Persistence-format details bounce to 04. Did I draw the line in the right place, or should something currently in 04 land here instead?

---

## Adjustments to current code (non-mockup)

These are notes on the **current** lifecycle methods that will need changing during implementation — not now, but logged so the implementation phase has them in hand.

- `PagesLifecycleModel.addEmptyPage` — must become async; two-line body: `createEditor("monaco")` + `restore()`. Affects all callers (`checkEmptyPage` via `setTimeout(0)`; `requireGroupedText`).
- `PagesLifecycleModel.addEditorPage` — drop the `category === "standalone"` branch; three-phase: `createEditor(editorId) → applyRestoreData({language, title, content}) → restore()`.
- `PagesLifecycleModel.requireWellKnownPage` — drop `loadViewModelFactory`; three-phase with `existingPage = new PageModel(id)`.
- `PagesLifecycleModel.createEditorFromFile` and `newEditorModel`/`newEditorModelFromState` helpers — collapsed into the three-phase pattern at the call site.
- `PagesPersistenceModel.restoreModel` — same three-phase shape; see L5 (walkthrough 04).
- `PageModel.switchMainEditor` (new) — `createEditor → switchFrom → restore → setMainEditor` directly, no helper.
- `PagesLifecycleModel.openLinks` — defer to walkthrough 24.
- `PagesModel.attachPage` — subscribe to `editor.descriptorChanged` instead of `editor.state` (A6).
- `PagesModel.resubscribeEditor` — same.
- `PagesModel.closeFirstPageIfEmpty` — replace the literal check with `mainEditor?.isFreshEmpty?.() === true`.
- `PageModel.dispose` — clean loop over `editors[]`. No Pattern B dedup needed (A8 redesign makes Pattern B inexpressible).
- `PageModel` itself — rewrite around unified `editors[]` + `_mainEditorId` flag (A8). Replaces `_mainEditor`/`secondaryEditors[]` dual field. Affects `attach`/`detach`/`setMainEditor`/`promoteSecondaryToMain`/`dispose`/title/modified/hasSidebar.
- `EditorModel.secondaryEditor` setter — drop the `addSecondaryEditor`/`removeSecondaryEditorWithoutDispose` side effects. Becomes a pure state mutation. PageNavigator reads contributions per walkthrough 03.

---

## Second-pass review (Tier 1 end — 2026-05-19)

Re-read against the final Tier 1 mockup shape and the resolutions captured in walkthroughs 02–07. The lifecycle decisions hold — none of L1–L7 / A-series were invalidated. Several mockup snippets inline in this doc are now stale relative to the actual `mockups/PageModel.ts` and `mockups/EditorModel.ts` files; they remain useful as design rationale but should be read alongside the live mockup, not as drop-in code.

### What later walkthroughs added on top of this walkthrough's mockups

- **From 02 / B1**: `EditorModel.editorId: string` abstract field landed in `EditorModel.ts`. The A7 "four creation paths" table here uses `data.type` and `desc.editor.editorId` interchangeably — read it as `desc.editorId` against the unified `EditorDescriptor` shape from walkthrough 04 / P1.
- **From 02 / B4**: `ComponentQueue` (per-editor model→view mailbox) is now on `EditorModel` as `readonly queue: ComponentQueue<E>` with a third class generic. `EditorModel.dispose()` is no longer empty — it calls `this.queue.dispose()`. The A8 PageModel sketch's `for (e of editors) await e.dispose()` is still correct because subclass overrides call `super.dispose()`.
- **From 02 / S10**: `IEditorState.type` / `.editor` / `EditorDefinition.editorType` retired. L3's discussion text still references `type === "textFile"` — read it as "today's check"; the new check reads `host instanceof TextFileModel` (already what A3's Monaco override shows).
- **From 03 / N1, B3, B4**: PageModel's `attach`/`detach` got a per-editor slice-subscription bookkeeping layer (`_editorSubs: Map<string, () => void>`) plus an `onEditorPanelsChanged` handler. The A8 sketch in this walkthrough shows the simpler shape — it predates 03's TOneState selector overload. The live `mockups/PageModel.ts` has the final shape.
- **From 03 / B6**: `close()` iterates panel editors first, main editor last. The A8 sketch doesn't show `close()`; the live mockup does, per walkthrough 03 / N7.
- **From 04 / L5 (resolved here, codified there)**: `restoreModel` shape is now `EditorDescriptor { editorId, id, state, host? }` + `HostDescriptor { kind, state, pipe? }` + unified `PageDescriptor.editors[]`. The A7 four-paths table's "Restore from session" row should be read as: `editor = await editorRegistry.createEditor(desc.editorId, desc.id); editor.applyRestoreData({...desc.state, host: desc.host}); await editor.restore();`.
- **From 04 / C2 / P6**: `editorRegistry.createEditor(id, instanceId?)` accepts an optional id. Affects A7's table — session-restore passes `desc.id` as `instanceId` so cache-file continuity holds (C9).
- **From 04 / P3 / C7**: `<pageId>-nav-panel.txt` sidebar cache file is retired. The A8 PageModel sketch's `dispose()` body still ends with `await fs.deleteCacheFiles(this.id)` — the live mockup removes this trailing call (no page-level cache to clean) while keeping per-editor `fs.deleteCacheFiles(editor.id)` inside the dispose loop. `_saveState` / `_saveStateDebounced` / `_cacheName` / `_skipSave` / `restoreSidebar` / `pendingSecondaryDescriptors` / `_pendingActivePanel` / `restoreSecondaryEditors` / `flushSave` all gone from PageModel; the A8 sketch never mentioned them, but the "Adjustments to current code" section should be read with them deleted.
- **From 04 / P5**: `_pendingActivePanel` retired in favor of parallel `Promise.all` restore. Walkthrough 01 deferred this to 04 (it was Open question 4's "what about openLinks shape"); no rework needed here, just confirmation that the deferred bit landed cleanly.
- **From 05 / M3 / C2**: `PageModel.saveState()` is added as an awaitable flush iterating `editors[]`. Called by `handleBeforeQuit` AND `movePageOut`. The A8 sketch didn't include `saveState()`; the live mockup does.
- **From 05 / M5 / C1**: `instanceId` covers both session-restore AND multi-window transfer cache-file id continuity. A7's table doesn't need to mention multi-window — it's a different walkthrough — but the mechanism is identical, single registry helper.
- **From 06 / CK7**: `PageModel.setMainEditor(newMain)` gains a "if this page is in a compare pair AND the new main's host isn't `TextFileModel`, exit compare for the pair" cleanup hook (real-code only — the live mockup doesn't show it because `compareGroups` lives on `PagesModel.state`, not `PageModel`). Worth flagging for the implementation phase but no mockup change required.
- **From 07 / GK10**: `findPage(id)` resolution under unified `editors[]` works correctly via `p.id || p.editors.some(e => e.id === id)` — already in shape from A8. Walkthrough 07 confirmed no change needed.

### Drift in the in-doc mockup sketches

The A8 PageModel sketch inline in L6 of this walkthrough captures the **initial** unified-array proposal. The **final** `mockups/PageModel.ts` extends it with:
- `_editorSubs: Map<string, () => void>` field (03 / N1).
- `attach()` sets up a slice subscription; `detach()` tears it down (03 / N1).
- `onEditorPanelsChanged(editor)` handler (03 / B4).
- `panelEditors` getter (03 / N3).
- `close()` method with panel-first / main-last ordering (03 / B6 / N7).
- `setMainEditor` cache-cleanup branch on id transfer (04 / C7 / 05 / M5).
- `reconcileVisibility()` standalone method (split out from notifyMainEditorChanged for clarity).
- `saveState()` method that iterates editors (04 / C7 / 05 / M3).
- No trailing `fs.deleteCacheFiles(this.id)` in `dispose()` (04 / P3).

These refinements are **additive** — A8's structural decisions (single array, `_mainEditorId` flag, visibility criterion, Pattern B inexpressible) all survive intact in the final mockup. The sketch in this doc is best read as the design rationale; the live mockup file is the source of truth for the final shape.

### No regressions, no new concerns

The lifecycle resolutions (L1 hardcode "monaco", L3 `isFreshEmpty()`, L4 three-phase lifecycle, L6 unified array, L7 visibility criterion) survive every later walkthrough untouched. L2 (`descriptorChanged`) is consumed by 04 / P3 (drives `saveStateDebounced` once the sidebar cache is folded into the unified descriptor). L5 was deferred to 04 and landed clean.

No new concerns surfaced during the second pass.

---

## Status

- [x] Analysis written
- [x] Reviewed by user
- [x] Concerns resolved (decisions captured) — L1, L2, L3, L4, L6, L7 resolved; L5 deferred to 04
- [x] Mockups updated per resolutions — A1 (traits.ts), A3+A6+A7 (EditorModel.ts), A8 (PageModel.ts), A7 (editorRegistry.ts)
- [x] Logged in `concerns.md`
- [x] Marked `[x]` in `progress.md`
- [x] Second-pass review (2026-05-19) — drift in in-doc A8 sketch noted; all decisions still hold
