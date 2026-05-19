// =============================================================================
// MOCKUP — PageModel (unified-array shape)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Replaces today's PageModel at /src/renderer/api/pages/PageModel.ts.
//
// Updated by walkthrough 01 (A7, A8):
//   - Single `editors: EditorModel[]` array replaces the dual
//      `_mainEditor: EditorModel | null` + `secondaryEditors: EditorModel[]`
//      shape from today's code.
//   - `_mainEditorId: string | null` flags which editor is the current
//      content area. Null = sidebar-only page (explorer-only, archive-root,
//      link-collection).
//   - Pattern B (model in both arrays) is inexpressible — every editor has
//      one membership in `editors[]`, with separate flags for "is main" and
//      "contributes panels".
//   - `switchMainEditor(newId)` uses the three-phase editor lifecycle:
//      createEditor → switchFrom(oldEditor) → restore → setMainEditor.
//      No standalone helper function — the page does it directly.
//   - **Visibility criterion**: an editor is kept in `editors[]` iff
//      `(editor.id === _mainEditorId) || editor.contributesPanels()`.
//      Otherwise PageModel detaches and disposes it. Evaluated at two
//      firing points:
//        (a) setMainEditor changes _mainEditorId.
//        (b) An editor's panel contribution becomes empty.
//      The notification mechanism for (b) is defined in walkthrough 03 (N1).
//
// Updated by walkthrough 03 (B3, B4, B6):
//   - `attach(editor)` sets up a TOneState **selective subscription** on
//      `editor.state.secondaryEditor` (via the new selector overload in
//      `TOneState.subscribe(listener, selector)` — mockup `TOneState.ts`).
//      `detach(editor)` tears it down. Per-editor unsub map keyed on id.
//   - `onEditorPanelsChanged(editor)` — handler fired by the slice
//      subscription. Bumps `state.version` (so PageNavigator re-renders) and
//      enforces the visibility criterion for that editor.
//   - `close()` iterates panel-contributing editors first, then the main
//      editor — preserves today's "ask side things, ask main thing last"
//      ordering. Cancellation on any inner editor aborts the close while
//      leaving the page (with its main content area) visible.
//
// Updated by walkthrough 08 (T3 / B1):
//   - `getDescriptor(): PageDescriptor` — single source of truth for the
//      page's serialized shape. Consumed by `PagesPersistenceModel.saveState`,
//      `PageTab.getDragData`, and `PagesLifecycleModel.duplicatePage`.
//      Eliminates the drift risk of inline `PageDescriptor` composition
//      across multiple callers.
//
// Updated by walkthrough 04 (P3, P5, C7):
//   - All per-page sidebar-cache machinery removed: `_saveState`,
//      `_saveStateDebounced`, `_cacheName`, `_skipSave`, `restoreSidebar`,
//      `pendingSecondaryDescriptors`, `_pendingActivePanel`,
//      `restoreSecondaryEditors`, `flushSave` — gone. Sidebar metadata
//      (`open`, `width`, `activePanel`) is folded into the unified
//      PageDescriptor (mockup `PersistenceTypes.ts`).
//   - `<pageId>-nav-panel.txt` cache file is retired. The page-level
//      subscription on `page.state` (already in `PagesModel.attachPage`)
//      carries open/width/activePanel mutations into the window-level
//      `saveStateDebounced` (500ms).
//   - `saveState()` iterates `editors[]` and flushes each editor's own
//      per-editor cache file (large state like Monaco content, decorations,
//      script panel state).
//   - `dispose()` no longer calls `fs.deleteCacheFiles(this.id)` — there is
//      no page-level cache file anymore. Per-editor caches still cleaned by
//      `fs.deleteCacheFiles(editor.id)` inside the editor dispose loop.
//   - `_pendingActivePanel` retired (P5). Parallel per-editor restore via
//      `Promise.all` guarantees panel-contributors are present before the
//      active-panel resolution runs in `PagesPersistenceModel.restorePage`.
// =============================================================================

import { TOneState } from "../../../src/renderer/core/state/state";
import type { EditorModel } from "./EditorModel";
import { editorRegistry } from "./editorRegistry";
import { fs } from "../../../src/renderer/api/fs";
import type { PageDescriptor } from "./PersistenceTypes";

// -----------------------------------------------------------------------------
// Reactive page-level state
// -----------------------------------------------------------------------------

export interface IPageState {
    pinned: boolean;
    mainEditorId: string | null;
    /** Bumped when editors[] changes so UI re-renders. */
    version: number;
}

