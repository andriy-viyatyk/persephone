import type { VanillaViewCtor } from "../../uikit/shared/vanilla-view";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { GroupContainer } from "./GroupContainer";
import { PageSlot, type PageSlotViewProps, type PopoverResizeEdge } from "./PageSlot";
import {
    POPOVER_FULL_HEIGHT_SNAP, POPOVER_MAX_HEIGHT, POPOVER_MAX_WIDTH, type PagePopoverSize,
} from "../../api/pages/PageModel";
import "./AppPageManagerView.css";

/** Gap between the popover and the page area's top/right edges; full height keeps it at the bottom too. */
const POPOVER_INSET = 8;
/** How far past its padding box the popover paints: covers the 1px border and the 4px halo, where the
 *  invisible resize strips extend so they are easy to grab. */
const POPOVER_CLIP_MARGIN = 5;
const popoverMaxHeight = (containerHeight: number) =>
    Math.min(containerHeight * POPOVER_MAX_HEIGHT, containerHeight - 2 * POPOVER_INSET);

export interface AppPageManagerProps {
    /** All page IDs in display order. */
    pageIds: string[];
    /** Active page ID. */
    activeId: string;
    /** Grouped page ID (the partner of the active page, if grouped). */
    groupedActiveId?: string;
    /** Grouping map: left page ID → right page ID. */
    grouping: Map<string, string>;
    /** Set of left page IDs in compare mode. */
    compareModeIds?: Set<string>;
    /** Right-pinned page IDs, which stay hidden except for the open popover. */
    rightPinnedIds: Set<string>;
    /** Right-pinned page currently rendered as a popover. */
    popoverId?: string;
    /** Reads a page's chosen popover size in pixels, or undefined for the default. Read on every
     *  layout rather than passed as a value, so a container resize never redraws a stale size. */
    getPopoverSize: (id: string) => PagePopoverSize | undefined;
    /** Called once when a resize drag ends, with the size the user chose in pixels. */
    onPopoverResize: (id: string, size: PagePopoverSize) => void;
    /** Native constructor for page content. */
    pageView: VanillaViewCtor<PageSlotViewProps>;
    /** Optional CSS class for the container. */
    className?: string;
}

/** Native application-page host with deferred page views and CSS grouping. */
export class AppPageManagerView extends VanillaView<AppPageManagerProps> {
    private readonly slots = new Map<string, PageSlot>();
    private readonly groupContainers = new Map<string, GroupContainer>();
    private readonly hasBeenActive = new Set<string>();
    private resizeObserver: ResizeObserver | undefined;
    private styledPopoverId: string | undefined;
    private resizeSession: PopoverResizeSession | undefined;

    public constructor(props: AppPageManagerProps) {
        super(props, document.createElement("div"));
        // The root is the slots' containing block, so it must span the page area: popover
        // geometry is measured from it (and observed for resizes). Slots stay `inset: 0`, so
        // ordinary pages render exactly as they did against the pages container.
        Object.assign(this.root.style, { position: "absolute", inset: "0" });
    }

    protected onMount(): void {
        this.resizeObserver = new ResizeObserver(() => this.applyPopoverGeometry(this.props));
        this.resizeObserver.observe(this.root);
        this.reconcile(this.props);
    }

    protected onUpdate(props: AppPageManagerProps): void {
        this.reconcile(props);
    }

    protected onDispose(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        this.finishResize(false);
        const groups = Array.from(this.groupContainers.values());
        const slots = Array.from(this.slots.values());
        this.groupContainers.clear();
        this.slots.clear();
        this.hasBeenActive.clear();

        let firstError: unknown;
        let hasError = false;
        const runCleanup = (cleanup: () => void): void => {
            try {
                cleanup();
            } catch (error) {
                if (!hasError) {
                    hasError = true;
                    firstError = error;
                }
            }
        };

        groups.forEach((group) => runCleanup(() => group.dispose()));
        slots.forEach((slot) => runCleanup(() => slot.dispose()));

        if (hasError) {
            throw firstError;
        }
    }

