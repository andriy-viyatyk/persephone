import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { TextFileModel } from "../text/TextPageModel";
import { isCurrentThemeDark } from "../../theme/themes";
import { renderMermaid } from "./render-mermaid";

// =============================================================================
// State
// =============================================================================

export const defaultMermaidViewState = {
    svgUrl: "",
    error: "",
    loading: true,
    lightMode: false,
};

export type MermaidViewState = typeof defaultMermaidViewState;

// =============================================================================
// ViewModel
// =============================================================================

export class MermaidViewModel extends ContentViewModel<MermaidViewState> {
    private _renderTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(host: IContentHost) {
        super(host, defaultMermaidViewState);
    }

    get pageModel(): TextFileModel {
        return this.host as unknown as TextFileModel;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        // Set initial lightMode from current theme
        this.state.update((s) => {
            s.lightMode = !isCurrentThemeDark();
        });

        // Watch lightMode changes → re-render
        let lastLightMode = this.state.get().lightMode;
        const unsub = this.state.subscribe(() => {
            const { lightMode } = this.state.get();
            if (lightMode !== lastLightMode) {
                lastLightMode = lightMode;
                this.renderDebounced();
            }
        });
        this.addSubscription(unsub);

        // Cleanup pending timeout on dispose
        this.addSubscription(() => clearTimeout(this._renderTimer));

        // Initial render
        this.renderDebounced();
    }

    protected onContentChanged(): void {
        this.renderDebounced();
    }

    protected onDispose(): void {
        clearTimeout(this._renderTimer);
    }

    // =========================================================================
    // Rendering
    // =========================================================================

    private renderDebounced(): void {
        clearTimeout(this._renderTimer);
        this.state.update((s) => { s.loading = true; });

        this._renderTimer = setTimeout(() => {
            const content = this.host.state.get().content;
            const { lightMode } = this.state.get();

            renderMermaid(content, lightMode)
                .then((url) => {
                    this.state.update((s) => {
                        s.svgUrl = url;
                        s.error = "";
                        s.loading = false;
                    });
                })
                .catch((e) => {
                    this.state.update((s) => {
                        s.error = e.message || "Failed to render diagram";
                        s.loading = false;
                    });
                });
        }, 400);
    }

    // =========================================================================
    // Actions
    // =========================================================================

    toggleLightMode = () => {
        this.state.update((s) => {
            s.lightMode = !s.lightMode;
        });
    };
}

// =============================================================================
// Factory
// =============================================================================

export function createMermaidViewModel(host: IContentHost): MermaidViewModel {
    return new MermaidViewModel(host);
}
