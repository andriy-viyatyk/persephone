export interface BoardExplorerRootCandidates {
    workingFolder?: string;
    claimedFolder?: string;
    fileFolder?: string;
    boardRoot?: string;
}

/** Resolve a new Explorer's root for a board page without changing folder-claim semantics. */
export async function resolveBoardExplorerRoot(
    candidates: BoardExplorerRootCandidates,
    isDirectory: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
    if (candidates.workingFolder && await isDirectory(candidates.workingFolder)) {
        return candidates.workingFolder;
    }
    return candidates.claimedFolder || candidates.fileFolder || candidates.boardRoot;
}