    getSlotElement(id: string): HTMLDivElement | undefined {
        return this.slots.get(id)?.element;
    }

    private reconcile(props: AppPageManagerProps): void {
        const {
            pageIds,
            activeId,
            groupedActiveId,
            grouping,
            compareModeIds,
            rightPinnedIds,
            popoverId,
            pageView,
            className,
        } = props;
        this.root.className = className ?? "";

        if (activeId) this.hasBeenActive.add(activeId);
        if (groupedActiveId) this.hasBeenActive.add(groupedActiveId);
        if (popoverId) this.hasBeenActive.add(popoverId);

        const currentIds = new Set(pageIds);

        for (const [id, slot] of this.slots) {
            if (!currentIds.has(id)) {
                slot.dispose();
                this.slots.delete(id);
                this.hasBeenActive.delete(id);
            }
        }

        const validGrouping = new Map<string, string>();
        for (const [leftId, rightId] of grouping) {
            if (currentIds.has(leftId) && currentIds.has(rightId)) {
                validGrouping.set(leftId, rightId);
            }
        }

        let firstError: unknown;
        let hasError = false;
        const runCleanup = (cleanup: () => void): void => {
            try {
                cleanup();
            } catch (error) {
                if (!hasError) {
                    hasError = true;
                    firstError = error;
                }
            }
        };

        for (const [leftId, group] of Array.from(this.groupContainers)) {
            const rightId = validGrouping.get(leftId);
            const expectedRight = rightId ? this.slots.get(rightId)?.element : undefined;
            if (!expectedRight || group.rightPlaceholder !== expectedRight) {
                this.groupContainers.delete(leftId);
                runCleanup(() => group.dispose());
            }
        }

        for (const leftId of validGrouping.keys()) {
            if (this.groupContainers.has(leftId)) {
                continue;
            }

            const rightId = validGrouping.get(leftId);
            if (!rightId) {
                continue;
            }
            const leftPlaceholder = this.slots.get(leftId)?.element;
            const rightPlaceholder = this.slots.get(rightId)?.element;
            if (!leftPlaceholder || !rightPlaceholder) {
                continue;
            }

            this.groupContainers.set(
                leftId,
                new GroupContainer(this.root as HTMLDivElement, leftPlaceholder, rightPlaceholder),
            );
        }

        for (const id of pageIds) {
            let slot = this.slots.get(id);
            if (!slot) {
                slot = new PageSlot(id, applyAppPageSlotStyle);
                this.slots.set(id, slot);
            }
            slot.attach(this.root);
        }

        for (const id of pageIds) {
            if (!this.hasBeenActive.has(id)) {
                continue;
            }
            this.slots.get(id)?.renderNative(this.root, pageView);
        }

        if (this.styledPopoverId && this.styledPopoverId !== popoverId) {
            const previousSlot = this.slots.get(this.styledPopoverId);
            if (previousSlot) this.clearPopoverSlot(previousSlot);
            this.styledPopoverId = undefined;
        }

        const activeGroupId = findGroupId(activeId, validGrouping);
        for (const [id, slot] of this.slots) {
            if (id === popoverId) {
                this.stylePopoverSlot(slot, props);
                this.styledPopoverId = id;
                continue;
            }
            if (rightPinnedIds.has(id)) {
                slot.element.style.display = "none";
                continue;
            }
            const groupId = findGroupId(id, validGrouping);
            if (groupId === undefined) {
                slot.element.style.display = id === activeId ? "flex" : "none";
                continue;
            }

            const isActiveGroup = groupId === activeGroupId;
            const inCompareMode = compareModeIds?.has(groupId) ?? false;
            if (!isActiveGroup) {
                slot.element.style.display = "none";
            } else if (inCompareMode) {
                if (validGrouping.has(id)) {
                    applyStandaloneStyle(slot.element);
                    slot.element.style.display = "flex";
                } else {
                    slot.element.style.display = "none";
                }
            } else {
                slot.element.style.display = "flex";
            }
        }

        for (const [leftId, group] of this.groupContainers) {
            const isActive = leftId === activeGroupId;
            const inCompareMode = compareModeIds?.has(leftId) ?? false;
            const wasCompareMode = group.compareMode;
            if (wasCompareMode !== inCompareMode) {
                group.setCompareMode(inCompareMode);
                if (wasCompareMode && !inCompareMode) {
                    const rightId = validGrouping.get(leftId);
                    const leftSlot = this.slots.get(leftId);
                    const rightSlot = rightId ? this.slots.get(rightId) : undefined;
                    const display = isActive ? "flex" : "none";
                    if (leftSlot) leftSlot.element.style.display = display;
                    if (rightSlot) rightSlot.element.style.display = display;
                }
            }
            group.splitter.element.style.display = isActive && !inCompareMode ? "" : "none";
        }

        if (hasError) {
            throw firstError;
        }
    }

