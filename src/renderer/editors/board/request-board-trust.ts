import { boardTrust } from "../../api/board-trust";
import { confirmNamespaceNotColliding } from "../../api/board-namespace";
import { showTrustBoardDialog } from "../../ui/dialogs/TrustBoardDialog";
import { boardTrustDisclosure, readNormalizedBoardManifest } from "./board-manifest";
import { bundledBoardRegistry } from "./bundled-board-registry";

/** Request permission for a board, returning true when its root is permitted. */
export async function requestBoardTrust(boardRoot: string): Promise<boolean> {
    await bundledBoardRegistry.ensureInitialized();
    if (bundledBoardRegistry.isBundled(boardRoot)) return true;

    await boardTrust.load();
    if (boardTrust.isTrusted(boardRoot)) return true;

    const manifest = await readNormalizedBoardManifest(boardRoot);
    const accepted = await showTrustBoardDialog(boardRoot, manifest
        ? boardTrustDisclosure(manifest)
        : { permissions: { kind: "legacy", service: false }, serviceDeclared: false, capabilities: [] });
    if (!accepted) return false;
    if (!(await confirmNamespaceNotColliding(boardRoot))) return false;

    await boardTrust.trust(boardRoot);
    return true;
}
