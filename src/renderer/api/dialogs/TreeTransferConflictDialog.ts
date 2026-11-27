import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import type { TreeConflictAction, TreeTransferConflict, TreeTransferConflictChoice } from "../../content/tree-providers/TreeTransfer";
import { showDialog } from "./dialogs-state";

export const treeTransferConflictDialogId = Symbol("treeTransferConflictDialog");

export interface TreeTransferConflictDialogState {
    conflict: TreeTransferConflict;
    applyToAll: boolean;
}

export class TreeTransferConflictDialogModel extends TDialogModel<TreeTransferConflictDialogState, TreeTransferConflictChoice | undefined> {
    private readonly signal: AbortSignal;
    private readonly cancelTransfer: () => void;
    private readonly abortHandler = () => { void this.close(undefined); };

    constructor(state: TComponentState<TreeTransferConflictDialogState>, signal: AbortSignal, cancelTransfer: () => void) {
        super(state);
        this.signal = signal;
        this.cancelTransfer = cancelTransfer;
        signal.addEventListener("abort", this.abortHandler, { once: true });
    }

    setApplyToAll = (applyToAll: boolean) => this.state.update((state) => { state.applyToAll = applyToAll; });
    choose = (action: TreeConflictAction) => {
        this.signal.removeEventListener("abort", this.abortHandler);
        return this.close({ action, applyToAll: this.state.get().applyToAll });
    };
    cancel = () => {
        this.cancelTransfer();
        if (!this.signal.aborted) void this.close(undefined);
    };
    disposeView = () => this.signal.removeEventListener("abort", this.abortHandler);
}

export function showTreeTransferConflictDialog(
    conflict: TreeTransferConflict,
    signal: AbortSignal,
    cancelTransfer: () => void,
): Promise<TreeTransferConflictChoice | undefined> {
    const model = new TreeTransferConflictDialogModel(
        new TComponentState({ conflict, applyToAll: false }), signal, cancelTransfer,
    );
    return showDialog({ viewId: treeTransferConflictDialogId, model }) as Promise<TreeTransferConflictChoice | undefined>;
}
