import fs from "node:fs";
import path from "node:path";
import { BoardRoot } from "../shared/board/board-root";
import { getAssetPath } from "./utils";

export interface BundledBoard { readonly id: string; readonly root: BoardRoot }

export function bundledBoardsFolder(): BoardRoot {
    return BoardRoot.from(getAssetPath("boards"));
}

export function bundledBoardId(root: BoardRoot): string | undefined {
    return root.bundledId(bundledBoardsFolder());
}

/** Bundled board folders under assets/boards, sorted by id. Folders only; the caller decides what a missing manifest means. */
export async function listBundledBoards(): Promise<BundledBoard[]> {
    const folder = bundledBoardsFolder();
    try {
        const entries = await fs.promises.readdir(folder.path, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory())
            .map((entry) => ({ id: entry.name, root: BoardRoot.from(path.join(folder.path, entry.name)) }))
            .sort((left, right) => left.id.localeCompare(right.id));
    } catch {
        return [];
    }
}
