# Walkthrough 11 — Empty pages & well-known pages

**Status:** Done (2026-05-20)

Tier 3 opens here. Tiers 1 and 2 nailed down the foundation (page core, persistence, UI surfaces); Tier 3 verifies the foundation handles **page shapes that aren't the typical "tab with a main editor"** — empty Monaco pages, sidebar-only pages with no main editor, and singleton pages with fixed ids.

Most of the architecture is already in place. This walkthrough is mostly a **verification pass** with a few real questions about `addEditorPage`'s shape after `state.editor` retires (S10), well-known instance-id propagation, and where language lives in the new host-split world.

---

## What exists today

Four distinct entry points in `PagesLifecycleModel.ts` (cross-referenced earlier in this epic) plus a small definitions file:

### Entry point 1 — `addEmptyPage()` (lines 161-165)

```typescript
addEmptyPage = (): PageModel => {
    const emptyFile = newTextFileModel("");
    emptyFile.restore();
    return this.addPage(emptyFile as unknown as EditorModel);
};
```

Boot-time fresh page. Empty Monaco editor, no file path, no title. The L3-resolved `isFreshEmpty()` heuristic identifies this kind of page so it can be auto-closed when a real file opens (`closeFirstPageIfEmpty`).

### Entry point 2 — `addEmptyPageWithNavPanel(folderPath)` (lines 167-172)

```typescript
addEmptyPageWithNavPanel = async (folderPath: string): Promise<PageModel> => {
    const page = new PageModel();
    await page.createExplorer(folderPath);
    page.ensurePageNavigatorModel();
    return this.addPage(null, page);
};
```

Sidebar-only page. `addPage(null, …)` — no main editor. The page has an Explorer editor as a panel-contributor and the PageNavigator chrome enabled. Used by "Open Folder", `_openAsarArchive`, drag-drop a folder, etc.

### Entry point 3 — `addEditorPage(editor, language, title, content?)` (lines 174-207)

```typescript
addEditorPage = (
    editor: EditorView, language: string, title: string, content?: string,
): PageModel => {
    // … positional-args runtime guard + standalone-editor reject …
    const editorModel = newTextFileModel("");
    editorModel.state.update((s) => {
        s.title = title;
        s.language = language;
        s.editor = editorRegistry.validateForLanguage(editor, language);
    });
    if (content) editorModel.changeContent(content);
    editorModel.restore();
    return this.addPage(editorModel as unknown as EditorModel);
};
```

Script API entry. Today's shape:
- **Always** creates a `TextFileModel` and stuffs the editor type onto `state.editor`. Works only because today every text-bearing view (grid, markdown, link, todo, …) is just a `TextFileModel` with `state.editor` flipped.
- After EPIC-028: `state.editor` field is gone (S10); each text-bearing editor is its own `EditorModel` subclass; the registry creates the correct class directly.

### Entry point 4 — `requireWellKnownPage(id)` (lines 209-234)

```typescript
requireWellKnownPage = async (id: string): Promise<PageModel> => {
    const existing = this.model.query.findPage(id);
    if (existing) { this.model.navigation.showPage(id); return existing; }

    const def = getWellKnownPageDef(id);
    if (!def) throw new Error(`Unknown well-known page ID: "${id}"`);

    await editorRegistry.loadViewModelFactory(def.editor as EditorView);
    const editorModel = newTextFileModel("");
    editorModel.state.update((s) => {
        s.id = id;
        s.title = def.title;
        s.language = def.language;
        s.editor = editorRegistry.validateForLanguage(def.editor as EditorView, def.language);
    });
    editorModel.restore();
    const page = new PageModel(id);
    return this.addPage(editorModel as unknown as EditorModel, page);
};
```

Singleton dispatch by id. The def lives in `well-known-pages.ts` and has `{ id, title, editor, language }`. Two registered today: `mcp-ui-log` and `mcp-server-log` — both log-view editors with `jsonl` language.

Notable: the def's `id` is used as **both** the editor instance id (today's `state.id`) AND the `PageModel(id)` constructor arg — same string in two namespaces.

### Entry point 5 — fixed-id singleton flows (lines 711-806)

