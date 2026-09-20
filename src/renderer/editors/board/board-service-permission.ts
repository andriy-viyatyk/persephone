import { isBoardPermitted } from "./board-access";
import {
    normalizePermissions,
    type BoardManifest,
} from "./board-manifest";

/** True exactly when a permitted board declares the service lifecycle permission. */
export function canStartBoardService(
    boardRoot: string,
    manifest: BoardManifest | null | undefined,
): boolean {
    return isBoardPermitted(boardRoot)
        && normalizePermissions(manifest?.permissions).includes("service");
}
