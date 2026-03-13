import * as d3 from "d3";
import { zoom as d3Zoom, D3ZoomEvent } from "d3-zoom";
import { drag as d3Drag, D3DragEvent } from "d3-drag";
import { GraphData, GraphNode, GraphLink, NodeShape, linkIds, nodeLabel, nodeRadius, levelRadii } from "./types";
import { forceProperties } from "./constants";
import color from "../../theme/color";
import { closeAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu";

interface ActiveState {
    activeId: string;
    activeChild: Set<string>;
    hoveredId: string;
    hoveredChild: Set<string>;
}

/** Resolved (computed) color values for canvas rendering. */
interface ResolvedColors {
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

function resolveVar(cssVar: string): string {
    if (!cssVar.startsWith("var(")) return cssVar;
    const varName = cssVar.slice(4, -1);
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || cssVar;
}

function resolveColors(): ResolvedColors {
    return {
        nodeDefault: resolveVar(color.graph.nodeDefault),
        nodeHighlight: resolveVar(color.graph.nodeHighlight),
        nodeSelected: resolveVar(color.graph.nodeSelected),
        borderDefault: resolveVar(color.graph.nodeBorderDefault),
        borderHighlight: resolveVar(color.graph.nodeBorderHighlight),
        borderSelected: resolveVar(color.graph.nodeBorderSelected),
        linkDefault: resolveVar(color.graph.linkDefault),
        linkSelected: resolveVar(color.graph.linkSelected),
        labelBg: resolveVar(color.graph.labelBackground),
        labelText: resolveVar(color.graph.labelText),
    };
}

/**
 * Manages D3 force simulation and canvas rendering for a force-directed graph.
 *
 * Lifecycle: create → setCanvas() → updateData() → dispose()
 */
export interface ForceParams {
    charge: number;
    linkDistance: number;
    collide: number;
}

const defaultForceParams: ForceParams = {
    charge: forceProperties.charge.strength,
    linkDistance: forceProperties.link.distance,
    collide: forceProperties.collide.strength,
};

export class ForceGraphRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
    private isDraggingNode = false;
    private graphData: GraphData = { nodes: [], links: [] };
    private dimensions = { width: 0, height: 0 };
    private transform = d3.zoomIdentity;
    private _forceParams: ForceParams = { ...defaultForceParams };

    private activeId = "";
    private activeChild = new Set<string>();
    private hoveredId = "";
    private hoveredChild = new Set<string>();

    private colors: ResolvedColors = resolveColors();
    private resizeObserver: ResizeObserver | null = null;

    /** Callback for badge click (expand hidden neighbors). `deep` is true when Ctrl is held. */
    onBadgeExpand: ((nodeId: string, deep: boolean) => void) | null = null;
    /** Callback when hovered node changes. Provides node ID and screen coordinates. */
    onHoverChanged: ((nodeId: string, clientX: number, clientY: number) => void) | null = null;
    /** Callback for right-click context menu. Provides node ID (empty = empty area) and screen coordinates. */
    onContextMenuAction: ((nodeId: string, clientX: number, clientY: number) => void) | null = null;
    /** Callback for Alt+Click on a node (link toggle). */
    onAltClick: ((nodeId: string) => void) | null = null;
    /** Callback when selected node changes. Provides node ID (empty = deselected). */
    onSelectionChanged: ((nodeId: string) => void) | null = null;
    /** Callback for double-click on a node. */
    onDoubleClick: ((nodeId: string) => void) | null = null;
    private hoveredBadgeNodeId = "";
    private _rootNodeId = "";
    private searchMatches: Set<string> | null = null;
    private highlightSet: Set<string> | null = null;
    private externalHoverId = "";
    private _lastClientX = 0;
    private _lastClientY = 0;

    // =========================================================================
    // Public API
    // =========================================================================

    setCanvas(canvas: HTMLCanvasElement | null): void {
        if (this.canvas === canvas) return;

        this.cleanupCanvas();
        this.canvas = canvas;

        if (canvas) {
            this.simulation = d3.forceSimulation<GraphNode, GraphLink>([]);
            this.simulation.on("tick", this.renderData);
            this.addDrag();
            this.addZoom();
            this.handleResize();

            this.resizeObserver = new ResizeObserver(() => this.handleResize());
            this.resizeObserver.observe(canvas);

            // If data was loaded before canvas was ready, apply it now
            if (this.graphData.nodes.length > 0) {
                this.simulation.nodes(this.graphData.nodes);
                this.initializeForces(this.graphData.links);
            }
        }
    }

    updateData(graphData: GraphData): void {
        this.graphData = graphData;
        this.activeId = "";
        this.activeChild = new Set();
        this.hoveredId = "";
        this.hoveredChild = new Set();

        if (this.simulation) {
            this.simulation.nodes(graphData.nodes);
            this.initializeForces(graphData.links);
        }
    }

    /** Update with new visible data, preserving positions of existing nodes.
     *  @param anchorNodeId — optional node ID near which to place newly appearing nodes.
     *  @param newNodePositions — explicit world positions for brand-new nodes (e.g. from context menu "Add Node"). */
    updateVisibleData(graphData: GraphData, anchorNodeId?: string, newNodePositions?: Map<string, { x: number; y: number }>): void {
        // Save positions of current nodes
        const positions = new Map<string, { x: number; y: number; vx?: number; vy?: number }>();
        for (const node of this.graphData.nodes) {
            if (node.x !== undefined && node.y !== undefined) {
                positions.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
            }
        }

        // Anchor position: where new nodes should appear (near the clicked node)
        const anchor = anchorNodeId ? positions.get(anchorNodeId) : undefined;

        // Restore positions for existing nodes; place new nodes near anchor or at explicit positions
        for (const node of graphData.nodes) {
            const pos = positions.get(node.id);
            if (pos) {
                node.x = pos.x;
                node.y = pos.y;
                node.vx = pos.vx;
                node.vy = pos.vy;
            } else if (newNodePositions?.has(node.id)) {
                const hint = newNodePositions.get(node.id)!;
                node.x = hint.x;
                node.y = hint.y;
            } else if (anchor) {
                // New node — place near anchor with small random offset so they spread out
                node.x = anchor.x + (Math.random() - 0.5) * 20;
                node.y = anchor.y + (Math.random() - 0.5) * 20;
            }
        }

        this.graphData = graphData;

        // Clear selection if the selected node is no longer visible
        const nodeIds = new Set(graphData.nodes.map((n) => n.id));
        if (this.activeId && !nodeIds.has(this.activeId)) {
            this.activeId = "";
            this.activeChild = new Set();
        }
        if (this.hoveredId && !nodeIds.has(this.hoveredId) && !this.externalHoverId) {
            this.hoveredId = "";
            this.hoveredChild = new Set();
        }

        if (this.simulation) {
            this.simulation.nodes(graphData.nodes);
            this.initializeForces(graphData.links);
        }
    }

    /** Re-resolve CSS variable colors (call on theme change). */
    refreshColors(): void {
        const next = resolveColors();
        if (next.nodeDefault === this.colors.nodeDefault && next.labelBg === this.colors.labelBg) return;
        this.colors = next;
        this.renderData();
    }

    /** Set of node IDs matching search. Null = no search active. */
    setSearchMatches(matchIds: Set<string> | null): void {
        this.searchMatches = matchIds;
        this.renderData();
    }

    /** Set of node IDs to highlight (e.g. links tab). Null = no highlight active. */
    setHighlightSet(ids: Set<string> | null): void {
        this.highlightSet = ids;
        this.renderData();
    }

    /** Set hover state from external source (e.g. grid row focus). Empty string clears. */
    setExternalHover(id: string): void {
        this.externalHoverId = id;
        if (this.hoveredId === id) return;
        this.hoveredId = id;
        this.hoveredChild = id ? this.getNeighborIds(id) : new Set();
        this.renderData();
        // Don't fire onHoverChanged — tooltip is not meaningful for external hover
    }

    /** Whether a node is currently being dragged. */
    get isDragging(): boolean {
        return this.isDraggingNode;
    }

    /** Currently selected (active) node ID. */
    get selectedId(): string {
        return this.activeId;
    }

    /** Programmatically select a node. */
    selectNode(nodeId: string): void {
        this.setActiveId(nodeId);
    }

    /** Convert screen coordinates (clientX/clientY) to world coordinates (D3 simulation space). */
    screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
        if (!this.canvas) return { x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: this.transform.invertX(clientX - rect.left),
            y: this.transform.invertY(clientY - rect.top),
        };
    }

    /** Get current visible nodes (for search matching). */
    getNodes(): GraphNode[] {
        return this.graphData.nodes;
    }

    /** Get current force parameters. */
    get forceParams(): Readonly<ForceParams> {
        return this._forceParams;
    }

    /** Get default force parameters. */
    static get defaultForceParams(): Readonly<ForceParams> {
        return defaultForceParams;
    }

    /** Update force parameters and restart simulation. */
    updateForceParams(params: Partial<ForceParams>): void {
        Object.assign(this._forceParams, params);
        this.applyTunedForces();
    }

    /** Reset force parameters to defaults and restart simulation. */
    resetForceParams(): void {
        this._forceParams = { ...defaultForceParams };
        this.applyTunedForces();
    }

    /** Set initial force params from saved options (before first render, no simulation restart). */
    setInitialForceParams(params: Partial<ForceParams>): void {
        Object.assign(this._forceParams, params);
    }

    /** Set the root node ID for visual distinction (compass shape, level-1 radius). */
    set rootNodeId(id: string) {
        if (this._rootNodeId === id) return;
        this._rootNodeId = id;
        this.renderData();
    }

    get rootNodeId(): string {
        return this._rootNodeId;
    }

    /** Apply tuned force params without recreating link force. */
    private applyTunedForces(): void {
        if (!this.simulation) return;
        const { width, height } = this.dimensions;
        if (width === 0 || height === 0) return;

        this.applyPositionForces(width, height);

        // Update existing link force distance (don't recreate)
        const linkForce = this.simulation.force("link") as d3.ForceLink<GraphNode, GraphLink> | null;
        if (linkForce) {
            linkForce.distance(this._forceParams.linkDistance);
        }

        this.simulation.alpha(1).restart();
    }

    dispose(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.simulation?.stop();
        this.simulation = null;
        this.canvas = null;
    }

    // =========================================================================
    // Canvas event handlers (bound for React)
    // =========================================================================

    onClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
        // Close any open popup menu on left-click
        closeAppPopupMenu();

        // Badge click takes priority — expand hidden neighbors
        const badgeNode = this.findBadgeAt(event);
        if (badgeNode && this.onBadgeExpand) {
            this.onBadgeExpand(badgeNode.id, event.ctrlKey);
            return;
        }

        const node = this.findNodeAt(event);

        // Alt+Click → toggle link with selected node
        if (event.altKey && node && this.onAltClick) {
            this.onAltClick(node.id);
            return;
        }

        this.setActiveId(node?.id ?? "");
    };

    onContextMenu = (event: React.MouseEvent<HTMLCanvasElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        const node = this.findNodeAt(event);
        this.onContextMenuAction?.(node?.id ?? "", event.clientX, event.clientY);
    };

    onMouseMove = (event: React.MouseEvent<HTMLCanvasElement>): void => {
        this._lastClientX = event.clientX;
        this._lastClientY = event.clientY;

        const badgeNode = this.findBadgeAt(event);
        const prevBadgeId = this.hoveredBadgeNodeId;
        this.hoveredBadgeNodeId = badgeNode?.id ?? "";

        // Update cursor for badge hover
        if (this.canvas) {
            this.canvas.style.cursor = badgeNode ? "pointer" : "";
        }

        // Re-render if badge hover state changed (for highlight effect)
        if (prevBadgeId !== this.hoveredBadgeNodeId) {
            this.renderData();
        }

        // Skip mouse hover when external hover is active (e.g. grid row focus)
        if (!this.externalHoverId) {
            const node = this.findNodeAt(event);
            this.setHoveredId(node?.id ?? "");
        }
    };

    onDblClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
        const node = this.findNodeAt(event);
        if (node) {
            this.onDoubleClick?.(node.id);
        }
    };

    // =========================================================================
    // Internals — dimensions
    // =========================================================================

    private handleResize = (): void => {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        if (width === this.dimensions.width && height === this.dimensions.height) return;
        this.dimensions = { width, height };

        if (width > 0 && height > 0) {
            const dpr = window.devicePixelRatio || 1;
            const ctx = this.canvas.getContext("2d");
            if (ctx) {
                this.canvas.width = width * dpr;
                this.canvas.height = height * dpr;
                ctx.scale(dpr, dpr);
            }
        }

        // Re-apply position forces with new center (don't recreate link force)
        setTimeout(() => this.updatePositionForces(), 0);
    };

    // =========================================================================
    // Internals — simulation forces
    // =========================================================================

    /**
     * Full force setup including link force. Call only when graph data changes
     * (nodes must already be set on simulation before this is called).
     */
    private initializeForces(links: GraphLink[]): void {
        const { width, height } = this.dimensions;
        if (!this.simulation || width === 0 || height === 0) return;

        this.applyPositionForces(width, height);

        this.simulation.force(
            "link",
            forceProperties.link.enabled
                ? d3.forceLink<GraphNode, GraphLink>(links)
                    .id((d) => d.id)
                    .distance(this._forceParams.linkDistance)
                    .iterations(forceProperties.link.iterations)
                : null,
        );

        this.simulation.alpha(1).restart();
    }

    /**
     * Update only position-related forces (center, charge, collide, forceX, forceY).
     * Safe to call on resize — does not recreate the link force.
     */
    private updatePositionForces(): void {
        const { width, height } = this.dimensions;
        if (!this.simulation || width === 0 || height === 0) return;

        this.applyPositionForces(width, height);
        this.simulation.alpha(1).restart();
    }

    private applyPositionForces(width: number, height: number): void {
        if (!this.simulation) return;

        this.simulation
            .force(
                "center",
                forceProperties.center.enabled
                    ? d3.forceCenter(width * forceProperties.center.x, height * forceProperties.center.y)
                    : null,
            )
            .force(
                "charge",
                forceProperties.charge.enabled
                    ? d3.forceManyBody()
                        .strength(this._forceParams.charge)
                        .distanceMin(forceProperties.charge.distanceMin)
                        .distanceMax(forceProperties.charge.distanceMax)
                    : null,
            )
            .force(
                "collide",
                forceProperties.collide.enabled
                    ? d3.forceCollide<GraphNode>()
                        .strength(this._forceParams.collide)
                        .radius((d) => (this._rootNodeId && d.id === this._rootNodeId ? levelRadii[0] : nodeRadius(d)) + 1)
                        .iterations(forceProperties.collide.iterations)
                    : null,
            )
            .force(
                "forceX",
                forceProperties.forceX.enabled
                    ? d3.forceX<GraphNode>()
                        .strength(forceProperties.forceX.strength)
                        .x(width * forceProperties.forceX.x)
                    : null,
            )
            .force(
                "forceY",
                forceProperties.forceY.enabled
                    ? d3.forceY<GraphNode>()
                        .strength(forceProperties.forceY.strength)
                        .y(height * forceProperties.forceY.y)
                    : null,
            );
    }

    // =========================================================================
    // Internals — zoom & drag
    // =========================================================================

    private addZoom(): void {
        if (!this.canvas) return;

        const zoomBehavior = d3Zoom<HTMLCanvasElement, unknown>()
            .scaleExtent([0.1, 12])
            .filter((event) => !this.isDraggingNode && !event.button && event.buttons !== 2)
            .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
                this.transform = event.transform;
                this.renderData();
                // Clear tooltip during zoom (but preserve external hover)
                if (this.hoveredId && !this.externalHoverId) {
                    this.hoveredId = "";
                    this.hoveredChild = new Set();
                    this.onHoverChanged?.("", 0, 0);
                }
            });

        const sel = d3.select(this.canvas);
        sel.call(zoomBehavior);
        // Disable d3-zoom's built-in double-click zoom (mouse wheel is sufficient)
        sel.on("dblclick.zoom", null);
    }

    private addDrag(): void {
        if (!this.canvas) return;

        const dragBehavior = d3Drag<HTMLCanvasElement, unknown>()
            .filter((event) => event.button === 0)
            .subject((event) => {
                const node = this.findNode(event.x, event.y);
                if (node) {
                    node.fx = node.x;
                    node.fy = node.y;
                    return node;
                }
                return null;
            })
            .on("start", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
                if (!event.subject) return;
                this.isDraggingNode = true;
                this.simulation?.alphaTarget(0.2).restart();
            })
            .on("drag", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
                if (!event.subject || !this.canvas) return;
                const canvasRect = this.canvas.getBoundingClientRect();
                const mouseX = event.sourceEvent.clientX - canvasRect.left;
                const mouseY = event.sourceEvent.clientY - canvasRect.top;
                event.subject.fx = this.transform.invertX(mouseX);
                event.subject.fy = this.transform.invertY(mouseY);
            })
            .on("end", (event: D3DragEvent<HTMLCanvasElement, unknown, GraphNode>) => {
                if (!event.subject) return;
                event.subject.fx = null;
                event.subject.fy = null;
                this.isDraggingNode = false;
                this.simulation?.alphaTarget(0);
            });

        d3.select(this.canvas).call(dragBehavior);
    }

    // =========================================================================
    // Internals — node lookup
    // =========================================================================

    private findNode(x: number, y: number): GraphNode | undefined {
        const tx = this.transform.invertX(x);
        const ty = this.transform.invertY(y);
        return this.graphData.nodes.find((node) => {
            const dx = tx - (node.x || 0);
            const dy = ty - (node.y || 0);
            const r = this._rootNodeId && node.id === this._rootNodeId ? levelRadii[0] : nodeRadius(node);
            return Math.sqrt(dx * dx + dy * dy) <= r;
        });
    }

    private findNodeAt(event: React.MouseEvent<HTMLCanvasElement>): GraphNode | undefined {
        if (!this.canvas) return undefined;
        const rect = this.canvas.getBoundingClientRect();
        return this.findNode(event.clientX - rect.left, event.clientY - rect.top);
    }

    /** Compute badge radius from hidden neighbor count. */
    private badgeRadius(hiddenCount: number): number {
        return Math.max(3, 2 + String(hiddenCount).length);
    }

    /** Hit-test the "+" badge on a node. Returns the node that owns the badge, or undefined. */
    private findBadgeAt(event: React.MouseEvent<HTMLCanvasElement>): GraphNode | undefined {
        if (!this.canvas || this.transform.k <= 0.5) return undefined;
        const rect = this.canvas.getBoundingClientRect();
        const tx = this.transform.invertX(event.clientX - rect.left);
        const ty = this.transform.invertY(event.clientY - rect.top);

        for (const d of this.graphData.nodes) {
            const hiddenCount = d._$hiddenCount ?? 0;
            if (hiddenCount <= 0) continue;

            const r = this._rootNodeId && d.id === this._rootNodeId ? levelRadii[0] : nodeRadius(d);
            const badgeX = (d.x || 0) + r * 0.7;
            const badgeY = (d.y || 0) - r * 0.7;
            const badgeR = this.badgeRadius(hiddenCount);

            const dx = tx - badgeX;
            const dy = ty - badgeY;
            if (dx * dx + dy * dy <= badgeR * badgeR) return d;
        }
        return undefined;
    }

    // =========================================================================
    // Internals — active/hovered state
    // =========================================================================

    private setActiveId(id: string): void {
        const changed = this.activeId !== id;
        this.activeId = id;
        this.activeChild = id ? this.getNeighborIds(id) : new Set();
        this.renderData();
        if (changed) this.onSelectionChanged?.(id);
    }

    private setHoveredId(id: string): void {
        const changed = this.hoveredId !== id;
        this.hoveredId = id;
        this.hoveredChild = id ? this.getNeighborIds(id) : new Set();
        this.renderData();
        if (changed) this.onHoverChanged?.(id, this._lastClientX, this._lastClientY);
    }

    private getNeighborIds(nodeId: string): Set<string> {
        const ids = this.graphData.links
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

    // =========================================================================
    // Internals — color helpers
    // =========================================================================

    private nodeColor(node: GraphNode, state: ActiveState): string {
        const c = this.colors;
        if (node.id === state.activeId) return c.nodeSelected;
        if (node.id === state.hoveredId) return c.nodeHighlight;
        return c.nodeDefault;
    }

    private nodeBorderColor(node: GraphNode, state: ActiveState): string {
        const c = this.colors;
        if (state.activeChild.has(node.id)) return c.borderSelected;
        if (node.id === state.hoveredId) return c.borderHighlight;
        if (node.id === state.activeId) return c.borderSelected;
        if (state.hoveredChild.has(node.id)) return c.borderHighlight;
        return c.borderDefault;
    }

    private linkColor(link: GraphLink, state: ActiveState): string {
        const c = this.colors;
        const { source, target } = linkIds(link);
        // Green highlight for the link between selected and hovered node
        if (state.hoveredId && state.activeId
            && ((source === state.activeId && target === state.hoveredId)
             || (target === state.activeId && source === state.hoveredId))) {
            return c.borderHighlight;
        }
        return source === state.activeId || target === state.activeId
            ? c.linkSelected
            : c.linkDefault;
    }

    // =========================================================================
    // Internals — shape drawing
    // =========================================================================

    private drawShape(ctx: CanvasRenderingContext2D, shape: NodeShape | "compass" | undefined, x: number, y: number, r: number): void {
        ctx.beginPath();
        switch (shape) {
            case "square":
                ctx.rect(x - r, y - r, r * 2, r * 2);
                break;
            case "diamond": {
                const dy = r * 1.2;
                ctx.moveTo(x, y - dy);
                ctx.lineTo(x + r, y);
                ctx.lineTo(x, y + dy);
                ctx.lineTo(x - r, y);
                ctx.closePath();
                break;
            }
            case "triangle": {
                const h = r * 1.15;
                ctx.moveTo(x, y - h);
                ctx.lineTo(x + r, y + h * 0.6);
                ctx.lineTo(x - r, y + h * 0.6);
                ctx.closePath();
                break;
            }
            case "star": {
                const spikes = 5;
                const outerR = r * 1.1;
                const innerR = r * 0.5;
                for (let i = 0; i < spikes * 2; i++) {
                    const angle = (i * Math.PI) / spikes - Math.PI / 2;
                    const rad = i % 2 === 0 ? outerR : innerR;
                    const px = x + rad * Math.cos(angle);
                    const py = y + rad * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                break;
            }
            case "compass": {
                const spikes = 4;
                const outerR = r * 1.2;
                const innerR = r * 0.4;
                for (let i = 0; i < spikes * 2; i++) {
                    const angle = (i * Math.PI) / spikes - Math.PI / 2;
                    const rad = i % 2 === 0 ? outerR : innerR;
                    const px = x + rad * Math.cos(angle);
                    const py = y + rad * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                break;
            }
            case "hexagon":
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI) / 3 - Math.PI / 6;
                    const px = x + r * Math.cos(angle);
                    const py = y + r * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                break;
            default: // "circle" or undefined
                ctx.arc(x, y, r, 0, 2 * Math.PI);
                break;
        }
    }

    // =========================================================================
    // Internals — canvas rendering
    // =========================================================================

    private renderData = (): void => {
        const ctx = this.canvas?.getContext("2d");
        if (!ctx) return;

        ctx.save();
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        const { transform, graphData, activeId, activeChild, hoveredId, hoveredChild, searchMatches, highlightSet } = this;
        const activeState: ActiveState = { activeId, activeChild, hoveredId, hoveredChild };
        // Merge dimming: if both active, intersect; if one active, use that one
        const dimSet = searchMatches && highlightSet
            ? new Set([...searchMatches].filter((id) => highlightSet.has(id)))
            : searchMatches ?? highlightSet;
        const dimming = dimSet !== null;

        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);

        // Draw links
        graphData.links.forEach((d) => {
            if (dimming) {
                const { source, target } = linkIds(d);
                ctx.globalAlpha = dimSet!.has(source) || dimSet!.has(target) ? 1.0 : 0.15;
            }
            ctx.beginPath();
            ctx.moveTo((d.source as GraphNode).x || 0, (d.source as GraphNode).y || 0);
            ctx.lineTo((d.target as GraphNode).x || 0, (d.target as GraphNode).y || 0);
            const linkCol = this.linkColor(d, activeState);
            ctx.strokeStyle = linkCol;
            ctx.lineWidth = linkCol === this.colors.borderHighlight ? 2 : 0.5;
            ctx.stroke();
        });

        // Draw nodes
        const rootId = this._rootNodeId;
        graphData.nodes.forEach((d) => {
            if (dimming) ctx.globalAlpha = dimSet!.has(d.id) ? 1.0 : 0.15;
            const isRoot = rootId !== "" && d.id === rootId;
            const r = isRoot ? levelRadii[0] : nodeRadius(d);
            const shape = isRoot ? "compass" as const : d.shape;
            this.drawShape(ctx, shape, d.x || 0, d.y || 0, r);
            ctx.fillStyle = this.nodeColor(d, activeState);
            ctx.fill();
            ctx.strokeStyle = this.nodeBorderColor(d, activeState);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });

        if (dimming) ctx.globalAlpha = 1.0;

        // Draw "+" badges on nodes with hidden neighbors
        if (transform.k > 0.5) {
            const c = this.colors;
            ctx.font = "bold 5px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            graphData.nodes.forEach((d) => {
                const hiddenCount = d._$hiddenCount ?? 0;
                if (hiddenCount > 0) {
                    if (dimming) ctx.globalAlpha = dimSet!.has(d.id) ? 1.0 : 0.15;
                    const isRoot = rootId !== "" && d.id === rootId;
                    const r = isRoot ? levelRadii[0] : nodeRadius(d);
                    const badgeX = (d.x || 0) + r * 0.7;
                    const badgeY = (d.y || 0) - r * 0.7;
                    const badgeR = this.badgeRadius(hiddenCount);
                    const isHovered = d.id === this.hoveredBadgeNodeId;

                    ctx.beginPath();
                    ctx.arc(badgeX, badgeY, badgeR, 0, 2 * Math.PI);
                    ctx.fillStyle = isHovered ? c.nodeSelected : c.nodeHighlight;
                    ctx.fill();
                    ctx.strokeStyle = isHovered ? c.borderSelected : c.borderHighlight;
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    ctx.fillStyle = c.labelText;
                    ctx.fillText(`+${hiddenCount}`, badgeX, badgeY);
                }
            });
        }

        if (dimming) ctx.globalAlpha = 1.0;

        // Draw labels at sufficient zoom
        if (transform.k > 0.8) {
            const c = this.colors;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            graphData.nodes.forEach((d) => {
                const isHighlighted =
                    d.id === activeState.activeId ||
                    d.id === activeState.hoveredId ||
                    activeState.activeChild.has(d.id) ||
                    activeState.hoveredChild.has(d.id);
                const isRoot = rootId !== "" && d.id === rootId;
                const isImportant = isRoot || (typeof d.level === "number" && d.level >= 1 && d.level <= 2);

                if (isHighlighted || isImportant) {
                    if (dimming) ctx.globalAlpha = dimSet!.has(d.id) ? 1.0 : 0.15;
                    const text = nodeLabel(d);
                    const r = isRoot ? levelRadii[0] : nodeRadius(d);
                    const paddingY = 1;
                    const paddingX = 2;

                    const textWidth = ctx.measureText(text).width;
                    const textHeight = 10;

                    const labelX = (d.x || 0) + r + 4;
                    const labelY = d.y || 0;

                    // Label background
                    ctx.fillStyle = c.labelBg;
                    ctx.fillRect(
                        labelX - paddingX,
                        labelY - textHeight / 2 - paddingY,
                        textWidth + 2 * paddingX,
                        textHeight + 2 * paddingY,
                    );

                    // Label text
                    ctx.fillStyle = c.labelText;
                    ctx.fillText(text, labelX, labelY);
                }
            });
        }

        if (dimming) ctx.globalAlpha = 1.0;
        ctx.restore();
    };

    private cleanupCanvas(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.simulation?.stop();
        this.simulation = null;
    }
}
