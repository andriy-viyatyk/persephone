import React, { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
    Placement,
    useFloating,
    offset as floatingOffset,
    flip,
    shift,
    autoUpdate,
} from "@floating-ui/react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, radius, spacing } from "../tokens";

// --- Types ---

export interface TooltipProps {
    /**
     * Tooltip body. Plain strings render as text; ReactNode lets the consumer compose richer
     * content. When `null`, `undefined`, or `false`, the tooltip is suppressed and the trigger
     * renders unwrapped.
     */
    content: React.ReactNode;
    /**
     * Single React element whose ref forwards to a DOM node. UIKit components and standard HTML
     * elements all qualify.
     */
    children: React.ReactElement<any>;
    /** Floating-ui placement. Default: "top". */
    placement?: Placement;
    /** [skidding, distance] — skidding shifts perpendicular to the main axis. Default: [0, 8]. */
    offset?: [number, number];
    /** Milliseconds to wait after pointer enter before opening. Default: 600. */
    delayShow?: number;
    /** Milliseconds to wait after pointer leave before closing. Default: 100. */
    delayHide?: number;
    /** When true, the tooltip is fully suppressed regardless of `content`. */
    disabled?: boolean;
}

// --- Styled ---

const Root = styled.div(
    {
        backgroundColor: color.background.default,
        color: color.text.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: radius.md,
        boxShadow: `0 2px 8px ${color.shadow.default}`,
        fontSize: fontSize.sm,
        padding: spacing.md,
        maxWidth: 360,
        pointerEvents: "auto",
        userSelect: "text",
        WebkitAppRegion: "no-drag",
    },
    { label: "Tooltip" },
);

// --- Component ---

export function Tooltip({
    content,
    children,
    placement = "top",
    offset = [0, 8],
    delayShow = 600,
    delayHide = 100,
    disabled,
}: TooltipProps) {
    const [open, setOpen] = useState(false);
    const showTimerRef = useRef<number | null>(null);
    const hideTimerRef = useRef<number | null>(null);

    const middleware = useMemo(
        () => [
            floatingOffset({ mainAxis: offset[1], crossAxis: offset[0] }),
            flip(),
            shift({ padding: 4 }),
        ],
        [offset],
    );

    const { refs, floatingStyles, placement: actualPlacement } = useFloating({
        open,
        onOpenChange: setOpen,
        placement,
        middleware,
        strategy: "fixed",
        whileElementsMounted: autoUpdate,
    });

    const clearTimers = useCallback(() => {
        if (showTimerRef.current !== null) {
            window.clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
        }
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    useEffect(() => clearTimers, [clearTimers]);

    const scheduleShow = useCallback(() => {
        clearTimers();
        showTimerRef.current = window.setTimeout(() => {
            showTimerRef.current = null;
            setOpen(true);
        }, delayShow);
    }, [clearTimers, delayShow]);

    const scheduleHide = useCallback(() => {
        clearTimers();
        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            setOpen(false);
        }, delayHide);
    }, [clearTimers, delayHide]);

    const suppressed = disabled || content === null || content === undefined || content === false;

    const childRef = (children as any).ref as React.Ref<unknown> | undefined;
    const mergedRef = useCallback(
        (node: Element | null) => {
            refs.setReference(node);
            if (typeof childRef === "function") childRef(node);
            else if (childRef && typeof childRef === "object")
                (childRef as React.MutableRefObject<Element | null>).current = node;
        },
        [refs, childRef],
    );

    const childProps = children.props as Record<string, any>;
    const trigger = cloneElement(children, {
        ref: mergedRef,
        onMouseEnter: (e: React.MouseEvent) => {
            childProps.onMouseEnter?.(e);
            if (!suppressed) scheduleShow();
        },
        onMouseLeave: (e: React.MouseEvent) => {
            childProps.onMouseLeave?.(e);
            if (!suppressed) scheduleHide();
        },
        onFocus: (e: React.FocusEvent) => {
            childProps.onFocus?.(e);
            if (!suppressed) scheduleShow();
        },
        onBlur: (e: React.FocusEvent) => {
            childProps.onBlur?.(e);
            if (!suppressed) scheduleHide();
        },
        onKeyDown: (e: React.KeyboardEvent) => {
            childProps.onKeyDown?.(e);
            if (e.key === "Escape" && open) {
                clearTimers();
                setOpen(false);
            }
        },
    });

    if (suppressed || !open) return trigger;

    return (
        <>
            {trigger}
            {ReactDOM.createPortal(
                <Root
                    ref={refs.setFloating}
                    data-type="tooltip"
                    data-placement={actualPlacement}
                    role="tooltip"
                    style={{ ...floatingStyles, zIndex: 1100 }}
                    onMouseEnter={clearTimers}
                    onMouseLeave={scheduleHide}
                >
                    {content}
                </Root>,
                document.body,
            )}
        </>
    );
}
