import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { height, radius } from "../tokens";

// --- Types ---

export interface SliderProps
    extends Omit<
        React.InputHTMLAttributes<HTMLInputElement>,
        "value" | "onChange" | "min" | "max" | "step" | "type" | "size" |
        "style" | "className"
    > {
    /** Current value. */
    value: number;
    /** Change handler — receives the parsed number directly. */
    onChange: (value: number) => void;
    /** Minimum value. */
    min: number;
    /** Maximum value. */
    max: number;
    /** Step. Default: 1. */
    step?: number;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
    /** Disabled state. */
    disabled?: boolean;
    /** Fixed width — number → px, string passes through. Default: fills parent (100%). */
    width?: number | string;
}

// --- Styled ---

const Root = styled.input(
    {
        appearance: "none",
        WebkitAppearance: "none",
        background: "transparent",
        outline: "none",
        cursor: "pointer",
        margin: 0,
        width: "100%",
        flex: "1 1 auto",
        minWidth: 0,

        // Webkit
        "&::-webkit-slider-runnable-track": {
            height: 4,
            borderRadius: radius.xs,
            background: color.border.default,
        },
        "&::-webkit-slider-thumb": {
            appearance: "none",
            WebkitAppearance: "none",
            width: 12,
            height: 12,
            marginTop: -4,
            borderRadius: radius.full,
            background: color.border.active,
            cursor: "pointer",
            border: "none",
        },

        // Firefox
        "&::-moz-range-track": {
            height: 4,
            borderRadius: radius.xs,
            background: color.border.default,
        },
        "&::-moz-range-thumb": {
            width: 12,
            height: 12,
            border: "none",
            borderRadius: radius.full,
            background: color.border.active,
            cursor: "pointer",
        },

        '&[data-size="sm"]': {
            height: height.controlSm,
        },
        '&[data-size="md"]': {
            height: height.controlMd,
        },

        "&[data-disabled]": {
            opacity: 0.4,
            pointerEvents: "none",
        },
    },
    { label: "Slider" },
);

// --- Component ---

export function Slider({
    value,
    onChange,
    min,
    max,
    step = 1,
    size = "md",
    disabled,
    width,
    ...rest
}: SliderProps) {
    return (
        <Root
            data-type="slider"
            data-size={size}
            data-disabled={disabled || undefined}
            type="range"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            style={width !== undefined ? { width } : undefined}
            {...rest}
        />
    );
}
