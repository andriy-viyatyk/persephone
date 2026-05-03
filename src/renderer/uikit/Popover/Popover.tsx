import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
    Placement,
    useFloating,
    VirtualElement,
    offset as floatingOffset,
    flip,
    useMergeRefs,
    autoUpdate,
    size,
} from "@floating-ui/react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { radius } from "../tokens";
import { ResizeHandleIcon } from "../../theme/icons";

// --- Types ---

/**
 * Positioning subset of `PopoverProps`. Shape-identical to legacy `PopperPosition`
 * (minus `anchorType`). Encapsulated `showSomething()` modules can carry a
 * `PopoverPosition` on their model and spread it directly into `<Popover>`.
 */
export interface PopoverPosition {
    elementRef?: Element | VirtualElement | null;
    x?: number;
    y?: number;
    placement?: Placement;
    /** [skidding, distance] — skidding shifts perpendicular to the main axis. */
    offset?: [number, number];
}

export interface PopoverProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">,
        PopoverPosition {
    /** Whether the popover is rendered. When false, no DOM is mounted. */
    open: boolean;
    /** Called on click-outside or Escape. */
    onClose?: () => void;
    /** Caller-set max-height override. The component also auto-caps to viewport. */
    maxHeight?: number | string;
    /**
     * CSS selector. A click outside the popover that lands on an element matching
     * this selector (or whose ancestor matches) does NOT trigger `onClose`. Used by
     * sibling-rendered families (e.g. submenus sharing a `data-type`) and sticky
     * input dropdowns where clicks on the input itself should keep the popover open.
     */
    outsideClickIgnoreSelector?: string;
    /**
     * Match the floating element's width to the anchor's width. Useful for
     * combobox / autocomplete / suggestions dropdowns. The width updates
     * automatically on `autoUpdate` (resize, scroll). Default: false.
     */
    matchAnchorWidth?: boolean;
    /**
     * When true, a resize handle is rendered at the bottom-right corner. The user
     * can drag it to grow the popover above its initial / anchor-matched size.
     * Once the user has dragged, the popover keeps its new size for the rest of
     * the open session — `matchAnchorWidth` no longer re-applies. On close, the
     * manual size is discarded; opening again starts fresh.
     */
    resizable?: boolean;
    /** Fired during a drag with the live `(width, height)`. Optional. */
    onResize?: (width: number, height: number) => void;
    children?: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        position: "relative",
        backgroundColor: color.background.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: radius.lg,
        boxShadow: `0 2px 8px ${color.shadow.default}`,
        overflow: "auto",
        WebkitAppRegion: "no-drag",
    },
    { label: "Popover" },
);

const ResizeHandle = styled.div(
    {
        position: "absolute",
        right: 2,
        bottom: 2,
        width: 14,
        height: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "nwse-resize",
        color: color.text.light,
        opacity: 0.6,
        userSelect: "none",
        touchAction: "none",
        zIndex: 1,
        "&:hover": { opacity: 1 },
        '&[data-edge="top"]': {
            top: 2,
            bottom: "unset",
            cursor: "nesw-resize",
            transform: "rotate(-90deg)",
        },
        "& > svg": {
            width: 12,
            height: 12,
        },
    },
    { label: "PopoverResizeHandle" },
);

// --- Component ---

interface ManualSize {
    width: number;
    height: number;
}