    private stylePopoverSlot(slot: PageSlot, props: AppPageManagerProps): void {
        slot.element.dataset.popover = "";
        slot.ensurePopoverResizeHandles((event) => this.startResize(event, slot.id));
        this.writePopoverGeometry(slot, props.getPopoverSize(slot.id));
    }

    private clearPopoverSlot(slot: PageSlot): void {
        slot.removePopoverResizeHandles();
        delete slot.element.dataset.popover;
        slot.element.style.height = "";
        slot.element.style.zIndex = "";
        slot.element.style.removeProperty("overflow-clip-margin");
        applyStandaloneStyle(slot.element);
    }

    private applyPopoverGeometry(props: AppPageManagerProps): void {
        const popoverId = props.popoverId;
        if (!popoverId) return;
        const slot = this.slots.get(popoverId);
        if (slot) this.writePopoverGeometry(slot, props.getPopoverSize(popoverId));
    }

    private writePopoverGeometry(slot: PageSlot, size: PagePopoverSize | undefined): void {
        const containerWidth = this.root.clientWidth;
        const containerHeight = this.root.clientHeight;
        if (containerWidth <= 0 || containerHeight <= 0) return;
        const maxWidth = containerWidth * POPOVER_MAX_WIDTH;
        const maxHeight = popoverMaxHeight(containerHeight);
        // A chosen size is fixed in pixels; only the limits shrink it when the window is smaller.
        // Full-height mode always fills the maximum height. Until the user resizes, the default is half the page area.
        const width = clamp(
            size?.width ?? containerWidth * 0.5,
            Math.min(360, maxWidth),
            maxWidth,
        );
        const height = size?.fullHeight ? maxHeight : clamp(
            size?.height ?? containerHeight * 0.5,
            Math.min(240, maxHeight),
            maxHeight,
        );
        Object.assign(slot.element.style, {
            position: "absolute",
            inset: "auto",
            top: `${POPOVER_INSET}px`,
            right: `${POPOVER_INSET}px`,
            bottom: "auto",
            left: "auto",
            width: `${width}px`,
            height: `${height}px`,
            display: "flex",
            zIndex: "10",
            // Clip, not hide, with a margin past the 1px border: the resize grip sits on the border corner.
            overflow: "clip",
        });
        slot.element.style.setProperty("overflow-clip-margin", `${POPOVER_CLIP_MARGIN}px`);
    }

    private startResize(event: PointerEvent, id: string): void {
        if (event.button !== 0) return;
        const slot = this.slots.get(id);
        if (!slot) return;
        const rect = slot.element.getBoundingClientRect();
        const handle = event.currentTarget;
        if (!(handle instanceof HTMLButtonElement)) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        this.resizeSession = {
            id,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
            edge: (handle.dataset.edge ?? "corner") as PopoverResizeEdge,
            handle,
            shield: this.createResizeShield(handle),
        };
        window.addEventListener("pointermove", this.handleResizeMove);
        window.addEventListener("pointerup", this.handleResizeEnd);
        handle.addEventListener("lostpointercapture", this.handleResizeEnd);
    }

