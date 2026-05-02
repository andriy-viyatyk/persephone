import React from "react";
import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import { ProgressIcon } from "../../theme/icons";

// --- Types ---

export interface SpinnerProps
    extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "className" | "color"> {
    /** Outer size in px. Default: 32. */
    size?: number;
    /** CSS color override applied to the spinner stroke. Default: inherits via currentColor. */
    color?: string;
}

// --- Styled ---

const spin = keyframes({
    from: { transform: "rotate(0deg)" },
    to:   { transform: "rotate(360deg)" },
});

const Root = styled.span<{ $size: number; $color?: string }>(
    ({ $size, $color }) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: $size,
        height: $size,
        flexShrink: 0,
        color: $color,
        "& svg": {
            width: $size,
            height: $size,
            animation: `${spin} 1.5s steps(10) infinite`,
        },
    }),
    { label: "Spinner" },
);

// --- Component ---

export function Spinner({ size = 32, color, ...rest }: SpinnerProps) {
    return (
        <Root
            data-type="spinner"
            role="status"
            aria-live="polite"
            aria-label="Loading"
            $size={size}
            $color={color}
            {...rest}
        >
            <ProgressIcon />
        </Root>
    );
}
