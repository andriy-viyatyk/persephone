import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { serializeAsJSON, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { isCurrentThemeDark } from "../../theme/themes";

// =============================================================================
// State
// =============================================================================

export interface DrawViewState {
    loading: boolean;
    error: string | null;
    /** Editor-local dark/light mode, initially synced with app theme. */
    darkMode: boolean;
}

export const defaultDrawViewState: DrawViewState = {
    loading: true,
    error: null,
    darkMode: true,
};

// =============================================================================
// ViewModel
// =============================================================================

export class DrawViewModel extends ContentViewModel<DrawViewState> {
    private _elements: any[] = [];
    private _appState: Record<string, any> = {};
    private _files: Record<string, any> = {};
    /** Prevents feedback loop when we push serialized content back to host. */
    private _skipNextContentUpdate = false;
    /** Fingerprint of elements+files for change detection (avoids dirty on scroll/select). */
    private _lastFingerprint = "";
    /** Live Excalidraw API ref — set by DrawView on mount, always available (pages stay mounted). */
    private _excalidrawApi: ExcalidrawImperativeAPI | null = null;

    protected onInit(): void {
        this.state.update((s) => { s.darkMode = isCurrentThemeDark(); });
        this.parseContent(this.host.state.get().content);
    }

    protected onContentChanged(content: string): void {
        if (this._skipNextContentUpdate) {
            this._skipNextContentUpdate = false;
            return;
        }
        this.parseContent(content);
    }

    private parseContent(content: string): void {
        try {
            if (!content || content.trim() === "") {
                this._elements = [];
                this._appState = { currentItemFontFamily: FONT_FAMILY.Helvetica };
                this._files = {};
            } else {
                const data = JSON.parse(content);
                this._elements = data.elements || [];
                this._appState = data.appState || {};
                this._files = data.files || {};
            }
            this._lastFingerprint = this.computeFingerprint(this._elements, this._files);
            this.state.update((s) => { s.loading = false; s.error = null; });
        } catch (e) {
            this.state.update((s) => { s.loading = false; s.error = (e as Error).message; });
        }
    }

    /**
     * Called from DrawView when Excalidraw content changes (already debounced).
     * Only pushes content to host when elements or files actually change,
     * ignoring appState-only changes (scroll, zoom, cursor, selection).
     */
    updateFromExcalidraw(elements: readonly any[], appState: Record<string, any>, files: any): void {
        this._appState = appState;

        const fingerprint = this.computeFingerprint(elements, files);
        if (fingerprint === this._lastFingerprint) return;

        this._lastFingerprint = fingerprint;
        this._elements = [...elements];
        this._files = files;

        this._skipNextContentUpdate = true;
        const json = serializeAsJSON(elements as any, appState as any, files, "local");
        this.host.changeContent(json, true);
    }

    /** Fast fingerprint of elements + files to detect real content changes. */
    private computeFingerprint(elements: readonly any[], files: any): string {
        const elPart = elements.map(
            (e) => `${e.id}:${e.version ?? 0}:${e.versionNonce ?? 0}`,
        ).join(";");
        const fileKeys = files ? Object.keys(files).sort().join(",") : "";
        return `${elPart}|${fileKeys}`;
    }

    // =========================================================================
    // Actions
    // =========================================================================

    toggleDarkMode = () => {
        this.state.update((s) => { s.darkMode = !s.darkMode; });
    };

    syncDarkMode = () => {
        this.state.update((s) => { s.darkMode = isCurrentThemeDark(); });
    };

    get elements() { return this._elements; }
    get appState() { return this._appState; }
    get files() { return this._files; }
    get excalidrawApi() { return this._excalidrawApi; }

    setExcalidrawApi(api: ExcalidrawImperativeAPI): void {
        this._excalidrawApi = api;
    }

    clearExcalidrawApi(): void {
        this._excalidrawApi = null;
    }
}

// =============================================================================
// Factory
// =============================================================================

export function createDrawViewModel(host: IContentHost) {
    return new DrawViewModel(host, defaultDrawViewState);
}
