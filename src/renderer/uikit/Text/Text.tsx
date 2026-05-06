import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize } from "../tokens";

// --- Types ---

export type TextVariant = "default" | "uppercased";
export type TextColor =
    | "inherit"
    | "default"
    | "light"
    | "dark"
    | "error"
    | "warning"
    | "success"
    | "primary";
export type TextSize = "xs" | "sm" | "md" | "base" | "lg" | "xl" | "xxl";

export interface TextStyleProps {
    /** Visual variant. "uppercased" applies uppercase + letter-spacing. Default: "default". */
    variant?: TextVariant;
    /** Text color. Default: "default" (color.text.default). */
    color?: TextColor;
    /** Font size from the fontSize token scale. Default: "base". */
    size?: TextSize;
    /** Render text in italic. */
    italic?: boolean;
    /** Render text in bold (font-weight 600). */
    bold?: boolean;
    /** Prevent text wrapping (white-space: nowrap). */
    nowrap?: boolean;
    /** Preserve newlines and wrap on word boundaries (white-space: pre-wrap). Mutually exclusive with `nowrap`. */
    preWrap?: boolean;
    /**
     * Truncate with an ellipsis. Wrap in a flex parent (e.g. `<Panel flex overflow="hidden">`)
     * so the parent can clip — `min-width: 0` on the truncated Text lets it shrink below content size.
     */
    truncate?: boolean;
    /**
     * Text alignment. Forces `display: block` since Text is a span by default and
     * `text-align` on an inline span does not affect wrapped-content layout. Use this
     * when the Text spans multiple lines and you need the wrapped lines aligned.
     */
    align?: "left" | "center" | "right";
}

export interface TextProps extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "className" | "color">,
    TextStyleProps {}

// --- Styled ---

const Root = styled.span(
    {
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
        '&[data-color="primary"]': { color: color.primary.text },

        // --- Variant ---
        '&[data-variant="uppercased"]': {
            textTransform: "uppercase",
            letterSpacing: 0.5,
        },

        // --- Modifiers ---
        "&[data-bold]":     { fontWeight: 600 },
        "&[data-italic]":   { fontStyle: "italic" },
        "&[data-nowrap]":   { whiteSpace: "nowrap" },
        "&[data-pre-wrap]": { whiteSpace: "pre-wrap" },
        "&[data-truncate]": {
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
        },

        // --- Alignment ---
        '&[data-align="left"]':   { textAlign: "left",   display: "block" },
        '&[data-align="center"]': { textAlign: "center", display: "block" },
        '&[data-align="right"]':  { textAlign: "right",  display: "block" },
    },
    { label: "Text" },
);

// --- Component ---

export function Text({
    variant = "default",
    color: colorProp = "default",
    size = "base",
    italic,
    bold,
    nowrap,
    preWrap,
    truncate,
    align,
    children,
    ...rest
}: TextProps) {
    return (
        <Root
            data-type="text"
            data-variant={variant}
            data-color={colorProp}
            data-size={size}
            data-bold={bold || undefined}
            data-italic={italic || undefined}
            data-nowrap={nowrap || undefined}
            data-pre-wrap={preWrap || undefined}
            data-truncate={truncate || undefined}
            data-align={align || undefined}
            {...rest}
        >
            {children}
        </Root>
    );
}
