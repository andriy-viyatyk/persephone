import { SplitterView, type SplitterProps } from "../../uikit/Splitter/SplitterView";

/**
 * Positions two sibling page placeholders around a vertical splitter. The
 * placeholders stay under the manager root to avoid reloading iframes/webviews.
 */
export class SplitLayout {
    paused = false;
    private widthK = 0.5;
    private readonly observer: ResizeObserver;
    private disposed = false;

    constructor(
        private readonly container: HTMLDivElement,
        private readonly leftPane: HTMLDivElement,
        private readonly rightPane: HTMLDivElement,
        private readonly splitterView: SplitterView,
        private readonly splitterProps: SplitterProps,
    ) {
        this.observer = new ResizeObserver(this.handleResize);
        try {
            this.observer.observe(container);
            this.applyLayout();
        } catch (error) {
            this.observer.disconnect();
            throw error;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.observer.disconnect();
    }

    /** Re-apply the current layout after compare mode restores grouped styles. */
    reapplyLayout(): void {
        this.applyLayout();
    }

    handleChange(next: number): void {
        const available = this.getAvailableWidth();
        const newWidth = Math.max(100, Math.min(available - 100, next));
        this.widthK = newWidth / available;
        this.applyLayout();
    }

    reset(): void {
        this.widthK = 0.5;
        this.applyLayout();
    }

    private getAvailableWidth(): number {
        return this.container.clientWidth - 8; // 8px for splitter
    }

    private applyLayout(): void {
        const available = this.getAvailableWidth();
        const leftWidth = Math.max(100, Math.min(available - 100, available * this.widthK));

        // Position left pane
        this.leftPane.style.left = "0";
        this.leftPane.style.width = `${leftWidth}px`;

        // Position splitter
        this.splitterView.root.style.left = `${leftWidth}px`;

        // Position right pane
        this.rightPane.style.left = `${leftWidth + 8}px`;
        this.rightPane.style.right = "0";
        this.rightPane.style.width = "";
        this.splitterView.update({ ...this.splitterProps, value: leftWidth });
    }

    private readonly handleResize = (): void => {
        if (!this.paused) this.applyLayout();
    };
}
