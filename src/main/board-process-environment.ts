import path from "node:path";
import { app } from "electron";
import { BoardRoot } from "../shared/board/board-root";
import { boardDataIdFromRoot } from "../shared/board/board-data-id";
import { applicationProfileName } from "./application-profile";
import { bundledBoardId } from "./bundled-boards";
import { isTestInstance } from "./test-mode/instance-options";
import { applyBoardProcessSandbox } from "./test-mode/board-process-sandbox";

/** Return the board's profile-scoped data path, or undefined when it cannot be derived. */
export function boardDataPath(boardRoot: string): string | undefined {
    const root = BoardRoot.tryFrom(boardRoot);
    if (!root) return undefined;
    const boardId = boardDataIdFromRoot(root, bundledBoardId(root));
    if (!boardId) return undefined;

    let dataRoot: string;
    if (applicationProfileName() || isTestInstance()) {
        dataRoot = path.join(app.getPath("userData"), "board-data");
    } else {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData || !path.isAbsolute(localAppData)) return undefined;
        dataRoot = path.join(localAppData, "Persephone", "board-data");
    }
    return path.join(dataRoot, boardId);
}

/** Add the host-selected board data path, removing any caller-provided value first. */
export function boardProcessEnvironment(base: NodeJS.ProcessEnv, boardRoot: string): NodeJS.ProcessEnv {
    const environment = { ...base };
    delete environment.PERSEPHONE_BOARD_DATA;
    const boardData = boardDataPath(boardRoot);
    if (boardData) environment.PERSEPHONE_BOARD_DATA = boardData;
    applyBoardProcessSandbox(environment);
    return environment;
}
