import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import { showDialog } from "./Dialogs";
import { registerDialogView } from "./dialog-view-registry";
import { InputDialogView } from "./InputDialogView";
import { DialogButton, dialogButton, dialogButtonLabel, normalizeDialogButton, type DialogButtonInput } from "./dialog-buttons";

export const inputDialogId = Symbol("inputDialog");

export interface InputDialogProps {
    title?: string;
    message: string;
    value?: string;
    buttons?: DialogButtonInput[];
    selectAll?: boolean;
    defaultButton?: string;
    /** Optional radio button options rendered below the input field. */
    options?: string[];
    /** Initially selected option (must match one of `options`). */
    selectedOption?: string;
}

const defaultInputDialogProps: InputDialogProps = {
    title: undefined,
    message: "",
    value: "",
    buttons: [dialogButton(DialogButton.ok), dialogButton(DialogButton.cancel)],
    selectAll: false,
    defaultButton: undefined,
};

export interface InputResult {
    value: string;
    button: string;
    buttonLabel: string;
    selectedOption?: string;
}

class InputDialogModel extends TDialogModel<InputDialogProps, InputResult | undefined> {
    handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const state = this.state.get();
            if (!state.buttons || state.buttons.length === 0 || !state.value?.trim()) {
                return;
            }
            const buttons = (state.buttons ?? []).map(normalizeDialogButton);
            const defBt = state.defaultButton || buttons[0]?.id || DialogButton.ok;
            const selected = buttons.find(({ id }) => id === defBt);
            this.close({ value: state.value || "", button: defBt, buttonLabel: selected ? dialogButtonLabel(selected) : defBt, selectedOption: state.selectedOption });
        }
    };

    setValue = (value: string) => {
        this.state.update((s) => {
            s.value = value;
        });
    };

    setSelectedOption = (option: string) => {
        this.state.update((s) => {
            s.selectedOption = option;
        });
    };
}

registerDialogView(inputDialogId, InputDialogView);

export function showInputDialog(props: InputDialogProps) {
    const modelState = {
        ...defaultInputDialogProps,
        ...props,
    };
    modelState.buttons = modelState.buttons?.map(normalizeDialogButton);

    const model = new InputDialogModel(new TComponentState(modelState));
    return showDialog({
        viewId: inputDialogId,
        model,
    }) as Promise<InputResult | undefined>;
}
