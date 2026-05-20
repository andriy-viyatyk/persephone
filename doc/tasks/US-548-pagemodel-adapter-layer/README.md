# US-548: PageModel adapter layer

**Epic:** [EPIC-028 — Unified Editor Architecture](../../epics/EPIC-028.md)
**Phase:** A — Foundation
**Status:** Investigation
**Depends on:** US-547 (foundation primitives landed inert, commit `abead6f`)
**Blocks:** US-549 (shared chrome), US-550 (MCP + scripting facades), Phase C per-editor migrations.

---

## Goal

Land the strangler-fig boundary that lets the new v4 `EditorModel` shape (introduced inert in US-547) drive the running app, while every existing editor continues to work through a `LegacyEditorAdapter`. After this task:

- `PageModel` is rewritten to the unified-array shape (`editors: EditorModel[]` + `_mainEditorId: string | null`); legacy `_mainEditor` + `secondaryEditors[]` are gone.
- Every existing editor flows into `PageModel` wrapped in a `LegacyEditorAdapter` (which `extends` the v4 `EditorModel` base from US-547).
- Persistence writes v4 (`WindowState.schemaVersion: 4`, `PageDescriptor.editors[]`, sidebar folded in) and dual-reads — falls back to the legacy v3 shape on first launch after upgrade.
- `compareGroups: Set<leftId>` moves to `PagesModel.state`; the `compareMode` field on `TextFileModel` and the `compareModeChanged` Subscription + `pagesModel.rerender()` are deleted (walkthrough 06 / CK1, CK6, CK7).
- The page-level switch widget (`TextToolbar` SegmentedControl) calls `page.switchMainEditor(newEditorId)`. For legacy adapter-wrapped editors, the switch falls through to today's `model.changeEditor(view)` (host-preserving in-place mutate); per-editor migrations (US-551+) replace this with the real `createEditor → switchFrom → restore` path.

User-visible behavior is unchanged: every editor still opens, edits, persists, and round-trips across restart.

---

## Background

### What US-547 left in place

- **v4 EditorModel base** at `src/renderer/editors/base/v4/EditorModel.ts` — abstract class with `editorId`, `queue: ComponentQueue`, `traits`, `descriptorChanged: Subscription<void>`, `stateStorage`, `page: IPageHost | null`, three-phase lifecycle (`applyRestoreData` / `switchFrom` / `restore`), `secondaryEditor` getter/setter (pure — no side effects), `contributesPanels()`, `findCompatibleEditors()`, `isFreshEmpty()`, `getRestoreData(): EditorDescriptor`, `confirmRelease`, `dispose()`.
- **v4 IContentHost interface** at `src/renderer/editors/base/v4/IContentHost.ts`.
- **v4 editorRegistry** at `src/renderer/editors/base/v4/editorRegistry.ts` — `register`, `getById`, `getAll`, `resolveForFile`, `findEditorsAccepting`, `createEditor(id, instanceId?)`. Empty in US-547.
- **CONTENT_HOST_TRAIT** at `src/renderer/editors/base/v4/editor-traits.ts`.
- **v4 persistence schemas** at `src/shared/persistence-v4.ts` — `PipeDescriptor`, `HostDescriptor`, `EditorDescriptor`, `PageDescriptor`, `WindowState`. (Coexists with legacy `src/shared/types.ts:PageDescriptor` etc.)
- **ComponentQueue** at `src/renderer/core/state/ComponentQueue.ts` and the **TOneState selector-subscribe overload** in `src/renderer/core/state/state.ts` — both verified inert.

### What today's code looks like (legacy shape, summary)

- **`PageModel`** (`src/renderer/api/pages/PageModel.ts`) — dual fields `_mainEditor: EditorModel | null` + `secondaryEditors: EditorModel[]` plus a `secondaryEditorsVersion` counter for re-render; sidebar cache via `_saveState` / `_saveStateDebounced` / `<pageId>-nav-panel.txt`; `restoreSidebar` + `restoreSecondaryEditors` + `pendingSecondaryDescriptors` + `_pendingActivePanel`; `promoteSecondaryToMain` with `_prePromotePanels` dance; `_notifyMainEditorOfSecondaryChange()` duck-type hook; `setMainEditor` handles Pattern B (model in both arrays) explicitly.
- **`PagesModel`** (`src/renderer/api/pages/PagesModel.ts`) — `attachPage` subscribes to `editor.state` + `page.state`; `resubscribeEditor` rewires after navigation; `closeFirstPageIfEmpty` hardcodes `editorState.type === "textFile" && !content && !filePath && !modified`.
- **`PagesPersistenceModel`** (`src/renderer/api/pages/PagesPersistenceModel.ts`) — `saveState` writes flat `PageDescriptor { editor: Partial<IEditorState> }`; `restoreState` detects pre-v3.0.1 format and skips, else iterates pages calling `restoreModel(data) → newEmptyEditorModel(type) → applyRestoreData → restore`, plus separate `restoreSidebar` + `restoreSecondaryEditors` per page.
- **`PagesLifecycleModel`** (`src/renderer/api/pages/PagesLifecycleModel.ts`) — `newEditorModel(filePath)` / `newEditorModelFromState(state)` / `createEditorFromFile` resolve via legacy `editorRegistry.resolve` + per-module `newEditorModel*` factories; `addPage`/`addEmptyPage`/`addEditorPage`/`openFile`/`openLinks`/`requireWellKnownPage`/`movePageIn`/`navigatePageTo`/`duplicatePage` all build legacy EditorModels and stuff them into PageModel via `page.mainEditor = X` or `page.addSecondaryEditor(X)`.
- **`PagesLayoutModel`** — `group`/`ungroup`/`groupTabs`/`fixGrouping`/`fixCompareMode`. `fixCompareMode` only covers "compareMode on but ungrouped".
- **`PagesQueryModel`** — `findPage(id)` checks `p.id || p.mainEditor?.id || p.secondaryEditors.some(...)`.
- **Compare mode** — flag lives on `TextFileModel.state.compareMode`; toggled via `setCompareMode(true)` on both editors; `compareModeChanged: Subscription<void>` bridges host-flag → `pagesModel.rerender()` (which bumps `state.rerender` purely to fire `state.use()`); `Pages.tsx` reads the flag twice (per-page render branch and whole-pair `compareModeIds` set).
- **Legacy registry** (`src/renderer/editors/registry.ts`) — `EditorDefinition { id, name, editorType, category, acceptFile?, validForLanguage?, switchOption?, isEditorContent?, loadModule }`. Registered editors enumerated in `src/renderer/editors/register-editors.ts` (24 entries today).
- **`EditorModel` base** (`src/renderer/editors/base/EditorModel.ts`) — legacy base; has `state`, `pipe`, `page`, `setPage`, lifecycle hooks (`beforeNavigateAway`, `onMainEditorChanged`, `onPanelExpanded`), `secondaryEditor` getter/setter with side effects (calls `page?.addSecondaryEditor` / `page?.removeSecondaryEditorWithoutDispose`), `confirmRelease`, `dispose`, `restore`, `getRestoreData`, `applyRestoreData`, `changeLanguage`. Subclasses: `TextFileModel`, `ExplorerEditorModel`, `ArchiveFileModel`, `BrowserEditorModel`, `PdfEditorModel`, `ImageEditorModel`, `VideoPlayerModel`, `McpInspectorEditorModel`, `AboutPageModel`, `SettingsPageModel`, `StorybookPageModel`, `CategoryEditorModel`, etc.

