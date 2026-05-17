import React from "react";
import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import color from "../../theme/color";
import { radius } from "../tokens";

// --- Types ---

type Variant = "default" | "success" | "warning" | "danger";

export interface ProgressBarProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
    /** Current value. When undefined and `completed` is false, the bar is indeterminate. */
    value?: number;
    /** Maximum value. Default: 100. */
    max?: number;
    /** Mark the work as finished. Renders a full bar in the success colour, overriding `variant`. */
    completed?: boolean;
    /** Fixed width — number → px, string passes through. Default: fills parent (100%). */
    width?: number | string;
    /** Track height in px. Default: 6. */
    height?: number;
    /** Visual variant. Ignored when `completed` is true. Default: "default". */
    variant?: Variant;
    /** ARIA label. Default: "Progress". */
    "aria-label"?: string;
}

// --- Animation ---

// Indeterminate segment travels from off-left to off-right using transform only
// (compositor-friendly — avoids layout thrash that hurt mounting under virtualization).
const indeterminateSlide = keyframes({
    "0%":   { transform: "translateX(-100%)" },
    "100%": { transform: "translateX(330%)" },
});

// --- Styled ---

const Root = styled.div(
    {
        position: "relative",
        backgroundColor: color.background.dark,
        borderRadius: radius.xs,
        overflow: "hidden",
        boxSizing: "border-box",
    },
    { label: "ProgressBar" },
);

const Fill = styled.div(
    {
        height: "100%",
        borderRadius: radius.xs,
        transition: "width 0.2s ease",

        // Determinate / completed: width-driven from inline style.
        // Indeterminate: 30% segment animated via transform.
        '[data-state="indeterminate"] > &': {
            width: "30%",
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            transition: "none",
            animation: `${indeterminateSlide} 1.4s linear infinite`,
        },

        '[data-variant="default"] > &':  { backgroundColor: color.misc.blue },
        '[data-variant="success"] > &':  { backgroundColor: color.misc.green },
        '[data-variant="warning"] > &':  { backgroundColor: color.misc.yellow },
        '[data-variant="danger"]  > &':  { backgroundColor: color.misc.red },

        // Completed wins over variant.
        '[data-state="completed"] > &':  { backgroundColor: color.misc.green },
    },
    { label: "ProgressBar-fill" },
);

// --- Helpers ---

function clampPercent(value: number, max: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    const pct = (value / max) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
}

// --- Component ---

export function ProgressBar({
    name,
    value,
    max = 100,
    completed,
    width,
    height = 6,
    variant = "default",
    "aria-label": ariaLabel = "Progress",
    ...rest
}: ProgressBarProps) {
    const state: "completed" | "determinate" | "indeterminate" =
        completed ? "completed" : value != null ? "determinate" : "indeterminate";

    const percent = state === "completed" ? 100 : state === "determinate" ? clampPercent(value ?? 0, max) : 0;

    const rootStyle: React.CSSProperties = {
        width: width ?? "100%",
        height,
    };

    const ariaProps: React.AriaAttributes =
        state === "indeterminate"
            ? { "aria-busy": true, "aria-valuemin": 0, "aria-valuemax": max }
            : { "aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": state === "completed" ? max : value };

    return (
        <Root
            data-type="progress-bar"
            data-name={name}
            data-state={state}
            data-variant={variant}
            role="progressbar"
            aria-label={ariaLabel}
            {...ariaProps}
            {...rest}
            style={rootStyle}
        >
            <Fill style={state === "indeterminate" ? undefined : { width: `${percent}%` }} />
        </Root>
    );
}
