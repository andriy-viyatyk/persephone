import { EditorId } from "../../../shared/editor-ids";
import { TComponentState } from "../../core/state/state";
import type { EditorStateBase } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import type { IImageExport } from "../base/IImageExport";
import { rasterToPngBlob } from "../../core/utils/image-raster";
import { ImageActions } from "../shared/image-actions";
import type { IImageEditSource, ImageEditPayload } from "../base/IImageEditSource";
import { errMessage } from "../../../shared/utils";

export type SvgQueueEvent = { type: "focus" };

export type SvgQueueRequest = never;

export type SvgEditorState = EditorStateBase;

export const defaultSvgEditorState: SvgEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
};

export class SvgEditor extends TextHostEditorModel<SvgEditorState, SvgQueueEvent, SvgQueueRequest>
    implements IImageExport, IImageEditSource {
    readonly editorId = EditorId.svgView;
    protected readonly displayName = "SVG";
    readonly imageActions = new ImageActions(this, {
        copyError: (error) => new Error(`SVG preview cannot copy an image: ${errMessage(error)}`),
        drawingEditorError: (error) => new Error(`SVG preview cannot open in Drawing Editor: ${errMessage(error)}`),
    });

    constructor(state: TComponentState<SvgEditorState>) {
        super(state);
    }

    focus(): void {
        this.queue.send({ type: "focus" });
    }

    // No host-content subscription needed — the body reads
    // `host.state.use((s) => s.content)` directly; BaseImageView
    // re-renders on every src prop change (data URL recomputed inline).

    // ── Image export (IImageExport) ─────────────────────────────────────

    /** Rasterise the SVG to a PNG blob. Builds the same `image/svg+xml` data
     *  URL the body renders, then draws it to a canvas. */
    async exportPng(): Promise<Blob> {
        const content = this.requireSource("export PNG");
        try {
            return await rasterToPngBlob(`data:image/svg+xml,${encodeURIComponent(content)}`);
        } catch (error) {
            throw new Error(`SVG preview cannot export PNG because rasterisation failed: ${errMessage(error)}`);
        }
    }

    suggestedImageName(): string {
        return (this.state.get().title || "image").replace(/\.\w+$/, "");
    }

    async imageEditPayload(): Promise<ImageEditPayload> {
        const content = this.requireSource("open in Drawing Editor");
        return {
            dataUrl: `data:image/svg+xml;base64,${Buffer.from(content, "utf-8").toString("base64")}`,
            mimeType: "image/svg+xml",
            title: (this.displayTitle || "SVG").replace(/\.svg$/i, ""),
        };
    }

    private requireSource(action: string): string {
        const content = this.host?.state.get().content;
        if (!content?.trim()) {
            throw new Error(`SVG preview cannot ${action} because the source is empty or unavailable.`);
        }
        return content;
    }
}
