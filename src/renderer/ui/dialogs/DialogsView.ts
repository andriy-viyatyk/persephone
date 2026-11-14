import { dialogsState } from "../../api/dialogs/dialogs-state";
import type { IDialogViewData } from "../../api/dialogs/dialog-types";
import { ModelViewSlotHost } from "./ModelViewSlotHost";

export class DialogsView extends ModelViewSlotHost<IDialogViewData, string> {
    public constructor(_props: undefined) {
        super(dialogsState, (dialog) => dialog.internalId ?? dialog.viewId.toString());
    }
}
