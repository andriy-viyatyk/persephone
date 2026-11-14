import { showDialog } from "./dialogs-state";
import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";

export const namespaceCollisionDialogId = Symbol("namespaceCollisionDialog");

export interface NamespaceCollisionDialogProps {
    namespace: string; // the colliding "author/name" namespace, for display
    collidingRoot: string; // absolute root path of the already-trusted board using it
}

export function showNamespaceCollisionDialog(namespace: string, collidingRoot: string) {
    const model = new TDialogModel<NamespaceCollisionDialogProps, boolean>(
        new TComponentState({ namespace, collidingRoot }),
    );
    return showDialog({
        viewId: namespaceCollisionDialogId,
        model,
    }) as Promise<boolean>;
}
