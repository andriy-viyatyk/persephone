import { GraphNode, GraphLink, linkIds } from "./types";

/**
 * Resolved (computed) color values for canvas rendering.
 * Passed in from ForceGraphRenderer which resolves CSS variables.
 */
export interface ResolvedColors {
    nodeDefault: string;
    nodeHighlight: string;
    nodeSelected: string;
    borderDefault: string;
    borderHighlight: string;
    borderSelected: string;
    linkDefault: string;
    linkSelected: string;
    labelBg: string;
    labelText: string;
    groupBorder: string;
}

/**
 * Manages highlight layers and selection/hover state for the graph renderer.
 *
 * Highlight layers are named sets of node IDs (e.g., "search", "linksTab", "legend").
 * When multiple layers are active, only the intersection is highlighted (AND logic).
 *
 * Also manages active/hovered node state with neighbor computation.
 */
export class GraphHighlightModel {
    private layers = new Map<string, Set<string>>();

    // Selection/hover state
    activeId = "";
    activeChild = new Set<string>();
    /** All currently selected node IDs (superset — includes activeId). */
    selectedIds = new Set<string>();
    /** Union of neighbors of all selected nodes. */
    selectedChildren = new Set<string>();
    hoveredId = "";
    hoveredChild = new Set<string>();
    externalHoverId = "";
    hoveredBadgeNodeId = "";

    // =========================================================================
    // Layer management
    // =========================================================================

    /** Set a named highlight layer. Null or undefined clears the layer. */
    setLayer(name: string, ids: Set<string> | null): void {
        if (ids && ids.size > 0) {
            this.layers.set(name, ids);
        } else {
            this.layers.delete(name);
        }
    }

    /** Clear a named highlight layer. */
    clearLayer(name: string): void {
        this.layers.delete(name);
    }

    /**
     * Compute the intersection of all active highlight layers.
     * Returns null if no layers are active (no dimming).
     * Returns a Set of node IDs that should be fully visible (rest are dimmed).
     */
    computeDimSet(): Set<string> | null {
        const activeLayers = [...this.layers.values()];
        if (activeLayers.length === 0) return null;
        if (activeLayers.length === 1) return activeLayers[0];

        // Intersection of all layers
        return new Set(
            [...activeLayers[0]].filter((id) => activeLayers.every((s) => s.has(id))),
        );
    }

    // =========================================================================
    // Selection/hover
    // =========================================================================

    /** Set single selection (replaces any multi-selection). */
    selectSingle(id: string, links: GraphLink[]): void {
        this.activeId = id;
        this.activeChild = id ? this.computeNeighborIds(id, links) : new Set();
        this.selectedIds = id ? new Set([id]) : new Set();
        this.selectedChildren = this.activeChild;
    }

    /** Toggle a node in/out of multi-selection. */
    toggleSelected(id: string, links: GraphLink[]): void {
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
        } else {
            this.selectedIds.add(id);
        }
        // Update activeId to the last toggled-in node (or first remaining, or empty)
        if (this.selectedIds.has(id)) {
            this.activeId = id;
            this.activeChild = this.computeNeighborIds(id, links);
        } else if (this.selectedIds.size > 0) {
            const last = [...this.selectedIds].pop()!;
            this.activeId = last;
            this.activeChild = this.computeNeighborIds(last, links);
        } else {
            this.activeId = "";
            this.activeChild = new Set();
        }
        this.recomputeSelectedChildren(links);
    }

    /** Clear all selection state. */
    clearSelection(links: GraphLink[]): void {
        this.selectSingle("", links);
    }

    /** Recompute the union of neighbors for all selected nodes. */
    private recomputeSelectedChildren(links: GraphLink[]): void {
        if (this.selectedIds.size === 0) {
            this.selectedChildren = new Set();
            return;
        }
        const children = new Set<string>();
        for (const nodeId of this.selectedIds) {
            for (const neighborId of this.computeNeighborIds(nodeId, links)) {
                if (!this.selectedIds.has(neighborId)) {
                    children.add(neighborId);
                }
            }
        }
        this.selectedChildren = children;
    }

    /** Set the hovered node. Computes neighbor set from links. */
    setHoveredId(id: string, links: GraphLink[]): void {
        this.hoveredId = id;
        this.hoveredChild = id ? this.computeNeighborIds(id, links) : new Set();
    }

    /** Set hover from external source (e.g. grid row focus). */
    setExternalHover(id: string, links: GraphLink[]): void {
        this.externalHoverId = id;
        if (this.hoveredId === id) return;
        this.hoveredId = id;
        this.hoveredChild = id ? this.computeNeighborIds(id, links) : new Set();
    }

    /** Clear active/hovered state if the node is not in the given set. */
    clearSelectionIf(nodeIds: Set<string>): void {
        if (this.activeId && !nodeIds.has(this.activeId)) {
            this.activeId = "";
            this.activeChild = new Set();
        }
        // Remove any selected nodes that no longer exist
        let selectionChanged = false;
        for (const id of this.selectedIds) {
            if (!nodeIds.has(id)) {
                this.selectedIds.delete(id);
                selectionChanged = true;
            }
        }
        if (selectionChanged) {
            this.selectedChildren = new Set(); // Will be recomputed on next render if needed
        }
        if (this.hoveredId && !nodeIds.has(this.hoveredId) && !this.externalHoverId) {
            this.hoveredId = "";
            this.hoveredChild = new Set();
        }
    }

    /** Reset all selection/hover state. */
    clearAll(): void {
        this.activeId = "";
        this.activeChild = new Set();
        this.selectedIds = new Set();
        this.selectedChildren = new Set();
        this.hoveredId = "";
        this.hoveredChild = new Set();
    }

    // =========================================================================
    // Color helpers
    // =========================================================================

    nodeColor(node: GraphNode, colors: ResolvedColors): string {
        if (this.selectedIds.has(node.id)) return colors.nodeSelected;
        if (node.id === this.hoveredId) return colors.nodeHighlight;
        return colors.nodeDefault;
    }

    nodeBorderColor(node: GraphNode, colors: ResolvedColors): string {
        if (this.selectedIds.has(node.id)) return colors.borderSelected;
        if (node.id === this.hoveredId) return colors.borderHighlight;
        if (this.hoveredChild.has(node.id)) return colors.borderHighlight;
        return colors.borderDefault;
    }

    labelTextColor(node: GraphNode, colors: ResolvedColors): string {
        if (this.selectedIds.has(node.id)) return colors.nodeSelected;
        if (node.id === this.hoveredId || this.hoveredChild.has(node.id)) return colors.nodeHighlight;
        return colors.labelText;
    }

    linkColor(link: GraphLink, colors: ResolvedColors): string {
        const { source, target } = linkIds(link);
        // Green highlight for the link between any selected node and hovered node
        if (this.hoveredId && this.selectedIds.size > 0
            && ((this.selectedIds.has(source) && target === this.hoveredId)
             || (this.selectedIds.has(target) && source === this.hoveredId))) {
            return colors.borderHighlight;
        }
        return this.selectedIds.has(source) || this.selectedIds.has(target)
            ? colors.linkSelected
            : colors.linkDefault;
    }

    // =========================================================================
    // Internals
    // =========================================================================

    private computeNeighborIds(nodeId: string, links: GraphLink[]): Set<string> {
        const ids = links
            .filter((link) => {
                const { source, target } = linkIds(link);
                return source === nodeId || target === nodeId;
            })
            .flatMap((link) => {
                const { source, target } = linkIds(link);
                return [source, target].filter((id) => id !== nodeId);
            });
        return new Set(ids);
    }
}
