import * as d3 from "d3";
import { zoom as d3Zoom, D3ZoomEvent } from "d3-zoom";
import { drag as d3Drag, D3DragEvent } from "d3-drag";
import { GraphData, GraphNode, GraphLink, NodeShape, linkIds, nodeLabel, nodeRadius } from "./types";
import { forceProperties } from "./constants";
import color from "../../theme/color";

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
export class ForceGraphRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
    private isDraggingNode = false;
    private graphData: GraphData = { nodes: [], links: [] };
    private dimensions = { width: 0, height: 0 };
    private transform = d3.zoomIdentity;

    private activeId = "";
    private activeChild = new Set<string>();
    private hoveredId = "";
    private hoveredChild = new Set<string>();

    private colors: ResolvedColors = resolveColors();
    private resizeObserver: ResizeObserver | null = null;

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

    /** Re-resolve CSS variable colors (call on theme change). */
    refreshColors(): void {
        this.colors = resolveColors();
        this.renderData();
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
        const node = this.findNodeAt(event);
        this.setActiveId(node?.id ?? "");
    };

    onMouseMove = (event: React.MouseEvent<HTMLCanvasElement>): void => {
        const node = this.findNodeAt(event);
        this.setHoveredId(node?.id ?? "");
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
                    .distance(forceProperties.link.distance)
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
                        .strength(forceProperties.charge.strength)
                        .distanceMin(forceProperties.charge.distanceMin)
                        .distanceMax(forceProperties.charge.distanceMax)
                    : null,
            )
            .force(
                "collide",
                forceProperties.collide.enabled
                    ? d3.forceCollide<GraphNode>()
                        .strength(forceProperties.collide.strength)
                        .radius((d) => nodeRadius(d) + 1)
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
            });

        d3.select(this.canvas).call(zoomBehavior);
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
            return Math.sqrt(dx * dx + dy * dy) <= nodeRadius(node);
        });
    }

    private findNodeAt(event: React.MouseEvent<HTMLCanvasElement>): GraphNode | undefined {
        if (!this.canvas) return undefined;
        const rect = this.canvas.getBoundingClientRect();
        return this.findNode(event.clientX - rect.left, event.clientY - rect.top);
    }

    // =========================================================================
    // Internals — active/hovered state
    // =========================================================================

    private setActiveId(id: string): void {
        this.activeId = id;
        this.activeChild = id ? this.getNeighborIds(id) : new Set();
        this.renderData();
    }

    private setHoveredId(id: string): void {
        this.hoveredId = id;
        this.hoveredChild = id ? this.getNeighborIds(id) : new Set();
        this.renderData();
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
        return source === state.activeId || target === state.activeId
            ? c.linkSelected
            : c.linkDefault;
    }

    // =========================================================================
    // Internals — shape drawing
    // =========================================================================

    private drawShape(ctx: CanvasRenderingContext2D, shape: NodeShape | undefined, x: number, y: number, r: number): void {
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

        const { transform, graphData, activeId, activeChild, hoveredId, hoveredChild } = this;
        const activeState: ActiveState = { activeId, activeChild, hoveredId, hoveredChild };

        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);

        // Draw links
        graphData.links.forEach((d) => {
            ctx.beginPath();
            ctx.moveTo((d.source as GraphNode).x || 0, (d.source as GraphNode).y || 0);
            ctx.lineTo((d.target as GraphNode).x || 0, (d.target as GraphNode).y || 0);
            ctx.strokeStyle = this.linkColor(d, activeState);
            ctx.lineWidth = 0.5;
            ctx.stroke();
        });

        // Draw nodes
        graphData.nodes.forEach((d) => {
            const r = nodeRadius(d);
            this.drawShape(ctx, d.shape, d.x || 0, d.y || 0, r);
            ctx.fillStyle = this.nodeColor(d, activeState);
            ctx.fill();
            ctx.strokeStyle = this.nodeBorderColor(d, activeState);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });

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
                const isImportant = typeof d.level === "number" && d.level >= 1 && d.level <= 2;

                if (isHighlighted || isImportant) {
                    const text = nodeLabel(d);
                    const r = nodeRadius(d);
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

        ctx.restore();
    };

    private cleanupCanvas(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.simulation?.stop();
        this.simulation = null;
    }
}
