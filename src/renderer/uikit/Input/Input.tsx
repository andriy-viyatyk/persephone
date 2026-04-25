import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, height, spacing, radius } from "../tokens";

// --- Types ---

export interface InputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
    /** Change handler — receives the string value directly, not the event. */
    onChange?: (value: string) => void;
    /** Control height. Default: "md". */
    size?: "sm" | "md";
}

// --- Styled ---

const Root = styled.input(
    {
        padding: `${spacing.sm}px ${spacing.md}px`,
        backgroundColor: color.background.dark,
        color: color.text.dark,
        border: `1px solid ${color.border.light}`,
        borderRadius: radius.md,
        outline: "none",
        boxSizing: "border-box",
        width: "100%",

        "&:focus, &:active": {
            borderColor: color.border.active,
        },

        '&[data-size="sm"]': {
            height: height.controlSm,
            fontSize: fontSize.sm,
        },
        '&[data-size="md"]': {
            height: height.controlMd,
            fontSize: fontSize.base,
        },

        "&[data-disabled]": {
            opacity: 0.5,
            pointerEvents: "none",
        },
    },
    { label: "Input" },
);

// --- Component ---

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    function Input({ onChange, size = "md", disabled, ...rest }, ref) {
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            onChange?.(e.target.value);
        };

        return (
            <Root
                ref={ref}
                data-type="input"
                data-size={size}
                data-disabled={disabled || undefined}
                disabled={disabled}
                onChange={handleChange}
                {...rest}
            />
        );
    },
);
