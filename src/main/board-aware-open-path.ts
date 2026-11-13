import { shell } from "electron";
import { BoardGrant } from "../shared/board/board-grant";
import { boardTrustService } from "./board-trust-service";

export async function openPath(path: string, boardRoot?: string): Promise<string> {
    if (boardRoot && !(await boardTrustService.allows(boardRoot, "openExternal"))) throw BoardGrant.deny("openExternal");
    return shell.openPath(path);
}
