import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, spacing } from "../tokens";

// --- Types ---

export type LabelVariant = "default" | "uppercased";
export type LabelColor =
    | "inherit"
    | "default"
    | "light"
    | "dark"
    | "error"
    | "warning"
    | "success";
export type LabelSize = "xs" | "sm" | "md" | "base" | "lg" | "xl" | "xxl";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    /** Visual variant. "uppercased" applies uppercase + letter-spacing. Default: "default". */
    variant?: LabelVariant;
    /** Text color. Default: "default" (color.text.default). */
    color?: LabelColor;
    /** Font size from the fontSize token scale. Default: "sm". */
    size?: LabelSize;
    /** Render text in italic. */
    italic?: boolean;
    /** Render text in bold (font-weight 600). */
    bold?: boolean;
    /** Shows a red asterisk after the label text. */
    required?: boolean;
    /** Dims the label. */
    disabled?: boolean;
}

// --- Styled ---

const Root = styled.label(
    {
        userSelect: "none",
        display: "inline-flex",
        gap: spacing.xs,
        fontWeight: "normal",

        // --- Size ---
        '&[data-size="xs"]':   { fontSize: fontSize.xs },
        '&[data-size="sm"]':   { fontSize: fontSize.sm },
        '&[data-size="md"]':   { fontSize: fontSize.md },
        '&[data-size="base"]': { fontSize: fontSize.base },
        '&[data-size="lg"]':   { fontSize: fontSize.lg },
        '&[data-size="xl"]':   { fontSize: fontSize.xl },
        '&[data-size="xxl"]':  { fontSize: fontSize.xxl },

        // --- Color ---
        '&[data-color="inherit"]': { color: "inherit" },
        '&[data-color="default"]': { color: color.text.default },
        '&[data-color="light"]':   { color: color.text.light },
        '&[data-color="dark"]':    { color: color.text.dark },
        '&[data-color="error"]':   { color: color.error.text },
        '&[data-color="warning"]': { color: color.warning.text },
        '&[data-color="success"]': { color: color.success.text },

        // --- Variant ---
        '&[data-variant="uppercased"]': {
            textTransform: "uppercase",
            letterSpacing: 0.5,
        },

        // --- Modifiers ---
        "&[data-bold]":   { fontWeight: 600 },
        "&[data-italic]": { fontStyle: "italic" },

        "&[data-disabled]": {
            opacity: 0.5,
        },
    },
    { label: "Label" },
);

// --- Component ---

export function Label({
    variant = "default",
    color: colorProp = "default",
    size = "sm",
    italic,
    bold,
    required,
    disabled,
    children,
    ...rest
}: LabelProps) {
    return (
        <Root
            data-type="label"
            data-variant={variant}
            data-color={colorProp}
            data-size={size}
            data-bold={bold || undefined}
            data-italic={italic || undefined}
            data-disabled={disabled || undefined}
            {...rest}
        >
            {children}
            {required && (
                <span style={{ color: color.error.text }}>*</span>
            )}
        </Root>
    );
}
