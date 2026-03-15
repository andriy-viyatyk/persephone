import { GraphNode, nodeLabel, getCustomProperties } from "./types";
import { GraphVisibilityModel } from "./GraphVisibilityModel";
import { ForceGraphRenderer } from "./ForceGraphRenderer";

// =============================================================================
// Search types
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

// =============================================================================
// Search matching (pure function)
// =============================================================================

/** Match a node against multi-word search. Returns result details or null if no match. */
export function matchNodeSearch(
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
// GraphSearchModel — owns search computation logic
// =============================================================================

/**
 * Encapsulates search query matching and result computation.
 * Does NOT own state — ViewModel maintains searchQuery/searchInfo/searchResults
 * in its GraphViewState. SearchModel is a logic helper that ViewModel calls.
 */
export class GraphSearchModel {
    private readonly renderer: ForceGraphRenderer;
    private readonly visibilityModel: GraphVisibilityModel;

    constructor(renderer: ForceGraphRenderer, visibilityModel: GraphVisibilityModel) {
        this.renderer = renderer;
        this.visibilityModel = visibilityModel;
    }

    /**
     * Compute search results for the given query.
     * Returns null if query is empty, otherwise returns search state.
     */
    computeSearch(query: string): {
        matchIds: Set<string>;
        searchInfo: SearchInfo;
        searchResults: SearchResult[] | null;
    } | null {
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) return null;

        const words = trimmed.split(/\s+/).filter(Boolean);

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

        return {
            matchIds: matchIds.size > 0 ? matchIds : new Set(),
            searchInfo: { visible: matchIds.size, hidden: hiddenResults.length, total: visibleNodes.length },
            searchResults: allResults.length > 0 ? allResults : null,
        };
    }

    /**
     * Reveal hidden nodes that match the current search results.
     * Returns true if visibility changed and a recompute is needed.
     */
    revealHiddenMatches(searchResults: SearchResult[] | null): boolean {
        if (!this.visibilityModel.active || !searchResults) return false;

        const hiddenIds = searchResults.filter((r) => !r.visible).map((r) => r.nodeId);
        if (hiddenIds.length === 0) return false;

        const changed = this.visibilityModel.revealPaths(hiddenIds);
        if (!changed) return false;

        const visibleGraph = this.visibilityModel.getVisibleGraph();
        this.renderer.updateVisibleData(visibleGraph);
        return true;
    }

    /**
     * Reveal a hidden node and select it.
     * Returns true if visibility changed and a recompute is needed.
     */
    revealAndSelectNode(nodeId: string): boolean {
        let visibilityChanged = false;

        if (this.visibilityModel.active && !this.visibilityModel.isNodeVisible(nodeId)) {
            const changed = this.visibilityModel.revealPaths([nodeId]);
            if (changed) {
                const visibleGraph = this.visibilityModel.getVisibleGraph();
                this.renderer.updateVisibleData(visibleGraph);
                visibilityChanged = true;
            }
        }

        this.renderer.selectNode(nodeId);
        return visibilityChanged;
    }
}
