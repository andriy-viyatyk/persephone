import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize } from "../tokens";

// --- Types ---

export interface TextProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Typography preset. Default: "body". */
    variant?: "heading" | "body" | "caption" | "code";
}

// --- Styled ---

const Root = styled.span(
    {
        // Default: body
        fontSize: fontSize.base,
        color: color.text.default,
        fontWeight: "normal",

        '&[data-variant="heading"]': {
            fontSize: fontSize.lg,
            color: color.text.default,
            fontWeight: 600,
        },
        '&[data-variant="body"]': {
            fontSize: fontSize.base,
            color: color.text.default,
            fontWeight: "normal",
        },
        '&[data-variant="caption"]': {
            fontSize: fontSize.sm,
            color: color.text.light,
            fontWeight: "normal",
        },
        '&[data-variant="code"]': {
            fontSize: fontSize.md,
            color: color.text.default,
            fontWeight: "normal",
            fontFamily: "monospace",
        },
    },
    { label: "Text" },
);

// --- Component ---

export function Text({ variant = "body", children, ...rest }: TextProps) {
    return (
        <Root
            data-type="text"
            data-variant={variant}
            {...rest}
        >
            {children}
        </Root>
    );
}
