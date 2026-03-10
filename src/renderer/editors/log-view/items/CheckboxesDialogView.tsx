import styled from "@emotion/styled";
import { useCallback } from "react";
import { CheckboxesEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";
import { Checkbox } from "../../../components/basic/Checkbox";
import { DIALOG_CONTENT_MAX_HEIGHT } from "../logConstants";

// =============================================================================
// Styled Components
// =============================================================================

const CheckboxesRoot = styled.div({
    minWidth: 200,

    "& .checkbox-list": {
        display: "flex",
        padding: "4px 8px",
        gap: 2,
        maxHeight: DIALOG_CONTENT_MAX_HEIGHT,
        overflowY: "auto",

        "&.vertical": {
            flexDirection: "column",
        },
        "&.flex": {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
        },
    },

    "& .checkbox-item": {
        fontSize: 14,
        lineHeight: "22px",
    },
});

// =============================================================================
// Component
// =============================================================================

interface CheckboxesDialogViewProps {
    entry: CheckboxesEntry;
    updateEntry: (updater: (draft: CheckboxesEntry) => void) => void;
}

const DEFAULT_BUTTONS = ["OK"];

export function CheckboxesDialogView({ entry, updateEntry }: CheckboxesDialogViewProps) {
    const vm = useLogViewModel();
    const resolved = entry.button !== undefined;
    const buttons = entry.buttons ?? DEFAULT_BUTTONS;
    const layout = entry.layout ?? "vertical";

    const handleToggle = useCallback(
        (index: number) => {
            updateEntry((draft) => {
                draft.items[index].checked = !draft.items[index].checked;
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

    const requirementNotMet = entry.items.every((item) => !item.checked);

    return (
        <DialogContainer resolved={resolved}>
            <CheckboxesRoot>
                <DialogHeader title={entry.title} />
                <div className={`checkbox-list ${layout}`}>
                    {entry.items.map((item, i) => (
                        <Checkbox
                            key={i}
                            className="checkbox-item"
                            checked={item.checked}
                            disabled={resolved}
                            onChange={() => handleToggle(i)}
                        >
                            {item.label}
                        </Checkbox>
                    ))}
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    button={entry.button}
                    requirementNotMet={requirementNotMet}
                    onClickButton={handleClick}
                />
            </CheckboxesRoot>
        </DialogContainer>
    );
}
