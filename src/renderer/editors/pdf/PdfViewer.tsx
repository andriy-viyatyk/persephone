import styled from "@emotion/styled";
import { IPageState, PageType } from "../../../shared/types";
import { getDefaultPageModelState, PageModel } from "../base";
import { PageToolbar } from "../base/EditorToolbar";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { FileIcon } from "../../components/icons/FileIcon";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { NavPanelIcon } from "../../theme/icons";
import { NavPanelModel } from "../../ui/navigation/nav-panel-store";
import { fpBasename, fpDirname } from "../../core/utils/file-path";
import { fs as appFs } from "../../api/fs";
import { ContentPipe } from "../../content/ContentPipe";
import { FileProvider } from "../../content/providers/FileProvider";
import { ZipTransformer } from "../../content/transformers/ZipTransformer";

const PdfViewerRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    height: 200,
    position: "relative",
});

interface PdfViewerModelState extends IPageState {
    /** Local file path to serve via safe-file:// (cache file for non-local sources). */
    localPdfPath?: string;
}

const getDefaultPdfViewerModelState = (): PdfViewerModelState => ({
    ...getDefaultPageModelState(),
    type: "pdfFile" as const,
});

class PdfViewerModel extends PageModel<PdfViewerModelState, void> {
    noLanguage = true;
    private cacheFileCreated = false;

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

    async restore() {
        await super.restore();
        const filePath = this.state.get().filePath;
        if (filePath) {
            this.state.update((s) => {
                s.title = fpBasename(filePath);
            });
        }

        // Determine local path for safe-file:// protocol
        this.ensurePipe();
        if (this.pipe) {
            if (this.pipe.provider.type === "file" && this.pipe.transformers.length === 0) {
                // Plain FileProvider — use source path directly (efficient streaming)
                this.state.update((s) => {
                    s.localPdfPath = this.pipe!.provider.sourceUrl;
                });
            } else {
                // Non-local source (HTTP, archive, etc.) — read and cache as temp file
                try {
                    const buffer = await this.pipe.readBinary();
                    const cachePath = appFs.resolveCachePath(this.id + ".pdf");
                    await appFs.writeBinary(cachePath, buffer);
                    this.cacheFileCreated = true;
                    this.state.update((s) => {
                        s.localPdfPath = cachePath;
                    });
                } catch {
                    // Pipe read failed — localPdfPath stays undefined
                }
            }
        }
    }

    async dispose(): Promise<void> {
        // Clean up cache file for non-local sources
        if (this.cacheFileCreated) {
            const cachePath = this.state.get().localPdfPath;
            if (cachePath) {
                try { await appFs.delete(cachePath); } catch { /* ignore */ }
            }
        }
        await super.dispose();
    }

    getIcon = () => {
        return (
            <FileIcon path={this.state.get().filePath} width={12} height={12} />
        );
    };
}

interface PdfViewerProps {
    model: PdfViewerModel;
}

function PdfViewer({ model }: PdfViewerProps) {
    const filePath = model.state.use((s) => s.filePath);
    const localPdfPath = model.state.use((s) => s.localPdfPath);

    const fileUrl = localPdfPath ? `safe-file://${localPdfPath.replace(/\\/g, "/")}` : "";
    const viewerUrl = fileUrl
        ? `app-asset://pdfjs/web/viewer.html?file=${encodeURIComponent(fileUrl)}`
        : "";

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
            </PageToolbar>
            <PdfViewerRoot>
                {viewerUrl && (
                    <object
                        data={viewerUrl}
                        style={{ width: "100%", height: "100%", border: "none" }}
                        type="text/html"
                    />
                )}
            </PdfViewerRoot>
        </>
    );
}

const pdfEditorModule: EditorModule = {
    Editor: PdfViewer,
    newPageModel: async (filePath?: string) => {
        const state = {
            ...getDefaultPdfViewerModelState(),
            ...(filePath ? { filePath } : {}),
        };

        return new PdfViewerModel(new TComponentState(state));
    },
    newEmptyPageModel: async (
        pageType: PageType
    ): Promise<PageModel | null> => {
        if (pageType === "pdfFile") {
            return new PdfViewerModel(
                new TComponentState(getDefaultPdfViewerModelState())
            );
        }
        return null;
    },
    newPageModelFromState: async (
        state: Partial<IPageState>
    ): Promise<PageModel> => {
        const initialState: PdfViewerModelState = {
            ...getDefaultPdfViewerModelState(),
            ...state,
        };
        return new PdfViewerModel(new TComponentState(initialState));
    },
};

export default pdfEditorModule;

// Named exports
export { PdfViewer, PdfViewerModel };
export type { PdfViewerProps, PdfViewerModelState };

// Re-export with old names for backward compatibility
export { PdfViewer as PdfPage };
export { PdfViewerModel as PdfPageModel };
export type { PdfViewerProps as PdfPageProps };
export type { PdfViewerModelState as PdfPageModelState };
