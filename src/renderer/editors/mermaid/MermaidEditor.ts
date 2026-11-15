import { EditorId } from "../../../shared/editor-ids";
import { TComponentState } from "../../core/state/state";
import type { EditorStateBase } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import { TextFileModel } from "../content-host/TextFileModel";
import { themeState } from "../../theme/theme-state";
import { renderMermaid } from "./render-mermaid";
import type { IImageExport } from "../base/IImageExport";
import { rasterToPngBlob } from "../../core/utils/image-raster";
import { ImageActions } from "../shared/image-actions";
import type { IImageEditSource, ImageEditPayload } from "../base/IImageEditSource";
import { getMissingEditCapabilityMessage } from "../../api/capability-feedback";
import { app } from "../../api/app";
import { t } from "../../../shared/i18n/t";
import type { DiagramEditResult } from "../../api/types/capabilities";
import { ui } from "../../api/ui";
import { errMessage } from "../../../shared/utils";
import {
    DEFAULT_MERMAID_RENDER_OPTIONS,
    isMermaidLayout,
    isMermaidLook,
    type MermaidLayout,
    type MermaidLook,
} from "./mermaid-options";

export type MermaidQueueEvent = { type: "focus" };

export type MermaidQueueRequest = never;

/**
 * HS1 host-slot shape — `lightMode` rides `host.editorSettings["mermaid-view"]`
 * so it survives Mermaid↔Monaco switches AND app restarts (PV6 HS1 amendment
 * 2026-05-21). Identical mechanism to Markdown's `compactMode`.
 */
interface MermaidViewSettings {
    lightMode?: boolean;
    look?: MermaidLook;
    layout?: MermaidLayout;
    [key: string]: unknown;
}

export interface MermaidEditorState extends EditorStateBase {
    // HS1 — rides host.editorSettings["mermaid-view"]. Bounded boolean.
    // Default seeded from the active theme in the constructor.
    lightMode: boolean;
    lightModeOverride?: boolean;
    look: MermaidLook;
    layout: MermaidLayout;
    // View-derived — present on state for in-session reactivity, stripped
    // from getRestoreData per PV5 / MO5 pattern. Recomputed on every render.
    svgUrl: string;
    error: string;
    loading: boolean;
}

export const defaultMermaidEditorState: MermaidEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
    lightMode: false,
    look: DEFAULT_MERMAID_RENDER_OPTIONS.look,
    layout: DEFAULT_MERMAID_RENDER_OPTIONS.layout,
    svgUrl: "",
    error: "",
    loading: true,
};

