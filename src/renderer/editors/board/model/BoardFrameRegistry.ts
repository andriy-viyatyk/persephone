import { BOARD_CDP_TAB } from "../../../../ipc/api-types";

/** Frames of one board: the live iframe per automation tab, which tabs are CDP-attachable,
 *  the tab automation drives, and waiters for the next load. Owned by BoardEditorModel;
 *  BoardTargetModel is the only external writer of the active tab. */
export class BoardFrameRegistry {
    private readonly frames = new Map<string, HTMLIFrameElement>();
    private readonly loadedTabs = new Set<string>();
    private frameLoadWaiters: Array<{ tab: string; resolve: (ok: boolean) => void }> = [];
    private active = BOARD_CDP_TAB;

    /** `declaredViewIds` reads the model's `state.secondaryViewDefs` lazily. */
    constructor(private readonly declaredViewIds: () => readonly { id: string }[] | undefined) {}

    get activeTabId(): string { return this.active; }

    /** Written only by BoardTargetModel.switchTab. */
    selectTab(tab: string): void { this.active = tab; }

    /** Register `el` for `tab`. Returns true when this replaced a different element or
     *  filled an empty slot with a new one (the tab's loaded flag is dropped). */
    setFrame(tab: string, el: HTMLIFrameElement): boolean {
        const replaced = this.frames.get(tab) !== el;
        if (replaced) this.loadedTabs.delete(tab);
        this.frames.set(tab, el);
        return replaced;
    }

    /** Clear only if `el` is still the live element (a remount may already have set the
     *  new one). Drops the loaded flag and falls back to main when `tab` was active.
     *  Returns true when something was cleared. */
    clearFrame(tab: string, el: HTMLIFrameElement): boolean {
        if (this.frames.get(tab) !== el) return false;
        this.frames.delete(tab);
        this.loadedTabs.delete(tab);
        if (this.active === tab) this.active = BOARD_CDP_TAB;
        return true;
    }

    getFrame(tab: string = this.active): HTMLIFrameElement | undefined {
        return this.frames.get(tab);
    }

    hasFrame(tab: string): boolean {
        return this.frames.has(tab);
    }

    isCurrentFrame(tab: string, el: HTMLIFrameElement): boolean {
        return this.frames.get(tab) === el;
    }

    isLoaded(tab: string): boolean {
        return this.loadedTabs.has(tab);
    }

    isFrameReady(tab: string): boolean {
        return this.hasFrame(tab) && this.isLoaded(tab);
    }

    markLoaded(tab: string): void {
        this.loadedTabs.add(tab);
        this.frameLoadWaiters = this.frameLoadWaiters.filter((w) => {
            if (w.tab !== tab) return true;
            w.resolve(true);
            return false;
        });
    }

    waitForFrameLoad(tab: string = BOARD_CDP_TAB, timeoutMs = 5000): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const waiter = { tab, resolve };
            this.frameLoadWaiters.push(waiter);
            setTimeout(() => {
                const i = this.frameLoadWaiters.indexOf(waiter);
                if (i >= 0) {
                    this.frameLoadWaiters.splice(i, 1);
                    resolve(false);
                }
            }, timeoutMs);
        });
    }

    hasSecondaryView(viewId: string): boolean {
        return (this.declaredViewIds() ?? []).some((d) => d.id === viewId);
    }

    dispose(): void {
        this.frames.clear();
        this.loadedTabs.clear();
        for (const w of this.frameLoadWaiters) w.resolve(false);
        this.frameLoadWaiters.length = 0;
    }
}