const defaultPageState: IPageState = {
    pinned: false,
    mainEditorId: null,
    version: 0,
};

// -----------------------------------------------------------------------------
// PageModel
// -----------------------------------------------------------------------------

export class PageModel {
    /** Stable page UUID — tab identity, React key, cache key. Never changes. */
    readonly id: string;

    readonly state = new TOneState<IPageState>({ ...defaultPageState });

    /**
     * All editors attached to this page. Order matches sidebar panel order.
     * One of these may also be the main editor (flagged by `_mainEditorId`).
     *
     * Editor lifetime in this array follows the visibility criterion:
     *   keep iff (editor.id === _mainEditorId) || editor.contributesPanels()
     */
    readonly editors: EditorModel[] = [];

    /**
     * Which editor in `editors[]` is the main (content area). Null = no
     * main; the page is sidebar-only. The matching editor (if any) is
     * found via `editors.find(e => e.id === _mainEditorId)`.
     */
    private _mainEditorId: string | null = null;

    /** Close callback — set by PagesModel.attachPage(). */
    onClose?: () => void;

    /** Sidebar layout model (open/closed, width). Lazy-created on first
     *  panel-contributing attach via ensurePageNavigatorModel(). */
    pageNavigatorModel: import("../../../src/renderer/ui/navigation/PageNavigatorModel").PageNavigatorModel | null = null;

    /** Which panel is currently expanded. Values: "explorer", "search",
     *  or a secondary panel ID. */
    activePanel: string = "explorer";

    /** Per-editor unsubscribe handles for the `secondaryEditor` slice
     *  subscriptions set up in `attach()`. Drained on `detach()` (and
     *  defensively in `dispose()`). See walkthrough 03 / N1. */
    private _editorSubs = new Map<string, () => void>();

    constructor(id?: string) {
        this.id = id ?? crypto.randomUUID();
    }

    // ── Derived getters ──────────────────────────────────────────────

    get mainEditor(): EditorModel | null {
        return this._mainEditorId
            ? this.editors.find((e) => e.id === this._mainEditorId) ?? null
            : null;
    }

    get pinned(): boolean { return this.state.get().pinned; }
    set pinned(v: boolean) { this.state.update((s) => { s.pinned = v; }); }

    get title(): string { return this.mainEditor?.title ?? "Empty"; }
    get modified(): boolean { return this.editors.some((e) => e.modified); }

    /** True if any editor contributes panels OR the navigator is open standalone. */
    get hasSidebar(): boolean {
        return this.editors.some((e) => e.contributesPanels()) || this.pageNavigatorModel !== null;
    }

    /** Editors that currently contribute panels (subset of `editors[]`).
     *  PageNavigator iterates this in array order to render the sidebar. */
    get panelEditors(): EditorModel[] {
        return this.editors.filter((e) => e.contributesPanels());
    }

    // ── Membership primitives ─────────────────────────────────────────

    /** Add an editor. No-op if already present.
     *
     *  Walkthrough 03 / N1: subscribes to a slice of the editor's state
     *  (`secondaryEditor`) using the TOneState selector overload. The handler
     *  fires only when the panel list actually differs, never on unrelated
     *  state mutations (title, modified, cursor, etc.). On any flip, the
     *  page bumps version and reconciles visibility for that editor. */
    attach(editor: EditorModel): void {
        if (this.editors.includes(editor)) return;
        this.editors.push(editor);
        editor.setPage(this);
        const unsub = editor.state.subscribe(
            () => this.onEditorPanelsChanged(editor),
            (s) => s.secondaryEditor,
        );
        this._editorSubs.set(editor.id, unsub);
        // PagesModel.attachPage subscribes to editor.descriptorChanged (A6)
        // when this method is called — see PagesModel.attachEditor helper.
        this.state.update((s) => { s.version++; });
    }

    /** Remove an editor. Does NOT dispose — caller decides. Used by both
     *  the visibility-criterion auto-detach (which calls dispose after)
     *  and explicit user actions. */
    detach(editor: EditorModel): void {
        const idx = this.editors.indexOf(editor);
        if (idx < 0) return;
        this.editors.splice(idx, 1);
        this._editorSubs.get(editor.id)?.();
        this._editorSubs.delete(editor.id);
        editor.setPage(null);
        // If this was the main editor, clear the flag.
        if (this._mainEditorId === editor.id) {
            this._mainEditorId = null;
            this.state.update((s) => { s.mainEditorId = null; });
        }
        this.state.update((s) => { s.version++; });
    }

