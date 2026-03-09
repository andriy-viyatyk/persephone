import styled from "@emotion/styled";
import { useCallback } from "react";
import { LogEntry, ConfirmDialogData } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { StyledTextView } from "../StyledTextView";
import { DialogContainer } from "./DialogContainer";
import { ButtonsPanel } from "./ButtonsPanel";

// =============================================================================
// Styled Components
// =============================================================================

const ConfirmRoot = styled.div({
    "& .confirm-message": {
        padding: "4px 8px",
        fontSize: 14,
        lineHeight: "18px",
    },
});

// =============================================================================
// Component
// =============================================================================

interface ConfirmDialogViewProps {
    entry: LogEntry<ConfirmDialogData>;
}

const DEFAULT_BUTTONS = ["No", "Yes"];

export function ConfirmDialogView({ entry }: ConfirmDialogViewProps) {
    const vm = useLogViewModel();
    const data = entry.data;
    const resolved = data.resultButton !== undefined;
    const buttons = data.buttons ?? DEFAULT_BUTTONS;

    const handleClick = useCallback(
        (label: string) => {
            vm.resolveDialog(entry.id, label, label);
        },
        [vm, entry.id],
    );

    return (
        <DialogContainer resolved={resolved}>
            <ConfirmRoot>
                <div className="confirm-message">
                    <StyledTextView text={data.message} />
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    resultButton={data.resultButton}
                    onClickButton={handleClick}
                />
            </ConfirmRoot>
        </DialogContainer>
    );
}
