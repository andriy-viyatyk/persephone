import { TComponentState } from "../../core/state/state";
import {
    EditorModel,
    type EditorStateBase,
    type RestoreData,
} from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import { createFileIconElement } from "../../components/icons/icon-elements";
import { fpBasename, fpExtname } from "../../core/utils/file-path";
import { fs as appFs } from "../../api/fs";
import { ui } from "../../api/ui";
import { pipeFromSourcePath } from "../../content/rebuild-pipe";
import type { IImageExport } from "../base/IImageExport";
import type { MenuItem } from "../../uikit";
import { getImageDimensions, rasterToPngBlob, savePngViaDialog } from "../shared/image-export";
import { filePathMenuItems } from "../shared/editor-menu-items";
import { app } from "../../api/app";
import { errMessage } from "../../../shared/utils";

function extToMime(ext: string): string {
    const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
        ".svg": "image/svg+xml",
    };
    return mimeTypes[ext.toLowerCase()] || "image/png";
}

export interface ImageEditorState extends EditorStateBase {
    /** Discriminator — preserved for legacy `newEditorModelFromState`
     *  routing and `EditorDescriptor.state.type` consumers. */
    type: "imageFile";
    /** Source path / URL / archive-with-bang notation
     *  (`archive.zip!path/to.png`). */
    filePath?: string;
    /** Runtime image URL — blob URL (created from pipe bytes or via
     *  `cacheBlobUrl`), HTTP(S) URL (external browser-webview source),
     *  or undefined. Blob URLs are stripped from descriptors;
     *  HTTP URLs are kept (pipe re-fetches on restore). */
    url?: string;
}

export const defaultImageEditorState: ImageEditorState = {
    id: "",
    title: "",
    modified: false,
    type: "imageFile",
};

export function getDefaultImageEditorState(): ImageEditorState {
    return {
        ...defaultImageEditorState,
        id: crypto.randomUUID(),
    };
}

export class ImageEditor extends EditorModel<ImageEditorState> implements IImageExport {
    /** Editor identity. Matches `EditorDescriptor.editorId`. */
    readonly editorId = "image-view";

    noLanguage = true;

    /** Tracks whether `restore()` or `cacheBlobUrl()` wrote a temp cache
     *  file for the image (true for non-local sources AND blob-URL
     *  imports). Gates the dispose() cleanup. */
    private cacheFileCreated = false;
    private pipeWatch: (() => void) | undefined;

    constructor(state: TComponentState<ImageEditorState>) {
        super(state);
    }

    /** Reconstruct pipe from `filePath` if not already present. Legacy
     *  compat for restore paths that don't carry a live pipe. */
    private async ensurePipe(): Promise<void> {
        if (this.pipe) return;
        const filePath = this.state.get().filePath;
        if (!filePath) return;
        this.pipe = await pipeFromSourcePath(filePath);
    }

    private async cacheImageBuffer(buffer: Buffer): Promise<void> {
        try {
            const cachePath = appFs.resolveCachePath(this.id + ".img");
            await appFs.writeBinary(cachePath, buffer);
            this.cacheFileCreated = true;
        } catch { /* ignore cache write failure */ }
    }

    private async tryRestoreFromCache(): Promise<void> {
        const cachePath = appFs.resolveCachePath(this.id + ".img");
        if (await appFs.exists(cachePath)) {
            try {
                const buffer = await appFs.readBinary(cachePath);
                const blob = new Blob([new Uint8Array(buffer)], {
                    type: "image/png",
                });
                const blobUrl = URL.createObjectURL(blob);
                this.state.update((s) => { s.url = blobUrl; });
            } catch { /* cache read failed */ }
        }
    }

    /** True once the editor has an image to show — the cache fallback may have
     *  supplied one after the source read failed. */
    private get hasImage(): boolean {
        return !!this.state.get().url;
    }

    async restore(): Promise<void> {
        await super.restore();
        const { filePath, url } = this.state.get();
        if (filePath) {
            this.state.update((s) => {
                s.title = fpBasename(filePath);
            });
        }

        await this.ensurePipe();
        if (this.pipe) {
            if (!this.pipeWatch && this.pipe.watch) {
                this.pipeWatch = this.pipe.watch(() => {
                    if (!this.hasImage) void this.restore();
                });
                this.own(() => this.pipeWatch?.());
            }
            if (!url) {
                // No URL yet — read from pipe and create blob URL
                try {
                    const buffer = await this.pipe.readBinary();
                    const ext = fpExtname(
                        filePath || this.pipe.provider.sourceUrl || ".png",
                    ).toLowerCase();
                    const mimeType = extToMime(ext);
                    const blob = new Blob([new Uint8Array(buffer)], {
                        type: mimeType,
                    });
                    const blobUrl = URL.createObjectURL(blob);
                    this.state.update((s) => { s.url = blobUrl; });

                    // Cache to disk for restart recovery (non-local sources only)
                    if (
                        this.pipe.provider.type !== "file"
                        || this.pipe.transformers.length > 0
                    ) {
                        await this.cacheImageBuffer(buffer);
                    }
                } catch (err) {
                    // Pipe read failed — try cache file fallback
                    await this.tryRestoreFromCache();
                    // Swallowing this left the view showing its alt text and nothing else:
                    // a blank page that looks identical to an unsupported format, with no
                    // way to tell a 404 from a 403 from an offline machine. The editor is
                    // still usable (the path and the menu actions work), so a toast is the
                    // right weight — but it has to say something.
                    if (!this.hasImage) {
                        ui.notify(
                            `Failed to load image: ${errMessage(err)}`,
                            "error",
                        );
                    }
                }
            } else if (this.pipe.provider.type !== "file") {
                // URL already set (HTTP image) — cache in background for
                // offline restart
                this.pipe.readBinary()
                    .then((buffer) => this.cacheImageBuffer(buffer))
                    .catch(() => { /* ignore */ });
            }
        } else if (!url) {
            // No pipe, no url — try cache file fallback (restart after blob
            // URL scenario)
            await this.tryRestoreFromCache();
        }
    }

