import { TComponentState } from "../../core/state/state";

const path = require("path") as typeof import("path");

// =============================================================================
// Types
// =============================================================================

export interface PageNavigatorState {
    open: boolean;
    width: number;
    rootPath: string;
}

const DEFAULT_WIDTH = 240;

// =============================================================================
// Model
// =============================================================================

/**
 * PageNavigatorModel — reactive state for the PageNavigator sidebar.
 *
 * Pure state container: open/close, width, rootPath, navigation.
 * Persistence is owned by PageModel (not this model).
 */
export class PageNavigatorModel {
    state: TComponentState<PageNavigatorState>;

    constructor(rootPath: string) {
        this.state = new TComponentState<PageNavigatorState>({
            open: true,
            width: DEFAULT_WIDTH,
            rootPath,
        });
    }

    /** Set state without triggering subscriptions. Used by PageModel.restoreSidebar(). */
    setStateQuiet(s: Partial<PageNavigatorState>): void {
        const current = this.state.get();
        this.state.set({
            open: s.open ?? current.open,
            width: s.width ?? current.width,
            rootPath: s.rootPath ?? current.rootPath,
        });
    }

    dispose = () => {};

    // ── State management ─────────────────────────────────────────────────

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
        this.state.update((s) => {
            s.rootPath = parent;
        });
    };

    makeRoot = (newRoot: string) => {
        const { rootPath } = this.state.get();
        if (newRoot.toLowerCase() === rootPath.toLowerCase()) return;
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
