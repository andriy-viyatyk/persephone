import { fpBasename, fpDirname } from "../../core/utils/file-path";
import { matchesBoardMaskParts } from "../../../shared/board/board-masks";
import { isWindows } from "../../../shared/platform";

export function matchesBoardMasks(
    filePathOrName: string,
    fileMasks: string[],
    folderMasks: string[] = [],
): boolean {
    if (!filePathOrName) return false;
    const hasPathSeparator = filePathOrName.includes("/") || (isWindows && filePathOrName.includes("\\"));
    const folder = hasPathSeparator ? fpDirname(filePathOrName) : undefined;
    return matchesBoardMaskParts(fpBasename(filePathOrName), folder, fileMasks, folderMasks);
}
