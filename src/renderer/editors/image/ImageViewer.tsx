import { useRef } from "react";
import { IEditorState, EditorType } from "../../../shared/types";
import { getDefaultEditorModelState, EditorModel } from "../base";
import { PageToolbar } from "../base/EditorToolbar";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { FileIcon } from "../../components/icons/FileIcon";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { CopyIcon, NavPanelIcon, SaveIcon } from "../../theme/icons";
import { DrawIcon } from "../../theme/language-icons";
import { fs } from "../../api/fs";
import { ui } from "../../api/ui";
import { pagesModel } from "../../api/pages";

import { BaseImageView } from "./BaseImageView";
import type { BaseImageViewRef } from "./BaseImageView";
import { fpBasename, fpDirname, fpExtname } from "../../core/utils/file-path";
import { buildExcalidrawJsonWithImage, getImageDimensions, extToMime } from "../draw/drawExport";
import { ContentPipe } from "../../content/ContentPipe";
import { FileProvider } from "../../content/providers/FileProvider";
import { ZipTransformer } from "../../content/transformers/ZipTransformer";

// ============================================================================
// ImageEditorModel (Page Model) - manages page state and lifecycle
// ============================================================================

interface ImageEditorModelState extends IEditorState {
    /** External image URL (e.g. from a browser webview). When set, used instead of filePath. */
    url?: string;
}

const getDefaultImageViewerModelState = (): ImageEditorModelState => ({
    ...getDefaultEditorModelState(),
    type: "imageFile" as const,
});

class ImageEditorModel extends EditorModel<ImageEditorModelState, void> {
    noLanguage = true;
    private cacheFileCreated = false;

    getRestoreData() {
        const data = super.getRestoreData();
        // Blob URLs don't survive across sessions — strip them.
        // HTTP(S) URLs are kept as display metadata (the pipe handles re-fetch).
        if (data.url && data.url.startsWith("blob:")) {
            delete data.url;
        }
        return data;
    }

    applyRestoreData(data: Partial<ImageEditorModelState>): void {
        super.applyRestoreData(data);
        if (data.url) {
            this.state.update((s) => { s.url = data.url; });
        }
    }

    async dispose(): Promise<void> {
        const url = this.state.get().url;
        if (url && url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
        }
        await super.dispose();
    }

    // ── Pipe helpers ─────────────────────────────────────────────────

    /** Reconstruct pipe from filePath if not already present (legacy compat / app restart). */
    private ensurePipe(): void {
        if (this.pipe) return;
        const filePath = this.state.get().filePath;
        if (!filePath) return;

        const bangIndex = filePath.indexOf("!");
        if (bangIndex >= 0) {
            const archivePath = filePath.slice(0, bangIndex);
            const entryPath = filePath.slice(bangIndex + 1);
            this.pipe = new ContentPipe(
                new FileProvider(archivePath),
                [new ZipTransformer(entryPath)],
            );
        } else {
            this.pipe = new ContentPipe(new FileProvider(filePath));
        }
    }

    /** Cache image binary to disk for restart recovery. */
    private async cacheImageBuffer(buffer: Buffer): Promise<void> {
        try {
            const cachePath = fs.resolveCachePath(this.id + ".img");
            await fs.writeBinary(cachePath, buffer);
            this.cacheFileCreated = true;
        } catch { /* ignore cache write failure */ }
    }

