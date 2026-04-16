import { TOneState } from "../../core/state/state";
import type { EditorModel } from "../../editors/base";
import type { IEditorState } from "../../../shared/types";
import { PageNavigatorModel } from "../../ui/navigation/PageNavigatorModel";
import type { IContentPipe } from "../types/io.pipe";
import { fs } from "../fs";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { panelExpanded } from "../../core/state/events";
import { fpDirname } from "../../core/utils/file-path";

export interface NavigationState {
    /** Currently selected item href (shared between PageNavigator and secondary editors). */
    selectedHref: string | null;
}

/** Serialized descriptor for a secondary editor model (for persistence). */
export interface SecondaryModelDescriptor {
    /** Serialized editor state (from model.getRestoreData()). */
    pageState: Partial<IEditorState>;
}

/** Persisted sidebar state (cache file). */
interface PageSidebarSavedState {
    open: boolean;
    width: number;
    activePanel?: string;
    secondaryModelDescriptors?: SecondaryModelDescriptor[];
}

/** Reactive page-level state — UI subscribes to this for re-render on page changes. */
export interface IPageState {
    /** Page-level pinned flag. */
    pinned: boolean;
    /** Whether the sidebar (PageNavigatorModel) exists. */
    hasSidebar: boolean;
    /** Current main editor ID — changes on navigation. UI subscribes to detect editor swaps. */
    mainEditorId: string | null;
}

const defaultPageState: IPageState = {
    pinned: false,
    hasSidebar: false,
    mainEditorId: null,
};

/**
 * PageModel — one per tab. Stable identity that survives navigation.
 *
 * Owns the browsing context (sidebar, tree, search, secondary editors)
 * and contains a mainEditor (EditorModel) as its content.
 */
export class PageModel {
    /** Stable page UUID — tab identity, React key, cache key. Never changes. */
    readonly id: string;

    /** Reactive page-level state. UI uses `page.state.use()` for re-render. */
    readonly state = new TOneState<IPageState>({ ...defaultPageState });

    /** The primary editor (content). Null = empty page with Explorer only. */
    private _mainEditor: EditorModel | null = null;

    /** Close callback — set by PagesModel.attachPage(). */
    onClose?: () => void;

    // ── Sidebar state ─────────────────────────────────────────────────

    /** Sidebar model — pure reactive state (open/close/width). */
    pageNavigatorModel: PageNavigatorModel | null = null;
    /** Which panel is currently active/expanded.
     *  Values: "explorer", "search", or a secondary panel ID. */
    activePanel: string = "explorer";

    // ── Secondary editors ────────────────────────────────────────────

    /** Editor models that act as secondary editors in the sidebar (survive navigation). */
    secondaryEditors: EditorModel[] = [];
    /** Reactive version counter — UI subscribes via .use() for re-render on add/remove. */
    readonly secondaryEditorsVersion = new TOneState({ version: 0 });
    /** Pending descriptors from restore — actual model creation deferred until restoreSecondaryEditors(). */
    pendingSecondaryDescriptors: SecondaryModelDescriptor[] | undefined = undefined;
    /** Deferred activePanel — set during restore, applied after restoreSecondaryEditors(). */
    private _pendingActivePanel: string | undefined = undefined;

    // ── Transient state (not persisted) ────────────────────────────

    /** Runtime-only key-value store. Survives editor navigation, cleared on page close / app restart. */
    private _transient = new Map<string, unknown>();

    /** Get a transient value by key. Returns undefined if not set. */
    getTransient<T>(key: string): T | undefined {
        return this._transient.get(key) as T | undefined;
    }

    /** Set a transient value. Pass undefined to delete. */
    setTransient(key: string, value: unknown): void {
        if (value === undefined) {
            this._transient.delete(key);
        } else {
            this._transient.set(key, value);
        }
    }

    // ── Internal ─────────────────────────────────────────────────────

    private _cacheName = "nav-panel";
    private _skipSave = false;
    private _unsubscribe: (() => void) | undefined = undefined;

    constructor(id?: string) {
        this.id = id ?? crypto.randomUUID();
    }

    // ── Main editor ────────────────────────────────────────────────

    get mainEditor(): EditorModel | null {
        return this._mainEditor;
    }

    /** Low-level setter — updates reference and bumps version for UI re-render.
     *  Does NOT handle lifecycle (dispose, beforeNavigateAway, notifications).
     *  Use setMainEditor() for navigation. */
    set mainEditor(editor: EditorModel | null) {
        this._mainEditor = editor;
        this.state.update((s) => { s.mainEditorId = editor?.id ?? null; });
    }

