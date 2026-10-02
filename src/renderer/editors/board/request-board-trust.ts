import { boardTrust, diffBoardPermissions } from "../../api/board-trust";
import { confirmNamespaceNotColliding } from "../../api/board-namespace";
import { showTrustBoardDialog } from "../../ui/dialogs/TrustBoardDialog";
import { boardTrustDisclosure, readNormalizedBoardManifest } from "./board-manifest";
import { bundledBoardRegistry } from "./bundled-board-registry";
import { errMessage } from "../../../shared/utils";
import { fpNormalizeForCompare } from "../../core/utils/file-path";

/** In-flight trust requests by board root, so concurrent opens/reloads of the same board share
 *  one dialog instead of stacking a copy per caller. */
const pendingRequests = new Map<string, Promise<boolean>>();

/** Request permission for a board, returning true when its root is permitted. */
export function requestBoardTrust(boardRoot: string, forceReview = false): Promise<boolean> {
    const key = `${fpNormalizeForCompare(boardRoot)}|${forceReview}`;
    const pending = pendingRequests.get(key);
    if (pending) return pending;
    const request = requestBoardTrustOnce(boardRoot, forceReview)
        .finally(() => pendingRequests.delete(key));
    pendingRequests.set(key, request);
    return request;
}

async function requestBoardTrustOnce(boardRoot: string, forceReview: boolean): Promise<boolean> {
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
        if (!forceReview && boardTrust.hasDeclinedProposal(boardRoot, proposed)) return true;
        const accepted = await showTrustBoardDialog(boardRoot, {
            permissions: proposed,
            serviceDeclared: false,
            capabilities: [],
            change: { granted: snapshot.permissions, proposed, changes, legacyTransition },
        });
        if (!accepted) {
            boardTrust.rememberDeclinedProposal(boardRoot, proposed);
            return true;
        }
        try {
            await boardTrust.trust(boardRoot, proposed);
            return true;
        } catch (error) {
            if (!errMessage(error).includes("Board permissions changed while the trust dialog was open")) throw error;
            await boardTrust.load();
            return requestBoardTrustOnce(boardRoot, true);
        }
    }

    const manifest = await readNormalizedBoardManifest(boardRoot);
    const disclosure = manifest
        ? boardTrustDisclosure(manifest)
        : { permissions: { kind: "legacy" as const, service: false }, serviceDeclared: false, capabilities: [] as string[] };
    const accepted = await showTrustBoardDialog(boardRoot, disclosure);
    if (!accepted) return false;
    if (!(await confirmNamespaceNotColliding(boardRoot))) return false;

    try {
        await boardTrust.trust(boardRoot, disclosure.permissions);
        return true;
    } catch (error) {
        if (!errMessage(error).includes("Board permissions changed while the trust dialog was open")) throw error;
        await boardTrust.load();
        return requestBoardTrustOnce(boardRoot, true);
    }
}
