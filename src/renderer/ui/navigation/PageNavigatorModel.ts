import { TComponentState } from "../../core/state/state";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import { fs } from "../../api/fs";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";

const path = require("path") as typeof import("path");

// =============================================================================
// Types
// =============================================================================

export interface PageNavigatorState {
    open: boolean;
    width: number;
    rootPath: string;
}

/** Subset persisted to disk. */
interface PageNavigatorSavedState {
    open: boolean;
    width: number;
    rootPath: string;
    treeState?: TreeProviderViewSavedState;
    // Backward compat: old NavPanelModel format
    rootFilePath?: string;
    fileExplorerState?: { expandedPaths?: string[] };
}

const DEFAULT_WIDTH = 240;

// =============================================================================
// Model
// =============================================================================

export class PageNavigatorModel {
    state: TComponentState<PageNavigatorState>;
    id: string | undefined = undefined;
    treeState: TreeProviderViewSavedState | undefined = undefined;

    private name = "nav-panel";
    private unsubscribe: (() => void) | undefined = undefined;
    private skipSave = false;

    constructor(rootPath: string) {
        this.state = new TComponentState<PageNavigatorState>({
            open: true,
            width: DEFAULT_WIDTH,
            rootPath,
        });
        this.unsubscribe = this.state.subscribe(this.saveStateDebounced);
    }

    // ── Persistence ──────────────────────────────────────────────────────

    restore = async (id: string) => {
        this.id = id;
        const data = await fs.getCacheFile(id, this.name);
        const saved = parseObject(data) as PageNavigatorSavedState | undefined;
        if (saved) {
            this.skipSave = true;

            // Backward compat: migrate old NavPanelModel format
            const rootPath = saved.rootPath || saved.rootFilePath || "";
            const treeState = saved.treeState || (saved.fileExplorerState?.expandedPaths
                ? { expandedPaths: saved.fileExplorerState.expandedPaths }
                : undefined);

            this.treeState = treeState;
            this.state.set({
                open: saved.open ?? true,
                width: saved.width ?? DEFAULT_WIDTH,
                rootPath,
            });
        }
    };

    private saveState = async (): Promise<void> => {
        if (this.skipSave) {
            this.skipSave = false;
            return;
        }
        if (!this.id) return;

        const { open, width, rootPath } = this.state.get();
        const saved: PageNavigatorSavedState = {
            open,
            width,
            rootPath,
            treeState: this.treeState,
        };
        await fs.saveCacheFile(this.id, JSON.stringify(saved), this.name);
    };

    private saveStateDebounced = debounce(this.saveState, 300);

    flushSave = async () => {
        await this.saveState();
    };

    updateId = (newId: string) => {
        this.id = newId;
        this.saveStateDebounced();
    };

    dispose = () => {
        this.unsubscribe?.();
    };

    // ── State management ─────────────────────────────────────────────────

    setTreeState = (state: TreeProviderViewSavedState) => {
        this.treeState = state;
        this.saveStateDebounced();
    };

    setWidth = (width: number) => {
        this.state.update((s) => {
            s.width = Math.max(120, width);
        });
    };

    toggle = () => {
        this.state.update((s) => {
            s.open = !s.open;
        });
    };

    close = () => {
        this.state.update((s) => {
            s.open = false;
        });
    };

    // ── Root navigation ──────────────────────────────────────────────────

    navigateUp = () => {
        const { rootPath } = this.state.get();
        const parent = path.dirname(rootPath);
        if (parent === rootPath) return; // already at root
        this.treeState = undefined; // clear expand state for new root
        this.state.update((s) => {
            s.rootPath = parent;
        });
    };

    makeRoot = (newRoot: string) => {
        const { rootPath } = this.state.get();
        if (newRoot.toLowerCase() === rootPath.toLowerCase()) return;
        this.treeState = undefined;
        this.state.update((s) => {
            s.rootPath = newRoot;
        });
    };

    /** Reinitialize rootPath if empty (e.g. after cache was cleared). */
    reinitIfEmpty = (rootPath: string) => {
        if (!this.state.get().rootPath) {
            this.state.update((s) => {
                s.rootPath = rootPath;
            });
        }
    };
}
