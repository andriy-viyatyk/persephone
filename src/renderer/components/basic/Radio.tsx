import styled from "@emotion/styled";
import { useCallback } from "react";
import { RadioCheckedIcon, RadioUncheckedIcon } from "../../theme/icons";
import color from "../../theme/color";

// =============================================================================
// Styles
// =============================================================================

const RadioRoot = styled.label({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    userSelect: "none",
    color: color.text.default,

    "& .radio-icon": {
        flexShrink: 0,
        width: 16,
        height: 16,
        color: color.text.light,
    },

    "&:hover .radio-icon": {
        color: color.text.default,
    },

    "&.disabled": {
        cursor: "default",
        opacity: 0.5,
        "&:hover .radio-icon": {
            color: color.text.light,
        },
    },
});

// =============================================================================
// Component
// =============================================================================

interface RadioProps {
    checked?: boolean;
    disabled?: boolean;
    onChange?: () => void;
    children?: React.ReactNode;
    className?: string;
}

export function Radio({ checked, disabled, onChange, children, className }: RadioProps) {
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            if (!disabled) onChange?.();
        },
        [disabled, onChange],
    );

    return (
        <RadioRoot
            className={disabled ? `disabled ${className ?? ""}` : className}
            onClick={handleClick}
        >
            {checked
                ? <RadioCheckedIcon className="radio-icon" />
                : <RadioUncheckedIcon className="radio-icon" />
            }
            {children}
        </RadioRoot>
    );
}
