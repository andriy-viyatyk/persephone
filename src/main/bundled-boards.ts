import { BoardRoot } from "../shared/board/board-root";
import { getAssetPath } from "./utils";

export function bundledBoardsFolder(): BoardRoot {
    return BoardRoot.from(getAssetPath("boards"));
}

export function bundledBoardId(root: BoardRoot): string | undefined {
    return root.bundledId(bundledBoardsFolder());
}
