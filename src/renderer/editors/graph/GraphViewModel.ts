import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { GraphData, GraphNode, GraphOptions, nodeLabel } from "./types";
import { ForceGraphRenderer, ForceParams } from "./ForceGraphRenderer";
import { GraphVisibilityModel } from "./GraphVisibilityModel";
import { GraphDataModel } from "./GraphDataModel";
import { GraphSearchModel } from "./GraphSearchModel";
import { showAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu";
import { buildNodeContextMenu, buildEmptyAreaContextMenu, ContextMenuActions } from "./GraphContextMenu";

// Re-export search types for consumers (GraphView.tsx imports from here)
export type { SearchInfo, SearchPropertyMatch, SearchResult } from "./GraphSearchModel";
import type { SearchInfo, SearchResult } from "./GraphSearchModel";

// =============================================================================
// State
// =============================================================================

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
// ViewModel
// =============================================================================

export class GraphViewModel extends ContentViewModel<GraphViewState> {
    readonly renderer = new ForceGraphRenderer();
    readonly visibilityModel = new GraphVisibilityModel();
    readonly dataModel = new GraphDataModel();
    readonly searchModel: GraphSearchModel;
    /** Set by GraphView to handle double-click on a node (e.g. expand detail panel). */
    onDoubleClickNode: ((nodeId: string) => void) | null = null;
    private _parseTimer: ReturnType<typeof setTimeout> | undefined;
    private _tooltipTimer: ReturnType<typeof setTimeout> | undefined;

    /** Full parsed JSON — preserved for serialization (keeps `type` and any extra user properties). */
    private originalJson: Record<string, unknown> = {};
    /** Skip flag to prevent re-parsing our own serialized changes. */
    private skipNextContentUpdate = false;
    /** First load uses updateData (full sim init); subsequent loads use updateVisibleData (position-preserving). */
    private isFirstLoad = true;

    constructor(host: IContentHost) {
        super(host, defaultGraphViewState);
        this.searchModel = new GraphSearchModel(this.renderer, this.visibilityModel);
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
        if (this.dataModel.sourceData) {
            if (!this.dataModel.sourceData.options) this.dataModel.sourceData.options = {};
            Object.assign(this.dataModel.sourceData.options, params);
            this.serializeToHost();
        }
    }

    resetForceParams(): void {
        this.renderer.resetForceParams();
        // Clear physics from options (next open uses defaults)
        if (this.dataModel.sourceData?.options) {
            delete this.dataModel.sourceData.options.charge;
            delete this.dataModel.sourceData.options.linkDistance;
            delete this.dataModel.sourceData.options.collide;
            this.serializeToHost();
        }
    }

    // =========================================================================
    // Root node
    // =========================================================================

    /** Current root node ID (from options or auto-selected). Undefined if no explicit root. */
    get rootNodeId(): string | undefined {
        return this.dataModel.sourceData?.options?.rootNode || undefined;
    }

    setRootNode(nodeId: string | undefined): void {
        if (!this.dataModel.sourceData) return;
        if (!this.dataModel.sourceData.options) this.dataModel.sourceData.options = {};
        if (nodeId) {
            this.dataModel.sourceData.options.rootNode = nodeId;
        } else {
            delete this.dataModel.sourceData.options.rootNode;
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
        const opts = this.dataModel.sourceData?.options ?? {};
        return { rootNode: opts.rootNode, expandDepth: opts.expandDepth, maxVisible: opts.maxVisible };
    }

    /** Update expansion options (rootNode excluded — use setRootNode). Does NOT recalculate graph. */
    updateExpansionOptions(patch: Partial<Pick<GraphOptions, "expandDepth" | "maxVisible">>): void {
        if (!this.dataModel.sourceData) return;
        if (!this.dataModel.sourceData.options) this.dataModel.sourceData.options = {};
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
                delete (this.dataModel.sourceData.options as any)[key];
            } else {
                (this.dataModel.sourceData.options as any)[key] = value;
            }
        }
        this.serializeToHost();
    }

    /** Get all nodes from source data (for ComboSelect in expansion settings). */
    getAllNodes(): GraphNode[] {
        return this.dataModel.sourceData?.nodes ?? [];
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
    // Legend (delegates to dataModel)
    // =========================================================================

    /** Get legend descriptions from options. */
    getLegendDescriptions() {
        return this.dataModel.getLegendDescriptions();
    }

    /** Set a single legend description. */
    setLegendDescription(tab: "levels" | "shapes", key: string, value: string): void {
        this.dataModel.setLegendDescription(tab, key, value);
        this.serializeToHost();
    }

    /** Get node IDs matching a filter (for legend highlighting). Operates on visible nodes. */
    getNodeIdsByLegendFilter(filter: { levels?: Set<number>; shapes?: Set<string>; includeRoot?: boolean }): Set<string> {
        return this.dataModel.getNodeIdsByLegendFilter(filter, this.renderer.getNodes());
    }

    /** Get set of levels and shapes present in visible nodes. */
    getPresentLevelsAndShapes() {
        return this.dataModel.getPresentLevelsAndShapes(this.renderer.getNodes());
    }

    // =========================================================================
    // Search (delegates to searchModel)
    // =========================================================================

    setSearchQuery(query: string): void {
        this.state.update((s) => { s.searchQuery = query; });
        this.recomputeSearch();
    }

    revealHiddenMatches(): void {
        const results = this.state.get().searchResults;
        const changed = this.searchModel.revealHiddenMatches(results);
        if (changed) this.recomputeSearch();
    }

    revealAndSelectNode(nodeId: string): void {
        const changed = this.searchModel.revealAndSelectNode(nodeId);
        if (changed) this.recomputeSearch();
    }

    private recomputeSearch(): void {
        const query = this.state.get().searchQuery;
        const result = this.searchModel.computeSearch(query);

        if (!result) {
            this.renderer.setSearchMatches(null);
            this.state.update((s) => { s.searchInfo = null; s.searchResults = null; });
            return;
        }

        this.renderer.setSearchMatches(result.matchIds);
        this.state.update((s) => {
            s.searchInfo = result.searchInfo;
            s.searchResults = result.searchResults;
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
        if (selectedId && nodeId !== selectedId && this.dataModel.sourceData) {
            const linked = this.dataModel.linkExists(selectedId, nodeId);
            const label = nodeLabel(this.dataModel.sourceData.nodes.find((n) => n.id === selectedId) ?? { id: selectedId });
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
        const total = this.dataModel.sourceData?.nodes.length ?? 0;
        if (!this.visibilityModel.active) return `${total} nodes`;
        const visible = this.renderer.getNodes().length;
        return `${visible} of ${total} nodes`;
    }

    /** True when the graph has no nodes (empty content or parsed with zero nodes). */
    get isEmpty(): boolean {
        if (this.dataModel.sourceData) return this.dataModel.sourceData.nodes.length === 0;
        // No sourceData — empty if not loading and no error (i.e. blank content)
        const { loading, error } = this.state.get();
        return !loading && !error;
    }

    // =========================================================================
    // Context menu
    // =========================================================================

    /** Context menu action handlers bound to this ViewModel. */
    private get contextMenuActions(): ContextMenuActions {
        return {
            addNode: (wx, wy) => this.addNode(wx, wy),
            addChild: (id) => this.addChild(id),
            deleteNode: (id) => this.deleteNode(id),
            deleteLink: (s, t) => this.deleteLink(s, t),
            setRootNode: (id) => this.setRootNode(id),
            collapseNode: (id) => this.collapseNode(id),
        };
    }

    private handleContextMenu(nodeId: string, clientX: number, clientY: number): void {
        this.clearTooltip();

        if (!nodeId) {
            const worldPos = this.renderer.screenToWorld(clientX, clientY);
            const items = buildEmptyAreaContextMenu(worldPos.x, worldPos.y, this.contextMenuActions);
            showAppPopupMenu(clientX, clientY, items);
        } else {
            this.renderer.selectNode(nodeId);
            const items = buildNodeContextMenu(
                nodeId,
                this.dataModel.getNeighborIdsFromSource(nodeId),
                (id) => this.dataModel.getNodeLabel(id),
                nodeId === this.rootNodeId,
                this.visibilityModel.active,
                this.contextMenuActions,
            );
            showAppPopupMenu(clientX, clientY, items);
        }
    }

    // =========================================================================
    // Alt+Click link toggle
    // =========================================================================

    private handleAltClick(nodeId: string): void {
        const selectedId = this.renderer.selectedId;
        if (!selectedId || selectedId === nodeId) return;
        if (!this.dataModel.sourceData) return;

        const exists = this.dataModel.linkExists(selectedId, nodeId);
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
                const node = this.dataModel.sourceData?.nodes.find((n) => n.id === nodeId);
                s.selectedNode = node ? { ...node } : null;
                s.linkedNodes = this.dataModel.computeLinkedNodes(nodeId);
            }
        });
    }

    /** Refresh the selectedNode snapshot from sourceData (after edits). */
    private refreshSelectedNode(): void {
        const selectedId = this.renderer.selectedId;
        if (!selectedId) return;
        this.state.update((s) => {
            const node = this.dataModel.sourceData?.nodes.find((n) => n.id === selectedId);
            s.selectedNode = node ? { ...node } : null;
            s.linkedNodes = this.dataModel.computeLinkedNodes(selectedId);
        });
    }

    // =========================================================================
    // Editing operations (delegate to dataModel → rebuild → serialize)
    // =========================================================================

    updateNodeProps(nodeId: string, props: Partial<GraphNode>): void {
        this.dataModel.updateNodeProps(nodeId, props);
        this.rebuildAndRender();
        this.serializeToHost();
        this.refreshSelectedNode();
    }

    renameNode(oldId: string, newId: string): boolean {
        const ok = this.dataModel.renameNode(oldId, newId);
        if (!ok) return false;

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

    addNode(worldX: number, worldY: number): string {
        if (!this.dataModel.sourceData) {
            // Initialize empty graph (first node on blank page)
            this.dataModel.sourceData = { nodes: [], links: [] };
            this.originalJson = { type: "force-graph" };
        }

        const id = this.dataModel.addNode();
        this.rebuildAndRender(undefined, new Map([[id, { x: worldX, y: worldY }]]), [id]);
        this.serializeToHost();
        return id;
    }

    deleteNode(nodeId: string): void {
        this.dataModel.deleteNode(nodeId);

        // Clear selection if deleted node was selected
        if (this.renderer.selectedId === nodeId) {
            this.renderer.selectNode("");
        }

        this.rebuildAndRender();
        this.serializeToHost();
    }

    addLink(sourceId: string, targetId: string): void {
        this.dataModel.addLink(sourceId, targetId);
        this.rebuildAndRender();
        this.serializeToHost();
    }

    deleteLink(sourceId: string, targetId: string): void {
        this.dataModel.deleteLink(sourceId, targetId);
        this.rebuildAndRender();
        this.serializeToHost();
    }

    addChild(parentId: string): string {
        const id = this.dataModel.addChild(parentId);
        if (!id) return "";

        // Anchor near parent so new node appears close to it; ensure both parent and child are visible
        this.rebuildAndRender(parentId, undefined, [id, parentId]);
        this.serializeToHost();
        return id;
    }

    applyPropertiesUpdate(
        nodeId: string,
        propsToSet: Record<string, string>,
        keysToRemove: string[],
    ): void {
        this.dataModel.applyPropertiesUpdate(nodeId, propsToSet, keysToRemove);
        this.rebuildAndRender();
        this.serializeToHost();
        this.refreshSelectedNode();
    }

    applyLinkedNodesUpdate(
        selectedNodeId: string,
        rows: Record<string, unknown>[],
        originalIds: Set<string>,
    ): void {
        this.dataModel.applyLinkedNodesUpdate(selectedNodeId, rows, originalIds);
        this.rebuildAndRender();
        this.serializeToHost();
        this.refreshSelectedNode();
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
        if (!this.dataModel.sourceData) return;

        const { nodes, links, options } = this.dataModel.sourceData;

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
        if (!this.dataModel.sourceData) return;

        const json: Record<string, unknown> = { ...this.originalJson };
        json.nodes = this.dataModel.sourceData.nodes;
        json.links = this.dataModel.sourceData.links;
        if (this.dataModel.sourceData.options) {
            json.options = this.dataModel.sourceData.options;
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
            this.dataModel.sourceData = null;
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
            this.dataModel.sourceData = {
                nodes: Array.isArray(json.nodes) ? json.nodes : [],
                links: Array.isArray(json.links) ? json.links : [],
                options: json.options,
            };

            // Restore physics params from options (before first render)
            const opts = this.dataModel.sourceData.options ?? {};
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
}

// =============================================================================
// Factory
// =============================================================================

export function createGraphViewModel(host: IContentHost): GraphViewModel {
    return new GraphViewModel(host);
}
