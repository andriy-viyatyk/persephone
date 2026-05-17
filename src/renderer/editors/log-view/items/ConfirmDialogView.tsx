import { useCallback } from "react";
import { ConfirmEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { StyledTextView } from "../StyledTextView";
import { DialogContainer } from "./DialogContainer";
import { ButtonsPanel } from "./ButtonsPanel";
import { Panel, Text } from "../../../uikit";

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
            <Panel name="log-confirm-message" paddingX="md" paddingY="sm">
                <Text size="base">
                    <StyledTextView text={entry.message} />
                </Text>
            </Panel>
            <ButtonsPanel
                buttons={buttons}
                button={entry.button}
                onClickButton={handleClick}
            />
        </DialogContainer>
    );
}