    /**
     * Handler for the `secondaryEditor` slice subscription set up in `attach`.
     * Fired whenever an editor's panel-list reference changes (per
     * `compareSelection` in the TOneState selector — arrays/undefined use
     * reference equality, and Immer always produces new references in
     * `state.update`, so this catches every legitimate setter assignment).
     *
     * - Bumps `state.version` → PageNavigator re-renders.
     * - Enforces the visibility criterion for this editor: if it's no longer
     *   the main editor AND no longer contributes panels, detach + dispose.
     *
     * Walkthrough 03 / N1.
     */
    onEditorPanelsChanged(editor: EditorModel): void {
        this.state.update((s) => { s.version++; });
        if (!this.editors.includes(editor)) return;
        if (editor !== this.mainEditor && !editor.contributesPanels()) {
            this.detach(editor);
            setTimeout(async () => {
                await editor.dispose();
                await fs.deleteCacheFiles(editor.id);
            }, 0);
        }
    }

    // ── Main editor swap ───────────────────────────────────────────────

    /**
     * Replace (or clear) the main editor. Handles lifecycle:
     *  - calls beforeNavigateAway on the old main
     *  - applies the visibility criterion to the old main:
     *      if not visible (no panels), detach + dispose
     *  - attaches the new editor if not already present
     *  - sets _mainEditorId
     *  - fires notifyMainEditorChanged on remaining editors
     *
     * Cache cleanup (C9): if the old main is detached and its id was NOT
     * transferred to a successor (i.e., `newEditor.id !== oldMain.id`), the
     * page deletes `<oldMain.id>-*` cache files. On switch (same id reused),
     * the cache survives.
     */
    async setMainEditor(newEditor: EditorModel | null): Promise<void> {
        const oldMain = this.mainEditor;
        if (oldMain && newEditor && oldMain !== newEditor) {
            oldMain.beforeNavigateAway(newEditor);
        }
        if (newEditor && !this.editors.includes(newEditor)) {
            this.attach(newEditor);
        }
        this._mainEditorId = newEditor?.id ?? null;
        this.state.update((s) => { s.mainEditorId = this._mainEditorId; });

        // Apply visibility criterion to old main.
        if (oldMain && oldMain !== newEditor && !oldMain.contributesPanels()) {
            this.detach(oldMain);
            const idTransferred = newEditor?.id === oldMain.id;
            // Defer dispose so React can unmount the old view first
            // (avoids Monaco's internal Delayer "Canceled" rejection).
            setTimeout(async () => {
                await oldMain.dispose();
                if (!idTransferred) {
                    await fs.deleteCacheFiles(oldMain.id);
                }
            }, 0);
        }
        this.notifyMainEditorChanged();
    }

    /**
     * Switch the main editor to a different editor type while preserving
     * the content via host transfer.
     *
     * Uses the three-phase editor lifecycle:
     *   createEditor → switchFrom(oldEditor) → restore → setMainEditor
     *
     * Pre-condition: oldEditor.traits.has(CONTENT_HOST_TRAIT). The switch
     * widget only renders for compatible editors via findCompatibleEditors().
     */
    async switchMainEditor(newEditorId: string): Promise<void> {
        const oldEditor = this.mainEditor;
        if (!oldEditor) return;
        const newEditor = await editorRegistry.createEditor(newEditorId);
        newEditor.switchFrom(oldEditor);     // extracts host from old's trait
        await newEditor.restore();           // host already restored; only editor-state restored
        await this.setMainEditor(newEditor); // disposes old (its host reference is null)
    }

    /**
     * Notify every editor (except the new main) that the main editor changed.
     * Editors may react — e.g., ArchiveEditor self-evicts when the new main
     * wasn't opened from its archive.
     */
    notifyMainEditorChanged(): void {
        const main = this.mainEditor;
        for (const editor of [...this.editors]) {
            if (editor === main) continue;
            editor.onMainEditorChanged(main);
        }
        // Visibility criterion: any editor that opted out of panels via
        // beforeNavigateAway / onMainEditorChanged and isn't the main gets
        // detached + disposed.
        this.reconcileVisibility();
    }

    /**
     * Re-evaluate the visibility criterion across all editors. Called by
     * notifyMainEditorChanged and by the panels-changed notification path
     * (walkthrough 03 defines the trigger mechanism).
     *
     * Cache cleanup (C9): invisible editors are not switch sources — their
     * ids are fully released. The page deletes `<e.id>-*` cache files.
     */
    reconcileVisibility(): void {
        const main = this.mainEditor;
        const invisible = this.editors.filter(
            (e) => e !== main && !e.contributesPanels(),
        );
        for (const e of invisible) {
            this.detach(e);
            setTimeout(async () => {
                await e.dispose();
                await fs.deleteCacheFiles(e.id);
            }, 0);
        }
    }