### Resolved design decisions inherited from walkthroughs

All concerns logged in [`concerns.md`](../../epics/EPIC-028-editor-architecture/concerns.md). The ones load-bearing for US-548:

- **L1**: empty page always Monaco; `addEmptyPage` calls `editorRegistry.createEditor("monaco") + restore`.
- **L2 / A6**: `EditorModel.descriptorChanged: Subscription<void>` — page subscribes once per editor; base auto-fires on every `state.subscribe(...)` invocation.
- **L3 / A3**: `EditorModel.isFreshEmpty(): boolean` — base returns false; Monaco overrides. Replaces the hardcoded check in `closeFirstPageIfEmpty`.
- **L6 + A8**: unified `editors: EditorModel[]` + `_mainEditorId` flag. Pattern B inexpressible. `panelEditors` getter (filter `contributesPanels()`).
- **S4 + B4**: `ComponentQueue` per editor for model → view imperative commands. Adapter exposes its own queue (unused for now).
- **S10 + B1**: `EditorModel.editorId: string` field replaces `IEditorState.type` + `state.editor` runtime discriminators. (Persistence migration to `editorId`-keyed lookup is in P1/C2 below.)
- **N1 + B3**: `PageModel.attach(editor)` sets up a TOneState **slice subscription** on `editor.state.secondaryEditor` via the overload. Setter stays pure; visibility criterion fires automatically.
- **N5**: CategoryEditor's "secondary editors changed" reactivity moves to the view (`page.state.use()`); model-side `onSecondaryEditorsChanged` and `_providerVersion` are deleted.
- **N7 + B6**: `PageModel.close()` iterates panel-contributing editors first, then the main editor.
- **P1 + C1**: v4 `EditorDescriptor` / `HostDescriptor` / `PageDescriptor` / `WindowState` shape. Already in `src/shared/persistence-v4.ts`.
- **P2 / P10**: single `schemaVersion: 4` integer discriminator; anything else → fall back to legacy path (this task) or skip (US-559).
- **P3 / C7**: sidebar cache file `<pageId>-nav-panel.txt` is retired in the v4 write path; v3 read path still reads it for upgrade legacy data.
- **P5 / C5**: per-page restore via `Promise.all` over `editors[]`; apply `mainEditorId` + sidebar metadata after all editors attach.
- **P6 / C2 / C3**: `editorRegistry.createEditor(id, instanceId?)`; `getRestoreData(): EditorDescriptor`; `applyRestoreData(data: RestoreData<S>)`.
- **P7**: per-editor restore failure salvages siblings (`console.warn + continue`).
- **P9**: no orphan cache sweep (existing `<pageId>-nav-panel.txt` files from v3 sessions just leak).
- **M2 / C3**: `PagesPersistenceModel.restorePage(desc)` is the shared restore entry point — bootstrap + IPC `movePageIn` + `duplicatePage` all consume it.
- **M3 / M5 / C1**: `page.saveState()` iterates `editors[]` for per-editor flush; `editorRegistry.createEditor(id, instanceId)` preserves editor-id continuity for cache files.
- **CK1**: compare flag is **pair-level** on `PagesModel.state.compareGroups: Set<string>` (keyed by left page id).
- **CK3**: `pagesModel.query.canCompare(leftId, rightId)` centralizes the predicate.
- **CK4**: `pagesModel.layout.enterCompareMode(pageId)` / `exitCompareMode(pageId)` — accept either side, resolve leftId internally.
- **CK5**: `pagesModel.query.isInCompareMode(pageId): { active, leftId?, rightId? }`.
- **CK6**: delete `compareModeChanged` and `pagesModel.rerender()`.
- **CK7**: delete `fixCompareMode`; fold cleanup into `PagesLayoutModel.ungroup`, `PagesModel.removePage`, `PageModel.setMainEditor`.
- **CK8**: `openDiff` becomes `groupTabs(first, second, true) + enterCompareMode(firstId)`. No direct host mutation, no `fixCompareMode` call.
- **CK9**: don't persist compareGroups. Compare mode survives in-process (main window tray hide); only secondary-window restart loses it (rare).
- **CK10**: `CompareEditor` gains a `leftPageId` prop; exit button calls `exitCompareMode(leftPageId)`.
- **GK2 + walkthrough 08 / T2**: `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` centralizes the host-instanceof check.
- **GK4**: `PageTab.closeClick` drops its `fixCompareMode()` call (CK7 carries the obligation).

---

## Implementation plan

The plan lands in 12 chunks ordered so the codebase compiles between each. Implementation expects the agent to read this section, the linked files, and the inherited design decisions — and to verify at each step that `npm run lint` + `npm run typecheck` succeed.

### Step 1 — `LegacyEditorAdapter` class

**New file:** `src/renderer/editors/base/v4/LegacyEditorAdapter.ts`

`LegacyEditorAdapter extends EditorModel<LegacyEditorState>` (v4 base from US-547). Wraps a legacy `LegacyEditorModel` instance and exposes the v4 surface. Sketch:

