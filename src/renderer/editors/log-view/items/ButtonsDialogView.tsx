import { useCallback } from "react";
import { LogEntry, ButtonsDialogData } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";

// =============================================================================
// Component
// =============================================================================

interface ButtonsDialogViewProps {
    entry: LogEntry<ButtonsDialogData>;
}

export function ButtonsDialogView({ entry }: ButtonsDialogViewProps) {
    const vm = useLogViewModel();
    const data = entry.data;
    const resolved = data.button !== undefined;

    const handleClick = useCallback(
        (label: string) => {
            vm.resolveDialog(entry.id, label);
        },
        [vm, entry.id],
    );

    return (
        <DialogContainer resolved={resolved}>
            <DialogHeader title={data.title} />
            <ButtonsPanel
                buttons={data.buttons}
                button={data.button}
                onClickButton={handleClick}
            />
        </DialogContainer>
    );
}
