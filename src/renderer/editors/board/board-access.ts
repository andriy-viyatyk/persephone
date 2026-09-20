import { boardTrust } from "../../api/board-trust";
import { bundledBoardRegistry } from "./bundled-board-registry";

export type BoardPermissionOrigin = "trusted" | "bundled";

/** Return the provenance that currently permits this exact board root, if any. */
export function getBoardPermissionOrigin(boardRoot: string): BoardPermissionOrigin | undefined {
    if (bundledBoardRegistry.isBundled(boardRoot)) return "bundled";
    return boardTrust.isTrusted(boardRoot) ? "trusted" : undefined;
}

/** True when a board is permitted either by the persisted trust list or bundled discovery. */
export function isBoardPermitted(boardRoot: string): boolean {
    return getBoardPermissionOrigin(boardRoot) !== undefined;
}

/** Subscribe to every board-permission source, including future bundled enable/disable changes. */
export function subscribeBoardPermission(listener: () => void): () => void {
    const unsubscribeTrust = boardTrust.subscribePaths(listener);
    const unsubscribeBundled = bundledBoardRegistry.subscribe(listener);
    return () => {
        unsubscribeTrust();
        unsubscribeBundled();
    };
}