`showAboutPage`, `showSettingsPage`, `showStorybookPage` each:
- `await import(...)` the per-page module
- Call `module.default.newEmptyEditorModel("aboutPage" /* etc. */)`
- Construct `new PageModel(module.ABOUT_PAGE_ID)` — **fixed** page id
- Call `addPage(model, page)`

`showMcpInspectorPage` and `showVideoPlayerPage` create their pages **without** a fixed id — those are not singletons.

`addPage` itself (lines 136-159) checks `findPage(page.id)` and `showPage`s on collision — singleton dedup is implicit for fixed-id flows.

### Definitions file — `well-known-pages.ts`

```typescript
export interface WellKnownPageDef {
    id: string; title: string; editor: string; language: string;
}
// Registered: "mcp-ui-log" (log-view, jsonl), "mcp-server-log" (log-view, jsonl)
```

---

## What the new architecture needs to support

1. **Empty Monaco page on boot** — `addEmptyPage` creates a fresh Monaco editor with no content, no file, no title. `closeFirstPageIfEmpty` finds it via `isFreshEmpty()` (L3) when a real file opens.
2. **Sidebar-only pages** — `mainEditorId: null` + populated `editors[]` (panel-contributors only) + `sidebar?` block. Already resolved by P8 (persistence round-trips); needs verification at the lifecycle level.
3. **Singleton pages with fixed ids** — About, Settings, Storybook, mcp-ui-log, mcp-server-log. Implicit dedup via `addPage(page.id)` collision check.
4. **`addEditorPage` script API** — accepts an editor id + language + title + optional content; creates the **correct editor class** via the registry (not always-a-TextFileModel).
5. **`requireWellKnownPage`** — resolves by id; creates the editor via registry; propagates the well-known id to the editor's instance id so cache files are stable across restarts.
6. **Persistence round-trip of empty-with-sidebar** — covered by P8; this walkthrough confirms it.
7. **`closeFirstPageIfEmpty`** heuristic — `isFreshEmpty()` returns true for `addEmptyPage`'s output but false for `addEditorPage("monaco", "javascript", "Custom Title")` (title is set).

---

## How the foundation mockups handle this

### `addEmptyPage` — confirms L1 + A7

Per **L1** (walkthrough 01): hardcode `"monaco"` inside `addEmptyPage`. No `getDefaultEditor()` helper, no setting — Persephone is a notepad replacement by design.

```typescript
addEmptyPage = async (): Promise<PageModel> => {
    const editor = await editorRegistry.createEditor("monaco");
    await editor.restore();   // A7 phase 3 — creates empty TextFileModel host
    return this.addPage(editor);
};
```

The `restore()` call constructs a fresh empty `TextFileModel` host via `MonacoEditor.restore()`'s "no pending host" branch (A7 internal). The host's state is the default: `content=""`, `filePath=undefined`, `modified=false`.

### `addEmptyPageWithNavPanel(folderPath)` — sidebar-only page (P8 verification)

```typescript
addEmptyPageWithNavPanel = async (folderPath: string): Promise<PageModel> => {
    const page = new PageModel();
    // Explorer stays outside the main editor registry (today's pattern preserved)
    const { ExplorerEditorModel } = await import("../../editors/explorer");
    const explorer = new ExplorerEditorModel();
    explorer.state.update((s) => { s.rootPath = folderPath; });
    await explorer.restore();
    explorer.secondaryEditor = ["file-explorer"];   // contributes a panel
    page.attach(explorer);
    page.ensurePageNavigatorModel();
    return this.addPage(null, page);                // mainEditor stays null
};
```

P8 already says empty-with-sidebar pages restore naturally — `mainEditorId: null` + `editors[]` populated + `sidebar?` present. This is the matching create path.

### `addEditorPage(editorId, language, title, content?)` — script API rewrite

Today's `newTextFileModel + s.editor = X` shape collapses post-S10. New shape: registry creates the correct class; initial state passes through `applyRestoreData` (P6 contract).

