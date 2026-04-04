import { useCallback, useEffect, useState } from "react";
import styled from "@emotion/styled";
import { CategoryView } from "../../components/tree-provider/CategoryView";
import type { CategoryViewMode } from "../../components/tree-provider/CategoryViewModel";
import { PageToolbar } from "../base/EditorToolbar";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { NavPanelIcon } from "../../theme/icons";
import { app } from "../../api/app";
import { RawLinkEvent } from "../../api/events/events";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { ExplorerFolderEditorModel } from "./ExplorerFolderEditorModel";
import type { EditorModule } from "../types";
import type { EditorType, IEditorState } from "../../../shared/types";
import color from "../../theme/color";
import { folderViewModeService } from "./FolderViewModeService";

const ExplorerFolderEditorRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: color.background.default,
});

export function ExplorerFolderEditor({ model }: { model: ExplorerFolderEditorModel }) {
    const page = model.page;
    const explorer = page?.findExplorer() as import("../explorer/ExplorerEditorModel").ExplorerEditorModel | undefined;
    const provider = explorer?.treeProvider ?? null;
    const categoryPath = model.categoryPath;
    const pageId = model.id;
    const [searchPortal, setSearchPortal] = useState<HTMLDivElement | null>(null);
    const [viewMode, setViewMode] = useState<CategoryViewMode>("list");

    // Load persisted view mode for this folder (with inheritance)
    useEffect(() => {
        folderViewModeService.getViewMode(categoryPath).then(setViewMode);
    }, [categoryPath]);

    const handleViewModeChange = useCallback((mode: CategoryViewMode) => {
        setViewMode(mode);
        folderViewModeService.setViewMode(categoryPath, mode);
    }, [categoryPath]);

    const selectedHref = explorer?.selectionState.use()?.selectedHref ?? null;

    const handleSelect = useCallback((item: ITreeProviderItem) => {
        explorer?.selectionState.update((s: any) => { s.selectedHref = item.href; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    }, [explorer]);

    const handleNavigate = useCallback((item: ITreeProviderItem) => {
        explorer?.selectionState.update((s: any) => { s.selectedHref = item.href; }); // eslint-disable-line @typescript-eslint/no-explicit-any
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId, sourceId: "explorer" }));
    }, [provider, pageId, explorer]);

    const handleToggleNavigator = useCallback(() => {
        page?.toggleNavigator();
    }, [page]);

    if (!provider) {
        return (
            <ExplorerFolderEditorRoot>
                <PageToolbar borderBottom>
                    <Button
                        type="icon"
                        size="small"
                        title="File Explorer"
                        onClick={handleToggleNavigator}
                    >
                        <NavPanelIcon />
                    </Button>
                    <FlexSpace />
                </PageToolbar>
                <div style={{ padding: 16, color: color.text.light }}>
                    Please select a category in the Navigation Panel.
                </div>
            </ExplorerFolderEditorRoot>
        );
    }

    return (
        <ExplorerFolderEditorRoot>
            <PageToolbar borderBottom>
                <Button
                    type="icon"
                    size="small"
                    title="File Explorer"
                    onClick={handleToggleNavigator}
                >
                    <NavPanelIcon />
                </Button>
                <FlexSpace />
                <div ref={setSearchPortal} style={{ display: "flex", alignItems: "center", gap: 4 }} />
            </PageToolbar>
            <CategoryView
                provider={provider}
                category={categoryPath}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                selectedHref={selectedHref}
                onItemClick={handleSelect}
                onItemDoubleClick={handleNavigate}
                onFolderClick={handleNavigate}
                toolbarPortalRef={searchPortal}
            />
        </ExplorerFolderEditorRoot>
    );
}

const explorerFolderEditorModule: EditorModule = {
    Editor: ExplorerFolderEditor,
    newEditorModel: async (filePath?: string) => {
        const { ExplorerFolderEditorModel } = await import("./ExplorerFolderEditorModel");
        const { decodeCategoryLink } = await import("../../content/tree-providers/tree-provider-link");
        const model = new ExplorerFolderEditorModel();
        if (filePath) {
            const link = decodeCategoryLink(filePath);
            if (link) model.initFromLink(link);
        }
        return model;
    },
    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType !== "explorerFolder") return null;
        const { ExplorerFolderEditorModel } = await import("./ExplorerFolderEditorModel");
        return new ExplorerFolderEditorModel();
    },
    newEditorModelFromState: async (state: Partial<IEditorState>) => {
        const { ExplorerFolderEditorModel } = await import("./ExplorerFolderEditorModel");
        const model = new ExplorerFolderEditorModel();
        model.applyRestoreData(state as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        return model;
    },
};

export default explorerFolderEditorModule;
