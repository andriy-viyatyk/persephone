import styled from "@emotion/styled";
import { useCallback } from "react";
import { RadioboxesEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";
import { Radio } from "../../../components/basic/Radio";
import { DIALOG_CONTENT_MAX_HEIGHT } from "../logConstants";

// =============================================================================
// Styled Components
// =============================================================================

const RadioboxesRoot = styled.div({
    minWidth: 200,

    "& .radio-list": {
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

    "& .radio-item": {
        fontSize: 14,
        lineHeight: "22px",
    },
});

// =============================================================================
// Component
// =============================================================================

interface RadioboxesDialogViewProps {
    entry: RadioboxesEntry;
    updateEntry: (updater: (draft: RadioboxesEntry) => void) => void;
}

const DEFAULT_BUTTONS = ["OK"];

export function RadioboxesDialogView({ entry, updateEntry }: RadioboxesDialogViewProps) {
    const vm = useLogViewModel();
    const resolved = entry.button !== undefined;
    const buttons = entry.buttons ?? DEFAULT_BUTTONS;
    const layout = entry.layout ?? "vertical";

    const handleSelect = useCallback(
        (label: string) => {
            updateEntry((draft) => {
                draft.checked = label;
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

    const requirementNotMet = !entry.checked;

    return (
        <DialogContainer resolved={resolved}>
            <RadioboxesRoot>
                <DialogHeader title={entry.title} />
                <div className={`radio-list ${layout}`}>
                    {entry.items.map((item) => (
                        <Radio
                            key={item}
                            className="radio-item"
                            checked={entry.checked === item}
                            disabled={resolved}
                            onChange={() => handleSelect(item)}
                        >
                            {item}
                        </Radio>
                    ))}
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    button={entry.button}
                    requirementNotMet={requirementNotMet}
                    onClickButton={handleClick}
                />
            </RadioboxesRoot>
        </DialogContainer>
    );
}
