import styled from "@emotion/styled";
import { useCallback } from "react";
import { TextInputEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";
import { TextField } from "../../../components/basic/TextField";

// =============================================================================
// Styled Components
// =============================================================================

const TextInputRoot = styled.div({
    minWidth: 300,

    "& .text-input-field": {
        padding: "4px 8px",
    },
});

// =============================================================================
// Component
// =============================================================================

interface TextInputDialogViewProps {
    entry: TextInputEntry;
    updateEntry: (updater: (draft: TextInputEntry) => void) => void;
}

const DEFAULT_BUTTONS = ["OK"];

export function TextInputDialogView({ entry, updateEntry }: TextInputDialogViewProps) {
    const vm = useLogViewModel();
    const resolved = entry.button !== undefined;
    const buttons = entry.buttons ?? DEFAULT_BUTTONS;
    const currentValue = entry.text ?? entry.defaultValue ?? "";

    const handleTextChange = useCallback(
        (text: string) => {
            updateEntry((draft) => {
                draft.text = text;
            });
        },
        [updateEntry],
    );

    const handleClick = useCallback(
        (label: string) => {
            vm.resolveDialog(entry.id, label);
        },
        [vm, entry.id],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !resolved) {
                // Find the first non-required button, or just the first button
                const defaultBtn = buttons[buttons.length - 1];
                const label = defaultBtn.startsWith("!") ? defaultBtn.slice(1) : defaultBtn;
                // Only submit if no required button blocks it or field is not empty
                const hasRequired = buttons.some((b) => b.startsWith("!"));
                if (!hasRequired || currentValue.trim()) {
                    vm.resolveDialog(entry.id, label);
                }
            }
        },
        [vm, entry.id, resolved, buttons, currentValue],
    );

    const requirementNotMet = !currentValue.trim();

    return (
        <DialogContainer resolved={resolved}>
            <TextInputRoot>
                <DialogHeader title={entry.title} />
                <div className="text-input-field">
                    <TextField
                        value={currentValue}
                        onChange={handleTextChange}
                        placeholder={entry.placeholder}
                        disabled={resolved}
                        onKeyDown={handleKeyDown}
                    />
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    button={entry.button}
                    requirementNotMet={requirementNotMet}
                    onClickButton={handleClick}
                />
            </TextInputRoot>
        </DialogContainer>
    );
}
