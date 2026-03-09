import styled from "@emotion/styled";
import { useCallback } from "react";
import { LogEntry, TextDialogData } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";
import { TextField } from "../../../components/basic/TextField";

// =============================================================================
// Styled Components
// =============================================================================

const TextInputRoot = styled.div({
    "& .text-input-field": {
        padding: "4px 8px",
    },
});

// =============================================================================
// Component
// =============================================================================

interface TextInputDialogViewProps {
    entry: LogEntry<TextDialogData>;
    updateEntry: (updater: (draft: LogEntry<TextDialogData>) => void) => void;
}

const DEFAULT_BUTTONS = ["OK"];

export function TextInputDialogView({ entry, updateEntry }: TextInputDialogViewProps) {
    const vm = useLogViewModel();
    const data = entry.data;
    const resolved = data.resultButton !== undefined;
    const buttons = data.buttons ?? DEFAULT_BUTTONS;
    const currentValue = data.result ?? data.defaultValue ?? "";

    const handleTextChange = useCallback(
        (text: string) => {
            updateEntry((draft) => {
                draft.data.result = text;
            });
        },
        [updateEntry],
    );

    const handleClick = useCallback(
        (label: string) => {
            vm.resolveDialog(entry.id, currentValue, label);
        },
        [vm, entry.id, currentValue],
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
                    vm.resolveDialog(entry.id, currentValue, label);
                }
            }
        },
        [vm, entry.id, currentValue, resolved, buttons],
    );

    const requirementNotMet = !currentValue.trim();

    return (
        <DialogContainer resolved={resolved}>
            <TextInputRoot>
                <DialogHeader title={data.title} />
                <div className="text-input-field">
                    <TextField
                        value={currentValue}
                        onChange={handleTextChange}
                        placeholder={data.placeholder}
                        disabled={resolved}
                        onKeyDown={handleKeyDown}
                    />
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    resultButton={data.resultButton}
                    requirementNotMet={requirementNotMet}
                    onClickButton={handleClick}
                />
            </TextInputRoot>
        </DialogContainer>
    );
}
