import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { GraphData } from "./types";
import { ForceGraphRenderer } from "./ForceGraphRenderer";

// =============================================================================
// State
// =============================================================================

export const defaultGraphViewState = {
    graphData: null as GraphData | null,
    error: "",
    loading: true,
};

export type GraphViewState = typeof defaultGraphViewState;

// =============================================================================
// ViewModel
// =============================================================================

export class GraphViewModel extends ContentViewModel<GraphViewState> {
    readonly renderer = new ForceGraphRenderer();
    private _parseTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(host: IContentHost) {
        super(host, defaultGraphViewState);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        this.addSubscription(() => clearTimeout(this._parseTimer));
        this.parseContent();
    }

    protected onContentChanged(): void {
        this.parseDebounced();
    }

    protected onDispose(): void {
        clearTimeout(this._parseTimer);
        this.renderer.dispose();
    }

    // =========================================================================
    // Theme support
    // =========================================================================

    refreshColors(): void {
        this.renderer.refreshColors();
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
            this.state.update((s) => {
                s.graphData = null;
                s.error = "";
                s.loading = false;
            });
            return;
        }

        try {
            const json = JSON.parse(content);
            const graphData: GraphData = {
                nodes: Array.isArray(json.nodes) ? json.nodes : [],
                links: Array.isArray(json.links) ? json.links : [],
            };

            this.state.update((s) => {
                s.graphData = graphData;
                s.error = "";
                s.loading = false;
            });

            // Deep copy for D3 mutation safety
            const copy: GraphData = JSON.parse(JSON.stringify(graphData));
            this.renderer.updateData(copy);
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
