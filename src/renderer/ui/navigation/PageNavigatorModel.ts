import { TComponentState } from "../../core/state/state";
import { pageNavigatorToggled } from "../../core/state/events";

// =============================================================================
// Types
// =============================================================================

export interface PageNavigatorState {
    open: boolean;
    width: number;
}

const DEFAULT_WIDTH = 240;

// =============================================================================
// Model
// =============================================================================

/**
 * PageNavigatorModel — reactive state for the PageNavigator sidebar.
 *
 * Pure layout container: open/close, width.
 * Persistence is owned by PageModel (not this model).
 */
export class PageNavigatorModel {
    state: TComponentState<PageNavigatorState>;

    constructor(private readonly pageId: string) {
        this.state = new TComponentState<PageNavigatorState>({
            open: true,
            width: DEFAULT_WIDTH,
        });
    }

    /** Set state without triggering subscriptions. Used by PageModel.restoreSidebar(). */
    setStateQuiet(s: Partial<PageNavigatorState>): void {
        const current = this.state.get();
        this.state.set({
            open: s.open ?? current.open,
            width: s.width ?? current.width,
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
        pageNavigatorToggled.send({ pageId: this.pageId, isOpen: this.state.get().open });
    };

    close = () => {
        this.state.update((s) => {
            s.open = false;
        });
        pageNavigatorToggled.send({ pageId: this.pageId, isOpen: false });
    };
}
