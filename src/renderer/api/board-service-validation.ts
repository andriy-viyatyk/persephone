import { codedError } from "../../shared/coded-error";
import { BoardRoot } from "../../shared/board/board-root";
import { boardRegistry } from "./boards/board-registry";
import { readBoardManifest } from "./boards/board-manifest-io";

/** Validate a main-supplied board root for a trusted host-managed service request. */
export async function validateBoardServiceRoot(boardRoot: unknown): Promise<string> {
    if (typeof boardRoot !== "string" || !boardRoot.trim()) throw codedError("service-exited");
    await boardRegistry.load();
    const root = BoardRoot.tryFrom(boardRoot);
    if (!root) throw codedError("service-exited");
    if (!boardRegistry.isPermitted(boardRoot)) throw codedError("untrusted");
    if (!await readBoardManifest(boardRoot)) throw codedError("service-exited");
    return boardRoot;
}
