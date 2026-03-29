import type { ITreeProvider } from "../../api/types/io.tree";
import { NavPanelModel } from "./nav-panel-store";

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

    private _rootPath: string;

    constructor(rootPath: string) {
        this.renderId = crypto.randomUUID();
        this._rootPath = rootPath;
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

    /** Restore from cache (on app restart). */
    async restore(pageId: string): Promise<void> {
        const model = this.ensurePageNavigatorModel();
        model.id = pageId;
        await model.restore(pageId);
        // Sync rootPath from restored model
        this._rootPath = model.state.get().rootFilePath;
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