    // ── Sidebar / PageNavigator ────────────────────────────────────────

    setActivePanel(panel: string): void {
        this.activePanel = panel;
        this.state.update((s) => { s.version++; });
        const owner = this.editors.find((e) => e.secondaryEditor?.includes(panel));
        owner?.onPanelExpanded(panel);
    }

    // ── Persistence (walkthrough 04 / C7; walkthrough 08 / T3) ─────────

    /**
     * Build the page's serialized descriptor. Single source of truth for the
     * `PageDescriptor` shape (mockup `PersistenceTypes.ts`).
     *
     * Three consumers (walkthrough 08 / T3 / B1):
     *   - `PagesPersistenceModel.saveState` — per-window file write
     *   - `PageTab.getDragData` — cross-window drag payload
     *   - `PagesLifecycleModel.duplicatePage` — with fresh ids on the copy
     *
     * Mirrors `EditorModel.getRestoreData()` — each layer describes itself;
     * many consumers read the same shape. Eliminates the drift risk between
     * persistence and drag-payload inline composition that today's code has.
     */
    getDescriptor(): PageDescriptor {
        return {
            id: this.id,
            pinned: this.pinned,
            modified: this.modified,
            mainEditorId: this._mainEditorId,
            editors: this.editors.map((e) => e.getRestoreData()),
            sidebar: this.pageNavigatorModel
                ? {
                      open: this.pageNavigatorModel.open,
                      width: this.pageNavigatorModel.width,
                      activePanel: this.activePanel,
                  }
                : undefined,
        };
    }

    /**
     * Flush per-editor cache files. Window-level descriptor is written by
     * `PagesPersistenceModel.saveState` separately (which calls
     * `page.getDescriptor()` per walkthrough 08 / T3, which in turn calls
     * `editor.getRestoreData()` on each editor in `editors[]`).
     *
     * Two callers:
     *   - `RendererEventsService.handleBeforeQuit` — flush before app quit
     *      so the next launch's bootstrap restore reads up-to-date caches
     *      (walkthrough 04 / C7).
     *   - `PagesLifecycleModel.movePageOut` — flush before detach so the
     *      target window's `editor.restore()` reads up-to-date caches on the
     *      other side of the IPC transfer (walkthrough 05 / M3).
     *
     * Each `EditorModel` subclass's `saveState?()` MUST internally flush its
     * own debounce — this is an awaitable flush, not a fire-and-forget save.
     *
     * Page-level cache files (today's `<pageId>-nav-panel.txt`) no longer
     * exist (walkthrough 04 / P3); nothing to flush at this level.
     */
    async saveState(): Promise<void> {
        await Promise.all(this.editors.map((e) => e.saveState?.()));
    }

    // ── Close & dispose ────────────────────────────────────────────────

    /**
     * Close this page (tab). Checks for unsaved changes in every editor.
     *
     * Walkthrough 03 / N7: iterates panel-contributing editors first, then
     * the main editor last. Rationale: cancellation on any inner editor
     * aborts the close while leaving the page (with its main content area)
     * visible to the user; closing the main editor is the conceptual commit
     * point for the page tab itself.
     *
     * Iteration within the panel-editor pass uses insertion order. Each
     * editor is asked via `confirmRelease()` (only if modified); any Cancel
     * short-circuits the close.
     */
    async close(): Promise<boolean> {
        // Panel-contributing editors first.
        for (const editor of this.editors) {
            if (editor === this.mainEditor) continue;
            if (!editor.modified) continue;
            const released = await editor.confirmRelease();
            if (!released) return false;
        }
        // Main editor last — closing it commits to closing the page tab.
        if (this.mainEditor?.modified) {
            const released = await this.mainEditor.confirmRelease();
            if (!released) return false;
        }
        this.onClose?.();
        return true;
    }

    /**
     * Dispose all attached editors. Clean loop — no Pattern B dedup needed
     * (Pattern B is inexpressible in the unified-array model).
     *
     * Cache cleanup (C9): all editors here are fully released — no
     * successors. The page deletes each `<editor.id>-*` cache file set.
     *
     * Walkthrough 03 / N1: defensively drain `_editorSubs` even though every
     * `detach()` call unsubscribes — disposal may be reached from paths that
     * bypass `detach()`.
     *
     * Walkthrough 04 / P3: page-level cache (today's `<pageId>-nav-panel.txt`)
     * no longer exists; the trailing `fs.deleteCacheFiles(this.id)` call from
     * the prior shape is removed.
     */
    async dispose(): Promise<void> {
        for (const unsub of this._editorSubs.values()) unsub();
        this._editorSubs.clear();
        for (const editor of this.editors) {
            editor.setPage(null);
            await editor.dispose();
            await fs.deleteCacheFiles(editor.id);
        }
        this.editors.length = 0;
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
    }
}

