import { popperState } from "../../../api/dialogs/dialogs-state";
import type { IPopperViewData } from "../../../api/dialogs/dialog-types";
import { ModelViewSlotHost } from "../ModelViewSlotHost";

export class PoppersView extends ModelViewSlotHost<IPopperViewData, IPopperViewData> {
    public constructor(_props: undefined) {
        super(popperState, (popper) => popper);
    }
}
