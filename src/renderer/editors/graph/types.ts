import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";

/** Prefix for runtime-computed system properties on GraphNode (avoid collision with user custom properties). */
export const SYS_PREFIX = "_$";

export type NodeShape = "circle" | "square" | "diamond" | "triangle" | "star" | "hexagon";

export interface GraphNode extends SimulationNodeDatum {
    id: string;
    title?: string;
    level?: number;
    shape?: NodeShape;
    _$showIndex?: number;      // runtime: BFS discovery order
    _$hiddenCount?: number;    // runtime: count of hidden neighbors
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
    source: string | GraphNode;
    target: string | GraphNode;
}

export interface GraphOptions {
    rootNode?: string;     // Root node ID for BFS expansion (renamed from focus)
    expandDepth?: number;  // BFS depth limit from root
    maxVisible?: number;   // Hard ceiling on visible nodes (default 500)
    // Physics tuning (persisted)
    charge?: number;
    linkDistance?: number;
    collide?: number;
}

export interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
    options?: GraphOptions;
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

// =============================================================================
// Custom properties
// =============================================================================

/** Keys excluded from custom property enumeration (core, presentation, D3 sim). */
const CUSTOM_PROP_EXCLUDED_KEYS = new Set([
    "id", "title", "level", "shape",
    "x", "y", "vx", "vy", "fx", "fy", "index",
]);

/** Format an arbitrary value as a display string. */
export function formatPropertyValue(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const json = JSON.stringify(value);
    return json.length > 100 ? json.slice(0, 97) + "..." : json;
}

/** Get custom (non-core, non-system) properties from a GraphNode as [key, formattedValue] pairs. */
export function getCustomProperties(node: GraphNode): Array<[string, string]> {
    const result: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(node)) {
        if (CUSTOM_PROP_EXCLUDED_KEYS.has(key) || key.startsWith(SYS_PREFIX)) continue;
        if (value === undefined) continue;
        result.push([key, formatPropertyValue(value)]);
    }
    return result;
}

/** Check if a key is reserved (core, presentation, D3, or system prefix). */
export function isReservedPropertyKey(key: string): boolean {
    return CUSTOM_PROP_EXCLUDED_KEYS.has(key) || key.startsWith(SYS_PREFIX);
}

// =============================================================================
// Node radius
// =============================================================================

export const levelRadii = [14, 11, 8, 6, 4];

export function nodeRadius(node: GraphNode): number {
    const level = node.level;
    if (typeof level === "number" && level >= 1 && level <= 5) return levelRadii[level - 1];
    return 4; // invalid or missing level → level 5 (smallest)
}
