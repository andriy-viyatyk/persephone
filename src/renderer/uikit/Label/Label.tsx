import React from "react";
import styled from "@emotion/styled";
import { spacing } from "../tokens";
import { Text, TextStyleProps } from "../Text/Text";

// --- Types ---

export interface LabelProps extends
    Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "style" | "className" | "color">,
    TextStyleProps {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
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

        "&[data-disabled]": {
            opacity: 0.5,
        },
    },
    { label: "Label" },
);

// --- Component ---

export function Label({
    name,
    variant = "default",
    color: colorProp = "default",
    size = "sm",
    italic,
    bold,
    nowrap = true,
    required,
    disabled,
    children,
    ...rest
}: LabelProps) {
    const textProps: TextStyleProps = { variant, color: colorProp, size, italic, bold, nowrap };
    return (
        <Root
            data-type="label"
            data-name={name}
            data-disabled={disabled || undefined}
            {...rest}
        >
            <Text {...textProps}>{children}</Text>
            {required && (
                <Text {...textProps} color="error">*</Text>
            )}
        </Root>
    );
}
