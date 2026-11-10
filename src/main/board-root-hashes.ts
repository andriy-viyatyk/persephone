import { createHash } from "node:crypto";
import type { BoardRoot } from "../shared/board/board-root";

function sha256Hex(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

/** Storage folder and capability provider id for a non-bundled board. */
export function boardRootDigest(root: BoardRoot): string {
    return sha256Hex(root.digestInputs.storage);
}

/** Bundled storage folder. Windows storage keys historically lower-cased the bundled id. */
export function bundledBoardDigest(bundledId: string): string {
    return sha256Hex(`bundled:${process.platform === "win32" ? bundledId.toLowerCase() : bundledId}`);
}

/** The board:// origin host. */
export function boardHost(root: BoardRoot): string {
    return `b${sha256Hex(root.digestInputs.host).slice(0, 20)}`;
}

/** Window state, AppUserModelID and icon file name. */
export function boardWindowKey(root: BoardRoot): string {
    return sha256Hex(root.digestInputs.window);
}

/** Was the inline board window-state key. */
export function boardWindowStateKey(root: BoardRoot): string {
    return `boardWindowState.${boardWindowKey(root)}`;
}

/** Was localCallerId. */
export function boardLocalCallerId(root: BoardRoot): string {
    return `local:${sha256Hex(root.key)}`;
}
