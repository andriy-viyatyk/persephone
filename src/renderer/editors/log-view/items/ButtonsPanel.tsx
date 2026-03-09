import styled from "@emotion/styled";
import { useCallback } from "react";
import { Button } from "../../../components/basic/Button";
import { CheckIcon } from "../../../theme/icons";
import color from "../../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const PanelRoot = styled.div({
    display: "flex",
    flexDirection: "row",
    gap: 6,
    padding: "4px 8px",
    flexWrap: "wrap",

    "& .btn-check": {
        display: "inline-flex",
        alignItems: "center",
        marginRight: 2,
        color: color.misc.green,
    },
});

// =============================================================================
// Helpers
// =============================================================================

interface ParsedButton {
    label: string;
    required: boolean;
}

function parseButtons(buttons: string[]): ParsedButton[] {
    return buttons.map((b) => {
        if (b.startsWith("!")) {
            return { label: b.slice(1), required: true };
        }
        return { label: b, required: false };
    });
}

// =============================================================================
// Component
// =============================================================================

interface ButtonsPanelProps {
    buttons: string[];
    resultButton?: string;
    requirementNotMet?: boolean;
    onClickButton: (label: string) => void;
}

export function ButtonsPanel({ buttons, resultButton, requirementNotMet, onClickButton }: ButtonsPanelProps) {
    const resolved = resultButton !== undefined;
    const parsed = parseButtons(buttons);

    const handleClick = useCallback(
        (label: string) => {
            if (!resolved) onClickButton(label);
        },
        [resolved, onClickButton],
    );

    return (
        <PanelRoot>
            {parsed.map((btn) => {
                const isResult = resolved && resultButton === btn.label;
                const disabled = resolved || (btn.required && requirementNotMet);
                return (
                    <Button
                        key={btn.label}
                        size="small"
                        type="raised"
                        disabled={disabled}
                        onClick={() => handleClick(btn.label)}
                    >
                        {isResult && (
                            <span className="btn-check"><CheckIcon /></span>
                        )}
                        {btn.label}
                    </Button>
                );
            })}
        </PanelRoot>
    );
}