    /**
     * Replace the main editor with full lifecycle handling.
     * Used by navigatePageTo — consolidates the editor swap logic:
     * - Calls beforeNavigateAway on old editor
     * - Disposes old editor (unless it survived as secondary)
     * - Sets new editor's page reference
     * - Bumps version for UI re-render
     * - Notifies secondary editors
     * - Registers new editor's secondary panel if any
     */
    async setMainEditor(newEditor: EditorModel | null): Promise<void> {
        const oldEditor = this._mainEditor;
        let editorToDispose: EditorModel | null = null;

        if (oldEditor && newEditor) {
            // Give old editor a chance to keep/clear its secondary editor status
            oldEditor.beforeNavigateAway(newEditor);
            // If old editor survived as secondary, detach from main role but don't dispose
            const survivesAsSecondary = this.secondaryEditors.includes(oldEditor);
            if (!survivesAsSecondary) {
                oldEditor.setPage(null);
                editorToDispose = oldEditor;
            }
        } else if (oldEditor) {
            oldEditor.setPage(null);
            editorToDispose = oldEditor;
        }

        this._mainEditor = newEditor;
        if (newEditor) {
            newEditor.setPage(this);
        }
        this.state.update((s) => { s.mainEditorId = newEditor?.id ?? null; });

        // Notify secondary editors of the change
        this.notifyMainEditorChanged();

        // Register new editor's secondary panel if it has one
        if (newEditor) {
            const se = newEditor.state.get().secondaryEditor;
            if (se?.length) {
                this.addSecondaryEditor(newEditor);
            }
        }

        // Defer old editor disposal — let React unmount the old editor view first
        // (avoids Monaco's internal Delayer "Canceled" rejection)
        if (editorToDispose) {
            const editor = editorToDispose;
            setTimeout(() => { editor.dispose(); }, 0);
        }
    }

    // ── Pinned (reactive) ────────────────────────────────────────────

    get pinned(): boolean {
        return this.state.get().pinned;
    }

    set pinned(value: boolean) {
        this.state.update((s) => { s.pinned = value; });
    }

    // ── Derived properties ───────────────────────────────────────────

    /** Display title — delegates to mainEditor, or "Empty" for empty pages. */
    get title(): string {
        return this._mainEditor?.title ?? "Empty";
    }

    /** Aggregate modified flag: true if mainEditor OR any secondary editor is modified. */
    get modified(): boolean {
        if (this._mainEditor?.modified) return true;
        return this.secondaryEditors.some((m) => m.modified);
    }

    /** Whether this page has an active sidebar. */
    get hasSidebar(): boolean {
        return this.secondaryEditors.length > 0 || this.pageNavigatorModel !== null;
    }

    // ── Close ────────────────────────────────────────────────────────

    /** Close this page (tab). Checks for unsaved changes in main + secondary editors. */
    async close(): Promise<boolean> {
        if (this._mainEditor) {
            // Check secondary editors first
            const secondaryReleased = await this.confirmSecondaryRelease();
            if (!secondaryReleased) return false;
            // Then check main editor (may prompt save dialog)
            const released = await this._mainEditor.confirmRelease();
            if (!released) return false;
        }
        this.onClose?.();
        return true;
    }

    /** Set the active panel. Notifies the owning secondary editor via onPanelExpanded(). */
    setActivePanel(panel: string): void {
        this.activePanel = panel;
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
        // Notify the secondary editor that owns this panel
        const owner = this.secondaryEditors.find((m) => m.secondaryEditor?.includes(panel));
        if (owner) {
            owner.onPanelExpanded(panel);
        }
        // Broadcast global event for components that subscribe (e.g., LinkEditor)
        panelExpanded.send({ pageId: this.id, panelId: panel });
    }

    /** Expand a secondary panel by its panel ID. Called by secondary editors directly. */
    expandPanel(panelId: string): void {
        if (!panelId) return;
        if (!this.secondaryEditors.some((m) => m.secondaryEditor?.includes(panelId))) return;
        this.setActivePanel(panelId);
    }

    // ── Explorer helpers ─────────────────────────────────────────────

    /** Find the ExplorerEditorModel in secondaryEditors, if any. */
    findExplorer(): EditorModel | undefined {
        return this.secondaryEditors.find(
            (m) => m.state.get().type === "fileExplorer"
        );
    }

