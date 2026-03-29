import type { ITreeProvider } from "../../api/types/io.tree";
import type { IContentPipe } from "../../api/types/io.pipe";
import { TOneState } from "../../core/state/state";
import { fpDirname } from "../../core/utils/file-path";
import { NavPanelModel } from "./nav-panel-store";

export interface NavigationState {
    /** Currently selected item href (shared between PageNavigator and CategoryEditor). */
    selectedHref: string | null;
}

/**
 * NavigationData — stable browsing context that survives page navigation.
 *
 * Created once when a page first opens with a navigator. Transferred
 * between page models during navigatePageTo (not recreated).
 *
 * Owns the shared ITreeProvider instance and the PageNavigator model.
 * Both PageNavigator (sidebar) and CategoryEditor (content area) access
 * the same treeProvider through this object.
 */
export class NavigationData {
    /** Stable ID for React key — survives navigation. Keeps PageNavigator mounted. */
    readonly renderId: string;
    /** Shared tree provider. Accessed by PageNavigator and CategoryEditor. */
    treeProvider: ITreeProvider | null = null;
    /**
     * Sidebar model. Uses NavPanelModel for backward compatibility with
     * existing cache format. Lazy-created on first "open navigator" action.
     */
    pageNavigatorModel: NavPanelModel | null = null;
    /** Shared selection state — reactive, subscribed by PageNavigator and CategoryEditor. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });

    private _rootPath: string;

    constructor(rootPath: string) {
        this.renderId = crypto.randomUUID();
        this._rootPath = rootPath;
    }

    /** Update the selected item href. Both PageNavigator and CategoryEditor call this. */
    setSelectedHref(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
        // Sync to NavPanelModel for persistence
        this.pageNavigatorModel?.setSelectedHref(href);
    }

    /** Root path used for lazy PageNavigatorModel creation. */
    get rootPath(): string {
        return this.pageNavigatorModel?.state.get().rootFilePath || this._rootPath;
    }

    /** Lazy-create PageNavigatorModel on first access. */
    ensurePageNavigatorModel(): NavPanelModel {
        if (!this.pageNavigatorModel) {
            this.pageNavigatorModel = new NavPanelModel(this._rootPath);
        }
        return this.pageNavigatorModel;
    }

    /**
     * Toggle the PageNavigator panel. If no treeProvider exists yet,
     * attempts to create a FileTreeProvider from the pipe's file provider.
     * @param pipe — content pipe of the current page (used to derive root path if needed)
     * @param filePath — current file path (used for reinitIfEmpty and root path fallback)
     */
    toggleNavigator(pipe?: IContentPipe | null, filePath?: string): void {
        // If we have a tree provider or the panel is already open, just toggle
        if (this.treeProvider || this.pageNavigatorModel) {
            if (filePath) {
                this.pageNavigatorModel?.reinitIfEmpty(fpDirname(filePath), filePath);
            }
            this.ensurePageNavigatorModel().toggle();
            return;
        }

        // Try to derive root path from pipe's file provider
        let rootPath = this._rootPath;
        if (pipe?.provider.type === "file" && pipe.provider.sourceUrl) {
            rootPath = fpDirname(pipe.provider.sourceUrl);
        } else if (filePath) {
            rootPath = fpDirname(filePath);
        }

        if (!rootPath) return; // Can't determine a root — do nothing

        this._rootPath = rootPath;
        this.ensurePageNavigatorModel().toggle();
    }

    /** Whether the navigator can be opened (has tree provider or file-based pipe). */
    canOpenNavigator(pipe?: IContentPipe | null, filePath?: string): boolean {
        if (this.treeProvider) return true;
        if (this.pageNavigatorModel) return true;
        if (pipe?.provider.type === "file") return true;
        if (filePath) return true;
        return false;
    }

    /** Restore from cache (on app restart). */
    async restore(pageId: string): Promise<void> {
        const model = this.ensurePageNavigatorModel();
        model.id = pageId;
        await model.restore(pageId);
        // Sync rootPath from restored model
        this._rootPath = model.state.get().rootFilePath;
        // Sync selectedHref from restored model
        if (model.selectedHref) {
            this.setSelectedHref(model.selectedHref);
        }
    }

    /** Update page ID after navigation transfer. */
    updateId(newPageId: string): void {
        this.pageNavigatorModel?.updateId(newPageId);
    }

    /** Flush pending saves. */
    async flushSave(): Promise<void> {
        await this.pageNavigatorModel?.flushSave();
    }

    dispose(): void {
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
    }
}
