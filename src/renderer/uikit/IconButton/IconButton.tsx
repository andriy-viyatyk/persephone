import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { height, spacing, radius } from "../tokens";

// --- Types ---

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** The icon to render. */
    icon: React.ReactNode;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
}

// --- Styled ---

const Root = styled.button(
    {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        border: "none",
        background: "transparent",
        borderRadius: radius.sm,
        outline: "none",
        padding: spacing.xs,
        color: color.icon.light,
        flexShrink: 0,

        "&:hover": {
            color: color.icon.default,
        },
        "&:active": {
            color: color.icon.dark,
        },

        '&[data-size="sm"]': {
            width: height.controlSm,
            height: height.controlSm,
            "& svg": {
                width: height.iconMd,
                height: height.iconMd,
            },
        },
        '&[data-size="md"]': {
            width: height.controlMd,
            height: height.controlMd,
            "& svg": {
                width: height.iconLg,
                height: height.iconLg,
            },
        },

        "&[data-disabled]": {
            color: color.icon.disabled,
            pointerEvents: "none",
        },
    },
    { label: "IconButton" },
);

// --- Component ---

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton({ icon, size = "md", disabled, ...rest }, ref) {
        return (
            <Root
                ref={ref}
                data-type="icon-button"
                data-size={size}
                data-disabled={disabled || undefined}
                disabled={disabled}
                type="button"
                {...rest}
            >
                <span data-part="icon">{icon}</span>
            </Root>
        );
    },
);