```ts
import type { EditorModel as LegacyEditorModel } from "../EditorModel";
import { EditorModel as V4EditorModel, type EditorStateBase, type RestoreData } from "./EditorModel";
import type { IEditorState } from "../../../../shared/types";
import type { EditorDescriptor, HostDescriptor } from "../../../../shared/persistence-v4";
import { editorRegistry as legacyRegistry } from "../../registry";

/**
 * State shape exposed to v4 callers. Inherits all legacy IEditorState fields
 * because the wrapped legacy editor reads them directly.
 */
export type LegacyEditorState = EditorStateBase & IEditorState;

export class LegacyEditorAdapter extends V4EditorModel<LegacyEditorState> {
    readonly editorId: string;

    /** The wrapped legacy editor. */
    readonly legacy: LegacyEditorModel;

    constructor(legacy: LegacyEditorModel, editorId: string) {
        // Pass the legacy editor's state as our state — single source of truth.
        super(legacy.state as any, undefined);
        this.legacy = legacy;
        this.editorId = editorId;

        // descriptorChanged is already wired to this.state.subscribe by the v4
        // base ctor; since this.state IS legacy.state, every legacy mutation
        // fires descriptorChanged. Pipe changes also need forwarding:
        // (the legacy pipe is mutated via assignment, not state; in practice
        //  the only mutation paths run through state too, so this is enough.)
    }

    /** v4 setPage handoff: also keep legacy.page in sync so legacy editor
     *  side-effect setters (secondaryEditor → page.addSecondaryEditor) still work. */
    setPage(page: IPageHost | null): void {
        super.setPage(page);
        this.legacy.setPage(page as any); // PageModel keeps compat shims (Step 4)
    }

    // ── Lifecycle hooks — delegate to legacy ──────────────────────────

    applyRestoreData(data: RestoreData<LegacyEditorState>): void {
        // v4 RestoreData<S> = Partial<S> & { host?, revealLine?, highlightText? }
        // Legacy applyRestoreData takes Partial<IEditorState>. Strip v4-only fields.
        const { host, revealLine, highlightText, ...rest } = data as any;
        this.legacy.applyRestoreData(rest as Partial<IEditorState>);
        // ComponentQueue passthroughs: ignored — legacy editors don't use the queue.
    }

    switchFrom(_oldEditor: V4EditorModel): void {
        throw new Error(`Legacy adapter does not implement switchFrom — host-preserving switch is handled via legacy model.changeEditor() in TextToolbar; createEditor+switchFrom activates only after per-editor migrations US-551+.`);
    }

    async restore(): Promise<void> {
        await this.legacy.restore();
    }

    beforeNavigateAway(newModel: V4EditorModel): void {
        // Legacy override expects a legacy EditorModel; unwrap if we can.
        const newLegacy = newModel instanceof LegacyEditorAdapter ? newModel.legacy : (newModel as any);
        this.legacy.beforeNavigateAway(newLegacy);
    }

    onMainEditorChanged(newMain: V4EditorModel | null): void {
        const newLegacy = newMain instanceof LegacyEditorAdapter ? newMain.legacy : (newMain as any);
        this.legacy.onMainEditorChanged(newLegacy);
    }

    onPanelExpanded(panelId: string): void {
        this.legacy.onPanelExpanded(panelId);
    }

    contributesPanels(): boolean {
        const se = (this.legacy.state.get() as IEditorState).secondaryEditor;
        return (se?.length ?? 0) > 0;
    }

    // ── secondaryEditor — keep legacy setter semantics ────────────────
    // The legacy setter has side effects (calls page.addSecondaryEditor / etc.).
    // Adapter's setter just delegates to legacy's setter so existing editor
    // code (Archive, Link, Explorer) keeps working.

    get secondaryEditor(): string[] | undefined {
        return this.legacy.secondaryEditor;
    }

    set secondaryEditor(value: string[] | undefined) {
        this.legacy.secondaryEditor = value;
    }

    // ── Switch widget support ─────────────────────────────────────────

    findCompatibleEditors(): string[] {
        // Defer to legacy: build switch options from language + filePath.
        const s = this.legacy.state.get() as IEditorState;
        const opts = legacyRegistry.getSwitchOptions(s.language ?? "", s.filePath);
        return opts.options;
    }

    // ── Fresh-empty (replaces hard-coded check in closeFirstPageIfEmpty) ─

    isFreshEmpty(): boolean {
        const s = this.legacy.state.get() as IEditorState & { content?: string };
        return s.type === "textFile"
            && !s.modified
            && !s.filePath
            && !s.content;
    }

    // ── Convenience getters for legacy IEditorState fields ────────────
    // Various code reads `editor.filePath`, `editor.language`, etc.
    // These delegate to the legacy state via the inherited getters on the
    // v4 base. (Legacy `EditorModel` has its own getters; the inherited
    // ones from US-547 only cover id/title/modified — extend here.)

    get filePath(): string | undefined { return (this.state.get() as IEditorState).filePath; }
    get language(): string | undefined { return (this.state.get() as IEditorState).language; }

    // ── Persistence ───────────────────────────────────────────────────

    getRestoreData(): EditorDescriptor {
        const legacyState = this.legacy.getRestoreData() as IEditorState;
        // Put the full legacy state under `state`; do NOT split into host
        // (per-editor migrations US-551+ will do that split).
        return {
            editorId: this.editorId,
            id: legacyState.id,
            state: legacyState as unknown as Record<string, unknown>,
            host: undefined,
        };
    }

    async confirmRelease(closing?: boolean): Promise<boolean> {
        return this.legacy.confirmRelease(closing);
    }

    async saveState(): Promise<void> {
        await this.legacy.saveState?.();
    }

    async dispose(): Promise<void> {
        // v4 base dispose() disposes the queue. Don't forward to legacy
        // dispose yet — call super first so the queue is drained, then legacy
        // (which handles its own pipe + fs.deleteCacheFiles).
        await super.dispose();
        await this.legacy.dispose();
    }
}

/** Resolve the v4 editorId for a legacy editor. */
export function deriveEditorId(legacyState: Partial<IEditorState>): string {
    // For text-bearing editors, state.editor is the view discriminator
    // (monaco / grid-json / link-view / etc.); use it directly when present.
    if (legacyState.type === "textFile" && legacyState.editor) {
        return legacyState.editor;
    }
    // Otherwise, look up the legacy registry def whose editorType === state.type
    // and return its id (e.g., type === "pdfFile" → id === "pdf-view").
    if (legacyState.type) {
        const def = legacyRegistry.getAll().find((e) => e.editorType === legacyState.type);
        if (def) return def.id;
    }
    // Fallback: monaco for safety. The dual-read salvage path catches misses.
    return "monaco";
}
```

Key invariants:
- The adapter's `state` is the legacy editor's `state` — single source of truth, no copying.
- The legacy editor's `setPage(adapter.page)` is called so legacy setter side-effects (`secondaryEditor` setter → `page.addSecondaryEditor`) still flow.
- `getRestoreData()` puts the full legacy IEditorState under `EditorDescriptor.state`; no host split. Per-editor migrations US-551+ will split.
- `switchFrom` throws. Real view-switch goes through the legacy `model.changeEditor` path (kept in `TextToolbar.tsx` for now).

**Re-export from index:** Add `export { LegacyEditorAdapter, deriveEditorId } from "./LegacyEditorAdapter";` to `src/renderer/editors/base/v4/index.ts`.

### Step 2 — Auto-bridge legacy registry into v4 registry

**Modify:** `src/renderer/editors/register-editors.ts`

After the existing `editorRegistry.register(...)` calls and `secondaryEditorRegistry.register(...)` calls, add a final loop:

```ts
// =============================================================================
// EPIC-028 strangler-fig bridge — every legacy EditorDefinition gets a
// v4 EditorDefinition whose loadModule returns an adapter-wrapped factory.
// Per-editor migrations (US-551+) replace these entries with native v4 editors.
// US-559 deletes the bridge entirely.
// =============================================================================
import { editorRegistry as v4Registry } from "./base/v4/editorRegistry";
import { LegacyEditorAdapter } from "./base/v4/LegacyEditorAdapter";
import type { EditorModule as V4Module } from "./base/v4/editorRegistry";

for (const legacyDef of editorRegistry.getAll()) {
    v4Registry.register({
        id: legacyDef.id,
        name: legacyDef.name,
        hasContentHost: legacyDef.editorType === "textFile",
        accepts: (input) => {
            // Mode-aware priority: edit-leaning vs view-leaning.
            // For US-548, fall through to legacy acceptFile (filename-keyed)
            // and switchOption (language+filename-keyed). Mode is honored only
            // for resolveForFile (open-file flow): "view" mode prefers
            // switchOption > 0 winners, "edit" mode prefers Monaco fallback.
            // Per-editor migrations sharpen this; for adapter-wrapped editors
            // today's behavior is preserved end-to-end.
            if (input.fileName) {
                const p = legacyDef.acceptFile?.(input.fileName) ?? -1;
                if (p >= 0) return p;
            }
            if (input.language) {
                const p = legacyDef.switchOption?.(input.language, input.fileName) ?? -1;
                if (p >= 0) return p;
            }
            return -1;
        },
        loadModule: async (): Promise<V4Module> => {
            const legacyModule = await legacyDef.loadModule();
            return {
                createEditor: () => {
                    // For text-bearing editors, default to monaco view; for
                    // standalone editors, instantiate the legacy editor's
                    // newEmptyEditorModel(editorType). The legacy module
                    // exposes both shapes via EditorModelCreations.
                    throw new Error("LegacyEditorAdapter is instantiated via the bridge factory below, not via createEditor() directly. See PagesLifecycleModel for the call sites.");
                },
                Component: legacyModule.Editor as any,
            };
        },
    });
}
```

