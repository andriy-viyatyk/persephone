import { useCallback } from "react";
import { ButtonsEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";

// =============================================================================
// Component
// =============================================================================

interface ButtonsDialogViewProps {
    entry: ButtonsEntry;
}

export function ButtonsDialogView({ entry }: ButtonsDialogViewProps) {
    const vm = useLogViewModel();
    const resolved = entry.button !== undefined;

    const handleClick = useCallback(
        (label: string) => {
            vm.resolveDialog(entry.id, label);
        },
        [vm, entry.id],
    );

    return (
        <DialogContainer resolved={resolved}>
            <DialogHeader title={entry.title} />
            <ButtonsPanel
                buttons={entry.buttons}
                button={entry.button}
                onClickButton={handleClick}
            />
        </DialogContainer>
    );
}
