import styled from "@emotion/styled";
import { useCallback } from "react";
import { ConfirmEntry } from "../logTypes";
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
    entry: ConfirmEntry;
}

const DEFAULT_BUTTONS = ["No", "Yes"];

export function ConfirmDialogView({ entry }: ConfirmDialogViewProps) {
    const vm = useLogViewModel();
    const resolved = entry.button !== undefined;
    const buttons = entry.buttons ?? DEFAULT_BUTTONS;

    const handleClick = useCallback(
        (label: string) => {
            vm.resolveDialog(entry.id, label);
        },
        [vm, entry.id],
    );

    return (
        <DialogContainer resolved={resolved}>
            <ConfirmRoot>
                <div className="confirm-message">
                    <StyledTextView text={entry.message} />
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    button={entry.button}
                    onClickButton={handleClick}
                />
            </ConfirmRoot>
        </DialogContainer>
    );
}