The auto-bridge populates the v4 registry but doesn't replace the legacy creation pathway — that's deliberate. PagesLifecycleModel still calls legacy factories (`newTextFileModel`, `newEditorModel`, etc.), then wraps the result in `LegacyEditorAdapter` (Step 7). The v4 registry's main use in US-548 is:
- `findEditorsAccepting(host)` for the switch widget (deferred to US-549 for the actual widget rewrite; US-548 just makes the v4 registry inspectable).
- `resolveForFile(fileName, language?, mode?)` consumed by `navigatePageTo` (replaces `editorRegistry.resolve` + `editorRegistry.getPreviewEditor`).

The `createEditor` throw is intentional — US-548 wraps at PagesLifecycleModel level, not via v4 createEditor. Per-editor migrations US-551+ replace these `createEditor` stubs with real factories.

### Step 3 — Rewrite `PageModel`

**Modify:** `src/renderer/api/pages/PageModel.ts`

Replace the body with the v4 unified-array shape. The reference mockup is at [`/doc/epics/EPIC-028-editor-architecture/mockups/PageModel.ts`](../../epics/EPIC-028-editor-architecture/mockups/PageModel.ts); copy structurally with these implementation-specific notes:

- **Import v4 EditorModel** (`from "../../editors/base/v4"`), NOT legacy.
- **State shape** — `IPageState { pinned, mainEditorId, version }`. Drop `hasSidebar` (replaced by getter).
- **Fields**:
  - `editors: EditorModel[] = []` (v4 EditorModel type).
  - `private _mainEditorId: string | null = null`.
  - `pageNavigatorModel: PageNavigatorModel | null = null`.
  - `activePanel: string = "explorer"`.
  - `private _editorSubs = new Map<string, () => void>()` — per-editor selector subscriptions on `secondaryEditor` slice (walkthrough 03 / N1).
  - `private _transient = new Map<string, unknown>()` — survives.
  - `onClose?: () => void` — set by `PagesModel.attachPage`.
- **No fields**: `_mainEditor`, `secondaryEditors`, `secondaryEditorsVersion`, `pendingSecondaryDescriptors`, `_pendingActivePanel`, `_cacheName`, `_skipSave`, `_unsubscribe`.
- **Getters**: `mainEditor` (derived from `_mainEditorId` lookup in editors[]), `title`, `modified` (any editor modified), `hasSidebar` (any editor `contributesPanels()` OR `pageNavigatorModel`), `panelEditors` (filter `contributesPanels()`).
- **Methods**: `attach(editor)`, `detach(editor)`, `onEditorPanelsChanged(editor)`, `setMainEditor(newEditor)` (with CK7 compare-cleanup hook + CK9 cache-id-transfer skip), `switchMainEditor(newEditorId)`, `notifyMainEditorChanged()`, `reconcileVisibility()`, `setActivePanel`, `expandPanel`, `close()` (panel-editors first then main per N7), `dispose()` (clean loop; no `fs.deleteCacheFiles(this.id)` since page-level cache is gone), `saveState()` (`Promise.all(editors.map(e => e.saveState?.()))`), `getDescriptor(): PageDescriptor` (v4 shape per walkthrough 08 / T3).
- **CK7 compare-cleanup hook in `setMainEditor`**:
  ```ts
  async setMainEditor(newEditor: EditorModel | null): Promise<void> {
      // …existing visibility logic…
      // Compare-mode cleanup (CK7): if this page is in a compare pair and
      // the new main's host isn't TextFileModel, exit compare for the pair.
      // Imported lazily to avoid circular dep.
      if (newEditor) {
          const { pagesModel } = await import("./index");
          const pair = pagesModel.query.isInCompareMode(this.id);
          if (pair.active) {
              const isText = pagesModel.query.getTextFileHost(this.id) !== null;
              if (!isText) {
                  pagesModel.layout.exitCompareMode(this.id);
              }
          }
      }
  }
  ```
- **Compat shims for legacy editor setter side-effects (until US-559)**:
  ```ts
  /** Compat shim: legacy EditorModel.secondaryEditor setter calls this.
   *  Delegates to attach() and bumps version. Retired in US-559. */
  addSecondaryEditor(editor: EditorModel): void {
      if (this.editors.includes(editor)) {
          // Setter re-fired with a different panel list — slice subscription
          // already handles re-render via onEditorPanelsChanged. No-op here.
          return;
      }
      this.attach(editor);
  }

  /** Compat shim. Delegates to detach (no dispose). Retired in US-559. */
  removeSecondaryEditorWithoutDispose(editor: EditorModel): void {
      this.detach(editor);
  }

  /** Compat shim. Detach + dispose. Used by user-initiated panel close. */
  async removeSecondaryEditor(editor: EditorModel): Promise<void> {
      this.detach(editor);
      await editor.dispose();
  }

  /** Compat shim: today's `findSecondaryEditor(id)` reads from secondaryEditors[].
   *  Migrate callers to `panelEditors.find(e => e.id === id)` directly. */
  findSecondaryEditor(editorId: string): EditorModel | undefined {
      return this.panelEditors.find((e) => e.id === editorId);
  }
  ```
- **Compat property accessor**: `get secondaryEditors(): EditorModel[] { return this.panelEditors; }` — keep for code that still reads `page.secondaryEditors`. Per Grep: 6 files reference it (PageNavigator.tsx, LinkEditor.tsx, CategoryEditor.tsx, VideoPlayerEditor.tsx, PageModel.ts itself, PagesQueryModel.ts). PageNavigator and PagesQueryModel are updated in this task; the rest stay reading via the compat getter until their per-editor migrations.
- **`findExplorer`/`createExplorer` survive** — they read/write from `editors[]` instead of `secondaryEditors[]`; signatures unchanged.
- **`toggleNavigator`/`canOpenNavigator` survive** unchanged.
- **`promoteSecondaryToMain` deleted** — Pattern B inexpressible; the only caller (toolbar?) becomes `setMainEditor(secondary)`. Verify no other callers.

### Step 4 — Rewrite `PagesModel`

**Modify:** `src/renderer/api/pages/PagesModel.ts`