```typescript
addEditorPage = async (
    editorId: string, language: string, title: string, content?: string,
): Promise<PageModel> => {
    if (typeof editorId !== "string") {/* runtime guard preserved */}
    const editorDef = editorRegistry.getById(editorId);
    if (!editorDef && editorId !== "monaco") {
        throw new Error(`Editor '${editorId}' is not registered. …`);
    }
    if (editorDef?.category === "standalone") {
        throw new Error(`Cannot create '${editorId}' with addEditorPage() — …`);
    }
    const editor = await editorRegistry.createEditor(editorId);
    editor.applyRestoreData({
        title,
        host: { kind: "textFile", state: { content: content ?? "", language } },
    });
    await editor.restore();
    return this.addPage(editor);
};
```

Three things to notice:
1. The registry produces the correct **EditorModel subclass** (MonacoEditor / GridEditor / MarkdownEditor / …) — no more "single TextFileModel with a flag."
2. Content + language ride through `applyRestoreData` as a synthetic `HostDescriptor`. The editor's `restore()` reconstructs the host via `TextFileModel.fromDescriptor(...)` per P6's contract.
3. Title sits on the editor's own state (mirrors `EditorDescriptor.state` shape from P1).

### `requireWellKnownPage(id)` — registry-driven creation with instance-id propagation

```typescript
requireWellKnownPage = async (id: string): Promise<PageModel> => {
    const existing = this.model.query.findPage(id);
    if (existing) { this.model.navigation.showPage(id); return existing; }

    const def = getWellKnownPageDef(id);
    if (!def) throw new Error(`Unknown well-known page ID: "${id}"`);

    const editor = await editorRegistry.createEditor(def.editor, def.id);  // instanceId = def.id
    editor.applyRestoreData({
        title: def.title,
        host: { kind: "textFile", state: { language: def.language } },
    });
    await editor.restore();
    const page = new PageModel(def.id);
    return this.addPage(editor, page);
};
```

Key change: `createEditor(def.editor, def.id)` propagates the well-known id as the editor's **instance id** (per P6's `createEditor(id, instanceId?)` signature). Cache files key on `def.id` regardless of restart — `mcp-ui-log-host.txt` survives reboots, so the log content is preserved.

`page.id` is also `def.id` (same string in the page-id namespace). `findPage` resolves either way; the matching strings are convenient, not required.

The `loadViewModelFactory` preamble in today's code is gone — `createEditor` internally awaits the editor module load (registry contract).

### Fixed-id singleton flows — unchanged shape

About / Settings / Storybook continue to:
- Dynamic-import the per-page module
- Call module's `newEmptyEditorModel(...)`-equivalent (the per-page module owns its EditorModel subclass)
- Construct `new PageModel(MODULE_FIXED_ID)`
- Call `addPage(editor, page)` — implicit dedup via `findPage(page.id)`

The per-page modules are walkthrough 30 scope (no-host editors). This walkthrough just confirms the singleton-page mechanism still works under the new architecture.

### `closeFirstPageIfEmpty` — confirms L3

L3 resolved this with `EditorModel.isFreshEmpty(): boolean` (default false; Monaco overrides). The override checks:
- `host.state.content === ""`
- `host.state.filePath === undefined`
- `editor.state.title` is the default (empty or "Untitled")
- `!host.state.modified`

`addEditorPage("monaco", "javascript", "My Page")` sets title → not fresh-empty → `closeFirstPageIfEmpty` keeps the first page. `addEmptyPage()` → fresh-empty → first page eligible for close. Confirmed at the override level; walkthrough 20 finalizes Monaco's `isFreshEmpty` body.

---

## Concerns

EW1 — [x] `addEmptyPage` shape under the new arch — confirm L1 + A7
EW2 — [x] `addEditorPage` shape post-S10 — `state.editor` is gone
EW3 — [x] `requireWellKnownPage` — instance-id propagation
EW4 — [x] Page id = editor id collision in well-known flow — namespaces and overlap
EW5 — [x] `addEmptyPageWithNavPanel` — Explorer creation under unified `editors[]`
EW6 — [x] `WellKnownPageDef.language` placement — host-owned vs. editor-owned
EW7 — [x] `WellKnownPageDef` future extensibility — minimal shape vs. richer descriptor
EW8 — [x] Singleton dedup pattern — explicit findPage vs. addPage's implicit collision check
EW9 — [x] Persistence of empty-with-sidebar pages — verify P8 holds here
EW10 — [x] `closeFirstPageIfEmpty` heuristic — confirm L3's `isFreshEmpty()` discriminates `addEditorPage` correctly

