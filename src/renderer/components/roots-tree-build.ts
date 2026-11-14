import { fpRelative, fpSep } from "../core/utils/file-path";

export interface RootsTreeNode<K extends string> {
    value: string;
    label: string;
    kind: "folder" | K;
    root?: string;
    items?: RootsTreeNode<K>[];
}

interface RootsTreeInput {
    root: string;
    label: string;
}

interface RootsTreeOptions<K extends string> {
    leafKind: K;
    leafIdPrefix: string;
}

interface BuildNode {
    label: string;
    pathKey: string;
    children: Map<string, BuildNode>;
    leaf?: { root: string; label: string };
}

function normSeg(segment: string): string {
    return process.platform === "win32" ? segment.toLowerCase() : segment;
}

function sortNodes<K extends string>(nodes: RootsTreeNode<K>[]): void {
    nodes.sort((first, second) => {
        if (first.kind !== second.kind) return first.kind === "folder" ? -1 : 1;
        return first.label.localeCompare(second.label);
    });
}

function convert<K extends string>(
    node: BuildNode,
    options: RootsTreeOptions<K>,
): RootsTreeNode<K> {
    if (node.leaf) {
        return {
            value: options.leafIdPrefix + node.leaf.root,
            label: node.leaf.label,
            kind: options.leafKind,
            root: node.leaf.root,
        };
    }

    let label = node.label;
    let deepest = node;
    while (deepest.children.size === 1) {
        const child = deepest.children.values().next().value as BuildNode;
        if (child.leaf) break;
        label += fpSep + child.label;
        deepest = child;
    }
    const items = [...deepest.children.values()].map(child => convert(child, options));
    sortNodes(items);
    return { value: "dir:" + deepest.pathKey, label, kind: "folder", items };
}

/** Build a compacted tree from labeled roots, keeping topology and keys path-derived. */
export function buildRootsTree<K extends string>(
    roots: RootsTreeInput[],
    baseRoot: string | undefined,
    options: RootsTreeOptions<K>,
): RootsTreeNode<K>[] {
    const rootChildren = new Map<string, BuildNode>();

    for (const { root, label } of roots) {
        let displaySegments: string[];
        let keySegments: string[];
        if (baseRoot) {
            const relativePath = fpRelative(baseRoot, root);
            if (!relativePath || relativePath === "." || relativePath.startsWith("..")) {
                displaySegments = [label];
                keySegments = [root];
            } else {
                displaySegments = relativePath.split(/[\\/]/).filter(Boolean);
                keySegments = [...displaySegments];
                displaySegments[displaySegments.length - 1] = label;
            }
        } else {
            displaySegments = root.split(/[\\/]/).filter(Boolean);
            keySegments = [...displaySegments];
            if (displaySegments.length > 0) displaySegments[displaySegments.length - 1] = label;
        }
        if (displaySegments.length === 0) continue;

        let level = rootChildren;
        let pathKey = "";
        for (let index = 0; index < displaySegments.length; index++) {
            const segmentKey = normSeg(keySegments[index] ?? displaySegments[index]);
            pathKey = pathKey ? pathKey + "/" + segmentKey : segmentKey;
            let node = level.get(segmentKey);
            if (!node) {
                node = { label: displaySegments[index], pathKey, children: new Map() };
                level.set(segmentKey, node);
            }
            if (index === displaySegments.length - 1) node.leaf = { root, label };
            level = node.children;
        }
    }

    const nodes = [...rootChildren.values()].map(node => convert(node, options));
    sortNodes(nodes);
    return nodes;
}
