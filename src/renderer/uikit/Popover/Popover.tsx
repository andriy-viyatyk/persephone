import React, { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
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
    children?: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        backgroundColor: color.background.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: radius.lg,
        boxShadow: `0 2px 8px ${color.shadow.default}`,
        overflow: "auto",
        WebkitAppRegion: "no-drag",
    },
    { label: "Popover" },
);

// --- Component ---

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

    const middleware = useMemo(() => {
        const m = [
            flip(),
            size({
                apply({
                    availableHeight,
                    elements,
                }: {
                    availableHeight: number;
                    elements: { floating: HTMLElement };
                }) {
                    Object.assign(elements.floating.style, {
                        maxHeight: `${Math.max(100, availableHeight - 20)}px`,
                    });
                },
            }),
        ];
        if (offset) {
            m.unshift(floatingOffset({ mainAxis: offset[1], crossAxis: offset[0] }));
        }
        return m;
    }, [offset]);

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
    const mergedRefs = useMergeRefs([refs.setFloating, ref, internalRef]);

    useEffect(() => {
        refs.setPositionReference(placeRef ?? null);
    }, [placeRef, refs]);

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

    if (!open || !placeRef) return null;

    return ReactDOM.createPortal(
        <Root
            data-type="popover"
            data-placement={actualPlacement}
            onKeyDown={onKeyDown}
            {...rest}
            ref={mergedRefs}
            style={{ ...floatingStyles, zIndex: 1000, ...(maxHeight ? { maxHeight } : {}) }}
        >
            {children}
        </Root>,
        document.body,
    );
});