### EW1 — `addEmptyPage` shape under the new arch

**Question.** Today's `newTextFileModel("") + restore()` collapses into `editorRegistry.createEditor("monaco") + editor.restore()`. Is anything missing?

**Options.**
- **(a)** Two-call shape — `createEditor("monaco")` + `restore()`. (Recommended)
- **(b)** Add a registry helper `editorRegistry.createEmpty(editorId)` that wraps both. (One-caller convenience.)

**Recommendation.** (a). Two calls is the same pattern every other lifecycle uses (per A7) — `createEditor → applyRestoreData → restore`. `addEmptyPage` just skips phase 2 (no setup data). No registry helper needed for one-caller convenience.

**Side effect.** `addEmptyPage` becomes async (returns `Promise<PageModel>` instead of `PageModel`) to await `restore()`. Callers already inside an async chain — `openLinks`, `_openAsarArchive`, etc. — pick up the await transparently. The script API surface (today `pages.addEmpty()` returns a wrapper synchronously) gets a one-line wrap in the script facade — defer the exact wrapping shape to walkthrough 12 alongside the other script facades.

**Resolution.** Option (a). Two-call shape preserved; `addEmptyPage` becomes async. Confirms L1 (hardcode `"monaco"`) and A7 (three-phase lifecycle). Script-facade wrapping deferred to walkthrough 12.

### EW2 — `addEditorPage` shape post-S10

**Question.** Today's `newTextFileModel("") + state.editor = X + changeContent(content) + restore()` doesn't survive — there's no `state.editor` field anymore (S10), and the registry's `createEditor(editorId)` already builds the correct EditorModel subclass. How do content + language + title get into the new editor cleanly?

**Options.**
- **(a)** `applyRestoreData` with a synthetic `HostDescriptor`. Threads through the same shape persistence uses (P6). (Recommended)
  ```typescript
  const editor = await editorRegistry.createEditor(editorId);
  editor.applyRestoreData({
      title,
      host: { kind: "textFile", state: { content: content ?? "", language } },
  });
  await editor.restore();
  ```
- **(b)** Direct state mutation after construction: `editor.state.update(s => { s.title = title })`, then `restore()`, then `editor.contentHost.state.update(s => { s.content = content; s.language = language })`.
- **(c)** New `createEditor(editorId, instanceId?, initialState?)` overload — registry accepts initial state at construction time.

