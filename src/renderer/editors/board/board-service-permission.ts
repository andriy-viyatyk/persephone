import { isBoardPermitted } from "./board-access";
import { boardTrust } from "../../api/board-trust";

/** True exactly when a permitted board declares the service lifecycle permission. */
export async function canStartBoardService(boardRoot: string): Promise<boolean> {
    return isBoardPermitted(boardRoot) && boardTrust.allows(boardRoot, "service");
}
