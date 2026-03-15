import { GraphNode, GraphLink, linkIds } from "./types";

const EMPTY_SET: ReadonlySet<string> = new Set();

export interface PreprocessedGraph {
    nodes: GraphNode[];
    links: GraphLink[];
    syntheticLinkCounts: Map<string, number>;
}

/**
 * Read-only analysis model for group node membership.
 * Tracks which nodes are groups and which nodes belong to which group.
 *
 * Membership is derived from links: a link FROM a group node TO a non-group node
 * means the target is a member of that group. A node can belong to at most one group.
 *
 * This model does NOT transform data — that is the job of the link pre-processing step (US-189).
 * It only provides membership lookups for UI purposes (tooltip, detail panel, legend).
 */
export class GraphGroupModel {
    /** Map from group node ID → Set of member node IDs. */
    private groups = new Map<string, Set<string>>();
    /** Map from member node ID → group node ID (reverse lookup). */
    private memberOf = new Map<string, string>();

    /** Rebuild membership from source data. Call after any data change. */
    rebuild(nodes: GraphNode[], links: GraphLink[]): void {
        this.groups.clear();
        this.memberOf.clear();

        // Find all group nodes
        const groupIds = new Set<string>();
        for (const node of nodes) {
            if (node.isGroup) {
                groupIds.add(node.id);
                this.groups.set(node.id, new Set());
            }
        }

        if (groupIds.size === 0) return;

        // Find membership links: links FROM a group node TO a non-group node
        for (const link of links) {
            const { source, target } = linkIds(link);
            if (groupIds.has(source) && !groupIds.has(target)) {
                this.groups.get(source)!.add(target);
                // A node can belong to at most one group (first wins)
                if (!this.memberOf.has(target)) {
                    this.memberOf.set(target, source);
                }
            }
        }
    }

    /** Check if a node is a group node. */
    isGroup(nodeId: string): boolean {
        return this.groups.has(nodeId);
    }

    /** Get the group a node belongs to (undefined if not in any group). */
    getGroupOf(nodeId: string): string | undefined {
        return this.memberOf.get(nodeId);
    }

    /** Get all member IDs of a group node (empty set if not a group). */
    getMembers(groupId: string): ReadonlySet<string> {
        return this.groups.get(groupId) ?? EMPTY_SET;
    }

    /** Get count of groups. */
    get groupCount(): number {
        return this.groups.size;
    }

    /**
     * Pre-process links for visualization: hide membership links, split cross-group
     * and inter-group links through group nodes, deduplicate synthetic links.
     *
     * Pure transformation — does not modify source data or internal state.
     * The root node is excluded from group membership so it stays outside all groups.
     */
    preprocess(nodes: GraphNode[], links: GraphLink[], rootNodeId: string): PreprocessedGraph {
        const empty: PreprocessedGraph = { nodes, links, syntheticLinkCounts: new Map() };
        if (this.groups.size === 0) return empty;

        // 1. Build effective memberOf map (exclude root from membership)
        const effectiveMemberOf = new Map(this.memberOf);
        if (rootNodeId) effectiveMemberOf.delete(rootNodeId);

        // 2. Build effective groups map (remove root from its group's member set)
        const effectiveGroups = new Map<string, Set<string>>();
        for (const [groupId, members] of this.groups) {
            const copy = new Set(members);
            if (rootNodeId) copy.delete(rootNodeId);
            effectiveGroups.set(groupId, copy);
        }

        // Helper: get effective group of a node (group nodes themselves are NOT "in" any group)
        const groupOf = (id: string): string | undefined => effectiveMemberOf.get(id);

        // 3. Classify links and collect output
        // Dedup map: canonical key → GraphLink (for synthetic links)
        const syntheticMap = new Map<string, GraphLink>();
        const syntheticCounts = new Map<string, number>();
        const outputLinks: GraphLink[] = [];

        const canonicalKey = (a: string, b: string): string =>
            a < b ? `${a}→${b}` : `${b}→${a}`;

        const addSynthetic = (source: string, target: string): void => {
            if (source === target) return;
            const key = canonicalKey(source, target);
            const existing = syntheticCounts.get(key) ?? 0;
            syntheticCounts.set(key, existing + 1);
            if (!syntheticMap.has(key)) {
                syntheticMap.set(key, { source, target });
            }
        };

        for (const link of links) {
            const { source, target } = linkIds(link);

            // Rule 1: Membership link — source is group AND target is effective member (or vice versa)
            if (this.groups.has(source) && effectiveGroups.get(source)?.has(target)) continue;
            if (this.groups.has(target) && effectiveGroups.get(target)?.has(source)) continue;

            const sourceGroup = groupOf(source);
            const targetGroup = groupOf(target);

            if (sourceGroup !== undefined && sourceGroup === targetGroup) {
                // Rule 2: Intra-group — keep as-is
                outputLinks.push(link);
            } else if (sourceGroup !== undefined && targetGroup !== undefined) {
                // Rule 4: Inter-group — split through both group nodes
                addSynthetic(source, sourceGroup);
                addSynthetic(sourceGroup, targetGroup);
                addSynthetic(targetGroup, target);
            } else if (sourceGroup !== undefined) {
                // Rule 3: Cross-group (source in group, target outside)
                addSynthetic(source, sourceGroup);
                addSynthetic(sourceGroup, target);
            } else if (targetGroup !== undefined) {
                // Rule 3: Cross-group (target in group, source outside)
                addSynthetic(source, targetGroup);
                addSynthetic(targetGroup, target);
            } else {
                // Rule 5: External — keep as-is
                outputLinks.push(link);
            }
        }

        // 4. Add deduplicated synthetic links to output
        for (const [, link] of syntheticMap) {
            outputLinks.push(link);
        }

        return { nodes, links: outputLinks, syntheticLinkCounts: syntheticCounts };
    }
}
