import styled from "@emotion/styled";
import { useCallback } from "react";
import { SelectEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";
import { ComboSelect } from "../../../components/form/ComboSelect";

// =============================================================================
// Constants
// =============================================================================

const CHAR_WIDTH = 8;

// =============================================================================
// Styled Components
// =============================================================================

const SelectRoot = styled.div({
    minWidth: 200,

    "& .select-control": {
        padding: "4px 8px",
        maxWidth: "100%",
    },
});

// =============================================================================
// Component
// =============================================================================

interface SelectDialogViewProps {
    entry: SelectEntry;
    updateEntry: (updater: (draft: SelectEntry) => void) => void;
}

const DEFAULT_BUTTONS = ["OK"];

export function SelectDialogView({ entry, updateEntry }: SelectDialogViewProps) {
    const vm = useLogViewModel();
    const resolved = entry.button !== undefined;
    const buttons = entry.buttons ?? DEFAULT_BUTTONS;

    const handleSelect = useCallback(
        (value?: string) => {
            updateEntry((draft) => {
                draft.selected = value;
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

    const requirementNotMet = !entry.selected;

    return (
        <DialogContainer resolved={resolved}>
            <SelectRoot>
                <DialogHeader title={entry.title} />
                <div className="select-control">
                    <ComboSelect
                        selectFrom={entry.items}
                        value={entry.selected}
                        onChange={handleSelect}
                        placeholder={entry.placeholder}
                        disabled={resolved}
                        adjustWithCharWidth={CHAR_WIDTH}
                    />
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    button={entry.button}
                    requirementNotMet={requirementNotMet}
                    onClickButton={handleClick}
                />
            </SelectRoot>
        </DialogContainer>
    );
}
