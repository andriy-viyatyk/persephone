import { EditorId } from "../../../shared/editor-ids";
import { t } from "../../../shared/i18n/t";
import { TComponentState } from "../../core/state/state";
import type { EditorStateBase } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import { fpBasename, fpDirname } from "../../core/utils/file-path";
import { FileProvider } from "../../content/providers/FileProvider";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { toFileUrl } from "../../content/link-utils";
import { ui } from "../../api/ui";
import { api } from "../../../ipc/renderer/api";
import { blobToDataUrl } from "../../core/utils/image-raster";
import type { IImageExport } from "../base/IImageExport";
import type { IImageEditSource, ImageEditPayload } from "../base/IImageEditSource";
import { ImageActions, type ImageExportAction } from "../shared/image-actions";
import { notifyEditCapabilityFailure, type EditCapabilityId } from "../../api/capability-feedback";
import { errMessage } from "../../../shared/utils";
import { ViewPort } from "../base/view-port";

interface HtmlViewPort {
    captureRect(): { left: number; top: number; width: number; height: number };
}

export type HtmlQueueEvent = { type: "focus" };

export type HtmlQueueRequest = never;

export interface HtmlEditorState extends EditorStateBase {
    /** Transient — a PNG capture is in flight (disables the image-export toolbar
     *  buttons). Not persisted. */
    capturing?: boolean;
}

export const defaultHtmlEditorState: HtmlEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
};

export class HtmlEditor extends TextHostEditorModel<HtmlEditorState, HtmlQueueEvent, HtmlQueueRequest>
    implements IImageExport, IImageEditSource {
    readonly editorId = EditorId.htmlView;
    protected readonly displayName = "HTML";

    private readonly viewPort = new ViewPort<HtmlViewPort>();
    readonly imageActions: ImageActions;

    constructor(state: TComponentState<HtmlEditorState>) {
        super(state);
        this.imageActions = new ImageActions(this, {
            runExportAction: (action, run) => this.runImageAction(action, run),
        });
    }

    focus(): void {
        this.queue.send({ type: "focus" });
    }

    /** The sibling-resource folder for a plain local HTML file, from its live source pipe. */
    resourceRoot(): string | undefined {
        const pipe = this.host?.pipe;
        if (!(pipe?.provider instanceof FileProvider) || pipe.transformers.length !== 0) return undefined;
        return fpDirname(pipe.provider.sourceUrl);
    }

    /** Addressable saved source for the toolbar's browser action. */
    browserUrl(): string | undefined {
        const pipe = this.host?.pipe;
        if (!pipe || pipe.transformers.length !== 0) return undefined;
        if (pipe.provider instanceof FileProvider) return toFileUrl(pipe.provider.sourceUrl);
        if (pipe.provider instanceof HttpProvider) {
            try {
                const url = new URL(pipe.provider.sourceUrl);
                if (url.protocol === "http:" || url.protocol === "https:") return pipe.provider.sourceUrl;
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    // The body view owns subscriptions to the host's live content and pipe state.

    // ── Image export (IImageExport) ─────────────────────────────────────

    attachViewPort(port: HtmlViewPort): () => void {
        return this.viewPort.attach(port);
    }

    /** Capture the rendered page exactly as shown on screen (WYSIWYG) as a PNG.
     *  Goes through `webContents.capturePage` in main — works through the
     *  sandboxed `srcDoc` iframe because it is a composited-pixel grab.
     *
     *  DEVIATION from the headless `IImageExport` contract: unlike Mermaid/SVG/Image
     *  (which rasterise from model data), this capture is the *live on-screen* iframe,
     *  so it requires a mounted, visible view and throws if the port is absent. This
     *  is intentional — the feature's whole point is to capture what the user sees. The
     *  toolbar actions are only reachable while the page is visible, so this holds in
     *  practice; a background-tab script call to `exportPng()` will reject.
     *  @throws if the preview iframe is not mounted / has no visible area. */
    async exportPng(): Promise<Blob> {
        const port = this.viewPort.get();
        if (!port) throw new Error("HTML preview is not mounted");
        const r = port.captureRect();
        const rect = {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
        };
        if (rect.width <= 0 || rect.height <= 0) {
            throw new Error("HTML preview has no visible area to capture");
        }
        const bytes = await api.capturePageRegion(rect);
        return new Blob([new Uint8Array(bytes)], { type: "image/png" });
    }

    suggestedImageName(): string {
        const s = this._host?.state.get();
        const base = s?.filePath ? fpBasename(s.filePath) : s?.title || "page";
        return base.replace(/\.html?$/i, "") || "page";
    }

    /** Run an export-derived action with a transient `capturing` guard + error toast. */
    private async withCapture(
        action: (blob: Blob) => Promise<void> | void,
        failMessage: string,
        capability?: EditCapabilityId,
    ): Promise<void> {
        if (this.state.get().capturing) return;
        this.state.update((s) => {
            s.capturing = true;
        });
        try {
            await action(await this.exportPng());
        } catch (err) {
            if (capability) notifyEditCapabilityFailure(err, capability, failMessage);
            else ui.notify(`${failMessage}: ${errMessage(err)}`, "error");
        } finally {
            this.state.update((s) => {
                s.capturing = false;
            });
        }
    }

    async imageEditPayload(): Promise<ImageEditPayload> {
        const blob = await this.exportPng();
        return { dataUrl: await blobToDataUrl(blob), mimeType: "image/png", title: this.suggestedImageName() };
    }

    private runImageAction(action: ImageExportAction, run: (blob: Blob) => Promise<void>): Promise<void> {
        const failMessage = action === "copy"
            ? "Failed to copy image"
            : action === "open-in-image-view" ? "Failed to open image" : "Failed to open image for editing";
        return this.withCapture(async (blob) => {
            await run(blob);
            if (action === "copy") ui.notify(t("editors.imageCopiedToClipboard"), "success");
        }, failMessage, action === "edit-image" ? "image.edit" : undefined);
    }

    // ── Dispose ─────────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        this.viewPort.clear();
        await super.dispose();
    }
}