    /** Create and add an ExplorerEditorModel with the given rootPath. */
    async createExplorer(rootPath: string): Promise<EditorModel> {
        const { ExplorerEditorModel } = await import("../../editors/explorer");
        const explorer = new ExplorerEditorModel(rootPath);
        this.addSecondaryEditor(explorer);
        return explorer;
    }

    // ── PageNavigatorModel ───────────────────────────────────────────

    /** Lazy-create PageNavigatorModel on first access. */
    ensurePageNavigatorModel(): PageNavigatorModel {
        if (!this.pageNavigatorModel) {
            this.pageNavigatorModel = new PageNavigatorModel(this.id);
            // Subscribe to model state changes for auto-save
            this._unsubscribe = this.pageNavigatorModel.state.subscribe(() => {
                if (!this._skipSave) {
                    this._saveStateDebounced();
                }
            });
            // Update reactive state so UI knows sidebar exists
            this.state.update((s) => { s.hasSidebar = true; });
        }
        return this.pageNavigatorModel;
    }

    // ── Navigator toggle ─────────────────────────────────────────────

    /**
     * Toggle the PageNavigator panel. Creates ExplorerEditorModel if needed.
     */
    async toggleNavigator(pipe?: IContentPipe | null, filePath?: string): Promise<void> {
        const existing = this.findExplorer();
        if (existing || this.pageNavigatorModel) {
            // Explorer or sidebar exists — just toggle visibility
            this.ensurePageNavigatorModel().toggle();
            return;
        }

        // Derive root path
        let rootPath = "";
        if (pipe?.provider.type === "file" && pipe.provider.sourceUrl) {
            rootPath = fpDirname(pipe.provider.sourceUrl);
        } else if (filePath) {
            rootPath = fpDirname(filePath);
        }
        if (!rootPath) return;

        // Create Explorer + ensure sidebar is visible
        await this.createExplorer(rootPath);
        this.ensurePageNavigatorModel();
    }

    /** Whether the navigator can be opened. */
    canOpenNavigator(pipe?: IContentPipe | null, filePath?: string): boolean {
        if (this.findExplorer()) return true;
        if (this.pageNavigatorModel) return true;
        if (pipe?.provider.type === "file") return true;
        if (filePath) return true;
        return false;
    }

    // ── Secondary editor lifecycle ───────────────────────────────────

    /** Add an editor model as a secondary editor in the sidebar. */
    addSecondaryEditor(model: EditorModel): void {
        if (this.secondaryEditors.includes(model)) return;
        this.secondaryEditors.push(model);
        model.setPage(this);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._notifyMainEditorOfSecondaryChange();
        this._saveStateDebounced();
    }

