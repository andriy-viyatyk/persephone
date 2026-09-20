import { showDialog } from "./Dialogs";
import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import { registerDialogView } from "./dialog-view-registry";
import { TrustBoardDialogView } from "./TrustBoardDialogView";
import { normalizeCapabilities, readBoardManifest } from "../../editors/board/board-manifest";

export const trustBoardDialogId = Symbol("trustBoardDialog");

export interface TrustBoardDialogProps {
    boardPath: string; // absolute board-root path, for display
    permissions: readonly string[];
    serviceDeclared: boolean;
    capabilities: readonly string[];
}

registerDialogView(trustBoardDialogId, TrustBoardDialogView);

export async function showTrustBoardDialog(
    boardPath: string,
    disclosure: Omit<TrustBoardDialogProps, "boardPath" | "capabilities">
        & { capabilities?: readonly string[] },
): Promise<boolean> {
    const capabilities = disclosure.capabilities
        ?? normalizeCapabilities((await readBoardManifest(boardPath))?.capabilities).map((declaration) => declaration.id);
    const model = new TDialogModel<TrustBoardDialogProps, boolean>(
        new TComponentState({ boardPath, ...disclosure, capabilities }),
    );
    return showDialog({
        viewId: trustBoardDialogId,
        model,
    }) as Promise<boolean>;
}