    /** Try to restore image from cache file (restart after blob URL scenario). */
    private async tryRestoreFromCache(): Promise<void> {
        const cachePath = fs.resolveCachePath(this.id + ".img");
        if (await fs.exists(cachePath)) {
            try {
                const buffer = await fs.readBinary(cachePath);
                const blob = new Blob([new Uint8Array(buffer)], { type: "image/png" });
                const blobUrl = URL.createObjectURL(blob);
                this.state.update((s) => { s.url = blobUrl; });
            } catch { /* cache read failed */ }
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    async restore() {
        await super.restore();
        const { filePath, url } = this.state.get();
        if (filePath) {
            this.state.update((s) => {
                s.title = fpBasename(filePath);
            });
        }

        // Load image via content pipe → blob URL (or cache for restart)
        this.ensurePipe();
        if (this.pipe) {
            if (!url) {
                // No URL yet — read from pipe and create blob URL
                try {
                    const buffer = await this.pipe.readBinary();
                    const ext = fpExtname(filePath || this.pipe.provider.sourceUrl || ".png").toLowerCase();
                    const mimeType = extToMime(ext);
                    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
                    const blobUrl = URL.createObjectURL(blob);
                    this.state.update((s) => { s.url = blobUrl; });

                    // Cache to disk for restart recovery (non-local sources only)
                    if (this.pipe.provider.type !== "file" || this.pipe.transformers.length > 0) {
                        await this.cacheImageBuffer(buffer);
                    }
                } catch {
                    // Pipe read failed — try cache file fallback
                    await this.tryRestoreFromCache();
                }
            } else if (this.pipe.provider.type !== "file") {
                // URL already set (HTTP image) — cache in background for offline restart
                this.pipe.readBinary()
                    .then((buffer) => this.cacheImageBuffer(buffer))
                    .catch(() => { /* ignore */ });
            }
        } else if (!url) {
            // No pipe, no url — try cache file fallback (restart after blob URL scenario)
            await this.tryRestoreFromCache();
        }
    }

    /** Cache blob URL content to disk (called by openImageInNewTab for blob URLs). */
    async cacheBlobUrl(blobUrl: string): Promise<void> {
        try {
            const response = await fetch(blobUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            await this.cacheImageBuffer(buffer);
        } catch { /* ignore cache failure */ }
    }

    getIcon = () => {
        const filePath = this.state.get().filePath;
        return (
            <FileIcon path={filePath || "image.png"} width={12} height={12} />
        );
    };

    saveImage = async () => {
        const url = this.state.get().url;
        if (!url) return;

        // Guess a default filename from the URL
        let defaultName = "image.png";
        try {
            const urlPath = new URL(url).pathname;
            const basename = urlPath.split("/").pop();
            if (basename && /\.\w+$/.test(basename)) {
                defaultName = decodeURIComponent(basename)
                    .replace(/[<>:"/\\|?*]/g, "_");
            }
        } catch { /* ignore invalid URLs */ }

        const savePath = await fs.showSaveDialog({
            title: "Save Image",
            defaultPath: defaultName,
            filters: [
                { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"] },
                { name: "All Files", extensions: ["*"] },
            ],
        });
        if (!savePath) return;

        try {
            const response = await fetch(url);
            const buffer = Buffer.from(await response.arrayBuffer());
            await fs.saveBinaryFile(savePath, buffer);
        } catch (err) {
            ui.notify(`Failed to save image: ${(err as Error).message}`, "error");
            return;
        }

        // Switch from URL to local file
        this.state.update((s) => {
            s.url = undefined;
            s.filePath = savePath;
            s.title = fpBasename(savePath);
        });
    };
}

// ============================================================================
// ImageViewer Component - thin wrapper for binary image files
// ============================================================================

interface ImageViewerProps {
    model: ImageEditorModel;
}

function ImageViewer({ model }: ImageViewerProps) {
    const filePath = model.state.use((s) => s.filePath);
    const url = model.state.use((s) => s.url);
    const imageRef = useRef<BaseImageViewRef>(null);
    const src = url || "";
    const alt = filePath ? fpBasename(filePath) : "Image";

    return (
        <>
            <PageToolbar borderBottom>
                {(model.navigationData?.canOpenNavigator(model.pipe, filePath) || filePath) && (
                    <Button
                        type="icon"
                        size="small"
                        title="File Explorer"
                        onClick={() => {
                            model.ensureNavigationData(fpDirname(filePath || ""));
                            model.navigationData!.toggleNavigator(model.pipe, filePath);
                        }}
                    >
                        <NavPanelIcon />
                    </Button>
                )}
                <FlexSpace />
                {!filePath && url && (
                    <Button
                        type="icon"
                        size="small"
                        title="Save Image to File"
                        onClick={model.saveImage}
                    >
                        <SaveIcon />
                    </Button>
                )}
                <Button
                    type="icon"
                    size="small"
                    title="Open in Drawing Editor"
                    onClick={async () => {
                        const { filePath: fp, url: u } = model.state.get();
                        let dataUrl: string;
                        let mimeType: string;
                        if (model.pipe) {
                            const buffer = await model.pipe.readBinary();
                            const ext = fpExtname(fp || model.pipe.provider.sourceUrl || ".png").toLowerCase();
                            mimeType = extToMime(ext);
                            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
                        } else if (u) {
                            const response = await fetch(u);
                            const blob = await response.blob();
                            mimeType = blob.type || "image/png";
                            const buffer = Buffer.from(await blob.arrayBuffer());
                            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
                        } else {
                            return;
                        }
                        const dims = await getImageDimensions(dataUrl);
                        const json = buildExcalidrawJsonWithImage(dataUrl, mimeType, dims.width, dims.height);
                        const baseName = fp ? fpBasename(fp).replace(/\.\w+$/, "") : "image";
                        pagesModel.addEditorPage("draw-view", "json", baseName + ".excalidraw", json);
                    }}
                >
                    <DrawIcon />
                </Button>
                <Button
                    type="icon"
                    size="small"
                    title="Copy Image to Clipboard (Ctrl+C)"
                    onClick={() => imageRef.current?.copyToClipboard()}
                >
                    <CopyIcon />
                </Button>
            </PageToolbar>
            <BaseImageView ref={imageRef} src={src} alt={alt} />
        </>
    );
}

// ============================================================================
// Editor Module
// ============================================================================

const imageEditorModule: EditorModule = {
    Editor: ImageViewer,
    newEditorModel: async (filePath?: string) => {
        const state = {
            ...getDefaultImageViewerModelState(),
            ...(filePath ? { filePath } : {}),
        };

        return new ImageEditorModel(new TComponentState(state));
    },
    newEmptyEditorModel: async (
        editorType: EditorType
    ): Promise<EditorModel | null> => {
        if (editorType === "imageFile") {
            return new ImageEditorModel(
                new TComponentState(getDefaultImageViewerModelState())
            );
        }
        return null;
    },
    newEditorModelFromState: async (
        state: Partial<IEditorState>
    ): Promise<EditorModel> => {
        const initialState: ImageEditorModelState = {
            ...getDefaultImageViewerModelState(),
            ...state,
        };
        return new ImageEditorModel(new TComponentState(initialState));
    },
};

export default imageEditorModule;

// Named exports
export { ImageViewer, ImageEditorModel };
export type { ImageViewerProps, ImageEditorModelState };

// Re-export base components for reuse
export { BaseImageView, ImageViewModel, defaultImageViewState } from "./BaseImageView";
export type { BaseImageViewProps, ImageViewState } from "./BaseImageView";
