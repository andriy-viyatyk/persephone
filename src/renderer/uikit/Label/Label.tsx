import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, spacing } from "../tokens";

// --- Types ---

export type LabelVariant = "default" | "section" | "error" | "warning" | "success";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    /** Visual style. Default: "default". */
    variant?: LabelVariant;
    /** Shows a red asterisk after the label text. */
    required?: boolean;
    /** Dims the label. */
    disabled?: boolean;
}

// --- Styled ---

const Root = styled.label(
    {
        fontSize: fontSize.sm,
        color: color.text.light,
        userSelect: "none",
        display: "inline-flex",
        gap: spacing.xs,

        '&[data-variant="section"]': {
            fontSize: fontSize.xs,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: color.text.light,
        },
        '&[data-variant="error"]': {
            color: color.error.text,
        },
        '&[data-variant="warning"]': {
            color: color.misc.yellow,
        },
        '&[data-variant="success"]': {
            color: color.misc.green,
        },

        "&[data-disabled]": {
            opacity: 0.5,
        },
    },
    { label: "Label" },
);

// --- Component ---

export function Label({ variant = "default", required, disabled, children, ...rest }: LabelProps) {
    return (
        <Root
            data-type="label"
            data-variant={variant}
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
