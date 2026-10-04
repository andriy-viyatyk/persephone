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
    boardName: string;
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

/** First trust resolves `true`/`false`; a permission change resolves `"accept"` / `"unregister"`.
 *  A dialog dismissed without a button (agent `cancel()`) resolves `undefined`. */
export type TrustBoardDialogResult = boolean | "accept" | "unregister";

function openTrustBoardDialog(
    boardPath: string,
    disclosure: Omit<TrustBoardDialogProps, "boardPath">,
): Promise<TrustBoardDialogResult | undefined> {
    const model = new TDialogModel<TrustBoardDialogProps, TrustBoardDialogResult>(
        new TComponentState({ boardPath, ...disclosure }),
    );
    return showDialog({
        viewId: trustBoardDialogId,
        model,
    }) as Promise<TrustBoardDialogResult | undefined>;
}

/** "Trust this board?" for a board that is not trusted yet. */
export async function showTrustBoardDialog(
    boardPath: string,
    disclosure: Omit<TrustBoardDialogProps, "boardPath" | "change">,
): Promise<boolean> {
    return (await openTrustBoardDialog(boardPath, disclosure)) === true;
}

/** "Board permissions changed" for a trusted board whose manifest widened its permissions.
 *  There is no cancel: the user accepts the new set or unregisters the board. */
export async function showBoardPermissionChangeDialog(
    boardPath: string,
    disclosure: Omit<TrustBoardDialogProps, "boardPath"> & { change: NonNullable<TrustBoardDialogProps["change"]> },
): Promise<"accept" | "unregister" | undefined> {
    const result = await openTrustBoardDialog(boardPath, disclosure);
    return result === "accept" || result === "unregister" ? result : undefined;
}
