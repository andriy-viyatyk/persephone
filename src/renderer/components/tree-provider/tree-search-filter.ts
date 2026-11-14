import { hrefKey } from "./href-utils";
import type { TreeProviderNode } from "./tree-provider-node";

export function matchesSearchWords(title: string, words: string[]): boolean {
    const nameLower = title.toLowerCase();
    return words.every(word => nameLower.includes(word));
}

export function getExpandedPaths(expandedMap: Record<string, boolean>): Set<string> {
    return new Set(
        Object.entries(expandedMap)
            .filter(([, expanded]) => expanded)
            .map(([id]) => hrefKey(id)),
    );
}

function filterDirectoriesOnly(node: TreeProviderNode): TreeProviderNode {
    return {
        ...node,
        items: node.items
            ?.filter(child => child.data.isDirectory)
            .map(filterDirectoriesOnly),
    };
}

function filterTreeDeep(
    node: TreeProviderNode,
    words: string[],
): TreeProviderNode {
    return {
        ...node,
        items: filterChildrenDeep(node.items, words),
    };
}

function filterChildrenDeep(
    items: TreeProviderNode[] | undefined,
    words: string[],
): TreeProviderNode[] {
    if (!items) return [];
    const result: TreeProviderNode[] = [];
    for (const item of items) {
        if (item.data.isDirectory) {
            const filteredChildren = filterChildrenDeep(item.items, words);
            if (filteredChildren.length > 0) {
                result.push({ ...item, items: filteredChildren });
            }
        } else {
            if (matchesSearchWords(item.data.title, words)) {
                result.push(item);
            }
        }
    }
    return result;
}

function filterTreeShallow(
    node: TreeProviderNode,
    words: string[],
    expandedPaths: Set<string>,
): TreeProviderNode {
    return {
        ...node,
        items: filterChildrenShallow(node.items, words, expandedPaths),
    };
}

function filterChildrenShallow(
    items: TreeProviderNode[] | undefined,
    words: string[],
    expandedPaths: Set<string>,
): TreeProviderNode[] {
    if (!items) return [];
    const result: TreeProviderNode[] = [];
    for (const item of items) {
        if (item.data.isDirectory) {
            if (expandedPaths.has(hrefKey(item.data.href))) {
                result.push({
                    ...item,
                    items: filterChildrenShallow(item.items, words, expandedPaths),
                });
            } else {
                result.push(item);
            }
        } else {
            if (matchesSearchWords(item.data.title, words)) {
                result.push(item);
            }
        }
    }
    return result;
}

export function computeDisplayTree(
    tree: TreeProviderNode | null,
    query: string,
    showLinks: boolean,
    expandedKeys: Set<string>,
): TreeProviderNode | null {
    if (!tree) return null;

    let result = tree;

    // Apply showLinks filter
    if (!showLinks) {
        result = filterDirectoriesOnly(result);
    }

    // Apply search filter
    if (query) {
        const words = query.toLowerCase().split(" ").filter(Boolean);
        if (words.length > 0) {
            if (query.length >= 3) {
                result = filterTreeDeep(result, words);
            } else {
                result = filterTreeShallow(result, words, expandedKeys);
            }
        }
    }

    return result;
}
