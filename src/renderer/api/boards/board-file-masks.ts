import { fpBasename, fpDirname } from "../../core/utils/file-path";
import { matchesBoardMaskParts } from "../../../shared/board/board-masks";

export function matchesBoardMasks(
    filePathOrName: string,
    fileMasks: string[],
    folderMasks: string[] = [],
): boolean {
    if (!filePathOrName) return false;
    const folder = /[\\/]/.test(filePathOrName) ? fpDirname(filePathOrName) : undefined;
    return matchesBoardMaskParts(fpBasename(filePathOrName), folder, fileMasks, folderMasks);
}