**Recommendation.** (a). Reuses the canonical lifecycle entry point (A7's phase 2 → phase 3). Editor receives initial setup as a `RestoreData<S>` blob (P6), exactly as session-restore and `openFile` do. No new shape; no post-construction mutation racing with `restore()`.

**Tradeoff.** (a) requires `addEditorPage` to know the `HostDescriptor` shape — a small layering leak: the script API knows the host kind ("textFile"). Two mitigations: (1) `addEditorPage` only deals with **text-bearing** editors (standalone editors are rejected at the existing guard), so "textFile" is always correct; (2) if a future non-text-bearing host kind appears, `addEditorPage` either grows a branch or the caller picks the right entry point.

(b) avoids the layering leak but races with `restore()` — the editor's `applyRestoreData → restore` sequence is the **canonical** path; bypassing it for fresh editors means two creation paths in the codebase. Reject as YAGNI churn.

(c) adds a third construction parameter for a one-caller use case. Reject.

**Side effect.** `addEditorPage` becomes async; threads `{ title, host: { kind: "textFile", state: { content, language } } }` through `applyRestoreData`. The "textFile" string is a small layering note: `addEditorPage` accepts text-bearing editor ids only (the standalone-reject guard already enforces this at runtime). The runtime guard message preserved verbatim.

**Resolution.** Option (a). `addEditorPage` becomes async; threads `{ title, host: { kind: "textFile", state: { content, language } } }` through `applyRestoreData` per P6's canonical phase-2 contract. The runtime positional-args guard + standalone-editor reject preserved verbatim. The "textFile" layering note is acceptable scope — `addEditorPage` accepts text-bearing editor ids only (the existing reject guard enforces this at runtime).

### EW3 — `requireWellKnownPage` instance-id propagation

**Question.** Today's well-known page sets `editorModel.state.id = id` after construction. After EPIC-028, instance id is set at construction time via `createEditor(editorId, instanceId)` (P6 — refined by M5 to cover both bootstrap-restore AND well-known/IPC paths). How does that flow?

**Options.**
- **(a)** `editorRegistry.createEditor(def.editor, def.id)` — instance id flows in at construction, no post-construction mutation. Cache files key on `def.id` from frame 1. (Recommended)
- **(b)** `createEditor(def.editor)` then `editor.id = def.id` post-construction. Same observable behavior but the cache-key window opens with a fresh uuid before getting overwritten.

**Recommendation.** (a). P6 explicitly added the `instanceId` parameter for exactly this reason — "identity set at construction, no post-construction mutation." Well-known pages are a primary motivator.

**Side effect.** `requireWellKnownPage` calls `await editorRegistry.createEditor(def.editor, def.id)` and never touches `editor.id` afterward. Today's `s.id = id` line goes away. Cache files (`<def.id>-host.txt`, `<def.id>-log-view.json` if log-view persists its own state, etc.) survive restarts.

**Resolution.** Option (a). `await editorRegistry.createEditor(def.editor, def.id)` propagates the well-known id as the editor's instance id at construction time per P6 / M5's `instanceId` parameter. No post-construction id mutation; today's `s.id = id` line deleted. Cache files keyed on `def.id` survive restarts (log content of `mcp-ui-log` / `mcp-server-log` persists across restarts).

### EW4 — Page id = editor id collision in well-known flow

**Question.** Today's well-known uses the same string (`"mcp-ui-log"`) as **both** the editor's instance id AND the page's page id. After EPIC-028, these are two different namespaces (editor id is per-editor; page id is per-page). Is using the same string still appropriate?

**Options.**
- **(a)** Keep using the same string — convenient, no functional collision because the namespaces are separate; `findPage` resolves either way (it checks `page.id || editor.id matches` per walkthroughs 01 / A8 + 03 + 07 / GK10). (Recommended)
- **(b)** Generate a fresh editor uuid; only use `def.id` for the page id. Cleaner separation but loses the cache-key continuity per EW3 unless we also pass `def.id` as a separate cache prefix.
- **(c)** Generate a fresh editor uuid AND a fresh page uuid; map well-known semantic id → page id separately via a registry table.

**Recommendation.** (a). The collision is **semantic**, not structural — both namespaces happen to use the same string because the well-known def has a single "identity" per singleton. Editor cache files keyed on `def.id` preserve log content across restarts (EW3 resolution). Page id keyed on `def.id` makes the dedup query (`findPage("mcp-ui-log")`) work without a lookup table.

(b) sacrifices cache continuity for namespace purity. (c) adds infrastructure for no observable benefit.

**Resolution.** Option (a). Same string in both namespaces by explicit design. `findPage` resolves either way (per walkthroughs 01 / A8 + 03 + 07 / GK10's unified-editors[] migration); cache-key continuity (EW3) keys on the same string; dedup query reads cleanly. Documented in the `well-known-pages.ts` comment block as a singleton-id design choice.

### EW5 — `addEmptyPageWithNavPanel` Explorer creation under unified `editors[]`

**Question.** Today's `page.createExplorer(folderPath)` is a PageModel method that builds an ExplorerEditorModel and registers it as a secondary editor. Under the unified `editors[]` model (A8), how is the Explorer attached?

**Context.** Per today's code (`PagesLifecycleModel.newEditorModelFromState` lines 87-90), Explorer is **not** in the editor registry — it's secondary-only (no main-area role). Walkthrough 30 (no-host editors) will codify the Explorer's full lifecycle; this walkthrough just needs the `addEmptyPageWithNavPanel` entry point right.

**Options.**
- **(a)** Direct construction — `new ExplorerEditorModel()` + configure + `page.attach(explorer)`. Preserves today's "not in main registry" pattern. (Recommended)
- **(b)** Register Explorer in a separate **secondary-editor-only** registry that mirrors `editorRegistry` but lists panel-only editors. `editorRegistry.createSecondaryEditor("file-explorer")` etc.
- **(c)** Register Explorer in the **main** editor registry with `category === "secondary-only"` flag that excludes it from `findEditorsAccepting(host)` and `resolveForFile`.

**Recommendation.** (a). Explorer is the only secondary-only editor today (`secondary-editor-registry.ts` covers panel **contributions**, which are different from "editors that own panel content but never the main area"). One-off direct construction matches the today-pattern and avoids inventing a registry for one editor.

If a second secondary-only editor appears, revisit at that point.

**Side effect.** Today's `page.createExplorer(folderPath)` PageModel method dissolves — its logic inlines into `addEmptyPageWithNavPanel`; PageModel stays editor-agnostic.

**Resolution.** Option (a). `addEmptyPageWithNavPanel` does direct dynamic-import + `new ExplorerEditorModel()` + configure `rootPath` + `await explorer.restore()` + set `secondaryEditor = ["file-explorer"]` + `page.attach(explorer)` + `page.ensurePageNavigatorModel()` + `addPage(null, page)`. PageModel's today-`createExplorer` method retires — its logic moves into the lifecycle method; PageModel stays editor-agnostic. If a second secondary-only editor surfaces, revisit at that point.

### EW6 — `WellKnownPageDef.language` placement

**Question.** Today's `editorModel.state.language = def.language` sets the language on the TextFileModel-as-EditorModel. After EPIC-028, language lives on the **host's** state (`TextFileModel.state.language`), not on the editor's state. How does the def's language reach the host?

**Options.**
- **(a)** Through `applyRestoreData` as part of the synthetic `HostDescriptor.state` (mirrors EW2): `editor.applyRestoreData({ host: { kind: "textFile", state: { language: def.language } } })`. (Recommended)
- **(b)** After `restore()`, mutate the host directly: `editor.contentHost?.state.update(s => { s.language = def.language })`.
- **(c)** Add `language?: string` as a top-level `RestoreData` field that the editor base class routes to its host (a convenience shortcut).

**Recommendation.** (a). Same answer as EW2 — `applyRestoreData` is the canonical phase-2 entry; everything stashed there flows naturally into `restore()`'s phase 3. No layering question.

**Resolution.** Option (a). The well-known flow's `applyRestoreData` blob bundles `title` (editor's own state) and `host.state.language` (host's state) together in a single phase-2 call: `editor.applyRestoreData({ title: def.title, host: { kind: "textFile", state: { language: def.language } } })`. Threads through the canonical contract per P6; no post-restore mutation; same lane as EW2.

### EW7 — `WellKnownPageDef` future extensibility

**Question.** Today's def has `{ id, title, editor, language }`. Future singletons might want a default content blob (welcome message), initial cursor position, an open panel, etc. Should we widen the shape now?

**Options.**
- **(a)** Keep minimal — `{ id, title, editor, language }`. Add fields only when concrete need appears. (Recommended)
- **(b)** Widen to mirror `EditorDescriptor` — `{ id, editorId, state?, host? }`. Lets each singleton specify arbitrary initial state.
- **(c)** Half-step — add `content?: string` for default content but nothing else.

**Recommendation.** (a). YAGNI. The two existing well-known pages don't need defaults beyond what's in the today-def. (b) lets the def specify arbitrary state including things that don't make sense for singletons (like a `filePath` — singletons don't back to files). (c) is the easy-add for hypothetical future welcome screens but matches no concrete request.

**Resolution.** Option (a). `WellKnownPageDef` shape unchanged: `{ id, title, editor, language }`. Future fields added when concrete needs land. No file edit to `well-known-pages.ts`.

### EW8 — Singleton dedup pattern

**Question.** About / Settings / Storybook each `new PageModel(FIXED_ID)` + `addPage(model, page)`. `addPage` does the `findPage(page.id)` collision check + `showPage` automatically. The well-known flow has an **explicit** `findPage` check at the top. Is the explicit check redundant?

**Options.**
- **(a)** Keep the explicit check in `requireWellKnownPage` — it short-circuits **before** loading the editor module (cheaper hot-path for "already open"). (Recommended)
- **(b)** Rely on `addPage`'s implicit check; remove the explicit one from `requireWellKnownPage`. Saves four lines.
- **(c)** Move the explicit check into `addPage` itself but expose a "fast-path" return that callers can check.

**Recommendation.** (a). The explicit check avoids the dynamic-import of the editor module on a hot path (clicking a well-known menu item when the page is already open is a frequent operation). Saving the module load is real (Monaco / LogView is a non-trivial bundle). About / Settings / Storybook don't have the same hot-path concern because their import is small and they're rarely opened more than once.

**Resolution.** Option (a). Keep the explicit `findPage` short-circuit at the top of `requireWellKnownPage` — short-circuits before the editor module's dynamic-import on a hot path. About / Settings / Storybook keep their implicit-via-addPage dedup (no explicit check; `addPage`'s `findPage` collision check + `showPage` handles it). Documented as a hot-path optimization comment at the call site in `requireWellKnownPage`.