export const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover(
    {
        open,
        elementRef,
        x,
        y,
        placement = "bottom-start",
        offset,
        onClose,
        onKeyDown,
        maxHeight,
        outsideClickIgnoreSelector,
        matchAnchorWidth,
        resizable,
        onResize,
        children,
        ...rest
    },
    ref,
) {
    const placeRef = useMemo<Element | VirtualElement | undefined>(() => {
        if (elementRef) return elementRef;
        if (x !== undefined && y !== undefined) {
            return {
                getBoundingClientRect: () => ({
                    top: y, left: x, bottom: y, right: x, width: 0, height: 0,
                }),
            } as VirtualElement;
        }
        return undefined;
    }, [elementRef, x, y]);

    const [manualSize, setManualSize] = useState<ManualSize | null>(null);
    const manualSizeRef = useRef<ManualSize | null>(null);
    useEffect(() => {
        manualSizeRef.current = manualSize;
    }, [manualSize]);

    const middleware = useMemo(() => {
        const m = [
            flip(),
            size({
                apply({
                    availableHeight,
                    rects,
                    elements,
                }: {
                    availableHeight: number;
                    rects: { reference: { width: number } };
                    elements: { floating: HTMLElement };
                }) {
                    const styles: Record<string, string> = {
                        maxHeight: `${Math.max(100, availableHeight - 20)}px`,
                    };
                    if (matchAnchorWidth && !manualSizeRef.current) {
                        styles.width = `${rects.reference.width}px`;
                    }
                    Object.assign(elements.floating.style, styles);
                },
            }),
        ];
        if (offset) {
            m.unshift(floatingOffset({ mainAxis: offset[1], crossAxis: offset[0] }));
        }
        return m;
    }, [offset, matchAnchorWidth]);

    const onOpenChange = useCallback((value: boolean) => {
        if (value) onClose?.();
    }, [onClose]);

    const { refs, floatingStyles, placement: actualPlacement } = useFloating({
        open,
        onOpenChange,
        placement,
        middleware,
        strategy: "fixed",
        whileElementsMounted: autoUpdate,
    });

    const internalRef = useRef<HTMLDivElement | null>(null);
    const initialSizeRef = useRef<ManualSize | null>(null);
    const mergedRefs = useMergeRefs([refs.setFloating, ref, internalRef]);

    useEffect(() => {
        refs.setPositionReference(placeRef ?? null);
    }, [placeRef, refs]);

    // Reset manual size when the popover closes.
    useEffect(() => {
        if (!open) {
            setManualSize(null);
            initialSizeRef.current = null;
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (!internalRef.current || internalRef.current.contains(event.target as Node)) return;
            const target = event.target as Element | null;
            if (target?.closest('[data-type="tooltip"]')) return;
            if (outsideClickIgnoreSelector) {
                if (target?.closest(outsideClickIgnoreSelector)) return;
            }
            onClose?.();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose?.();
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, onClose, outsideClickIgnoreSelector]);

    const isTopPlacement = actualPlacement.startsWith("top");

    const onHandlePointerDown = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (event.pointerType === "mouse" && event.buttons !== 1) return;
            const root = internalRef.current;
            if (!root) return;
            event.preventDefault();
            event.stopPropagation();

            const startRect = root.getBoundingClientRect();
            if (!initialSizeRef.current) {
                initialSizeRef.current = { width: startRect.width, height: startRect.height };
            }
            const initial = initialSizeRef.current;
            const startX = event.clientX;
            const startY = event.clientY;
            const isTop = isTopPlacement;

            const onPointerMove = (e: PointerEvent) => {
                if (!internalRef.current) return;
                e.preventDefault();
                const dx = e.clientX - startX;
                const dy = isTop ? -(e.clientY - startY) : e.clientY - startY;
                const w = Math.max(initial.width, startRect.width + dx);
                const h = Math.max(initial.height, startRect.height + dy);
                setManualSize({ width: w, height: h });
                onResize?.(w, h);
            };
            const onLost = () => {
                root.removeEventListener("pointermove", onPointerMove);
                root.removeEventListener("lostpointercapture", onLost);
                root.removeEventListener("pointerup", onLost);
            };

            root.setPointerCapture(event.pointerId);
            root.addEventListener("pointermove", onPointerMove);
            root.addEventListener("lostpointercapture", onLost);
            root.addEventListener("pointerup", onLost);
        },
        [isTopPlacement, onResize],
    );

    if (!open || !placeRef) return null;

    const inlineStyle: React.CSSProperties = {
        ...floatingStyles,
        zIndex: 1000,
        ...(maxHeight ? { maxHeight } : {}),
        ...(manualSize ? { width: manualSize.width, height: manualSize.height } : {}),
    };

    return ReactDOM.createPortal(
        <Root
            data-type="popover"
            data-placement={actualPlacement}
            data-resizable={resizable || undefined}
            data-resized={manualSize ? "" : undefined}
            onKeyDown={onKeyDown}
            {...rest}
            ref={mergedRefs}
            style={inlineStyle}
        >
            {children}
            {resizable && (
                <ResizeHandle
                    data-type="popover-resize-handle"
                    data-edge={isTopPlacement ? "top" : "bottom"}
                    onPointerDown={onHandlePointerDown}
                >
                    <ResizeHandleIcon />
                </ResizeHandle>
            )}
        </Root>,
        document.body,
    );
});
