import type { ITreeProviderItem } from "../../api/types/io.tree";
import { sameHref } from "./href-utils";

export interface TreeProviderNode {
    data: ITreeProviderItem;
    /** undefined = not loaded (lazy), [] = empty directory */
    items?: TreeProviderNode[];
}

/** Filter out ".." parent navigation entries (used by FileTreeProvider for flat views, not trees). */
export function filterTreeItems(items: ITreeProviderItem[]): ITreeProviderItem[] {
    return items.filter((item) => item.title !== "..");
}

export function toNode(item: ITreeProviderItem): TreeProviderNode {
    return {
        data: item,
        // directories: items = undefined (lazy), files: no items needed
    };
}

export function findNode(
    tree: TreeProviderNode | null | undefined,
    href: string,
    equals: (left: string, right: string) => boolean = sameHref,
): TreeProviderNode | null {
    if (!tree) return null;
    if (equals(tree.data.href, href)) return tree;
    if (tree.items) {
        for (const child of tree.items) {
            const found = findNode(child, href, equals);
            if (found) return found;
        }
    }
    return null;
}

export function findParent(tree: TreeProviderNode | null, href: string): TreeProviderNode | null {
    if (!tree || !tree.items) return null;
    for (const child of tree.items) {
        if (sameHref(child.data.href, href)) return tree;
        const found = findParent(child, href);
        if (found) return found;
    }
    return null;
}

export function updateNodeChildren(
    node: TreeProviderNode,
    href: string,
    children: TreeProviderNode[],
): TreeProviderNode {
    if (sameHref(node.data.href, href)) {
        return { ...node, items: children };
    }
    if (node.items) {
        return {
            ...node,
            items: node.items.map(child => updateNodeChildren(child, href, children)),
        };
    }
    return node;
}