### EW9 — Persistence of empty-with-sidebar pages

**Question.** P8 already says empty-with-sidebar pages restore naturally via `PageDescriptor.mainEditorId: null` + `editors: [ExplorerDescriptor]` + `sidebar?`. Does this walkthrough's `addEmptyPageWithNavPanel` produce a descriptor that round-trips?

**Verification (read-only — no decision):**
- `page.id` is set; `page.pinned` defaults false; `page.modified` is false (Explorer has no editing semantics)
- `page._mainEditorId === null`
- `page.editors = [explorer]` — one panel-contributor
- `page.pageNavigatorModel` is created via `ensurePageNavigatorModel()`
- `getDescriptor()` returns `{ id, pinned: false, modified: false, mainEditorId: null, editors: [explorer.getRestoreData()], sidebar: { open: true, width, activePanel: "explorer" } }`

P5's `Promise.all` restore reconstructs each editor in `editors[]`; `mainEditorId === null` skips the main-editor assignment; `sidebar?` triggers `ensurePageNavigatorModel()` on the restored page. Explorer's `applyRestoreData({ host: undefined, state: { rootPath } })` + `restore()` reinstantiates the explorer's tree state.

**Recommendation.** Mark resolved-by-confirmation. P8 + P5 already cover this; no new decision needed.

