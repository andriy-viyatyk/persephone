import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, height, spacing, gap, radius } from "../tokens";

// --- Types ---

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style. Default: "default". */
    variant?: "default" | "primary" | "ghost" | "danger";
    /** Control height. Default: "md". */
    size?: "sm" | "md";
    /** Icon rendered before children. */
    icon?: React.ReactNode;
}

// --- Styled ---

const Root = styled.button(
    {
        display: "inline-flex",
        alignItems: "center",
        gap: gap.md,
        cursor: "pointer",
        border: "1px solid transparent",
        borderRadius: radius.md,
        outline: "none",
        userSelect: "none",
        textWrap: "nowrap",
        fontSize: fontSize.base,
        color: color.text.default,
        backgroundColor: color.background.default,

        "&:hover": {
            backgroundColor: color.background.light,
        },
        "&:active": {
            backgroundColor: color.background.dark,
        },

        '&[data-variant="primary"]': {
            backgroundColor: color.icon.active,
            color: color.text.selection,
            "&:hover": {
                filter: "brightness(1.1)",
            },
            "&:active": {
                filter: "brightness(0.9)",
            },
        },
        '&[data-variant="ghost"]': {
            backgroundColor: "transparent",
            "&:hover": {
                backgroundColor: color.background.light,
            },
            "&:active": {
                backgroundColor: color.background.dark,
            },
        },
        '&[data-variant="danger"]': {
            backgroundColor: "transparent",
            color: color.error.text,
            "&:hover": {
                backgroundColor: color.error.background,
            },
            "&:active": {
                backgroundColor: color.error.background,
            },
        },

        '&[data-size="sm"]': {
            height: height.controlSm,
            padding: `0 ${spacing.sm}px`,
            fontSize: fontSize.sm,
        },
        '&[data-size="md"]': {
            height: height.controlMd,
            padding: `0 ${spacing.md}px`,
            fontSize: fontSize.base,
        },

        "&[data-disabled]": {
            opacity: 0.4,
            pointerEvents: "none",
        },

        "& svg": {
            width: height.iconMd,
            height: height.iconMd,
        },
    },
    { label: "Button" },
);

// --- Component ---

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    function Button(
        { variant = "default", size = "md", icon, disabled, children, ...rest },
        ref,
    ) {
        return (
            <Root
                ref={ref}
                data-type="button"
                data-variant={variant}
                data-size={size}
                data-disabled={disabled || undefined}
                disabled={disabled}
                type="button"
                {...rest}
            >
                {icon}
                {children}
            </Root>
        );
    },
);
