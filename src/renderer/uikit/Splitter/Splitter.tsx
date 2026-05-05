import React, { useRef, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";

// --- Types ---

export interface SplitterProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /** Bar direction. "vertical" = vertical bar (resizes width); "horizontal" = horizontal bar (resizes height). Default: "vertical". */
    orientation?: "vertical" | "horizontal";

    /** Current size of the panel adjacent to the splitter, in px. Read on pointerdown and held as the drag origin until pointerup. */
    value: number;

    /** Called continuously during drag with the new clamped size. */
    onChange: (value: number) => void;

    /**
     * Which side of the splitter the controlled panel sits on.
     * - "before" — panel is to the left ("vertical") or above ("horizontal"); drag away from panel grows it
     * - "after"  — panel is to the right ("vertical") or below ("horizontal"); drag toward panel grows it
     * Default: "before".
     */
    side?: "before" | "after";

    /** Minimum size, in px. Drag is clamped. Default: 0. */
    min?: number;

    /** Maximum size, in px. Drag is clamped. Default: Infinity. */
    max?: number;

    /** When true, splitter cannot be dragged. */
    disabled?: boolean;

    /**
     * Where to draw the 1px border line on the splitter, or "none" to omit it.
     * For "vertical": "before" = left edge, "after" = right edge.
     * For "horizontal": "before" = top edge, "after" = bottom edge.
     * Default: "after". Choose what makes the splitter feel visually attached to the
     * intended side — drawing on the "after" edge makes the splitter read as part of the
     * panel that sits before it; drawing on "before" makes it read as part of the area
     * after it.
     */
    border?: "before" | "after" | "none";

    /**
     * Splitter background fill. Maps to `color.background.{default,light,dark,overlay}`.
     * Pick the value that matches the side the splitter visually belongs to (often the
     * adjacent panel's background). Default: "default".
     */
    background?: "default" | "light" | "dark" | "overlay";

    /**
     * Splitter background while hovered or being dragged. Same scale as `background`.
     * Default: "light". For a dark splitter the natural choice is `"default"` (lighten on
     * hover); for a default splitter the natural choice is `"light"`.
     */
    hoverBackground?: "default" | "light" | "dark" | "overlay";
}

// --- Styled ---

const Root = styled.div(
    {
        flexShrink: 0,
        flexGrow: 0,
        boxSizing: "border-box",

        // Default: vertical (resizes width). 6px thickness matches legacy splitter.
        width: 6,
        cursor: "ew-resize",

        '&[data-orientation="horizontal"]': {
            width: "auto",
            height: 6,
            cursor: "ns-resize",
        },

        // Background — driven by data-bg.
        '&[data-bg="default"]': { backgroundColor: color.background.default },
        '&[data-bg="light"]':   { backgroundColor: color.background.light },
        '&[data-bg="dark"]':    { backgroundColor: color.background.dark },
        '&[data-bg="overlay"]': { backgroundColor: color.background.overlay },

        // Hover / drag background — driven by data-bg-hover.
        '&:hover[data-bg-hover="default"], &[data-dragging][data-bg-hover="default"]': { backgroundColor: color.background.default },
        '&:hover[data-bg-hover="light"],   &[data-dragging][data-bg-hover="light"]':   { backgroundColor: color.background.light },
        '&:hover[data-bg-hover="dark"],    &[data-dragging][data-bg-hover="dark"]':    { backgroundColor: color.background.dark },
        '&:hover[data-bg-hover="overlay"], &[data-dragging][data-bg-hover="overlay"]': { backgroundColor: color.background.overlay },

        // Border placement — driven by data-border ("before" | "after" | "none").
        '&[data-orientation="vertical"][data-border="before"]':   { borderLeft:   `1px solid ${color.background.light}` },
        '&[data-orientation="vertical"][data-border="after"]':    { borderRight:  `1px solid ${color.background.light}` },
        '&[data-orientation="horizontal"][data-border="before"]': { borderTop:    `1px solid ${color.background.light}` },
        '&[data-orientation="horizontal"][data-border="after"]':  { borderBottom: `1px solid ${color.background.light}` },

        "&[data-disabled]": {
            cursor: "default",
            pointerEvents: "none",
        },
    },
    { label: "Splitter" },
);

// --- Component ---

export function Splitter({
    orientation = "vertical",
    value,
    onChange,
    side = "before",
    min = 0,
    max = Infinity,
    disabled,
    border = "after",
    background = "default",
    hoverBackground = "light",
    ...rest
}: SplitterProps) {
    const startCoord = useRef(0);
    const startValue = useRef(0);
    const [isDragging, setIsDragging] = useState(false);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        startCoord.current = orientation === "vertical" ? e.clientX : e.clientY;
        startValue.current = value;
        setIsDragging(true);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const current = orientation === "vertical" ? e.clientX : e.clientY;
        const delta = current - startCoord.current;
        const sign = side === "before" ? 1 : -1;
        const next = Math.min(Math.max(startValue.current + delta * sign, min), max);
        onChange(next);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setIsDragging(false);
    };

    return (
        <Root
            data-type="splitter"
            data-orientation={orientation}
            data-side={side}
            data-border={border}
            data-bg={background}
            data-bg-hover={hoverBackground}
            data-disabled={disabled || undefined}
            data-dragging={isDragging || undefined}
            role="separator"
            aria-orientation={orientation}
            aria-valuenow={value}
            aria-valuemin={min !== 0 ? min : undefined}
            aria-valuemax={max !== Infinity ? max : undefined}
            onPointerDown={disabled ? undefined : handlePointerDown}
            onPointerMove={disabled ? undefined : handlePointerMove}
            onPointerUp={disabled ? undefined : handlePointerUp}
            onPointerCancel={disabled ? undefined : handlePointerUp}
            {...rest}
        />
    );
}
