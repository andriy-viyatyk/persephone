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

    /** Set the active (selected) node. Computes neighbor set from links. */
    setActiveId(id: string, links: GraphLink[]): void {
        this.activeId = id;
        this.activeChild = id ? this.computeNeighborIds(id, links) : new Set();
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
        if (this.hoveredId && !nodeIds.has(this.hoveredId) && !this.externalHoverId) {
            this.hoveredId = "";
            this.hoveredChild = new Set();
        }
    }

    /** Reset all selection/hover state. */
    clearAll(): void {
        this.activeId = "";
        this.activeChild = new Set();
        this.hoveredId = "";
        this.hoveredChild = new Set();
    }

    // =========================================================================
    // Color helpers
    // =========================================================================

    nodeColor(node: GraphNode, colors: ResolvedColors): string {
        if (node.id === this.activeId) return colors.nodeSelected;
        if (node.id === this.hoveredId) return colors.nodeHighlight;
        return colors.nodeDefault;
    }

    nodeBorderColor(node: GraphNode, colors: ResolvedColors): string {
        if (node.id === this.activeId) return colors.borderSelected;
        if (node.id === this.hoveredId) return colors.borderHighlight;
        if (this.hoveredChild.has(node.id)) return colors.borderHighlight;
        return colors.borderDefault;
    }

    labelTextColor(node: GraphNode, colors: ResolvedColors): string {
        if (node.id === this.activeId) return colors.nodeSelected;
        if (node.id === this.hoveredId || this.hoveredChild.has(node.id)) return colors.nodeHighlight;
        return colors.labelText;
    }

    linkColor(link: GraphLink, colors: ResolvedColors): string {
        const { source, target } = linkIds(link);
        // Green highlight for the link between selected and hovered node
        if (this.hoveredId && this.activeId
            && ((source === this.activeId && target === this.hoveredId)
             || (target === this.activeId && source === this.hoveredId))) {
            return colors.borderHighlight;
        }
        return source === this.activeId || target === this.activeId
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
