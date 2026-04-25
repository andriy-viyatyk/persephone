import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, spacing } from "../tokens";

// --- Types ---

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
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

        "&[data-disabled]": {
            opacity: 0.5,
        },
    },
    { label: "Label" },
);

// --- Component ---

export function Label({ required, disabled, children, ...rest }: LabelProps) {
    return (
        <Root
            data-type="label"
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
