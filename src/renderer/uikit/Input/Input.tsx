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
    /** Content rendered inside the input chrome, before the text. */
    startSlot?: React.ReactNode;
    /** Content rendered inside the input chrome, after the text. */
    endSlot?: React.ReactNode;
}

// --- Styled ---

const Wrapper = styled.div(
    {
        display: "flex",
        alignItems: "stretch",
        backgroundColor: color.background.dark,
        border: `1px solid ${color.border.light}`,
        borderRadius: radius.md,
        boxSizing: "border-box",
        width: "100%",

        "&:focus-within": {
            borderColor: color.border.active,
        },
        "&[data-readonly]:focus-within": {
            borderColor: color.border.light,
        },

        '&[data-size="sm"]': {
            height: height.controlSm,
        },
        '&[data-size="md"]': {
            height: height.controlMd,
        },

        "&[data-disabled]": {
            opacity: 0.5,
            pointerEvents: "none",
        },
    },
    { label: "Input" },
);

const Field = styled.input(
    {
        flex: "1 1 auto",
        minWidth: 0,
        backgroundColor: "transparent",
        color: color.text.dark,
        border: "none",
        outline: "none",
        margin: 0,
        height: "100%",
        boxSizing: "border-box",
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: spacing.md,
        paddingRight: spacing.md,

        '&[data-size="sm"]': {
            fontSize: fontSize.sm,
        },
        '&[data-size="md"]': {
            fontSize: fontSize.base,
        },

        "&[data-has-start]": {
            paddingLeft: 0,
        },
        "&[data-has-end]": {
            paddingRight: 0,
        },

        "&[type='number']:not([data-has-end])": {
            paddingRight: spacing.xs,
        },
        "&[type='number']": {
            "&::-webkit-inner-spin-button": {
                cursor: "pointer",
                background: "transparent",
                opacity: 0.5,
                transition: "opacity 0.15s",
                marginRight: -spacing.xs,
            },
            "&:hover::-webkit-inner-spin-button, &:focus::-webkit-inner-spin-button": {
                opacity: 1,
            },
        },
    },
    { label: "InputField" },
);

const Slot = styled.div(
    {
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
    },
    { label: "InputSlot" },
);

// --- Component ---

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    function Input(
        { onChange, size = "md", disabled, readOnly, startSlot, endSlot, ...rest },
        ref,
    ) {
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            onChange?.(e.target.value);
        };

        const hasStart = startSlot !== undefined && startSlot !== null && startSlot !== false;
        const hasEnd = endSlot !== undefined && endSlot !== null && endSlot !== false;

        return (
            <Wrapper
                data-type="input"
                data-size={size}
                data-disabled={disabled || undefined}
                data-readonly={readOnly || undefined}
            >
                {hasStart && <Slot data-part="start-slot">{startSlot}</Slot>}
                <Field
                    ref={ref}
                    data-size={size}
                    data-has-start={hasStart || undefined}
                    data-has-end={hasEnd || undefined}
                    disabled={disabled}
                    readOnly={readOnly}
                    onChange={handleChange}
                    {...rest}
                />
                {hasEnd && <Slot data-part="end-slot">{endSlot}</Slot>}
            </Wrapper>
        );
    },
);
