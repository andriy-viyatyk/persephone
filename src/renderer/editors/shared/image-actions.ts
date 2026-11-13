import { api } from "../../../ipc/renderer/api";
import { fs as appFs } from "../../api/fs";
import { ui } from "../../api/ui";
import { openImageForEdit, getMissingEditCapabilityMessage } from "../../api/capability-feedback";
import { pages } from "../../api/pages";
import type { IImageEditSource } from "../base/IImageEditSource";
import type { IImageExport } from "../base/IImageExport";
import { blobToBuffer, blobToDataUrl } from "../../core/utils/image-raster";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";

export type ImageExportAction = "copy" | "open-in-image-view" | "edit-image";

export interface ImageActionsOptions {
    copyError?: (error: unknown) => Error;
    drawingEditorError?: (error: unknown) => Error;
    runExportAction?: (action: ImageExportAction, run: (blob: Blob) => Promise<void>) => Promise<void>;
    onDrawingEditorFailure?: (error: unknown) => boolean;
}

export type ImageActionSource = IImageExport & IImageEditSource;

export async function copyPngBlobToClipboard(blob: Blob): Promise<void> {
    await api.clipboardWritePng(new Uint8Array(await blob.arrayBuffer()));
}

export async function writePngToFile(source: IImageExport, filePath: string): Promise<string> {
    const blob = await source.exportPng();
    await appFs.writeBinary(filePath, await blobToBuffer(blob));
    return filePath;
}

export async function savePngViaDialog(source: IImageExport): Promise<void> {
    const path = await appFs.showSaveDialog({
        title: t("menus.saveImage"),
        defaultPath: `${source.suggestedImageName()}.png`,
        filters: [
            { name: "PNG", extensions: ["png"] },
            { name: "All Files", extensions: ["*"] },
        ],
    });
    if (!path) return;
    try {
        await appFs.writeBinary(path, await blobToBuffer(await source.exportPng()));
    } catch (error) {
        ui.notify(t("menus.failedToSaveImage", { error: errMessage(error) }), "error");
    }
}

/** Shared owner for image actions; models retain export and edit-source preparation. */
export class ImageActions {
    public constructor(
        private readonly source: ImageActionSource,
        private readonly options: ImageActionsOptions = {},
    ) {}

    async copy(blob?: Blob): Promise<void> {
        const run = async (image: Blob): Promise<void> => {
            await copyPngBlobToClipboard(image);
        };
        try {
            if (blob) return await run(blob);
            if (this.options.runExportAction) return await this.options.runExportAction("copy", run);
            return await run(await this.source.exportPng());
        } catch (error) {
            if (this.options.copyError) throw this.options.copyError(error);
            throw error;
        }
    }

    saveAsPng(): Promise<void> {
        return savePngViaDialog(this.source);
    }

    async openInDrawingEditor(): Promise<void> {
        const payload = await this.source.imageEditPayload();
        if (!payload) return;
        try {
            await openImageForEdit(payload);
        } catch (error) {
            if (getMissingEditCapabilityMessage(error, "image.edit")) throw error;
            if (this.options.onDrawingEditorFailure?.(error)) return;
            if (this.options.drawingEditorError) throw this.options.drawingEditorError(error);
            throw error;
        }
    }

    openInImageView(): Promise<void> {
        if (!this.options.runExportAction) return Promise.reject(new Error("Image view action is not available"));
        return this.options.runExportAction("open-in-image-view", async (blob) => {
            pages.openImageInNewTab(URL.createObjectURL(blob));
        });
    }

    editImage(): Promise<void> {
        if (!this.options.runExportAction) return Promise.reject(new Error("Image edit action is not available"));
        return this.options.runExportAction("edit-image", async (blob) => {
            await openImageForEdit({ dataUrl: await blobToDataUrl(blob), mimeType: "image/png", title: this.source.suggestedImageName() });
        });
    }
}
