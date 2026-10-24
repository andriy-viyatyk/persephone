import type { VanillaView, VanillaViewCtor } from "../../uikit/shared/vanilla-view";
import { t } from "../../../shared/i18n/t";

export type PageSlotStyle = (element: HTMLDivElement) => void;
export type PopoverResizeEdge = "corner" | "left" | "bottom";
const POPOVER_RESIZE_EDGES: readonly PopoverResizeEdge[] = ["left", "bottom", "corner"];
export interface PageSlotViewProps { pageId: string; }

/** Owns one stable page placeholder and one retained native page. */
export class PageSlot {
    readonly element: HTMLDivElement;

    private nativeView: VanillaView<PageSlotViewProps> | undefined;
    private resizeHandles: HTMLButtonElement[] = [];
    private disposed = false;

    public constructor(
        readonly id: string,
        applyStyle: PageSlotStyle,
    ) {
        this.element = document.createElement("div");
        this.element.dataset.name = "page-slot";
        this.element.dataset.pageId = id;
        applyStyle(this.element);
    }

    /** Attach a newly-created placeholder without ever reordering a live one. */
    attach(root: HTMLElement): void {
        if (this.disposed || this.element.parentNode) {
            return;
        }

        root.appendChild(this.element);
    }

    /** Attach and mount one native page view, retaining it for the slot lifetime. */
    renderNative(root: HTMLElement, viewConstructor: VanillaViewCtor<PageSlotViewProps>): void {
        if (this.disposed || this.nativeView) {
            return;
        }

        const attachedHere = !this.element.parentNode;
        let view: VanillaView<PageSlotViewProps> | undefined;
        // A construction or mount failure must not leave the slot holding a half-built view:
        // `renderNative` returns early whenever `nativeView` is set, so a retained broken view
        // would never be retried and the page would stay permanently blank. Roll back to the
        // empty state and rethrow, matching AsyncEditorView's mount-failure handling.
        try {
            this.attach(root);
            view = new viewConstructor({ pageId: this.id });
            this.nativeView = view;
            this.element.append(view.root);
            view.mount();
        } catch (error) {
            this.nativeView = undefined;
            try {
                view?.dispose();
            } catch {
                // Preserve the mount failure after attempting cleanup.
            }
            view?.root.remove();
            if (attachedHere) this.element.remove();
            throw error;
        }
    }

    /** Invisible resize strips on the popover's free edges: the bottom-left corner resizes both
     *  dimensions, the left edge only the width, the bottom edge only the height. */
    ensurePopoverResizeHandles(onPointerDown: (event: PointerEvent) => void): void {
        if (!this.resizeHandles.length) {
            for (const edge of POPOVER_RESIZE_EDGES) {
                const handle = document.createElement("button");
                handle.type = "button";
                handle.tabIndex = -1;
                handle.dataset.type = "popover-resize-handle";
                handle.dataset.edge = edge;
                handle.setAttribute("aria-label", t("shell.resizePopover"));
                this.element.append(handle);
                this.resizeHandles.push(handle);
            }
        }

        for (const handle of this.resizeHandles) handle.onpointerdown = onPointerDown;
    }

    removePopoverResizeHandles(): void {
        for (const handle of this.resizeHandles) {
            handle.onpointerdown = null;
            handle.remove();
        }
        this.resizeHandles = [];
    }

    /** Detach immediately, then dispose the nested root after the outer commit. */
    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.removePopoverResizeHandles();
        const nativeView = this.nativeView;
        this.nativeView = undefined;
        this.element.remove();

        // Remove the placeholder before disposing the native view. This is deliberate for
        // foreign-document views: the webview/iframe is detached before its resources are torn
        // down, so disposal cannot leave a live foreign document in the page tree.
        if (nativeView) nativeView.dispose();
    }
}
