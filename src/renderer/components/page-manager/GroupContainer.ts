import { SplitterView, type SplitterProps } from "../../uikit/Splitter/SplitterView";
import { SplitLayout } from "./SplitLayout";

/**
 * Imperative container that visually groups two page placeholders into a
 * side-by-side split view with a resizable splitter.
 *
 * IMPORTANT: Placeholders are NOT reparented (moved via appendChild) because
 * that would cause iframes/webviews to reload. Instead, the group container
 * is a visual wrapper that uses CSS absolute positioning to lay out the
 * placeholders within the main container. The placeholders remain as direct
 * children of the main container at all times.
 *
 * Visual structure (all elements are siblings in the main container):
 *   placeholder-left  — positioned via CSS (left: 0, width: N px)
 *   placeholder-right — positioned via CSS (left: N+8 px, right: 0)
 *   splitter          — positioned via CSS (left: N px, width: 8px)
 */
export class GroupContainer {
    readonly splitter: SplitterView;
    private readonly layout: SplitLayout;
    private disposed = false;
    private _compareMode = false;

    constructor(
        private container: HTMLDivElement,
        private leftPlaceholder: HTMLDivElement,
        readonly rightPlaceholder: HTMLDivElement,
    ) {
        // Style placeholders for grouped mode.
        this.setGroupedStyle(leftPlaceholder, "left");
        this.setGroupedStyle(rightPlaceholder, "right");

        let layout: SplitLayout | undefined;
        const onChange = (value: number): void => layout?.handleChange(value);
        const onDoubleClick = (): void => layout?.reset();
        const splitterProps: SplitterProps & { onDoubleClick: () => void } = {
            name: "page-group-splitter",
            orientation: "vertical",
            side: "before",
            background: "dark",
            hoverBackground: "light",
            border: "none",
            value: 0,
            onChange,
            onDoubleClick,
        };

        // Create splitter with callbacks that target the layout after initialization.
        this.splitter = new SplitterView(splitterProps);
        try {
            this.layout = new SplitLayout(
                container,
                leftPlaceholder,
                rightPlaceholder,
                this.splitter,
                splitterProps,
            );
            layout = this.layout;
            // Insert the handle as the same last sibling, after initial layout is applied.
            container.appendChild(this.splitter.root);
            this.splitter.mount();
        } catch (error) {
            try {
                this.layout?.dispose();
            } finally {
                try {
                    this.splitter.dispose();
                } finally {
                    this.splitter.root.remove();
                }
            }
            this.setSingleStyle(leftPlaceholder);
            this.setSingleStyle(rightPlaceholder);
            throw error;
        }

        // Both placeholders are visible inside the group.
        leftPlaceholder.style.display = "flex";
        rightPlaceholder.style.display = "flex";
    }

    get compareMode() { return this._compareMode; }

    /** Enter compare mode — pause splitter layout */
    setCompareMode(enabled: boolean) {
        this._compareMode = enabled;
        this.layout.paused = enabled;
        if (!enabled) {
            // Exiting compare mode — restore grouped layout
            this.setGroupedStyle(this.leftPlaceholder, "left");
            this.setGroupedStyle(this.rightPlaceholder, "right");
            this.layout.reapplyLayout();
            this.leftPlaceholder.style.display = "flex";
            this.rightPlaceholder.style.display = "flex";
        }
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;

        // Preserve teardown order: layout observer, view listeners/capture, then handle root.
        this.layout.dispose();
        this.splitter.dispose();
        this.splitter.root.remove();

        // Restore placeholders to standalone style (no reparenting needed)
        this.setSingleStyle(this.leftPlaceholder);
        this.setSingleStyle(this.rightPlaceholder);
    }

    private setGroupedStyle(el: HTMLDivElement, side: "left" | "right") {
        Object.assign(el.style, {
            position: "absolute",
            inset: "",
            top: "0",
            bottom: "0",
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
        });
        if (side === "right") {
            el.style.right = "0";
        }
    }

    private setSingleStyle(el: HTMLDivElement) {
        // Clear individual positioning set by the splitter first,
        // then apply inset shorthand so it takes full effect
        Object.assign(el.style, {
            top: "",
            bottom: "",
            left: "",
            right: "",
            width: "",
            flex: "",
            flexShrink: "",
            minWidth: "",
            maxWidth: "",
        });
        Object.assign(el.style, {
            position: "absolute",
            inset: "0",
            display: "none",
            flexDirection: "row",
            overflow: "hidden",
        });
    }
}