- Add `compareGroups: Set<string>` to the default state (CK1).
- Delete the `rerender: number` field and the `rerender()` method (CK6).
- `attachPage` now subscribes to `editor.descriptorChanged` (v4 signal from US-547's EditorModel base) AND walks `page.editors[]` initially, plus listens to `page.state.version` changes to maintain the per-editor subscription map. Use a `Map<editorId, () => void>` per page. Implementation note: on `attach`/`detach` events from PageModel, PagesModel doesn't know individually — instead subscribe to `page.state` (which version-bumps on attach/detach) and reconcile the per-editor-descriptorChanged subscription map. Sketch:
  ```ts
  attachPage = (page: PageModel) => {
      const editorSubs = new Map<string, () => void>();
      const reconcile = () => {
          const present = new Set(page.editors.map(e => e.id));
          // Tear down subs for editors that left
          for (const [id, unsub] of editorSubs) {
              if (!present.has(id)) { unsub(); editorSubs.delete(id); }
          }
          // Add subs for new editors
          for (const editor of page.editors) {
              if (editorSubs.has(editor.id)) continue;
              editorSubs.set(editor.id, editor.descriptorChanged.subscribe(() => {
                  this.persistence.saveStateDebounced();
              }));
          }
      };
      reconcile();
      const pageUnsub = page.state.subscribe(() => {
          reconcile();
          this.persistence.saveStateDebounced();
      });
      this.pageSubscriptions.set(page.id, () => {
          for (const unsub of editorSubs.values()) unsub();
          editorSubs.clear();
          pageUnsub();
      });
      page.onClose = () => { this.detachPage(page); this.removePage(page); page.dispose(); };
  };
  ```
- Delete `resubscribeEditor` — covered by `attachPage`'s reconcile-on-state-change.
- `removePage` — adds CK7 compare cleanup:
  ```ts
  removePage = (page: PageModel) => {
      // …existing splice…
      this.state.update((s) => {
          // …
          // CK7: drop compareGroups entry if this page is in a pair.
          const pair = this.query.isInCompareMode(page.id);
          if (pair.active && pair.leftId) {
              const next = new Set(s.compareGroups);
              next.delete(pair.leftId);
              s.compareGroups = next;
          }
      });
      // …
  };
  ```
- `closeFirstPageIfEmpty` — migrate to `mainEditor?.isFreshEmpty?.() === true` (per L3/A3); drop the literal type+content+filePath+modified check.
- Public delegates — keep most. New delegates: `enterCompareMode`, `exitCompareMode`, `canCompare`, `isInCompareMode`, `getTextFileHost`. Remove: `rerender`, `fixCompareMode` (no longer exists).

### Step 5 — Rewrite `PagesLayoutModel`

**Modify:** `src/renderer/api/pages/PagesLayoutModel.ts`

- Delete `fixCompareMode` entirely.
- Delete the trailing `this.fixCompareMode()` call in `fixGrouping`.
- Add `enterCompareMode(pageId: string): boolean` — resolves leftId from either side, validates via `canCompare`, adds to `compareGroups`. Returns false if precondition fails.
- Add `exitCompareMode(pageId: string): void` — resolves leftId, deletes from `compareGroups`.
- `ungroup` — adds CK7 compare cleanup: when ungrouping, also `delete compareGroups.get(leftId)`. Sketch:
  ```ts
  ungroup = (pageId: string) => {
      // …existing direction-swap + delete from leftRight/rightLeft maps…
      // CK7: if this page (or its grouped partner) was in a compare pair,
      // drop the compareGroups entry. Use resolved leftId.
      const leftId = state.rightLeft.get(pageId) ?? pageId;
      this.model.state.update((s) => {
          if (s.compareGroups.has(leftId)) {
              const next = new Set(s.compareGroups);
              next.delete(leftId);
              s.compareGroups = next;
          }
      });
  };
  ```

### Step 6 — Rewrite `PagesQueryModel`

**Modify:** `src/renderer/api/pages/PagesQueryModel.ts`

- `findPage` — change `p.secondaryEditors.some(se => se.id === id)` to `p.editors.some(e => e.id === id)` (walkthrough 03 / GK10 / 04 implications).
- Add `canCompare(leftId, rightId): boolean` (CK3) — both pages exist, both grouped together, both `getTextFileHost(...) !== null`.
- Add `isInCompareMode(pageId): { active: boolean; leftId?: string; rightId?: string }` (CK5).
- Add `getTextFileHost(pageId): TextFileModel | null` (GK2 / walkthrough 08 / T2). For US-548 (adapter era), this returns `adapter.legacy as unknown as TextFileModel` if `adapter.legacy.constructor.name === "TextFileModel"` (or `instanceof TextFileModel` if importing). Per-editor migrations US-551+ replace this with `editor.contentHost instanceof TextFileModel`.

### Step 7 — Rewrite `PagesLifecycleModel` (wrap-at-the-call-site)

**Modify:** `src/renderer/api/pages/PagesLifecycleModel.ts`

For each path that builds a legacy editor and hands it to `page.mainEditor = X` or `page.addSecondaryEditor(X)`, wrap in `LegacyEditorAdapter` before attaching:

```ts
import { LegacyEditorAdapter, deriveEditorId } from "../../editors/base/v4/LegacyEditorAdapter";

private wrap(legacy: LegacyEditorModel): EditorModel {
    const editorId = deriveEditorId(legacy.state.get());
    return new LegacyEditorAdapter(legacy, editorId);
}
```

Then update each call site:
- `addEmptyPage()` — wrap before addPage.
- `addEmptyPageWithNavPanel(folderPath)` — wrap the Explorer editor.
- `addEditorPage(editor, language, title, content?)` — wrap before addPage.
- `addDrawPage(dataUrl, title?)` — wrap.
- `openLinks(links, title)` — wrap.
- `openFile(filePath, pipe, options)` — wrap.
- `_openZipArchive(filePath)` — wrap.
- `_openAsarArchive(filePath)` — wrap the Explorer.
- `requireWellKnownPage(id)` — wrap.
- `addDrawPage`, `showAboutPage`, `showSettingsPage`, `showBrowserPage`, `showMcpInspectorPage`, `showStorybookPage`, `showVideoPlayerPage`, `openImageInNewTab` — wrap.
- `navigatePageTo` — wrap the new editor before `page.setMainEditor(newEditor)`. The `revealLine`/`highlightText` post-swap logic still needs the legacy TextFileModel — extract via `pagesModel.query.getTextFileHost(page.id)`.
- `movePageIn(data)` — delegate to `pagesModel.persistence.restorePage(data.page)` per M2 (covered in Step 8).
- `movePageOut(pageId)` — minor — `await page.saveState()` still flushes per-editor caches.
- `duplicatePage(pageId)` — rewrite per M2: build a `PageDescriptor` from `page.getDescriptor()` with fresh ids on the editor copies, then call `restorePage`.
- `openDiff(params)` — rewrite per CK8: `groupTabs(first, second, true) + layout.enterCompareMode(firstId)`. Drop direct `state.update(s => s.compareMode = true)` calls; drop `fixCompareMode` call.

`newEditorModel`, `newEditorModelFromState`, `createEditorFromFile`, `newEditorModelByTarget` survive in US-548 (still used to build legacy editors before wrapping). They retire incrementally in per-editor migrations US-551+ and finally in US-559.

`PAGE_TYPE_MIGRATIONS` (today's mcpBrowserPage → mcpInspectorPage migration map) stays in the legacy creation path for v3 dual-read.

### Step 8 — Rewrite `PagesPersistenceModel`

**Modify:** `src/renderer/api/pages/PagesPersistenceModel.ts`

#### `saveState` — write v4 only

```ts
import type { WindowState as V4WindowState, PageDescriptor as V4PageDescriptor } from "../../../shared/persistence-v4";

saveState = async (): Promise<void> => {
    const { pages, leftRight } = this.model.state.get();
    const pageDescriptors: V4PageDescriptor[] = pages.map((p) => p.getDescriptor());
    const storedState: V4WindowState = {
        schemaVersion: 4,
        pages: pageDescriptors,
        groupings: Array.from(leftRight.entries()),
        activePageId: this.model.query.activePage?.id,
    };
    await appFs.saveDataFile(openFilesNameTemplate, JSON.stringify(storedState, null, 4));
};
```

#### `restoreState` — dual-read

```ts
restoreState = async () => {
    const data = parseObject(await appFs.getDataFile(openFilesNameTemplate));
    if (!data || !Array.isArray(data.pages)) return;

    if (data.schemaVersion === 4) {
        await this.restoreV4(data as V4WindowState);
    } else {
        await this.restoreV3(data);  // legacy path — kept until US-559
    }
};
```

#### `restoreV4` — uses the shared `restorePage` helper

```ts
async restorePage(desc: V4PageDescriptor): Promise<PageModel | null> {
    const page = new PageModel(desc.id);
    page.pinned = desc.pinned;

    const editors = await Promise.all(desc.editors.map(async (d) => {
        try {
            // For US-548, all editors are adapter-wrapped. Resolve editorId
            // back to legacy class via the legacy registry; instantiate the
            // legacy editor with d.id; apply restore data; wrap.
            const legacyState = d.state as Partial<IEditorState>;
            const legacy = await this.model.lifecycle.newEditorModelFromState({
                ...legacyState,
                id: d.id,
            });
            legacy.applyRestoreData(legacyState);
            await legacy.restore();
            return new LegacyEditorAdapter(legacy, d.editorId);
        } catch (err) {
            console.warn(`[restore] editor ${d.editorId} in page ${desc.id}:`, err);
            return null;
        }
    }));

    for (const e of editors) if (e) page.attach(e);

    if (desc.mainEditorId && page.editors.some((e) => e.id === desc.mainEditorId)) {
        // Set _mainEditorId directly via the page setter — avoid the full
        // setMainEditor lifecycle (which would fire beforeNavigateAway etc.).
        (page as any)._mainEditorId = desc.mainEditorId;
        page.state.update((s) => { s.mainEditorId = desc.mainEditorId; });
    }

    if (desc.sidebar) {
        const nav = page.ensurePageNavigatorModel();
        nav.setStateQuiet({ open: desc.sidebar.open, width: desc.sidebar.width });
        const panel = desc.sidebar.activePanel;
        const valid = panel === "explorer" || panel === "search"
            || page.editors.some((e) => e.secondaryEditor?.includes(panel));
        page.activePanel = valid ? panel : "explorer";
    }

    if (page.editors.length === 0 && !desc.sidebar) return null;
    return page;
}

private async restoreV4(data: V4WindowState): Promise<void> {
    const results = await Promise.all(data.pages.map(async (d) => {
        try { return await this.restorePage(d); }
        catch (err) { console.warn(`[restore] page ${d.id}:`, err); return null; }
    }));
    const pages = results.filter((p): p is PageModel => p !== null);
    for (const p of pages) this.model.attachPage(p);

    const active = pages.find((p) => p.id === data.activePageId);
    const ordered = active ? [...pages.filter((p) => p !== active), active] : pages;
    this.model.state.update((s) => { s.pages = pages; s.ordered = ordered; });

    if (data.groupings) {
        for (const [l, r] of data.groupings) this.model.layout.group(l, r);
        this.model.layout.fixGrouping();
    }
}
```

#### `restoreV3` — today's behavior, refactored to wrap adapter

```ts
private async restoreV3(data: any): Promise<void> {
    // Detect pre-v3.0.1 flat format and skip (today's behavior).
    const isPreV3 = data.pages.length > 0
        && data.pages[0]?.type && typeof data.pages[0]?.type === "string"
        && !data.pages[0]?.editor?.type;
    if (isPreV3) return;

    const models: PageModel[] = [];
    for (const desc of data.pages as LegacyPageDescriptor[]) {
        const page = new PageModel(desc.id);
        page.pinned = desc.pinned ?? false;

        if (desc.editor && Object.keys(desc.editor).length > 0) {
            const legacy = await this.restoreModelLegacy(desc.editor);
            if (!legacy) continue;
            const adapter = new LegacyEditorAdapter(legacy, deriveEditorId(legacy.state.get()));
            page.attach(adapter);
            (page as any)._mainEditorId = adapter.id;
            page.state.update((s) => { s.mainEditorId = adapter.id; });

            if (desc.hasSidebar) {
                await this.restoreSidebarLegacy(page);
                await this.restoreSecondaryEditorsLegacy(page, legacy);
            }
        } else if (desc.hasSidebar) {
            await this.restoreSidebarLegacy(page);
            await this.restoreSecondaryEditorsLegacy(page, null);
        } else {
            continue;
        }

        this.model.attachPage(page);
        models.push(page);
    }

    const active = models.find((m) => m.id === data.activePageId);
    const ordered = active ? [...models.filter((m) => m !== active), active] : models;
    this.model.state.update((s) => { s.pages = models; s.ordered = ordered; });

    if (data.groupings && Array.isArray(data.groupings)) {
        data.groupings.forEach((el: any) => {
            if (Array.isArray(el) && el.length === 2) this.model.layout.group(el[0], el[1]);
        });
        this.model.layout.fixGrouping();
    }
}

private async restoreModelLegacy(data: Partial<IEditorState>): Promise<LegacyEditorModel | null> {
    // today's restoreModel body — kept here, private, only for v3 dual-read.
    // Builds legacy editor via legacy registry + newEmptyEditorModel + applyRestoreData + restore.
}

private async restoreSidebarLegacy(page: PageModel): Promise<void> {
    // Reads <pageId>-nav-panel.txt (today's PageSidebarSavedState shape) and
    // populates page.pageNavigatorModel + page.activePanel + a deferred
    // secondaryDescriptors list stored on the page for restoreSecondaryEditorsLegacy.
}

private async restoreSecondaryEditorsLegacy(page: PageModel, ownerLegacy: LegacyEditorModel | null): Promise<void> {
    // Today's restoreSecondaryEditors body: for each pending descriptor,
    // build legacy editor, wrap in adapter, page.attach(adapter).
}
```

Three private helpers (`restoreModelLegacy`, `restoreSidebarLegacy`, `restoreSecondaryEditorsLegacy`) move from PageModel.ts into PagesPersistenceModel.ts (their only consumer is now legacy-restore). PageModel's `restoreSidebar` + `restoreSecondaryEditors` methods delete.

After US-548 ships and users upgrade, on first save the openFiles.txt becomes v4-shaped (with sidebar folded). Subsequent launches read v4 directly. Pre-existing `<pageId>-nav-panel.txt` files orphan harmlessly (P9 — accepted).

### Step 9 — Migrate `src/shared/types.ts` and `PageDragData`

**Modify:** `src/shared/types.ts`

- Keep `IEditorState`, `EditorType`, `EditorView` — these are legacy types still consumed by legacy editors. Retire in US-559.
- Migrate `PageDescriptor` references: in `WindowPages` and `PageDragData`, switch `page?: PageDescriptor` to `page?: V4PageDescriptor` (import from `persistence-v4.ts`). Both windows run the same code; the drag payload picks up the v4 shape per walkthrough 05 / M1.
- Keep the legacy `PageDescriptor` + `WindowState` types in `types.ts` UNDER A RENAMED EXPORT (`LegacyPageDescriptor`, `LegacyWindowState`) for the dual-read code path. US-559 deletes them.

**Modify:** `src/renderer/ui/tabs/PageTab.tsx`

`getDragData()` builds v4 PageDescriptor via `page.getDescriptor()`.

### Step 10 — Migrate compare-mode UI surfaces

Per CK1, CK5, CK6, CK10:

**Modify:** `src/renderer/ui/app/Pages.tsx`
- `PageContent` reads compare-mode state via `pagesModel.query.isInCompareMode(pageId)` — subscribe to `pagesModel.state.use(s => s.compareGroups)` to trigger re-renders.
- Drop the `compareModeChanged.subscribe → pagesModel.rerender` effect; replace with derivation from `compareGroups` directly in render.
- `CompareEditor` gets `leftPageId` prop (CK10). PageContent already has the leftId resolved.
- `compareModeIds: Set<string>` derived from `pagesModel.state.compareGroups`.

**Modify:** `src/renderer/editors/text/TextToolbar.tsx`
- Compare button onClick: `pagesModel.layout.enterCompareMode(model.id)`. Drop the dual `setCompareMode(true)` calls.
- Button visibility check: `pagesModel.query.canCompare(model.page.id, partner.id)` (CK3).
- The `isTextFileModel` check inside (line ~100 area) — keep as today for now; reads `model` which is a legacy TextFileModel via the adapter unwrap path (the toolbar still receives legacy TextFileModel through a getTextFileHost call upstream).

**Modify:** `src/renderer/editors/compare/CompareEditor.tsx`
- Accept new prop `leftPageId: string`.
- Exit button onClick: `pagesModel.layout.exitCompareMode(leftPageId)`. Drop the dual `setCompareMode(false)` calls.

**Modify:** `src/renderer/editors/text/TextEditorModel.ts`
- Remove `compareMode: boolean` from `ITextFileState`.
- Delete the `compareMode` reads in `getRestoreData`/`applyRestoreData` (they were implicit via state).

**Modify:** `src/renderer/editors/text/TextFileActionsModel.ts`
- Delete `setCompareMode` method.

**Modify:** `src/renderer/core/state/events.ts`
- Delete `compareModeChanged` Subscription.

### Step 11 — Migrate PageNavigator subscription

**Modify:** `src/renderer/ui/navigation/PageNavigator.tsx`
- Replace `page.secondaryEditorsVersion.use()` with `page.state.use()` (N2).
- Replace `page.secondaryEditors` iteration with `page.panelEditors`.

### Step 12 — Migrate `PageTab.closeClick` simplification

**Modify:** `src/renderer/ui/tabs/PageTab.tsx`
- `closeClick`'s grouped branch drops the `pagesModel.fixCompareMode()` call (GK4). Resulting flow: `ungroup → showPage`.

---

## Files changed summary

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/editors/base/v4/LegacyEditorAdapter.ts` | **NEW** | The adapter class + `deriveEditorId` helper. |
| `src/renderer/editors/base/v4/index.ts` | MODIFY | Re-export `LegacyEditorAdapter`, `deriveEditorId`. |
| `src/renderer/editors/register-editors.ts` | MODIFY | Add bridge loop populating v4 registry. |
| `src/renderer/api/pages/PageModel.ts` | **REWRITE** | Unified-array shape + getDescriptor + saveState + close()/dispose() + compat shims. |
| `src/renderer/api/pages/PagesModel.ts` | MODIFY | compareGroups in state; descriptorChanged-based subscription map; drop rerender; new delegates. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | MODIFY | Wrap legacy editors via adapter at every call site; openDiff/duplicatePage/movePageIn rewrite. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | MODIFY | Dual-read (v4 + v3); v4 write; restorePage helper; absorb sidebar restore from PageModel. |
| `src/renderer/api/pages/PagesLayoutModel.ts` | MODIFY | Add enterCompareMode/exitCompareMode; delete fixCompareMode; ungroup cleanup. |
| `src/renderer/api/pages/PagesQueryModel.ts` | MODIFY | findPage rewrite; add canCompare/isInCompareMode/getTextFileHost. |
| `src/shared/types.ts` | MODIFY | Rename legacy PageDescriptor → LegacyPageDescriptor; PageDragData uses v4. |
| `src/renderer/ui/tabs/PageTab.tsx` | MODIFY | getDragData uses page.getDescriptor(); closeClick drops fixCompareMode call. |
| `src/renderer/ui/navigation/PageNavigator.tsx` | MODIFY | Subscribe to page.state; iterate page.panelEditors. |
| `src/renderer/ui/app/Pages.tsx` | MODIFY | Derive compareModeIds from compareGroups; drop compareModeChanged sub. |
| `src/renderer/editors/text/TextEditorModel.ts` | MODIFY | Remove compareMode field. |
| `src/renderer/editors/text/TextFileActionsModel.ts` | MODIFY | Delete setCompareMode method. |
| `src/renderer/editors/text/TextToolbar.tsx` | MODIFY | Use enterCompareMode; canCompare for visibility. |
| `src/renderer/editors/compare/CompareEditor.tsx` | MODIFY | Add leftPageId prop; use exitCompareMode. |
| `src/renderer/core/state/events.ts` | MODIFY | Delete compareModeChanged Subscription. |

### Files NOT changing (verified, no surgery needed)

- `src/renderer/api/pages/PagesNavigationModel.ts` — page focus only.
- `src/renderer/ui/navigation/PageNavigatorModel.ts` — sidebar layout only.
- `src/renderer/ui/navigation/secondary-editor-registry.ts` — panel-id → component map.
- `src/renderer/components/page-manager/AppPageManager.tsx` — prop shape unchanged.
- `src/renderer/components/page-manager/GroupContainer.ts` — pure DOM.
- `src/renderer/components/page-manager/ImperativeSplitter.ts` — pure DOM.
- `src/main/drag-model.ts` — buffering only.
- `src/main/open-windows.ts` — window management.
- Every individual editor file (Monaco, Grid, PDF, Image, Browser, Archive, Link, Notebook, Todo, RestClient, Mermaid, Markdown, SVG, HTML, Log, Graph, Draw, Compare, About, Settings, Storybook, Video, MCP, Category, Explorer) — wrapped by adapter, internals untouched.
- `src/renderer/editors/base/EditorModel.ts` (legacy) — survives unchanged; setter side effects still flow via PageModel compat shims.
- `src/renderer/scripting/api-wrapper/PageWrapper.ts` — the `editor` setter still calls `model.changeEditor(view)`; rewiring to `page.switchMainEditor` lands in US-550.
- `src/renderer/api/mcp-handler.ts` — adopts new MCP routing in US-550.

---

## Concerns / Open questions

All 12 resolved 2026-05-20 — user accepted every proposed default. Locked decisions:

### Q1 — Scope discrepancy: `secondaryEditorIds[]` vs `panelEditors` getter — **RESOLVED**

The EPIC scope text reads "editors[] / mainEditorId / **secondaryEditorIds[]**" but design phase (walkthrough 01 / A8, walkthrough 03 / N3) chose `panelEditors` getter (filter `editors[]` by `contributesPanels()`). **Decision**: follow design phase — no separate field.

### Q2 — Adapter location and instantiation pattern — **RESOLVED**

**Decision**: (a) — wrap at PagesLifecycleModel call sites. Each `addPage` / `openFile` / etc. wraps the legacy editor result before attaching. Explicit, traceable. PageModel.attach receives only v4 EditorModels.

### Q3 — Switch widget semantics in US-548 — **RESOLVED**

**Decision**: (c) — defer to US-549. `page.switchMainEditor(newEditorId)` lands as a public method with adapter throw semantics; no in-app caller is wired in US-548 (US-549's shared chrome rewrite absorbs the widget). TextToolbar's existing SegmentedControl stays calling `model.changeEditor(view)` directly until US-549.

### Q4 — `TextFileModel.compareMode` field removal — **RESOLVED**

**Decision**: full sweep in US-548. Delete the field from `ITextFileState`, delete `setCompareMode` from `TextFileActionsModel`, migrate every reader to `pagesModel.query.isInCompareMode(pageId)`. Equivalent semantics — `openDiff` calls `enterCompareMode(firstId)` once instead of two `state.update` calls.

### Q5 — Existing user's compareMode loss on upgrade — **RESOLVED**

**Decision**: accept per CK9. On first v4 launch a previously-compare-mode pair restores side-by-side (no diff). On first save the flag drops from disk. Document in release notes.

### Q6 — `PageModel` compat shims for legacy setter side-effects — **RESOLVED**

**Decision**: keep `addSecondaryEditor` / `removeSecondaryEditorWithoutDispose` / `removeSecondaryEditor` / `findSecondaryEditor` as compat shims on PageModel that delegate to `attach` / `detach`. They retire in US-559.

### Q7 — `_pendingActivePanel` retirement timing — **RESOLVED**

**Decision**: v4 restore path uses parallel `Promise.all` + apply-after (no pending field). v3 restore path keeps the deferred pattern as local state inside `PagesPersistenceModel`'s legacy helpers (not on PageModel). PageModel does not carry the field.

### Q8 — `EditorView` / `EditorType` types — **RESOLVED**

**Decision**: keep both string-literal unions in `src/shared/types.ts` for US-548 (still consumed by legacy editors, PAGE_TYPE_MIGRATIONS, ScriptContext, PageWrapper). US-559 deletes them.

### Q9 — adapter `editorId` for empty Monaco page — **RESOLVED**

**Decision**: verified. `deriveEditorId({type: "textFile", editor: undefined})` returns `"monaco"` via legacy-registry fallback. Matches L1.

### Q10 — Cross-renderer v3/v4 IPC payload mismatch — **RESOLVED**

**Decision**: accept. App upgrade replaces all running renderers; the multi-build scenario is artificial.

### Q11 — `closeFirstPageIfEmpty` migration to `isFreshEmpty()` — **RESOLVED**

**Decision**: verified equivalent. Adapter's `isFreshEmpty()` reads legacy state directly; same predicate, different surface.

### Q12 — `close()` ordering — **RESOLVED**

**Decision**: adopt v4 shape (modified-only iteration, panel-editors first, main last). Minor perf win over today's blanket-iteration shape; equivalent observable behavior.

---

## Acceptance criteria

1. **`npm run lint` passes** with no new errors (existing pre-existing errors carry over from US-547 baseline — 49 errors, 0 from new files).
2. **`npm run typecheck` passes** with no new errors (US-547 baseline: 20 pre-existing errors, 0 from new files).
3. **Manual smoke test**: launch the app via `npm start`. Verify:
   - App starts; the auto-empty Monaco page appears.
   - Open a text file via Open dialog — file opens, content displays, syntax highlighting works.
   - Open a JSON file with `.grid.json` extension — grid editor opens correctly.
   - Open a `.note.json` file — notebook editor opens correctly.
   - Open a folder (Open Folder) — explorer panel renders.
   - Open an archive (zip) — archive view renders.
   - Open a PDF — PDF viewer renders.
   - Open an image — image viewer renders.
   - Open a video file — video player renders.
   - Open About / Settings / Storybook — well-known pages render.
   - Group two text tabs side-by-side; click Compare with Left Page; diff editor renders; exit compare returns to side-by-side.
   - Drag a tab to a new window — page transfers; cache files survive (content preserved).
   - Edit a file; type; close tab → save prompt appears.
   - Close all tabs → empty page auto-creates.
   - Click "Open Diff" from script panel — two pages open in compare mode.
4. **Persistence round-trip**:
   - Open several files, edit some, close the app. Re-open: every page restores with content + cursor position + sidebar + grouping + active panel intact.
   - Open the data file (`%APPDATA%/persephone/data/openFiles.txt`) — verify `schemaVersion: 4` and the v4 page descriptor shape.
5. **Backwards-compatible bootstrap**: rename current openFiles.txt to backup; copy a v3 user's openFiles.txt + their `<userData>/cache/<pageId>-nav-panel.txt` files into the data dir. Launch: pages restore, sidebars restore, on first save the file becomes v4 shape. (If no v3 sample available, simulate by hand-crafting a minimal v3 openFiles.txt with one text page + one archive page + one Explorer page.)
6. **Compare mode survives in-process**: enter compare mode → minimize main window to tray → restore from tray → compare still active. Quit the app → restart → compare NOT active (CK9 confirmed loss).

---

## References

- [EPIC-028](../../epics/EPIC-028.md) — master plan + implementation phases.
- [Walkthrough 01](../../epics/EPIC-028-editor-architecture/walkthroughs/01-page-lifecycle.md) — A1, A3, A6, A7, A8 (lifecycle, unified array, descriptorChanged).
- [Walkthrough 02](../../epics/EPIC-028-editor-architecture/walkthroughs/02-main-editor-swap.md) — S10/B1 (editorId), B2 (switchMainEditor), B4 (ComponentQueue — already in US-547).
- [Walkthrough 03](../../epics/EPIC-028-editor-architecture/walkthroughs/03-secondary-editors.md) — N1/B3 (attach + slice subscription), N7/B6 (close ordering), N5 (CategoryEditor reactivity).
- [Walkthrough 04](../../epics/EPIC-028-editor-architecture/walkthroughs/04-persistence.md) — C1 (descriptors), C5 (restoreState/restorePage), C6 (saveState), C7 (PageModel cache cleanup).
- [Walkthrough 05](../../epics/EPIC-028-editor-architecture/walkthroughs/05-multi-window-transfer.md) — M2 (unified restore), M3 (flush ordering), M5 (instanceId continuity).
- [Walkthrough 06](../../epics/EPIC-028-editor-architecture/walkthroughs/06-compare-mode.md) — CK1–CK10.
- [Walkthrough 07](../../epics/EPIC-028-editor-architecture/walkthroughs/07-grouped-pages.md) — GK2 (getTextFileHost), GK4 (closeClick simplification).
- [Foundation mockups](../../epics/EPIC-028-editor-architecture/mockups/) — `PageModel.ts`, `EditorModel.ts`, `editorRegistry.ts`, `IContentHost.ts`, `TextFileModel.ts`, `PersistenceTypes.ts`, `ComponentQueue.ts`, `TOneState.ts`.
- US-547 implementation commit `abead6f` on `upcoming-v3.0.10`.
