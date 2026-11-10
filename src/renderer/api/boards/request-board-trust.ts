import { boardRegistry } from "./board-registry";
import { BoardRoot } from "../../../shared/board/board-root";
import { BoardGrant } from "../../../shared/board/board-grant";
import { confirmNamespaceNotColliding } from "./board-namespace";
import { showBoardPermissionChangeDialog, showTrustBoardDialog } from "../../ui/dialogs/TrustBoardDialog";
import { boardTrustDisclosure } from "../../../shared/board/board-manifest-queries";
import { readBoardManifest } from "./board-manifest-io";
import { errMessage } from "../../../shared/utils";
import { fpBasename } from "../../core/utils/file-path";
import { boardDisplayText, boardMetadataKeys, ensureBoardDisplayText } from "./board-display-text";
import { boardInstallRegistry } from "./board-install-registry";
import { boardLifecycle } from "./board-lifecycle";

/** In-flight trust requests by board root, so concurrent opens/reloads of the same board share
 *  one dialog instead of stacking a copy per caller. */
const pendingRequests = new Map<string, Promise<boolean>>();

/** Request permission for a board, returning true when its root is permitted. */
export function requestBoardTrust(boardRoot: string): Promise<boolean> {
    const key = BoardRoot.from(boardRoot).key;
    const pending = pendingRequests.get(key);
    if (pending) return pending;
    const request = requestBoardTrustOnce(boardRoot)
        .finally(() => pendingRequests.delete(key));
    pendingRequests.set(key, request);
    return request;
}

async function requestBoardTrustOnce(boardRoot: string): Promise<boolean> {
    await boardRegistry.load();
    if (boardRegistry.isBundled(boardRoot)) return boardRegistry.isPermitted(boardRoot);

    await boardRegistry.reload();
    const trusted = boardRegistry.isTrusted(boardRoot);
    if (trusted) {
        const snapshot = boardRegistry.permissionSnapshot(boardRoot);
        if (!snapshot || !snapshot.manifestChanged) return true;
        const proposed = snapshot.manifestPermissions;
        const grant = BoardGrant.from(snapshot.permissions);
        const proposedGrant = BoardGrant.from(proposed);
        const legacyTransition = grant.isLegacy() && !proposedGrant.isLegacy();
        const changes = grant.diff(proposedGrant);
        const requiresPrompt = grant.widensTo(proposedGrant)
            || snapshot.useChanges.some(({ kind }) => kind === "added");
        if (!requiresPrompt) return true;
        const manifest = await readBoardManifest(boardRoot);
        const englishName = manifest?.name?.trim() || fpBasename(boardRoot);
        if (manifest) await ensureBoardDisplayText(boardRoot, manifest).catch((): void => undefined);
        const boardName = boardDisplayText(boardRoot, manifest, boardMetadataKeys.name, englishName);
        for (;;) {
            const choice = await showBoardPermissionChangeDialog(boardRoot, {
                boardName,
                permissions: proposed,
                serviceDeclared: false,
                capabilities: [],
                serviceInterfaces: [],
                uses: snapshot.manifestUses,
                change: { granted: snapshot.permissions, proposed, changes, legacyTransition, grantedUses: snapshot.uses, proposedUses: snapshot.manifestUses, useChanges: snapshot.useChanges },
            });
            // Closed without a decision: the board does not run, and comes off its pages. The
            // dialog appears again on the next open.
            if (choice === undefined) {
                await boardLifecycle.releasePages(boardRoot);
                return false;
            }
            if (choice === "unregister") {
                if (await removeBoard(boardRoot, boardName)) return false;
                continue;
            }
            try {
                await boardRegistry.trust(boardRoot, proposed, [...snapshot.manifestUses]);
                return true;
            } catch (error) {
                if (!errMessage(error).includes("Board permissions changed while the trust dialog was open")) throw error;
                return requestBoardTrustOnce(boardRoot);
            }
        }
    }

    const manifest = await readBoardManifest(boardRoot);
    if (manifest) await ensureBoardDisplayText(boardRoot, manifest).catch((): void => undefined);
    const disclosure = manifest
        ? boardTrustDisclosure(manifest)
        : { permissions: BoardGrant.fromManifest(undefined).toWire(), serviceDeclared: false, capabilities: [] as string[], serviceInterfaces: [], uses: [] };
    const englishName = manifest?.name?.trim() || fpBasename(boardRoot);
    const boardName = boardDisplayText(boardRoot, manifest, boardMetadataKeys.name, englishName);
    const accepted = await showTrustBoardDialog(boardRoot, { ...disclosure, boardName });
    if (!accepted) return false;
    if (!(await confirmNamespaceNotColliding(boardRoot))) return false;

    try {
        await boardRegistry.trust(boardRoot, disclosure.permissions, [...disclosure.uses]);
        return true;
    } catch (error) {
        if (!errMessage(error).includes("Board permissions changed while the trust dialog was open")) throw error;
        return requestBoardTrustOnce(boardRoot);
    }
}

/** "Unregister board" from the permission-change dialog: a catalog install is uninstalled (its
 *  folder deleted, after its own confirmation); a local board is untrusted and its folder kept.
 *  Returns false when the user backs out, so the change dialog is shown again. */
async function removeBoard(boardRoot: string, boardName: string): Promise<boolean> {
    await boardInstallRegistry.load();
    const installed = boardInstallRegistry.getByRoot(boardRoot);
    if (installed) {
        return boardLifecycle.uninstall(installed.id, boardName);
    }
    return boardLifecycle.unregister(boardRoot, { consented: true });
}