// =============================================================================
// What's gone vs. today's PageModel
// =============================================================================
//
// REMOVED FIELDS:
//   - `_mainEditor: EditorModel | null` → replaced by editors[] + _mainEditorId
//   - `secondaryEditors: EditorModel[]` → merged into editors[]
//   - `secondaryEditorsVersion` → state.version covers re-render
//   - `pendingSecondaryDescriptors` → folded into PageDescriptor.editors[]
//      (walkthrough 04 / P3)
//   - `_pendingActivePanel` → retired (walkthrough 04 / P5). Parallel
//      `Promise.all` restore guarantees panel-contributors are present
//      before the active-panel resolution runs.
//   - `_cacheName`, `_skipSave`, `_unsubscribe` (sidebar cache file
//      machinery) → gone with `<pageId>-nav-panel.txt` (walkthrough 04 / P3)
//
// REMOVED METHODS:
//   - `addSecondaryEditor` → `attach`
//   - `removeSecondaryEditor` → `detach + dispose`
//   - `removeSecondaryEditorWithoutDispose` → `detach`
//   - `promoteSecondaryToMain` → just `setMainEditor(secondary)`; the
//      _prePromotePanels / queueMicrotask dance is gone because Pattern B
//      doesn't exist
//   - `restoreSecondaryEditors` / `restoreSidebar` → folded into
//      `PagesPersistenceModel.restorePage` (walkthrough 04 / P3, P5)
//   - `_saveState`, `_saveStateDebounced`, `flushSave` → sidebar cache file
//      retired (walkthrough 04 / P3). Per-editor cache flush via the new
//      `saveState()` method that iterates `editors[]`.
//   - `_notifyMainEditorOfSecondaryChange` → CategoryEditor's view now
//      subscribes to `page.state.use()` directly (walkthrough 03 / N5);
//      the duck-typed `onSecondaryEditorsChanged` method check is gone.
//   - `confirmSecondaryRelease` → absorbed into `close()` (walkthrough 03 / N7
//      iterates panel editors first, then main).
//
// REMOVED HELPERS:
//   - `switchEditorViaContentHost` standalone helper — PageModel does the
//      three-phase switch directly in switchMainEditor
//
// REMOVED CACHE-FILE PATHS:
//   - `<userData>/cache/<pageId>-nav-panel.txt` — folded into
//      `PageDescriptor.sidebar` in the unified WindowState (walkthrough 04 / P3)
//
// NEW:
//   - `attach` / `detach` membership primitives
//   - `reconcileVisibility` — enforces the visibility criterion
//   - `switchMainEditor` — three-phase switch
//   - `panelEditors` getter for PageNavigator
//   - `onEditorPanelsChanged(editor)` — handler for the per-editor slice
//      subscription set up in `attach()` (walkthrough 03 / N1). Bumps
//      `state.version` and enforces the visibility criterion for the editor.
//   - `_editorSubs: Map<string, () => void>` — per-editor unsubscribe handles
//      for the `secondaryEditor` slice subscriptions (walkthrough 03 / N1).
//   - `saveState()` — flushes per-editor cache files via
//      `Promise.all(editors.map(e => e.saveState?.()))` (walkthrough 04 / C7).
//   - `getDescriptor(): PageDescriptor` — single source of truth for the
//      serialized page shape (walkthrough 08 / T3 / B1). Consumed by
//      `PagesPersistenceModel.saveState`, `PageTab.getDragData`, and
//      `PagesLifecycleModel.duplicatePage`.
//
// SURVIVING (unchanged in shape):
//   - id, pinned, title, modified, hasSidebar getters (delegate to editors)
//   - setActivePanel
//   - onClose callback set by PagesModel.attachPage
//
// CHANGED (signature preserved, internals rewired):
//   - `close()` — iterates panel editors first, main editor last
//      (walkthrough 03 / N7). Same return shape, different order.
//   - `dispose()` — no trailing `fs.deleteCacheFiles(this.id)` call (page-
//      level cache file is gone — walkthrough 04 / P3). Per-editor caches
//      still cleaned by `fs.deleteCacheFiles(editor.id)` inside the loop.
//
// =============================================================================
