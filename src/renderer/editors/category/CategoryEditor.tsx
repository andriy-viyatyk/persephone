import { useCallback, useState } from "react";
import styled from "@emotion/styled";
import { CategoryView } from "../../components/tree-provider/CategoryView";
import { PageToolbar } from "../base/EditorToolbar";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { NavPanelIcon } from "../../theme/icons";
import { app } from "../../api/app";
import { RawLinkEvent } from "../../api/events/events";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { CategoryEditorModel } from "./CategoryEditorModel";
import type { EditorModule } from "../types";
import type { EditorType, IEditorState } from "../../../shared/types";
import color from "../../theme/color";

const CategoryEditorRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: color.background.default,
});

export function CategoryEditor({ model }: { model: CategoryEditorModel }) {
    const page = model.page;
    const provider = page?.treeProvider ?? null;
    const categoryPath = model.categoryPath;
    const pageId = model.id;
    const [searchPortal, setSearchPortal] = useState<HTMLDivElement | null>(null);

    const handleNavigate = useCallback((item: ITreeProviderItem) => {
        page?.selectionState.update((s) => { s.selectedHref = item.href; });
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
    }, [provider, pageId, page]);

    const handleToggleNavigator = useCallback(() => {
        page?.toggleNavigator();
    }, [page]);

    if (!provider) {
        return (
            <CategoryEditorRoot>
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
            </CategoryEditorRoot>
        );
    }

    return (
        <CategoryEditorRoot>
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
                <div ref={setSearchPortal} style={{ width: 200 }} />
            </PageToolbar>
            <CategoryView
                provider={provider}
                category={categoryPath}
                onItemClick={handleNavigate}
                onFolderClick={handleNavigate}
                toolbarPortalRef={searchPortal}
            />
        </CategoryEditorRoot>
    );
}

const categoryEditorModule: EditorModule = {
    Editor: CategoryEditor,
    newEditorModel: async (filePath?: string) => {
        const { CategoryEditorModel } = await import("./CategoryEditorModel");
        const { decodeCategoryLink } = await import("../../content/tree-providers/tree-provider-link");
        const model = new CategoryEditorModel();
        if (filePath) {
            const link = decodeCategoryLink(filePath);
            if (link) model.initFromLink(link);
        }
        return model;
    },
    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType !== "categoryPage") return null;
        const { CategoryEditorModel } = await import("./CategoryEditorModel");
        return new CategoryEditorModel();
    },
    newEditorModelFromState: async (state: Partial<IEditorState>) => {
        const { CategoryEditorModel } = await import("./CategoryEditorModel");
        const model = new CategoryEditorModel();
        model.applyRestoreData(state as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        return model;
    },
};

export default categoryEditorModule;
