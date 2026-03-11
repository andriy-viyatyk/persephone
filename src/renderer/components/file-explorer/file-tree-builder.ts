import { TreeItem } from "../TreeView";

import { fpBasename, fpExtname, fpJoin } from "../../core/utils/file-path";
import { fs } from "../../api/fs";

export interface FileTreeItem extends TreeItem<FileTreeItem> {
    label: string;
    filePath: string;
    isFolder: boolean;
    extension?: string;
    items?: FileTreeItem[];
}

export type FileSortType = "type" | "name";

/** Folders/files to always ignore */
const DEFAULT_IGNORE = new Set([
    ".git",
    "node_modules",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
]);

/**
 * Build a file tree from the filesystem.
 * Returns a root FileTreeItem with children, suitable for TreeView.
 */
export async function buildFileTree(
    rootPath: string,
    sortType: FileSortType = "type",
    maxDepth = 1,
): Promise<FileTreeItem> {
    const rootLabel = fpBasename(rootPath);
    const root: FileTreeItem = {
        label: rootLabel,
        filePath: rootPath,
        isFolder: true,
        items: [],
    };

    root.items = await readDirectoryItems(rootPath, sortType, maxDepth, 0);
    return root;
}

/**
 * Load direct children of a folder (1 level deep).
 * Used for lazy loading — folders in the result will have items: undefined (not yet loaded).
 */
export async function loadFolderChildren(
    folderPath: string,
    sortType: FileSortType = "type",
): Promise<FileTreeItem[]> {
    return readDirectoryItems(folderPath, sortType, 1, 0);
}

/**
 * Shallow filter: remove non-matching files from expanded folders only.
 * Collapsed folders are kept as-is. All folders are preserved (never removed)
 * to maintain tree structure stability.
 */
export function filterTreeShallow(
    root: FileTreeItem,
    searchWords: string[],
    expandedPaths: Set<string>,
): FileTreeItem {
    return {
        ...root,
        items: filterChildrenShallow(root.items, searchWords, expandedPaths),
    };
}

function filterChildrenShallow(
    items: FileTreeItem[] | undefined,
    searchWords: string[],
    expandedPaths: Set<string>,
): FileTreeItem[] {
    if (!items) return [];

    const result: FileTreeItem[] = [];
    for (const item of items) {
        if (item.isFolder) {
            if (expandedPaths.has(item.filePath)) {
                result.push({
                    ...item,
                    items: filterChildrenShallow(item.items, searchWords, expandedPaths),
                });
            } else {
                result.push(item);
            }
        } else {
            const labelLower = item.label.toLowerCase();
            if (searchWords.every(w => labelLower.includes(w))) {
                result.push(item);
            }
        }
    }
    return result;
}

/**
 * Deep filter: search all files across entire tree.
 * Returns only matching files and their ancestor folders.
 * Empty folders with no matching descendants are removed.
 */
export function filterTreeDeep(
    root: FileTreeItem,
    searchWords: string[],
): FileTreeItem {
    return {
        ...root,
        items: filterChildrenDeep(root.items, searchWords),
    };
}

function filterChildrenDeep(
    items: FileTreeItem[] | undefined,
    searchWords: string[],
): FileTreeItem[] {
    if (!items) return [];

    const result: FileTreeItem[] = [];
    for (const item of items) {
        if (item.isFolder) {
            const filteredChildren = filterChildrenDeep(item.items, searchWords);
            if (filteredChildren.length > 0) {
                result.push({ ...item, items: filteredChildren });
            }
        } else {
            const labelLower = item.label.toLowerCase();
            if (searchWords.every(w => labelLower.includes(w))) {
                result.push(item);
            }
        }
    }
    return result;
}

/**
 * Filter tree to keep only files whose paths are in the given set,
 * plus their ancestor folders. Used for external content-search filtering.
 */
export function filterTreeByPaths(
    root: FileTreeItem,
    filterPaths: Set<string>,
): FileTreeItem {
    return {
        ...root,
        items: filterChildrenByPaths(root.items, filterPaths),
    };
}

function filterChildrenByPaths(
    items: FileTreeItem[] | undefined,
    filterPaths: Set<string>,
): FileTreeItem[] {
    if (!items) return [];

    const result: FileTreeItem[] = [];
    for (const item of items) {
        if (item.isFolder) {
            const filteredChildren = filterChildrenByPaths(item.items, filterPaths);
            if (filteredChildren.length > 0) {
                result.push({ ...item, items: filteredChildren });
            }
        } else {
            if (filterPaths.has(item.filePath)) {
                result.push(item);
            }
        }
    }
    return result;
}

async function readDirectoryItems(
    dirPath: string,
    sortType: FileSortType,
    maxDepth: number,
    currentDepth: number,
): Promise<FileTreeItem[]> {
    if (currentDepth >= maxDepth) {
        return [];
    }

    let entries: { name: string; isDirectory: boolean }[];
    try {
        entries = await fs.listDirWithTypes(dirPath);
    } catch {
        return [];
    }

    const folders: FileTreeItem[] = [];
    const files: FileTreeItem[] = [];

    for (const entry of entries) {
        if (DEFAULT_IGNORE.has(entry.name)) continue;

        const fullPath = fpJoin(dirPath, entry.name);

        if (entry.isDirectory) {
            const atDepthLimit = currentDepth + 1 >= maxDepth;
            const children = atDepthLimit
                ? undefined
                : await readDirectoryItems(fullPath, sortType, maxDepth, currentDepth + 1);
            folders.push({
                label: entry.name,
                filePath: fullPath,
                isFolder: true,
                items: children,
            });
        } else {
            const ext = fpExtname(entry.name).toLowerCase();
            files.push({
                label: entry.name,
                filePath: fullPath,
                isFolder: false,
                extension: ext || undefined,
            });
        }
    }

    // Folders always first, sorted alphabetically by name
    folders.sort((a, b) => a.label.localeCompare(b.label));

    // Files sorted based on sortType
    if (sortType === "type") {
        files.sort((a, b) => {
            const extA = a.extension ?? "";
            const extB = b.extension ?? "";
            const extCmp = extA.localeCompare(extB);
            if (extCmp !== 0) return extCmp;
            return a.label.localeCompare(b.label);
        });
    } else {
        files.sort((a, b) => a.label.localeCompare(b.label));
    }

    return [...folders, ...files];
}
