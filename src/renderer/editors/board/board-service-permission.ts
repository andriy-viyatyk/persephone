import { boardTrust } from "../../api/board-trust";
import {
    normalizePermissions,
    type BoardManifest,
} from "./board-manifest";

/** True exactly when a trusted board declares the service lifecycle permission. */
export function canStartBoardService(
    boardRoot: string,
    manifest: BoardManifest | null | undefined,
): boolean {
    return boardTrust.isTrusted(boardRoot)
        && normalizePermissions(manifest?.permissions).includes("service");
}
