import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { GraphData, GraphLegend, GraphLink, GraphNode, GraphOptions, NodeShape, SYS_PREFIX, linkIds, nodeLabel, getCustomProperties } from "./types";
import { ForceGraphRenderer, ForceParams } from "./ForceGraphRenderer";
import { GraphVisibilityModel } from "./GraphVisibilityModel";
import { showAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu";
import type { MenuItem } from "../../components/overlay/PopupMenu";

// =============================================================================
// State
// =============================================================================

export interface SearchInfo {
    visible: number;
    hidden: number;
    total: number;
}

export interface SearchPropertyMatch {
    key: string;
    value: string;
}

export interface SearchResult {
    nodeId: string;
    label: string;
    visible: boolean;
    matchedProps: SearchPropertyMatch[];
}

export interface TooltipInfo {
    node: GraphNode;
    x: number;
    y: number;
}

export const defaultGraphViewState = {
    error: "",
    loading: true,
    searchQuery: "",
    searchInfo: null as SearchInfo | null,
    searchResults: null as SearchResult[] | null,
    tooltip: null as TooltipInfo | null,
    selectedNode: null as GraphNode | null,
    linkedNodes: [] as GraphNode[],
    statusHint: "",
};

export type GraphViewState = typeof defaultGraphViewState;

// =============================================================================
// Search matching
// =============================================================================

/** Match a node against multi-word search. Returns result details or null if no match. */
function matchNodeSearch(
    node: GraphNode,
    words: string[],
): Omit<SearchResult, "visible"> | null {
    const label = nodeLabel(node);
    const labelLower = label.toLowerCase();
    const customProps = getCustomProperties(node);

    // Build all searchable text fields
    const fields = [labelLower];
    for (const [key, value] of customProps) {
        fields.push(key.toLowerCase());
        fields.push(value.toLowerCase());
    }

    // All words must match at least one field (AND logic)
    for (const word of words) {
        if (!fields.some((f) => f.includes(word))) return null;
    }

    // Determine which custom properties contributed to the match
    const matchedProps: SearchPropertyMatch[] = [];
    for (const [key, value] of customProps) {
        const keyLower = key.toLowerCase();
        const valueLower = value.toLowerCase();
        if (words.some((w) => keyLower.includes(w) || valueLower.includes(w))) {
            matchedProps.push({ key, value });
        }
    }

    return { nodeId: node.id, label, matchedProps };
}

// =============================================================================
// Source data (Layer 1 — clean, editable, serializable)
// =============================================================================

interface SourceData {
    nodes: GraphNode[];
    links: GraphLink[];
    options?: GraphOptions;
}

// =============================================================================
// ViewModel
// =============================================================================

export class GraphViewModel extends ContentViewModel<GraphViewState> {
    readonly renderer = new ForceGraphRenderer();
    readonly visibilityModel = new GraphVisibilityModel();
    /** Set by GraphView to handle double-click on a node (e.g. expand detail panel). */
    onDoubleClickNode: ((nodeId: string) => void) | null = null;
    private _parseTimer: ReturnType<typeof setTimeout> | undefined;
    private _tooltipTimer: ReturnType<typeof setTimeout> | undefined;

    /** Clean source data — never has _$ or D3 properties. Edits happen here. */
    private sourceData: SourceData | null = null;
    /** Full parsed JSON — preserved for serialization (keeps `type` and any extra user properties). */
    private originalJson: Record<string, unknown> = {};
    /** Skip flag to prevent re-parsing our own serialized changes. */
    private skipNextContentUpdate = false;
    /** First load uses updateData (full sim init); subsequent loads use updateVisibleData (position-preserving). */
    private isFirstLoad = true;

    constructor(host: IContentHost) {
        super(host, defaultGraphViewState);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        this.addSubscription(() => clearTimeout(this._parseTimer));
        this.addSubscription(() => clearTimeout(this._tooltipTimer));
        this.renderer.onBadgeExpand = (nodeId, deep) => this.handleBadgeExpand(nodeId, deep);
        this.renderer.onHoverChanged = (nodeId, cx, cy) => this.handleHoverChanged(nodeId, cx, cy);
        this.renderer.onContextMenuAction = (nodeId, cx, cy) => this.handleContextMenu(nodeId, cx, cy);
        this.renderer.onAltClick = (nodeId) => this.handleAltClick(nodeId);
        this.renderer.onSelectionChanged = (nodeId) => this.handleSelectionChanged(nodeId);
        this.renderer.onDoubleClick = (nodeId) => this.onDoubleClickNode?.(nodeId);
        this.parseContent();
    }

    protected onContentChanged(): void {
        if (this.skipNextContentUpdate) {
            this.skipNextContentUpdate = false;
            return;
        }
        this.parseDebounced();
    }

    protected onDispose(): void {
        clearTimeout(this._parseTimer);
        clearTimeout(this._tooltipTimer);
        this.renderer.dispose();
    }

    // =========================================================================
    // Theme support
    // =========================================================================

    refreshColors(): void {
        this.renderer.refreshColors();
    }

    // =========================================================================
    // Force tuning
    // =========================================================================

    updateForceParams(params: Partial<ForceParams>): void {
        this.renderer.updateForceParams(params);
        // Persist to data options
        if (this.sourceData) {
            if (!this.sourceData.options) this.sourceData.options = {};
            Object.assign(this.sourceData.options, params);
            this.serializeToHost();
        }
    }

    resetForceParams(): void {
        this.renderer.resetForceParams();
        // Clear physics from options (next open uses defaults)
        if (this.sourceData?.options) {
            delete this.sourceData.options.charge;
            delete this.sourceData.options.linkDistance;
            delete this.sourceData.options.collide;
            this.serializeToHost();
        }
    }

    // =========================================================================
    // Root node
    // =========================================================================

    /** Current root node ID (from options or auto-selected). Undefined if no explicit root. */
    get rootNodeId(): string | undefined {
        return this.sourceData?.options?.rootNode || undefined;
    }

    setRootNode(nodeId: string | undefined): void {
        if (!this.sourceData) return;
        if (!this.sourceData.options) this.sourceData.options = {};
        if (nodeId) {
            this.sourceData.options.rootNode = nodeId;
        } else {
            delete this.sourceData.options.rootNode;
        }
        // Update renderer visual immediately
        this.renderer.rootNodeId = nodeId ?? "";
        this.serializeToHost();
    }

    // =========================================================================
    // Expansion options
    // =========================================================================

    /** Get current expansion options for UI. */
    getExpansionOptions(): { rootNode?: string; expandDepth?: number; maxVisible?: number } {
        const opts = this.sourceData?.options ?? {};
        return { rootNode: opts.rootNode, expandDepth: opts.expandDepth, maxVisible: opts.maxVisible };
    }

    /** Update expansion options (rootNode excluded — use setRootNode). Does NOT recalculate graph. */
    updateExpansionOptions(patch: Partial<Pick<GraphOptions, "expandDepth" | "maxVisible">>): void {
        if (!this.sourceData) return;
        if (!this.sourceData.options) this.sourceData.options = {};
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
                delete (this.sourceData.options as any)[key];
            } else {
                (this.sourceData.options as any)[key] = value;
            }
        }
        this.serializeToHost();
    }

    /** Get all nodes from source data (for ComboSelect in expansion settings). */
    getAllNodes(): GraphNode[] {
        return this.sourceData?.nodes ?? [];
    }

    // =========================================================================
    // Highlighting
    // =========================================================================

    /** Highlight a set of node IDs (dims everything else). Null to clear. */
    setHighlightSet(ids: Set<string> | null): void {
        this.renderer.setHighlightSet(ids);
    }

    /** Set hover highlight on a node from external source (e.g. grid focus). Empty to clear. */
    setExternalHover(id: string): void {
        this.renderer.setExternalHover(id);
    }

    /** Highlight a set of node IDs from legend panel. Null to clear. */
    setLegendHighlight(ids: Set<string> | null): void {
        this.renderer.setLegendHighlight(ids);
    }

    // =========================================================================
    // Legend
    // =========================================================================

    /** Get legend descriptions from options. */
    getLegendDescriptions(): GraphLegend {
        return this.sourceData?.options?.legend ?? {};
    }

    /** Set a single legend description. */
    setLegendDescription(tab: "levels" | "shapes", key: string, value: string): void {
        if (!this.sourceData) return;
        if (!this.sourceData.options) this.sourceData.options = {};
        if (!this.sourceData.options.legend) this.sourceData.options.legend = {};
        const legend = this.sourceData.options.legend;

        // Root description is canonical in levels.root — sync to both
        if (key === "root") {
            if (!legend.levels) legend.levels = {};
            if (!legend.shapes) legend.shapes = {};
            if (value) {
                legend.levels.root = value;
                legend.shapes.root = value;
            } else {
                delete legend.levels.root;
                delete legend.shapes.root;
            }
        } else {
            if (!legend[tab]) legend[tab] = {};
            if (value) {
                legend[tab]![key] = value;
            } else {
                delete legend[tab]![key];
            }
        }

        // Cleanup empty objects
        if (legend.levels && Object.keys(legend.levels).length === 0) delete legend.levels;
        if (legend.shapes && Object.keys(legend.shapes).length === 0) delete legend.shapes;
        if (!legend.levels && !legend.shapes) delete this.sourceData.options.legend;

        this.serializeToHost();
    }

    /** Get node IDs matching a filter (for legend highlighting). Operates on visible nodes. */
    getNodeIdsByLegendFilter(filter: { levels?: Set<number>; shapes?: Set<string>; includeRoot?: boolean }): Set<string> {
        const result = new Set<string>();
        const visibleNodes = this.renderer.getNodes();
        const rootId = this.sourceData?.options?.rootNode ?? "";

        for (const node of visibleNodes) {
            const isRoot = rootId !== "" && node.id === rootId;

            if (filter.includeRoot && isRoot) {
                result.add(node.id);
                continue;
            }

            if (filter.levels) {
                const level = typeof node.level === "number" && node.level >= 1 && node.level <= 5 ? node.level : 5;
                if (filter.levels.has(level)) {
                    result.add(node.id);
                    continue;
                }
            }

            if (filter.shapes) {
                const shape = isRoot ? "compass" : (node.shape || "circle");
                if (filter.shapes.has(shape)) {
                    result.add(node.id);
                }
            }
        }

        return result;
    }

    /** Get set of levels and shapes present in visible nodes. */
    getPresentLevelsAndShapes(): { levels: Set<number>; shapes: Set<NodeShape>; hasRoot: boolean } {
        const levels = new Set<number>();
        const shapes = new Set<NodeShape>();
        const visibleNodes = this.renderer.getNodes();
        const rootId = this.sourceData?.options?.rootNode ?? "";
        let hasRoot = false;

        for (const node of visibleNodes) {
            if (rootId !== "" && node.id === rootId) {
                hasRoot = true;
                continue; // root has its own entry, don't count its level/shape
            }
            const level = typeof node.level === "number" && node.level >= 1 && node.level <= 5 ? node.level : 5;
            levels.add(level);
            shapes.add(node.shape || "circle");
        }

        return { levels, shapes, hasRoot };
    }

    // =========================================================================
    // Search
    // =========================================================================

    setSearchQuery(query: string): void {
        this.state.update((s) => { s.searchQuery = query; });
        this.recomputeSearch();
    }

    revealHiddenMatches(): void {
        if (!this.visibilityModel.active) return;
        const results = this.state.get().searchResults;
        if (!results) return;

        const hiddenIds = results.filter((r) => !r.visible).map((r) => r.nodeId);
        if (hiddenIds.length === 0) return;

        const changed = this.visibilityModel.revealPaths(hiddenIds);
        if (!changed) return;

        const visibleGraph = this.visibilityModel.getVisibleGraph();
        this.renderer.updateVisibleData(visibleGraph);
        this.recomputeSearch();
    }

    revealAndSelectNode(nodeId: string): void {
        // Reveal if hidden
        if (this.visibilityModel.active && !this.visibilityModel.isNodeVisible(nodeId)) {
            const changed = this.visibilityModel.revealPaths([nodeId]);
            if (changed) {
                const visibleGraph = this.visibilityModel.getVisibleGraph();
                this.renderer.updateVisibleData(visibleGraph);
                this.recomputeSearch();
            }
        }
        // Select the node
        this.renderer.selectNode(nodeId);
    }

    private recomputeSearch(): void {
        const query = this.state.get().searchQuery.trim().toLowerCase();
        if (!query) {
            this.renderer.setSearchMatches(null);
            this.state.update((s) => { s.searchInfo = null; s.searchResults = null; });
            return;
        }

        const words = query.split(/\s+/).filter(Boolean);

        // Match against visible nodes
        const visibleNodes = this.renderer.getNodes();
        const matchIds = new Set<string>();
        const results: SearchResult[] = [];

        for (const node of visibleNodes) {
            const matched = matchNodeSearch(node, words);
            if (matched) {
                matchIds.add(node.id);
                results.push({ ...matched, visible: true });
            }
        }

        // Match hidden nodes (when visibility filtering is active)
        const hiddenResults: SearchResult[] = [];
        if (this.visibilityModel.active) {
            for (const node of this.visibilityModel.getHiddenNodes()) {
                const matched = matchNodeSearch(node, words);
                if (matched) {
                    hiddenResults.push({ ...matched, visible: false });
                }
            }
        }

        // Sort: visible first (alphabetical), then hidden (alphabetical)
        results.sort((a, b) => a.label.localeCompare(b.label));
        hiddenResults.sort((a, b) => a.label.localeCompare(b.label));
        const allResults = [...results, ...hiddenResults];

        this.renderer.setSearchMatches(matchIds.size > 0 ? matchIds : new Set());
        this.state.update((s) => {
            s.searchInfo = { visible: matchIds.size, hidden: hiddenResults.length, total: visibleNodes.length };
            s.searchResults = allResults.length > 0 ? allResults : null;
        });
    }

    // =========================================================================
    // Tooltip
    // =========================================================================

    private handleHoverChanged(nodeId: string, clientX: number, clientY: number): void {
        clearTimeout(this._tooltipTimer);

        if (!nodeId || this.renderer.isDragging) {
            this.clearTooltip();
            this.updateStatusHint("");
            return;
        }

        // Status hint: Alt+Click to link/unlink
        const selectedId = this.renderer.selectedId;
        if (selectedId && nodeId !== selectedId && this.sourceData) {
            const linked = this.linkExists(selectedId, nodeId);
            const label = nodeLabel(this.sourceData.nodes.find((n) => n.id === selectedId) ?? { id: selectedId });
            this.updateStatusHint(linked
                ? `Alt+Click to unlink from "${label}"`
                : `Alt+Click to link with "${label}"`);
        } else {
            this.updateStatusHint("");
        }

        this._tooltipTimer = setTimeout(() => {
            const node = this.renderer.getNodes().find((n) => n.id === nodeId);
            if (node) {
                this.state.update((s) => {
                    s.tooltip = { node: { ...node }, x: clientX, y: clientY };
                });
            }
        }, 500);
    }

    private clearTooltip(): void {
        clearTimeout(this._tooltipTimer);
        if (this.state.get().tooltip) {
            this.state.update((s) => { s.tooltip = null; });
        }
    }

    private updateStatusHint(hint: string): void {
        if (this.state.get().statusHint !== hint) {
            this.state.update((s) => { s.statusHint = hint; });
        }
    }

    // =========================================================================
    // Visibility
    // =========================================================================

    get hasVisibilityFilter(): boolean {
        return this.visibilityModel.active;
    }

    resetVisibility(): void {
        if (!this.visibilityModel.active) return;
        this.visibilityModel.reset();
        const visibleGraph = this.visibilityModel.getVisibleGraph();
        this.renderer.updateVisibleData(visibleGraph);
        this.recomputeSearch();
        this.clearTooltip();
    }

    /** Expand a node's hidden neighbors (used by badge click and links tab auto-expand). */
    expandNode(nodeId: string): void {
        if (!this.visibilityModel.active) return;

        const changed = this.visibilityModel.expand(nodeId);
        if (!changed) return;

        const visibleGraph = this.visibilityModel.getVisibleGraph();
        this.renderer.updateVisibleData(visibleGraph, nodeId);
        this.recomputeSearch();
        this.clearTooltip();
    }

    private handleBadgeExpand(nodeId: string, deep: boolean): void {
        if (deep) {
            this.expandNodeDeep(nodeId);
        } else {
            this.expandNode(nodeId);
        }
    }

    /** Deep expand: reveal the entire hidden subtree connected to this node, stopping at previously-visible barriers. */
    expandNodeDeep(nodeId: string): void {
        if (!this.visibilityModel.active) return;
        const changed = this.visibilityModel.expandDeep(nodeId);
        if (!changed) return;
        const visibleGraph = this.visibilityModel.getVisibleGraph();
        this.renderer.updateVisibleData(visibleGraph, nodeId);
        this.recomputeSearch();
        this.clearTooltip();
    }

    /** Collapse: hide descendants with higher showIndex (BFS subtree below this node). */
    collapseNode(nodeId: string): void {
        if (!this.visibilityModel.active) return;
        const changed = this.visibilityModel.collapse(nodeId);
        if (!changed) return;
        const visibleGraph = this.visibilityModel.getVisibleGraph();
        this.renderer.updateVisibleData(visibleGraph);
        this.recomputeSearch();
        this.clearTooltip();
    }

    /** Expand all nodes (make entire graph visible). */
    expandAll(): void {
        if (!this.visibilityModel.active) return;
        const changed = this.visibilityModel.expandAll();
        if (!changed) return;
        const visibleGraph = this.visibilityModel.getVisibleGraph();
        this.renderer.updateVisibleData(visibleGraph);
        this.recomputeSearch();
        this.clearTooltip();
    }

    /** Total number of nodes in the full graph (for confirmation dialog). */
    get totalNodeCount(): number {
        return this.visibilityModel.totalNodeCount;
    }

    /** Status bar text: "N of M nodes" when filtered, "N nodes" when all visible. */
    get recordsCount(): string {
        const total = this.sourceData?.nodes.length ?? 0;
        if (!this.visibilityModel.active) return `${total} nodes`;
        const visible = this.renderer.getNodes().length;
        return `${visible} of ${total} nodes`;
    }

    /** True when the graph has no nodes (empty content or parsed with zero nodes). */
    get isEmpty(): boolean {
        if (this.sourceData) return this.sourceData.nodes.length === 0;
        // No sourceData — empty if not loading and no error (i.e. blank content)
        const { loading, error } = this.state.get();
        return !loading && !error;
    }

    // =========================================================================
    // Context menu
    // =========================================================================

    private handleContextMenu(nodeId: string, clientX: number, clientY: number): void {
        this.clearTooltip();

        if (!nodeId) {
            // Right-click on empty area
            const worldPos = this.renderer.screenToWorld(clientX, clientY);
            showAppPopupMenu(clientX, clientY, [
                { label: "Add Node", onClick: () => this.addNode(worldPos.x, worldPos.y) },
            ]);
        } else {
            // Right-click on a node — select it
            this.renderer.selectNode(nodeId);

            const isRoot = nodeId === this.rootNodeId;
            const items: MenuItem[] = [
                { label: "Add Child", onClick: () => this.addChild(nodeId) },
                { label: "Set as Root", onClick: () => this.setRootNode(nodeId), disabled: isRoot },
                { label: "Collapse", onClick: () => this.collapseNode(nodeId), disabled: !this.visibilityModel.active },
                { label: "Delete Node", onClick: () => this.deleteNode(nodeId), startGroup: true },
            ];

            // Build "Delete Link" submenu for connected nodes
            const neighbors = this.getNeighborIdsFromSource(nodeId);
            if (neighbors.length > 0) {
                items.push({
                    label: "Delete Link",
                    startGroup: true,
                    items: neighbors.map((nId) => ({
                        label: this.getNodeLabel(nId),
                        onClick: () => this.deleteLink(nodeId, nId),
                    })),
                });
            }

            showAppPopupMenu(clientX, clientY, items);
        }
    }

    // =========================================================================
    // Alt+Click link toggle
    // =========================================================================

    private handleAltClick(nodeId: string): void {
        const selectedId = this.renderer.selectedId;
        if (!selectedId || selectedId === nodeId) return;
        if (!this.sourceData) return;

        const exists = this.linkExists(selectedId, nodeId);
        if (exists) {
            this.deleteLink(selectedId, nodeId);
        } else {
            this.addLink(selectedId, nodeId);
        }
    }

    // =========================================================================
    // Selection
    // =========================================================================

    private handleSelectionChanged(nodeId: string): void {
        this.state.update((s) => {
            s.statusHint = "";
            if (!nodeId) {
                s.selectedNode = null;
                s.linkedNodes = [];
            } else {
                const node = this.sourceData?.nodes.find((n) => n.id === nodeId);
                s.selectedNode = node ? { ...node } : null;
                s.linkedNodes = this.computeLinkedNodes(nodeId);
            }
        });
    }

    /** Refresh the selectedNode snapshot from sourceData (after edits). */
    private refreshSelectedNode(): void {
        const selectedId = this.renderer.selectedId;
        if (!selectedId) return;
        this.state.update((s) => {
            const node = this.sourceData?.nodes.find((n) => n.id === selectedId);
            s.selectedNode = node ? { ...node } : null;
            s.linkedNodes = this.computeLinkedNodes(selectedId);
        });
    }

    // =========================================================================
    // Node property editing
    // =========================================================================

    updateNodeProps(nodeId: string, props: Partial<GraphNode>): void {
        if (!this.sourceData) return;
        const node = this.sourceData.nodes.find((n) => n.id === nodeId);
        if (!node) return;

        for (const [key, value] of Object.entries(props)) {
            if (key === "id") continue; // Use renameNode for ID changes
            if (value === undefined || value === "" || value === null) {
                delete (node as any)[key];
            } else {
                (node as any)[key] = value;
            }
        }

        this.rebuildAndRender();
        this.serializeToHost();
        this.refreshSelectedNode();
    }

    renameNode(oldId: string, newId: string): boolean {
        if (!this.sourceData) return false;
        newId = newId.trim();
        if (!newId || newId === oldId) return false;
        if (this.sourceData.nodes.some((n) => n.id === newId)) return false;

        // Update node ID
        const node = this.sourceData.nodes.find((n) => n.id === oldId);
        if (!node) return false;
        node.id = newId;

        // Update all links referencing old ID
        for (const link of this.sourceData.links) {
            if (typeof link.source === "string" && link.source === oldId) link.source = newId;
            if (typeof link.target === "string" && link.target === oldId) link.target = newId;
        }

        // Update options.rootNode if it matches
        if (this.sourceData.options?.rootNode === oldId) {
            this.sourceData.options.rootNode = newId;
        }

        // Update visibility state so renamed node stays visible
        this.visibilityModel.renameId(oldId, newId);

        // Capture old node's position so it doesn't jump after rebuild
        const oldRendered = this.renderer.getNodes().find((n) => n.id === oldId);
        const posHint = oldRendered?.x != null && oldRendered?.y != null
            ? new Map([[newId, { x: oldRendered.x, y: oldRendered.y }]])
            : undefined;

        this.renderer.selectNode(newId);
        this.rebuildAndRender(undefined, posHint);
        this.serializeToHost();
        this.refreshSelectedNode();
        return true;
    }

    // =========================================================================
    // Editing operations (mutate sourceData → rebuild → serialize)
    // =========================================================================

    addNode(worldX: number, worldY: number): string {
        if (!this.sourceData) {
            // Initialize empty graph (first node on blank page)
            this.sourceData = { nodes: [], links: [] };
            this.originalJson = { type: "force-graph" };
        }

        const id = this.generateNodeId();
        this.sourceData.nodes.push({ id });
        this.rebuildAndRender(undefined, new Map([[id, { x: worldX, y: worldY }]]), [id]);
        this.serializeToHost();
        return id;
    }

    deleteNode(nodeId: string): void {
        if (!this.sourceData) return;

        this.sourceData.nodes = this.sourceData.nodes.filter((n) => n.id !== nodeId);
        this.sourceData.links = this.sourceData.links.filter((link) => {
            const { source, target } = linkIds(link);
            return source !== nodeId && target !== nodeId;
        });

        // Clear selection if deleted node was selected
        if (this.renderer.selectedId === nodeId) {
            this.renderer.selectNode("");
        }

        this.rebuildAndRender();
        this.serializeToHost();
    }

    addLink(sourceId: string, targetId: string): void {
        if (!this.sourceData) return;
        if (sourceId === targetId) return;
        if (this.linkExists(sourceId, targetId)) return;

        this.sourceData.links.push({ source: sourceId, target: targetId });
        this.rebuildAndRender();
        this.serializeToHost();
    }

    deleteLink(sourceId: string, targetId: string): void {
        if (!this.sourceData) return;

        this.sourceData.links = this.sourceData.links.filter((link) => {
            const { source, target } = linkIds(link);
            return !(
                (source === sourceId && target === targetId) ||
                (source === targetId && target === sourceId)
            );
        });

        this.rebuildAndRender();
        this.serializeToHost();
    }

    addChild(parentId: string): string {
        if (!this.sourceData) return "";

        const id = this.generateNodeId();
        this.sourceData.nodes.push({ id });
        this.sourceData.links.push({ source: parentId, target: id });

        // Anchor near parent so new node appears close to it; ensure both parent and child are visible
        this.rebuildAndRender(parentId, undefined, [id, parentId]);
        this.serializeToHost();
        return id;
    }

    // =========================================================================
    // Rebuild pipeline (sourceData → visibility → renderer)
    // =========================================================================

    /**
     * Rebuild the rendering pipeline from sourceData.
     * @param anchorNodeId — existing node near which to place new nodes (for expand/addChild)
     * @param newNodePositions — explicit world positions for brand-new nodes (for addNode on empty area)
     * @param ensureVisible — node IDs that must be visible (newly added nodes)
     */
    private rebuildAndRender(
        anchorNodeId?: string,
        newNodePositions?: Map<string, { x: number; y: number }>,
        ensureVisible?: string[],
    ): void {
        if (!this.sourceData) return;

        const { nodes, links, options } = this.sourceData;

        let filtering: boolean;
        if (this.isFirstLoad) {
            // First load: full reset (computes initial BFS visible set)
            filtering = this.visibilityModel.setFullGraph(nodes, links, options);
        } else {
            // Subsequent: incremental update (preserves expand/collapse state)
            filtering = this.visibilityModel.updateGraph(nodes, links, ensureVisible);
        }

        const copy: GraphData = filtering
            ? this.visibilityModel.getVisibleGraph()
            : { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })), options };

        if (this.isFirstLoad) {
            this.renderer.updateData(copy);
            this.isFirstLoad = false;
        } else {
            this.renderer.updateVisibleData(copy, anchorNodeId, newNodePositions);
        }

        this.recomputeSearch();
        this.clearTooltip();
    }

    // =========================================================================
    // Serialization (sourceData → JSON → host)
    // =========================================================================

    private serializeToHost(): void {
        if (!this.sourceData) return;

        const json: Record<string, unknown> = { ...this.originalJson };
        json.nodes = this.sourceData.nodes;
        json.links = this.sourceData.links;
        if (this.sourceData.options) {
            json.options = this.sourceData.options;
        }

        this.skipNextContentUpdate = true;
        this.host.changeContent(JSON.stringify(json, null, 4), true);
    }

    // =========================================================================
    // Parsing
    // =========================================================================

    private parseDebounced(): void {
        clearTimeout(this._parseTimer);
        this._parseTimer = setTimeout(() => this.parseContent(), 400);
    }

    private parseContent(): void {
        const content = this.host.state.get().content;
        if (!content.trim()) {
            this.sourceData = null;
            this.originalJson = {};
            this.state.update((s) => {
                s.error = "";
                s.loading = false;
            });
            return;
        }

        try {
            const json = JSON.parse(content);
            this.originalJson = json;
            this.sourceData = {
                nodes: Array.isArray(json.nodes) ? json.nodes : [],
                links: Array.isArray(json.links) ? json.links : [],
                options: json.options,
            };

            // Restore physics params from options (before first render)
            const opts = this.sourceData.options ?? {};
            if (this.isFirstLoad) {
                const initialParams: Partial<ForceParams> = {};
                if (opts.charge !== undefined) initialParams.charge = opts.charge;
                if (opts.linkDistance !== undefined) initialParams.linkDistance = opts.linkDistance;
                if (opts.collide !== undefined) initialParams.collide = opts.collide;
                if (Object.keys(initialParams).length > 0) {
                    this.renderer.setInitialForceParams(initialParams);
                }
            }

            this.state.update((s) => {
                s.error = "";
                s.loading = false;
            });

            this.rebuildAndRender();

            // Set root node visual on renderer (explicit rootNode from options, or empty)
            this.renderer.rootNodeId = opts.rootNode ?? "";

            // Refresh panel snapshot — selected node may have changed or been deleted externally
            this.refreshSelectedNode();
        } catch (e: any) {
            this.state.update((s) => {
                s.error = e.message || "Invalid JSON";
                s.loading = false;
            });
        }
    }

    // =========================================================================
    // Linked nodes (for Links tab)
    // =========================================================================

    /** Keys added by D3 simulation — not part of user data. */
    private static readonly SIM_KEYS = new Set(["x", "y", "vx", "vy", "fx", "fy", "index"]);

    /** Strip _$ runtime and D3 simulation properties, return clean copy. */
    private cleanNode(node: GraphNode): GraphNode {
        const clean: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node)) {
            if (!key.startsWith(SYS_PREFIX) && !GraphViewModel.SIM_KEYS.has(key)) {
                clean[key] = value;
            }
        }
        return clean as unknown as GraphNode;
    }

    private computeLinkedNodes(nodeId: string): GraphNode[] {
        if (!this.sourceData || !nodeId) return [];
        const neighborIds = new Set(this.getNeighborIdsFromSource(nodeId));
        return this.sourceData.nodes
            .filter((n) => neighborIds.has(n.id))
            .map((n) => this.cleanNode(n));
    }

    // =========================================================================
    // Batch apply (Properties tab)
    // =========================================================================

    /**
     * Apply batch property changes from the Properties tab grid.
     * @param nodeId — the selected node
     * @param propsToSet — key-value pairs to set (overwrites existing)
     * @param keysToRemove — property keys to delete from the node
     */
    applyPropertiesUpdate(
        nodeId: string,
        propsToSet: Record<string, string>,
        keysToRemove: string[],
    ): void {
        if (!this.sourceData) return;
        const node = this.sourceData.nodes.find((n) => n.id === nodeId);
        if (!node) return;

        for (const key of keysToRemove) {
            delete (node as any)[key];
        }

        for (const [key, value] of Object.entries(propsToSet)) {
            (node as any)[key] = value;
        }

        this.rebuildAndRender();
        this.serializeToHost();
        this.refreshSelectedNode();
    }

    // =========================================================================
    // Batch apply (Links tab)
    // =========================================================================

    /**
     * Apply batch changes from the Links tab grid.
     * @param selectedNodeId — the currently selected node (parent)
     * @param rows — grid rows after user edits (each has at least `id`)
     * @param originalIds — set of IDs that were in the grid when it was loaded
     */
    applyLinkedNodesUpdate(
        selectedNodeId: string,
        rows: Record<string, unknown>[],
        originalIds: Set<string>,
    ): void {
        if (!this.sourceData) return;

        const currentIds = new Set(rows.map((r) => r.id as string).filter(Boolean));

        // 1. Removed rows: in original but not in current
        for (const oldId of originalIds) {
            if (!currentIds.has(oldId)) {
                this.removeLinkSmart(selectedNodeId, oldId);
            }
        }

        // 2. New + modified rows
        for (const row of rows) {
            const id = (row.id as string)?.trim();
            if (!id) continue;

            if (!originalIds.has(id)) {
                // New row — create node if needed, add link
                if (!this.sourceData.nodes.some((n) => n.id === id)) {
                    this.sourceData.nodes.push({ id });
                }
                if (!this.linkExists(selectedNodeId, id) && selectedNodeId !== id) {
                    this.sourceData.links.push({ source: selectedNodeId, target: id });
                }
            }

            // Update properties (for both new and existing)
            const node = this.sourceData.nodes.find((n) => n.id === id);
            if (node) {
                this.applyRowPropsToNode(node, row);
            }
        }

        // 3. Rebuild
        this.rebuildAndRender();
        this.serializeToHost();
        this.refreshSelectedNode();
    }

    /**
     * Smart link removal:
     * - Always removes the link between aId and bId
     * - If bId has no other links after removal, also deletes the node
     */
    private removeLinkSmart(aId: string, bId: string): void {
        if (!this.sourceData) return;

        // Remove the link
        this.sourceData.links = this.sourceData.links.filter((link) => {
            const { source, target } = linkIds(link);
            return !(
                (source === aId && target === bId) ||
                (source === bId && target === aId)
            );
        });

        // Check if bId has any remaining links
        const hasOtherLinks = this.sourceData.links.some((link) => {
            const { source, target } = linkIds(link);
            return source === bId || target === bId;
        });

        // If orphaned, delete the node too
        if (!hasOtherLinks) {
            this.sourceData.nodes = this.sourceData.nodes.filter((n) => n.id !== bId);
        }
    }

    /** Apply row properties to a node, skipping 'id' and empty values. */
    private applyRowPropsToNode(node: GraphNode, row: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(row)) {
            if (key === "id") continue;
            if (value === undefined || value === null || value === "") {
                delete (node as any)[key];
            } else {
                (node as any)[key] = value;
            }
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private generateNodeId(): string {
        if (!this.sourceData) return "node-1";
        const existingIds = new Set(this.sourceData.nodes.map((n) => n.id));
        let i = 1;
        while (existingIds.has(`node-${i}`)) i++;
        return `node-${i}`;
    }

    private linkExists(aId: string, bId: string): boolean {
        if (!this.sourceData) return false;
        return this.sourceData.links.some((link) => {
            const { source, target } = linkIds(link);
            return (source === aId && target === bId) || (source === bId && target === aId);
        });
    }

    private getNeighborIdsFromSource(nodeId: string): string[] {
        if (!this.sourceData) return [];
        const neighbors: string[] = [];
        for (const link of this.sourceData.links) {
            const { source, target } = linkIds(link);
            if (source === nodeId) neighbors.push(target);
            else if (target === nodeId) neighbors.push(source);
        }
        return neighbors;
    }

    private getNodeLabel(nodeId: string): string {
        const node = this.sourceData?.nodes.find((n) => n.id === nodeId);
        return node ? nodeLabel(node) : nodeId;
    }
}

// =============================================================================
// Factory
// =============================================================================

export function createGraphViewModel(host: IContentHost): GraphViewModel {
    return new GraphViewModel(host);
}