**Resolution.** Confirmed. Empty-with-sidebar pages round-trip via P8's "no special branch" mechanism + P5's `Promise.all` per-editor restore. `addEmptyPageWithNavPanel`'s output produces a `PageDescriptor` with `mainEditorId: null` + `editors: [explorerDescriptor]` + `sidebar: { open, width, activePanel: "explorer" }`; restore reconstructs Explorer via direct-construction path (EW5) since Explorer is not in the main editor registry. No new mechanism required.

### EW10 — `closeFirstPageIfEmpty` heuristic — `isFreshEmpty` discrimination

**Question.** L3 resolved `closeFirstPageIfEmpty` via an `EditorModel.isFreshEmpty(): boolean` override. The override on Monaco needs to discriminate:
- `addEmptyPage()` output → **fresh-empty** (close eligible)
- `addEditorPage("monaco", "plaintext", "My Title")` output → **not fresh-empty** (the user typed a title; keep)
- `addEditorPage("monaco", "plaintext", "", "console.log(1)")` output → **not fresh-empty** (content present)
- A user-edited Monaco page → **not fresh-empty** (`modified === true`)

**What does the override body need?**
- `host.state.content === ""`
- `host.state.filePath === undefined`
- `host.state.modified === false`
- `editor.state.title === ""` (or whatever Monaco's default-title is)

The title check is the discriminator that distinguishes `addEmptyPage()` (default title) from `addEditorPage()` (user-supplied title).

**Options.**
- **(a)** Override body checks all four conditions. (Recommended)
- **(b)** Skip the title check — only check content/filePath/modified. Risk: `addEditorPage("monaco", "javascript", "My Title")` followed by file-open auto-closes the user's titled page.
- **(c)** Add a `pristine: boolean` flag set true at construction, flipped false on any user mutation. Override checks just `pristine && !host.content && !filePath`.

**Recommendation.** (a). Four checks is cheap; the title discriminator is necessary. (c) introduces a state field for what's already derivable from existing state. Reject as YAGNI.

**Note.** Override body finalized in walkthrough 20 (Monaco). This walkthrough just nails down the checklist.

**Resolution.** Option (a). Monaco's `isFreshEmpty()` override checks all four conditions: `host.state.content === ""` AND `host.state.filePath === undefined` AND `host.state.modified === false` AND `editor.state.title === ""` (default title). The title check is the discriminator that distinguishes `addEmptyPage()` (default title → fresh-empty → close-eligible) from `addEditorPage("monaco", "js", "Custom Title")` (user-set title → not fresh-empty → keep). Override body finalized in walkthrough 20 (Monaco).

---

## Mockup adjustments

**None landed.** Every concern resolved as a "confirms earlier resolution" answer — no foundation gap surfaced. Confirmed primitives carrying new callers:

- `addEmptyPage` shape — confirms L1's "hardcode monaco" + A7's three-phase lifecycle (EW1).
- `addEditorPage` shape — confirms P6's `applyRestoreData(RestoreData<S>)` contract handles initial state for fresh editors too (EW2). Existing primitive, new caller.
- `requireWellKnownPage` — confirms M5's `createEditor(id, instanceId?)` covers the well-known case (EW3).
- Page-id = editor-id overlap in well-known — confirms the dual-namespace `findPage` resolution from 01 / A8 + 03 + 07 / GK10 (EW4).
- Explorer creation in `addEmptyPageWithNavPanel` — direct construction; today's `page.createExplorer` dissolves (EW5).
- `WellKnownPageDef.language` — host-owned per the editor/host split; flows through `applyRestoreData({host: {state: {language}}})` (EW6).
- `WellKnownPageDef` shape unchanged — `{id, title, editor, language}` (EW7).
- Singleton dedup — explicit `findPage` short-circuit in `requireWellKnownPage` (hot-path module-load skip); About / Settings / Storybook keep implicit-via-`addPage` dedup (EW8).
- Empty-with-sidebar persistence — verification of P8 + P5 (EW9).
- `isFreshEmpty()` checks `host.state.content + filePath + modified` AND `editor.state.title`. Signature already exists on EditorModel mockup (per L3); Monaco override body finalized in walkthrough 20 (EW10).

---

## Second-pass note

Tier 3 has a single walkthrough (11). No tier-level second pass is required — the README's second-pass step targets multi-walkthrough tiers where later walkthroughs may invalidate earlier ones. With one walkthrough, that risk is nil. Tier 4 (cross-cutting) begins next with walkthrough 12 — scripting facades.

---

## Closure

All ten concerns (EW1–EW10) resolved 2026-05-20. Zero mockup adjustments — every question collapsed to a "confirms earlier resolution" answer. Net effect: empty pages + well-known + singleton flows ride the foundation primitives without any new infrastructure.

**Real-code migration scope handed off** (no mockup changes):

- `PagesLifecycleModel.addEmptyPage` rewrite to async + `createEditor("monaco") + restore()` (EW1).
- `PagesLifecycleModel.addEmptyPageWithNavPanel` rewrite — direct `ExplorerEditorModel` construction + `page.attach`; PageModel's today-`createExplorer` method dissolves (EW5).
- `PagesLifecycleModel.addEditorPage` rewrite to async + `createEditor(editorId) + applyRestoreData({title, host: {kind: "textFile", state: {content, language}}}) + restore()`; positional-args runtime guard + `category === "standalone"` reject preserved verbatim (EW2).
- `PagesLifecycleModel.requireWellKnownPage` rewrite to `createEditor(def.editor, def.id) + applyRestoreData({title, host: {kind: "textFile", state: {language}}}) + restore() + new PageModel(def.id)`; keep explicit `findPage` short-circuit before the module load (EW3 + EW6 + EW8).
- `well-known-pages.ts` — shape unchanged; add comment block documenting the page-id-and-editor-id namespace overlap as a singleton-id design choice (EW4 + EW7).
- About / Settings / Storybook lifecycle flows — no change beyond the per-page module's internal EditorModel migration (walkthrough 30).
- Monaco `isFreshEmpty()` override body — defined in walkthrough 20 with the four-condition check from EW10.

**Tier 3 complete.** Single-walkthrough tier; no tier-level second pass required. Tier 4 (cross-cutting) begins next with walkthrough 12 — scripting facades.
