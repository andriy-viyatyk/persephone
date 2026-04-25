import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, height, spacing, gap, radius } from "../tokens";

// --- Types ---

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style. Default: "default". */
    variant?: "default" | "primary" | "ghost" | "danger" | "link";
    /** Control height. Default: "md". */
    size?: "sm" | "md";
    /** Icon rendered before children. */
    icon?: React.ReactNode;
    /**
     * Parent container background — adjusts hover/active colors so they stay
     * visible against the parent. Affects "default", "ghost", and "link"
     * variants. Default: "default".
     */
    background?: "default" | "light" | "dark";
    /** Stretch to the full width of the parent. */
    block?: boolean;
}

// --- Styled ---

const Root = styled.button(
    {
        // Adaptive background tokens — overridden by data-bg below.
        // Default assumes parent uses color.background.default.
        "--btn-rest-bg": color.background.default,
        "--btn-hover-bg": color.background.light,
        "--btn-active-bg": color.background.dark,

        '&[data-bg="light"]': {
            "--btn-rest-bg": color.background.light,
            "--btn-hover-bg": color.background.default,
            "--btn-active-bg": color.background.dark,
        },
        '&[data-bg="dark"]': {
            "--btn-rest-bg": color.background.dark,
            "--btn-hover-bg": color.background.default,
            "--btn-active-bg": color.background.light,
        },

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
        backgroundColor: "var(--btn-rest-bg)",

        "&:hover": {
            backgroundColor: "var(--btn-hover-bg)",
        },
        "&:active": {
            backgroundColor: "var(--btn-active-bg)",
        },

        '&[data-variant="primary"]': {
            backgroundColor: color.background.selection,
            color: color.text.selection,
            "&:hover": {
                filter: "brightness(1.1)",
                backgroundColor: color.background.selection,
            },
            "&:active": {
                filter: "brightness(0.9)",
                backgroundColor: color.background.selection,
            },
        },
        '&[data-variant="ghost"]': {
            backgroundColor: "transparent",
            "&:hover": {
                backgroundColor: "var(--btn-hover-bg)",
            },
            "&:active": {
                backgroundColor: "var(--btn-active-bg)",
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
        '&[data-variant="link"]': {
            backgroundColor: "transparent",
            color: color.misc.blue,
            borderColor: color.border.default,
            "&:hover": {
                backgroundColor: "var(--btn-hover-bg)",
            },
            "&:active": {
                backgroundColor: "var(--btn-active-bg)",
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

        "&[data-block]": {
            display: "flex",
            width: "100%",
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
        { variant = "default", size = "md", background = "default", block, icon, disabled, children, ...rest },
        ref,
    ) {
        return (
            <Root
                ref={ref}
                data-type="button"
                data-variant={variant}
                data-size={size}
                data-bg={background}
                data-block={block || undefined}
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
