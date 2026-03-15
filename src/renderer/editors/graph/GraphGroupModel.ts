import { GraphNode, GraphLink, linkIds } from "./types";

const EMPTY_SET: ReadonlySet<string> = new Set();

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
}
