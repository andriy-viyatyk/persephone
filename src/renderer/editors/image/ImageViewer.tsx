import { useRef } from "react";
import { IPageState, PageType } from "../../../shared/types";
import { getDefaultPageModelState, PageModel } from "../base";
import { PageToolbar } from "../base/EditorToolbar";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { FileIcon } from "../../components/icons/FileIcon";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { CopyIcon, NavPanelIcon, SaveIcon } from "../../theme/icons";
import { fs } from "../../api/fs";
import { ui } from "../../api/ui";
import { NavPanelModel } from "../../ui/navigation/nav-panel-store";
import { BaseImageView } from "./BaseImageView";
import type { BaseImageViewRef } from "./BaseImageView";
import { fpBasename, fpDirname } from "../../core/utils/file-path";

// ============================================================================
// ImageViewerModel (Page Model) - manages page state and lifecycle
// ============================================================================

interface ImageViewerModelState extends IPageState {
    /** External image URL (e.g. from a browser webview). When set, used instead of filePath. */
    url?: string;
}

const getDefaultImageViewerModelState = (): ImageViewerModelState => ({
    ...getDefaultPageModelState(),
    type: "imageFile" as const,
});

class ImageViewerModel extends PageModel<ImageViewerModelState, void> {
    noLanguage = true;

    async restore() {
        await super.restore();
        const filePath = this.state.get().filePath;
        if (filePath) {
            this.state.update((s) => {
                s.title = fpBasename(filePath);
            });
        }
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
    model: ImageViewerModel;
}

function ImageViewer({ model }: ImageViewerProps) {
    const filePath = model.state.use((s) => s.filePath);
    const url = model.state.use((s) => s.url);
    const imageRef = useRef<BaseImageViewRef>(null);
    const src = url || `safe-file://${filePath?.replace(/\\/g, "/") || ""}`;
    const alt = filePath ? fpBasename(filePath) : "Image";

    return (
        <>
            <PageToolbar borderBottom>
                {filePath && (
                    <Button
                        type="icon"
                        size="small"
                        title="File Explorer"
                        onClick={() => {
                            if (model.navPanel) {
                                model.navPanel.reinitIfEmpty(fpDirname(filePath), filePath);
                                model.navPanel.toggle();
                            } else {
                                const navPanel = new NavPanelModel(fpDirname(filePath), filePath);
                                navPanel.id = model.id;
                                navPanel.flushSave();
                                model.navPanel = navPanel;
                                model.state.update((s) => {
                                    s.hasNavPanel = true;
                                });
                            }
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
    newPageModel: async (filePath?: string) => {
        const state = {
            ...getDefaultImageViewerModelState(),
            ...(filePath ? { filePath } : {}),
        };

        return new ImageViewerModel(new TComponentState(state));
    },
    newEmptyPageModel: async (
        pageType: PageType
    ): Promise<PageModel | null> => {
        if (pageType === "imageFile") {
            return new ImageViewerModel(
                new TComponentState(getDefaultImageViewerModelState())
            );
        }
        return null;
    },
    newPageModelFromState: async (
        state: Partial<IPageState>
    ): Promise<PageModel> => {
        const initialState: ImageViewerModelState = {
            ...getDefaultImageViewerModelState(),
            ...state,
        };
        return new ImageViewerModel(new TComponentState(initialState));
    },
};

export default imageEditorModule;

// Named exports
export { ImageViewer, ImageViewerModel };
export type { ImageViewerProps, ImageViewerModelState };

// Re-export base components for reuse
export { BaseImageView, ImageViewModel, defaultImageViewState } from "./BaseImageView";
export type { BaseImageViewProps, ImageViewState } from "./BaseImageView";
