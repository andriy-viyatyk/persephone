import { useCallback } from "react";
import { Button, Panel } from "../../../uikit";
import { CheckIcon } from "../../../theme/icons";

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
    button?: string;
    requirementNotMet?: boolean;
    onClickButton: (label: string) => void;
}

export function ButtonsPanel({ buttons, button, requirementNotMet, onClickButton }: ButtonsPanelProps) {
    const resolved = button !== undefined;
    const parsed = parseButtons(buttons);

    const handleClick = useCallback(
        (label: string) => {
            if (!resolved) onClickButton(label);
        },
        [resolved, onClickButton],
    );

    return (
        <Panel
            name="log-buttons-panel"
            direction="row"
            gap="md"
            paddingX="md"
            paddingY="sm"
            wrap
        >
            {parsed.map((btn) => {
                const isResult = resolved && button === btn.label;
                const disabled = resolved || (btn.required && requirementNotMet);
                return (
                    <Button
                        name={`log-button-${btn.label}`}
                        key={btn.label}
                        size="sm"
                        disabled={disabled}
                        onClick={() => handleClick(btn.label)}
                        icon={isResult ? <CheckIcon /> : undefined}
                    >
                        {btn.label}
                    </Button>
                );
            })}
        </Panel>
    );
}