    /** Shrinking the popover drags over its own page, and a webview there (a board, a browser page) would
     *  take the pointer events from the drag; a transparent layer over the page area keeps them here. */
    private createResizeShield(handle: HTMLButtonElement): HTMLDivElement {
        const shield = document.createElement("div");
        shield.dataset.type = "popover-resize-shield";
        shield.style.cursor = getComputedStyle(handle).cursor;
        this.root.append(shield);
        return shield;
    }

    private readonly handleResizeMove = (event: PointerEvent): void => {
        const session = this.resizeSession;
        if (!session || event.pointerId !== session.pointerId) return;
        const slot = this.slots.get(session.id);
        if (!slot) return;
        // The left edge changes only the width, the bottom edge only the height, the corner both.
        const width = session.edge === "bottom" ? session.startWidth : session.startWidth - (event.clientX - session.startX);
        const height = session.edge === "left" ? session.startHeight : session.startHeight + (event.clientY - session.startY);
        this.writePopoverDimensions(slot, width, height);
    };

    private readonly handleResizeEnd = (event: PointerEvent): void => {
        if (this.resizeSession && event.pointerId === this.resizeSession.pointerId) {
            this.finishResize(true);
        }
    };

    private finishResize(persist: boolean): void {
        const session = this.resizeSession;
        if (!session) return;
        this.resizeSession = undefined;
        session.shield.remove();
        window.removeEventListener("pointermove", this.handleResizeMove);
        window.removeEventListener("pointerup", this.handleResizeEnd);
        session.handle.removeEventListener("lostpointercapture", this.handleResizeEnd);
        if (session.handle.hasPointerCapture(session.pointerId)) {
            session.handle.releasePointerCapture(session.pointerId);
        }

        const slot = this.slots.get(session.id);
        if (!slot) return;
        if (persist) {
            // The drawn size is already within the limits; keep it in pixels so it ignores later window resizes.
            const rect = slot.element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const fullHeight = rect.height >= popoverMaxHeight(this.root.clientHeight) * POPOVER_FULL_HEIGHT_SNAP;
                this.props.onPopoverResize(session.id, {
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    ...(fullHeight ? { fullHeight: true } : {}),
                });
                // Snap to the exact full height now, not on the next layout.
                if (fullHeight) this.writePopoverGeometry(slot, this.props.getPopoverSize(session.id));
            }
        }
    }

    private writePopoverDimensions(slot: PageSlot, requestedWidth: number, requestedHeight: number): void {
        const maxWidth = this.root.clientWidth * POPOVER_MAX_WIDTH;
        const maxHeight = popoverMaxHeight(this.root.clientHeight);
        const width = clamp(requestedWidth, Math.min(360, maxWidth), maxWidth);
        const height = clamp(requestedHeight, Math.min(240, maxHeight), maxHeight);
        slot.element.style.width = `${width}px`;
        slot.element.style.height = `${height}px`;
    }
}

interface PopoverResizeSession {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    edge: PopoverResizeEdge;
    handle: HTMLButtonElement;
    shield: HTMLDivElement;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function applyStandaloneStyle(element: HTMLDivElement): void {
    Object.assign(element.style, {
        top: "",
        bottom: "",
        left: "",
        right: "",
        width: "",
        minWidth: "",
        maxWidth: "",
        flex: "",
        flexShrink: "",
    });
    Object.assign(element.style, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
    });
}

function applyAppPageSlotStyle(element: HTMLDivElement): void {
    applyStandaloneStyle(element);
    element.style.display = "none";
}

function findGroupId(
    pageId: string,
    grouping: Map<string, string>,
): string | undefined {
    if (grouping.has(pageId)) return pageId;
    for (const [leftId, rightId] of grouping) {
        if (rightId === pageId) return leftId;
    }
    return undefined;
}