export class MermaidEditor
    extends TextHostEditorModel<MermaidEditorState, MermaidQueueEvent, MermaidQueueRequest>
    implements IImageExport, IImageEditSource {
    readonly editorId = EditorId.mermaidView;
    protected readonly displayName = "Mermaid";
    readonly imageActions = new ImageActions(this, {
        copyError: (error) => new Error(`Mermaid preview cannot copy an image: ${errMessage(error)}`),
        drawingEditorError: (error) => new Error(`Mermaid preview cannot open in Drawing Editor: ${errMessage(error)}`),
    });

    private _renderTimer: ReturnType<typeof setTimeout> | undefined;
    private _syncingTheme = false;
    private _renderGeneration = 0;

    constructor(state: TComponentState<MermaidEditorState>) {
        super(state);

        // MR5 — seed lightMode from theme on first construct. HS1 slot read
        // in adoptHost overrides this if the user previously toggled.
        this.state.update((s) => {
            s.lightMode = !themeState.get().isDark;
        });
    }

    focus(): void {
        this.queue.send({ type: "focus" });
    }

    adoptHost(host: TextFileModel): void {
        this.invalidateRender();
        super.adoptHost(host);

        // HS1 — seed `lightMode` from host slot (sync, no flicker; retains the
        // theme-derived constructor default when the slot is absent) and mirror
        // changes back. Slice-bound so svgUrl/error/loading mutations (the
        // dominant write source) never trigger a host-slot write.
        const saved = host.getEditorState<MermaidViewSettings>(this.editorId);
        const look = isMermaidLook(saved?.look) ? saved.look : DEFAULT_MERMAID_RENDER_OPTIONS.look;
        const layout = isMermaidLayout(saved?.layout) ? saved.layout : DEFAULT_MERMAID_RENDER_OPTIONS.layout;
        const lightModeOverride = typeof saved?.lightMode === "boolean" ? saved.lightMode : undefined;
        this.state.update((s) => {
            s.look = look;
            s.layout = layout;
            s.lightModeOverride = lightModeOverride;
            s.lightMode = lightModeOverride ?? !themeState.get().isDark;
        });
        this.mirrorHostSettings<MermaidViewSettings>(
            (saved) => {
                const restoredLook = isMermaidLook(saved.look) ? saved.look : DEFAULT_MERMAID_RENDER_OPTIONS.look;
                const restoredLayout = isMermaidLayout(saved.layout) ? saved.layout : DEFAULT_MERMAID_RENDER_OPTIONS.layout;
                const restoredLightMode = typeof saved.lightMode === "boolean" ? saved.lightMode : undefined;
                this.state.update((s) => {
                    s.look = restoredLook;
                    s.layout = restoredLayout;
                    s.lightModeOverride = restoredLightMode;
                    s.lightMode = restoredLightMode ?? !themeState.get().isDark;
                });
            },
            (s) => {
                const current = this._host?.getEditorState<MermaidViewSettings>(this.editorId) ?? {};
                const snapshot: MermaidViewSettings = { ...current, look: s.look, layout: s.layout };
                if (s.lightModeOverride === undefined) delete snapshot.lightMode;
                else snapshot.lightMode = s.lightModeOverride;
                return snapshot;
            },
            (s) => ({ lightModeOverride: s.lightModeOverride, look: s.look, layout: s.layout }),
            () => !this._syncingTheme,
        );

        // A fresh host follows later app-theme changes until the first
        // explicit editor toggle writes the HS1 slot.
        this.registerHostSubscription(
            themeState.subscribe((isDark: boolean) => {
                    if (this.state.get().lightModeOverride !== undefined) {
                        return;
                    }
                    const lightMode = !isDark;
                    if (this.state.get().lightMode !== lightMode) {
                        this._syncingTheme = true;
                        try {
                            this.state.update((s) => { s.lightMode = lightMode; });
                        } finally {
                            this._syncingTheme = false;
                        }
                    }
                },
                (state) => state.isDark,
            ),
        );

        // Content changes retrigger the debounced render.
        this.subscribeHostContent(() => this.renderDebounced());

        // Theme and render-option changes render immediately; source typing stays debounced.
        this.registerHostSubscription(
            this.state.subscribe(
                () => this.renderImmediately(),
                (s) => ({ lightMode: s.lightMode, look: s.look, layout: s.layout }),
            ),
        );

        // MR3 — initial render against the freshly-adopted host.
        // TOneState.subscribe doesn't fire on first attach, so an explicit
        // kickoff is required.
        this.renderImmediately();
    }

    // ── Render pipeline (PV5 — relocated from MermaidViewModel) ─────────

    private renderDebounced(): void {
        clearTimeout(this._renderTimer);
        const generation = ++this._renderGeneration;
        this.state.update((s) => {
            s.loading = true;
            s.svgUrl = "";
            s.error = "";
        });

        this._renderTimer = setTimeout(() => {
            this.renderRequest(generation);
        }, 400);
    }

    private renderImmediately(): void {
        clearTimeout(this._renderTimer);
        this._renderTimer = undefined;
        const generation = ++this._renderGeneration;
        this.state.update((s) => {
            s.loading = true;
            s.svgUrl = "";
            s.error = "";
        });
        this.renderRequest(generation);
    }

    private renderRequest(generation: number): void {
        const content = this._host?.state.get().content ?? "";
        const { lightMode, look, layout } = this.state.get();
        void renderMermaid(content, lightMode, { look, layout })
            .then((url) => {
                if (generation !== this._renderGeneration) return;
                this.state.update((s) => {
                    s.svgUrl = url;
                    s.error = "";
                    s.loading = false;
                });
            })
            .catch((error: unknown) => {
                if (generation !== this._renderGeneration) return;
                this.state.update((s) => {
                    s.svgUrl = "";
                    s.error = errMessage(error, "Failed to render diagram");
                    s.loading = false;
                });
            });
    }

    private invalidateRender(): void {
        clearTimeout(this._renderTimer);
        this._renderTimer = undefined;
        this._renderGeneration++;
    }

    // ── State mutators ──────────────────────────────────────────────────

    toggleLightMode = (): void => {
        this.state.update((s) => {
            s.lightMode = !s.lightMode;
            s.lightModeOverride = s.lightMode;
        });
    };

    setLook = (look: MermaidLook): void => {
        if (look === this.state.get().look) return;
        this.state.update((s) => { s.look = look; });
    };

    setLayout = (layout: MermaidLayout): void => {
        if (layout === this.state.get().layout) return;
        this.state.update((s) => { s.layout = layout; });
    };

    // ── Image export (IImageExport) ─────────────────────────────────────

    /** Rasterise the rendered diagram to a PNG blob. Renders on demand when
     *  `svgUrl` is empty (page never shown / not the active tab). */
    async exportPng(): Promise<Blob> {
        const url = await this.renderForAction("export PNG");
        try {
            return await rasterToPngBlob(url);
        } catch (error) {
            throw new Error(`Mermaid preview cannot export PNG because rasterisation failed: ${errMessage(error)}`, { cause: error });
        }
    }

    suggestedImageName(): string {
        return (this.state.get().title || "diagram").replace(/\.\w+$/, "");
    }

    async imageEditPayload(): Promise<ImageEditPayload> {
        const svgUrl = await this.renderForAction("open in Drawing Editor");
        const svgText = decodeURIComponent(svgUrl.replace("data:image/svg+xml,", ""));
        return {
            dataUrl: `data:image/svg+xml;base64,${Buffer.from(svgText, "utf-8").toString("base64")}`,
            mimeType: "image/svg+xml",
            title: (this.displayTitle || "Mermaid").replace(/\.\w+$/, ""),
        };
    }

    async convertToExcalidraw(): Promise<void> {
        const source = this.host?.state.get().content?.trim();
        if (!source) {
            throw new Error("Mermaid preview cannot convert to Excalidraw because the source is empty or unavailable.");
        }
        const title = (this.displayTitle || "Mermaid").replace(/\.\w+$/, "") + ".excalidraw";
        let result: DiagramEditResult;
        try {
            result = await app.capabilities.invoke("diagram.edit", { source, title });
        } catch (error) {
            if (getMissingEditCapabilityMessage(error, "diagram.edit")) throw error;
            throw new Error(`Mermaid preview cannot open the Excalidraw page: ${errMessage(error)}`, { cause: error });
        }
        if (result.status === "conversion-failed") {
            ui.notify(
            t("editors.couldntConvertToEditableShapes", { reason: result.message }),
                "info",
            );
            await this.imageActions.openInDrawingEditor();
            return;
        }
        if (result.imageOnly) {
            ui.notify(
            t("editors.diagramCannotConvertToEditableShapes"),
                "info",
            );
        }
    }

    private async renderForAction(action: string): Promise<string> {
        const currentUrl = this.state.get().svgUrl;
        if (currentUrl) return currentUrl;

        const source = this.host?.state.get().content?.trim();
        if (!source) {
            throw new Error(`Mermaid preview cannot ${action} because the source is empty or unavailable.`);
        }
        try {
            const { lightMode, look, layout } = this.state.get();
            const url = await renderMermaid(source, lightMode, { look, layout });
            if (!url) throw new Error("rendering returned no SVG");
            return url;
        } catch (error) {
            throw new Error(`Mermaid preview cannot ${action} because rendering failed: ${errMessage(error)}`, { cause: error });
        }
    }

    // ── Dispose ─────────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        this.invalidateRender();
        await super.dispose();
    }
}
