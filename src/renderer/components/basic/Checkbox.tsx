import styled from "@emotion/styled";
import { useCallback } from "react";
import { CheckedIcon, UncheckedIcon } from "../../theme/icons";
import color from "../../theme/color";

// =============================================================================
// Styles
// =============================================================================

const CheckboxRoot = styled.label({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    userSelect: "none",
    color: color.text.default,

    "& .checkbox-icon": {
        flexShrink: 0,
        width: 16,
        height: 16,
        color: color.text.light,
    },

    "&:hover .checkbox-icon": {
        color: color.text.default,
    },

    "&.disabled": {
        cursor: "default",
        opacity: 0.5,
        "&:hover .checkbox-icon": {
            color: color.text.light,
        },
    },
});

// =============================================================================
// Component
// =============================================================================

interface CheckboxProps {
    checked?: boolean;
    disabled?: boolean;
    onChange?: (checked: boolean) => void;
    children?: React.ReactNode;
    className?: string;
}

export function Checkbox({ checked, disabled, onChange, children, className }: CheckboxProps) {
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            if (!disabled) onChange?.(!checked);
        },
        [checked, disabled, onChange],
    );

    return (
        <CheckboxRoot
            className={disabled ? `disabled ${className ?? ""}` : className}
            onClick={handleClick}
        >
            {checked
                ? <CheckedIcon className="checkbox-icon" />
                : <UncheckedIcon className="checkbox-icon" />
            }
            {children}
        </CheckboxRoot>
    );
}
