import { boardTrust, diffBoardPermissions } from "../../api/board-trust";
import { confirmNamespaceNotColliding } from "../../api/board-namespace";
import { showBoardPermissionChangeDialog, showTrustBoardDialog } from "../../ui/dialogs/TrustBoardDialog";
import { boardTrustDisclosure, readNormalizedBoardManifest } from "./board-manifest";
import { bundledBoardRegistry } from "./bundled-board-registry";
import { errMessage } from "../../../shared/utils";
import { fpBasename, fpNormalizeForCompare } from "../../core/utils/file-path";

/** In-flight trust requests by board root, so concurrent opens/reloads of the same board share
 *  one dialog instead of stacking a copy per caller. */
const pendingRequests = new Map<string, Promise<boolean>>();

/** Request permission for a board, returning true when its root is permitted. */
export function requestBoardTrust(boardRoot: string): Promise<boolean> {
    const key = fpNormalizeForCompare(boardRoot);
    const pending = pendingRequests.get(key);
    if (pending) return pending;
    const request = requestBoardTrustOnce(boardRoot)
        .finally(() => pendingRequests.delete(key));
    pendingRequests.set(key, request);
    return request;
}

async function requestBoardTrustOnce(boardRoot: string): Promise<boolean> {
    await bundledBoardRegistry.ensureInitialized();
    if (bundledBoardRegistry.isBundled(boardRoot)) return true;

    await boardTrust.load();
    await boardTrust.refreshPermissionSnapshot();
    const trusted = boardTrust.isTrusted(boardRoot);
    if (trusted) {
        const snapshot = await boardTrust.getPermissionSnapshot(boardRoot);
        if (!snapshot || !snapshot.manifestChanged) return true;
        const proposed = snapshot.manifestPermissions;
        const legacyTransition = snapshot.permissions.kind === "legacy" && proposed.kind === "flags";
        const changes = diffBoardPermissions(snapshot.permissions, proposed);
        const requiresPrompt = legacyTransition
            || snapshot.permissions.kind !== proposed.kind
            || (snapshot.permissions.kind === "legacy" && proposed.kind === "legacy" && proposed.service)
            || changes.some(({ kind }) => kind !== "removed");
        if (!requiresPrompt) return true;
        const manifest = await readNormalizedBoardManifest(boardRoot);
        const boardName = manifest?.name?.trim() || fpBasename(boardRoot);
        for (;;) {
            const choice = await showBoardPermissionChangeDialog(boardRoot, {
                boardName,
                permissions: proposed,
                serviceDeclared: false,
                capabilities: [],
                change: { granted: snapshot.permissions, proposed, changes, legacyTransition },
            });
            // Closed without a decision: the board does not run, and comes off its pages. The
            // dialog appears again on the next open.
            if (choice === undefined) {
                const { removeBoardFromPages } = await import("../../api/board-updates");
                await removeBoardFromPages(boardRoot);
                return false;
            }
            if (choice === "unregister") {
                if (await removeBoard(boardRoot, boardName)) return false;
                continue;
            }
            try {
                await boardTrust.trust(boardRoot, proposed);
                return true;
            } catch (error) {
                if (!errMessage(error).includes("Board permissions changed while the trust dialog was open")) throw error;
                await boardTrust.load();
                return requestBoardTrustOnce(boardRoot);
            }
        }
    }

    const manifest = await readNormalizedBoardManifest(boardRoot);
    const disclosure = manifest
        ? boardTrustDisclosure(manifest)
        : { permissions: { kind: "legacy" as const, service: false }, serviceDeclared: false, capabilities: [] as string[] };
    const boardName = manifest?.name?.trim() || fpBasename(boardRoot);
    const accepted = await showTrustBoardDialog(boardRoot, { ...disclosure, boardName });
    if (!accepted) return false;
    if (!(await confirmNamespaceNotColliding(boardRoot))) return false;

    try {
        await boardTrust.trust(boardRoot, disclosure.permissions);
        return true;
    } catch (error) {
        if (!errMessage(error).includes("Board permissions changed while the trust dialog was open")) throw error;
        await boardTrust.load();
        return requestBoardTrustOnce(boardRoot);
    }
}

/** "Unregister board" from the permission-change dialog: a catalog install is uninstalled (its
 *  folder deleted, after its own confirmation); a local board is untrusted (which unloads it
 *  from its pages) and its folder kept.
 *  Returns false when the user backs out, so the change dialog is shown again. */
async function removeBoard(boardRoot: string, boardName: string): Promise<boolean> {
    const { boardInstallRegistry } = await import("../../api/board-install-registry");
    await boardInstallRegistry.load();
    const installed = boardInstallRegistry.getByRoot(boardRoot);
    if (installed) {
        const { uninstallCatalogBoard } = await import("../../api/board-install");
        return uninstallCatalogBoard({ root: boardRoot, name: boardName, catalogId: installed.id });
    }
    await boardTrust.untrust(boardRoot);
    const { removePin } = await import("../../ui/sidebar/pinned-items");
    removePin({ kind: "board", root: boardRoot });
    return true;
}
