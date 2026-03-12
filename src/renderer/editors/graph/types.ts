import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";

export type NodeShape = "circle" | "square" | "diamond" | "triangle" | "star" | "hexagon";

export interface GraphNode extends SimulationNodeDatum {
    id: string;
    title?: string;
    level?: number;
    shape?: NodeShape;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
    source: string | GraphNode;
    target: string | GraphNode;
}

export interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
}

export function linkIds(link: GraphLink): { source: string; target: string } {
    return {
        source: typeof link.source === "string" ? link.source : link.source.id,
        target: typeof link.target === "string" ? link.target : link.target.id,
    };
}

export function nodeLabel(node: GraphNode): string {
    return node.title || node.id;
}

const levelRadii = [14, 11, 8, 6, 4];

export function nodeRadius(node: GraphNode): number {
    const level = node.level;
    if (typeof level === "number" && level >= 1 && level <= 5) return levelRadii[level - 1];
    return 4; // invalid or missing level → level 5 (smallest)
}