    /** Remove and dispose a secondary editor (panel closed by user). */
    removeSecondaryEditor(model: EditorModel): void {
        const idx = this.secondaryEditors.indexOf(model);
        if (idx < 0) return;
        this.secondaryEditors.splice(idx, 1);
        if (model.secondaryEditor?.includes(this.activePanel) || this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        model.setPage(null);
        model.dispose();
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._notifyMainEditorOfSecondaryChange();
        this._saveStateDebounced();
    }

    /** Remove a secondary editor WITHOUT disposing (model cleared its secondaryEditor). */
    removeSecondaryEditorWithoutDispose(model: EditorModel): void {
        const idx = this.secondaryEditors.indexOf(model);
        if (idx < 0) return;
        this.secondaryEditors.splice(idx, 1);
        if (model.secondaryEditor?.includes(this.activePanel) || this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        // Don't clear page if this model is also the mainEditor (Pattern B)
        if (this._mainEditor !== model) {
            model.setPage(null);
        }
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._notifyMainEditorOfSecondaryChange();
        this._saveStateDebounced();
    }

    /**
     * Toggle a secondary editor as the page's main editor.
     * - If the model is a secondary but NOT the current mainEditor → promote it (old mainEditor
     *   goes through normal navigation-away lifecycle and may be disposed).
     * - If the model IS the current mainEditor → demote it (mainEditor becomes null, model
     *   stays as secondary editor in the sidebar).
     *
     * Saves/restores the model's secondary panel list across the toggle so that panels
     * added by the main editor component (e.g., Tags, Hostnames) are removed on demote.
     */
    async promoteSecondaryToMain(model: EditorModel): Promise<void> {
        if (this._mainEditor === model) {
            // Demote: clear main editor, keep model as secondary.
            // Restore panels to the pre-promote snapshot (removes main-editor-only panels).
            const savedPanels = (model as any)._prePromotePanels as string[] | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
            delete (model as any)._prePromotePanels; // eslint-disable-line @typescript-eslint/no-explicit-any

            this._mainEditor = null;
            this.state.update((s) => { s.mainEditorId = null; });
            this.notifyMainEditorChanged();

            // Restore after React unmount cleanup (which may try to clear panels)
            queueMicrotask(() => {
                if (model.page !== this) return;
                if (savedPanels?.length) {
                    // Was promoted from secondary — restore the pre-promote panel list.
                    model.secondaryEditor = savedPanels;
                } else {
                    // Was originally the main editor (Pattern B) — reduce to
                    // base panel only (strip main-editor-only panels like Tags/Hostnames).
                    const current = model.secondaryEditor;
                    if (current && current.length > 1) {
                        model.secondaryEditor = [current[0]];
                    }
                }
                // Model is already in secondaryEditors[] — bump version
                // so PageNavigator re-renders with the reduced panel list.
                this.secondaryEditorsVersion.update((s) => { s.version++; });
            });
        } else if (this.secondaryEditors.includes(model)) {
            // Save current panels before promote — the main editor component may add more
            (model as any)._prePromotePanels = model.secondaryEditor ? [...model.secondaryEditor] : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
            // Promote: make secondary the main editor
            await this.setMainEditor(model);
        } else {
            return; // not a secondary editor on this page
        }
        // Re-subscribe persistence tracking to the (possibly null) main editor
        const { pagesModel } = await import("../pages");
        pagesModel.resubscribeEditor(this);
    }

    /** Notify mainEditor if it implements onSecondaryEditorsChanged (e.g., CategoryEditor). */
    private _notifyMainEditorOfSecondaryChange(): void {
        const me = this._mainEditor;
        if (me && "onSecondaryEditorsChanged" in me) {
            (me as any).onSecondaryEditorsChanged(); // eslint-disable-line @typescript-eslint/no-explicit-any
        }
    }

    /** Find a secondary editor by its editor ID. */
    findSecondaryEditor(editorId: string): EditorModel | undefined {
        return this.secondaryEditors.find((m) => m.id === editorId);
    }

    /** Check secondary editors for unsaved changes. Returns false if user cancels. */
    async confirmSecondaryRelease(): Promise<boolean> {
        for (const model of this.secondaryEditors) {
            if (!model.modified) continue;
            const released = await model.confirmRelease();
            if (!released) return false;
        }
        return true;
    }

    /**
     * Notify secondary editors that the main editor changed (after navigation).
     * Calls onMainEditorChanged() on each secondary editor.
     * Secondary editors may clear their secondaryEditor to opt out of survival.
     */
    notifyMainEditorChanged(): void {
        // Notify secondary editors — they may clear their secondaryEditor
        for (const m of [...this.secondaryEditors]) {
            m.onMainEditorChanged(this.mainEditor);
        }
        // Clean up models that cleared their secondaryEditor during notification
        const removed = this.secondaryEditors.filter((m) => !m.secondaryEditor?.length);
        if (removed.length > 0) {
            for (const m of removed) {
                const idx = this.secondaryEditors.indexOf(m);
                if (idx >= 0) this.secondaryEditors.splice(idx, 1);
                if (m.secondaryEditor?.includes(this.activePanel) || this.activePanel === m.id) {
                    this.activePanel = "explorer";
                }
                m.dispose();
            }
            this.secondaryEditorsVersion.update((s) => { s.version++; });
        }
    }

    /**
     * Restore secondary editor models from pending descriptors.
     * @param ownerEditor — the main editor, if any. If a descriptor has the same ID,
     *   reuse it (deduplication for self-referencing archives). Pass null for pages
     *   with no mainEditor (Pattern A standalone secondary editors).
     */
    async restoreSecondaryEditors(ownerEditor: EditorModel | null): Promise<void> {
        const descriptors = this.pendingSecondaryDescriptors;
        if (!descriptors?.length) {
            this._pendingActivePanel = undefined;
            return;
        }
        this.pendingSecondaryDescriptors = undefined;

        const { pagesModel } = await import("../pages");

        for (const desc of descriptors) {
            // Deduplicate: if this descriptor matches the owner editor, reuse it
            if (ownerEditor && desc.pageState.id === ownerEditor.id) {
                this.secondaryEditors.push(ownerEditor);
                ownerEditor.setPage(this);
                continue;
            }

            try {
                const model = await pagesModel.lifecycle.newEditorModelFromState(desc.pageState);
                model.applyRestoreData(desc.pageState as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                await model.restore();
                this.secondaryEditors.push(model);
                model.setPage(this);
            } catch (err) {
                console.warn("[PageModel] Failed to restore secondary editor:", err);
            }
        }

        // Re-check the deferred activePanel now that models are restored
        if (this._pendingActivePanel) {
            const panelExists = this.secondaryEditors.some(
                (m) => m.secondaryEditor?.includes(this._pendingActivePanel!)
            );
            if (panelExists) {
                this.activePanel = this._pendingActivePanel;
            }
            this._pendingActivePanel = undefined;
        }

        this.secondaryEditorsVersion.update((s) => { s.version++; });
    }

    // ── Persistence ──────────────────────────────────────────────────

    /** Restore sidebar state from cache (on app restart or page creation). */
    async restoreSidebar(): Promise<void> {
        const data = await fs.getCacheFile(this.id, this._cacheName);
        const saved = parseObject(data) as PageSidebarSavedState | undefined;
        if (!saved) return;

        // Restore sidebar layout
        this._skipSave = true;
        const navModel = this.ensurePageNavigatorModel();
        navModel.setStateQuiet({
            open: saved.open ?? true,
            width: saved.width ?? 240,
        });
        this._skipSave = false;

        // Migrate old format: rootPath at top level → create ExplorerEditorModel descriptor
        const oldRootPath = (saved as any).rootPath as string | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (oldRootPath && !saved.secondaryModelDescriptors?.some(
            (d) => d.pageState.type === "fileExplorer"
        )) {
            const explorerDesc: SecondaryModelDescriptor = {
                pageState: {
                    id: crypto.randomUUID(),
                    type: "fileExplorer",
                    title: "Explorer",
                    modified: false,
                    rootPath: oldRootPath,
                } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            };
            saved.secondaryModelDescriptors = [
                explorerDesc,
                ...(saved.secondaryModelDescriptors ?? []),
            ];
        }

        // Restore secondary editor model descriptors (actual creation deferred)
        if (saved.secondaryModelDescriptors?.length) {
            this.pendingSecondaryDescriptors = saved.secondaryModelDescriptors;
        }

        // Restore activePanel — defer non-builtin panels until models are restored
        const restoredPanel = saved.activePanel ?? "explorer";
        if (restoredPanel === "explorer" || restoredPanel === "search") {
            this.activePanel = restoredPanel;
        } else {
            this.activePanel = "explorer";
            this._pendingActivePanel = restoredPanel;
        }
    }

    /** Save sidebar state to cache. */
    private _saveState = async (): Promise<void> => {
        for (const model of this.secondaryEditors) {
            await model.saveState?.();
        }
        const navState = this.pageNavigatorModel?.state.get();
        const saved: PageSidebarSavedState = {
            open: navState?.open ?? true,
            width: navState?.width ?? 240,
            activePanel: this.activePanel,
            secondaryModelDescriptors: this.secondaryEditors.length > 0
                ? this.secondaryEditors.map((m) => ({ pageState: m.getRestoreData() }))
                : undefined,
        };
        await fs.saveCacheFile(this.id, JSON.stringify(saved), this._cacheName);
    };

    private _saveStateDebounced = debounce(this._saveState, 300);

    /** Flush pending saves immediately. */
    async flushSave(): Promise<void> {
        await this._saveState();
    }

    /** Save all state (sidebar + editor caches). Called before app quit. */
    async saveState(): Promise<void> {
        await this._saveState();
        await this.mainEditor?.saveState();
    }

    // ── Cleanup ──────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        this._unsubscribe?.();
        this._unsubscribe = undefined;
        // Dispose all secondary editors (includes ExplorerEditorModel)
        for (const model of this.secondaryEditors) {
            model.setPage(null);
            model.dispose();
        }
        this.secondaryEditors = [];
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
        // Dispose main editor
        if (this.mainEditor) {
            this.mainEditor.setPage(null);
            await this.mainEditor.dispose();
            this.mainEditor = null;
        }
        // Delete page-level cache files (nav-panel, etc.)
        await fs.deleteCacheFiles(this.id);
    }
}
