import { showDialog } from "./Dialogs";
import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import { registerDialogView } from "./dialog-view-registry";
import { TrustBoardDialogView } from "./TrustBoardDialogView";
import type { NormalizedBoardPermissions } from "../../../shared/board-manifest-utils";
import type { BoardPermissionChange } from "../../api/board-trust";

export const trustBoardDialogId = Symbol("trustBoardDialog");

export interface TrustBoardDialogProps {
    boardPath: string; // absolute board-root path, for display
    permissions: NormalizedBoardPermissions;
    serviceDeclared: boolean;
    capabilities: readonly string[];
    change?: {
        granted: NormalizedBoardPermissions;
        proposed: NormalizedBoardPermissions;
        changes: readonly BoardPermissionChange[];
        legacyTransition?: boolean;
    };
}

registerDialogView(trustBoardDialogId, TrustBoardDialogView);

export async function showTrustBoardDialog(
    boardPath: string,
    disclosure: Omit<TrustBoardDialogProps, "boardPath">,
): Promise<boolean> {
    const model = new TDialogModel<TrustBoardDialogProps, boolean>(
        new TComponentState({ boardPath, ...disclosure }),
    );
    return showDialog({
        viewId: trustBoardDialogId,
        model,
    }) as Promise<boolean>;
}
