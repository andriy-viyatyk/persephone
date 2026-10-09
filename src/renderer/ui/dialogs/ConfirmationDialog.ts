import { showDialog } from "./Dialogs";
import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import { registerDialogView } from "./dialog-view-registry";
import { ConfirmationDialogView } from "./ConfirmationDialogView";
import { DialogButton, dialogButton, normalizeDialogButton, type DialogButtonInput } from "./dialog-buttons";

export const confirmationDialogId = Symbol("confirmationDialog");

export interface ConfirmationDialogProps {
    title?: string;
    message: string;
    buttons?: DialogButtonInput[];
}

const defaultConfirmationDialogProps: ConfirmationDialogProps = {
    title: undefined,
    message: "",
    buttons: [dialogButton(DialogButton.yes), dialogButton(DialogButton.cancel)],
};

registerDialogView(confirmationDialogId, ConfirmationDialogView);

export function showConfirmationDialog(props: ConfirmationDialogProps) {
    const modelState = {
        ...defaultConfirmationDialogProps,
        ...props,
    };

    modelState.buttons = modelState.buttons?.map(normalizeDialogButton);

    const model = new TDialogModel<ConfirmationDialogProps, string>(new TComponentState(modelState));
    return showDialog({
        viewId: confirmationDialogId,
        model,
    }) as Promise<string>;
}