    applyRestoreData(data: RestoreData<ImageEditorState>): void {
        super.applyRestoreData(data);
        if (data.filePath) {
            this.state.update((s) => { s.filePath = data.filePath; });
        }
        if (data.url) {
            this.state.update((s) => { s.url = data.url; });
        }
    }

    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        // Blob URLs don't survive across sessions — strip them.
        // HTTP(S) URLs are kept as display metadata (the pipe handles
        // re-fetch on restore). filePath is preserved verbatim.
        const url = s.url && s.url.startsWith("blob:") ? undefined : s.url;
        return {
            editorId: this.editorId,
            id: s.id,
            state: {
                ...s,
                url,
            } as unknown as Record<string, unknown>,
        };
    }

    async dispose(): Promise<void> {
        // Revoke active blob URL (in-memory resource).
        const url = this.state.get().url;
        if (url && url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
        }
        // Delete cache file (on-disk resource) if we created one.
        if (this.cacheFileCreated) {
            const cachePath = appFs.resolveCachePath(this.id + ".img");
            try { await appFs.delete(cachePath); } catch { /* ignore */ }
        }
        await super.dispose();
    }

    /** Cache blob URL content to disk (called by openImageInNewTab for
     *  blob URLs — after addPage). Lets a freshly-imported blob image
     *  survive an app restart via tryRestoreFromCache(). */
    async cacheBlobUrl(blobUrl: string): Promise<void> {
        try {
            const response = await fetch(blobUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            await this.cacheImageBuffer(buffer);
        } catch { /* ignore cache failure */ }
    }

    // ── Image export (IImageExport) ─────────────────────────────────────

    /** Rasterise the displayed image to a PNG blob (re-encode to PNG). */
    async exportPng(): Promise<Blob> {
        const url = this.state.get().url;
        if (!url) throw new Error("No image to export");
        return rasterToPngBlob(url);
    }

    suggestedImageName(): string {
        const filePath = this.state.get().filePath;
        return filePath ? fpBasename(filePath).replace(/\.\w+$/, "") : "image";
    }

    /** "Save as .png" menu action — convert the image to PNG and write it
     *  (prompts for a path; `savePngViaDialog` surfaces failures as a toast). */
    saveAsPng = (): Promise<void> => savePngViaDialog(this);

    /** "Save original" menu action — write the source bytes in their original
     *  format (no re-encode). Reads via the content pipe (local / archive /
     *  cached URL) and falls back to fetching the runtime URL. */
    saveOriginal = async (): Promise<void> => {
        const { filePath, url } = this.state.get();
        await this.ensurePipe();
        const sourceName = filePath
            ? fpBasename(filePath)
            : (this.pipe?.provider.sourceUrl
                ? fpBasename(this.pipe.provider.sourceUrl)
                : undefined);
        const ext = (fpExtname(sourceName ?? ".png").replace(/^\./, "") || "png").toLowerCase();
        const baseName = sourceName ? sourceName.replace(/\.\w+$/, "") : "image";

        const savePath = await appFs.showSaveDialog({
            title: "Save Image",
            defaultPath: `${baseName}.${ext}`,
            filters: [
                { name: ext.toUpperCase(), extensions: [ext] },
                { name: "All Files", extensions: ["*"] },
            ],
        });
        if (!savePath) return;

        try {
            let buffer: Buffer;
            if (this.pipe) {
                buffer = await this.pipe.readBinary();
            } else if (url) {
                const response = await fetch(url);
                buffer = Buffer.from(await response.arrayBuffer());
            } else {
                return;
            }
            await appFs.saveBinaryFile(savePath, buffer);
        } catch (err) {
            ui.notify(`Failed to save image: ${errMessage(err)}`, "error");
        }
    };

    openInDrawingEditor = async (): Promise<void> => {
        const { filePath, url } = this.state.get();
        let dataUrl: string;
        let mimeType: string;
        if (this.pipe) {
            const buffer = await this.pipe.readBinary();
            const ext = fpExtname(
                filePath || this.pipe.provider.sourceUrl || ".png",
            ).toLowerCase();
            mimeType = extToMime(ext);
            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        } else if (url) {
            const response = await fetch(url);
            const blob = await response.blob();
            mimeType = blob.type || "image/png";
            const buffer = Buffer.from(await blob.arrayBuffer());
            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        } else {
            return;
        }
        const dimensions = await getImageDimensions(dataUrl);
        const baseName = filePath
            ? fpBasename(filePath).replace(/\.\w+$/, "")
            : "image";
        await app.capabilities.invoke("image.edit", {
            dataUrl,
            mimeType,
            naturalWidth: dimensions.width,
            naturalHeight: dimensions.height,
            title: baseName + ".excalidraw",
        });
    };

    getIconElement = (): Element => createFileIconElement({
        path: this.state.get().filePath || "image.png",
        width: 12,
        height: 12,
    });

    /** Show in File Explorer / Copy File Path for the image's source path. */
    onGetMenuItems(): MenuItem[] {
        return filePathMenuItems(this.state.get().filePath);
    }
}
