import { useCallback } from "react";
import styled from "@emotion/styled";
import { CategoryView } from "../../components/tree-provider/CategoryView";
import { PageToolbar } from "../base/EditorToolbar";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { NavPanelIcon } from "../../theme/icons";
import { app } from "../../api/app";
import { RawLinkEvent } from "../../api/events/events";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { CategoryPageModel } from "./CategoryPageModel";
import type { EditorModule } from "../types";
import type { PageType, IPageState } from "../../../shared/types";
import color from "../../theme/color";

const CategoryEditorRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: color.background.default,
});

export function CategoryEditor({ model }: { model: CategoryPageModel }) {
    const navData = model.navigationData;
    const provider = navData?.treeProvider ?? null;
    const categoryPath = model.categoryPath;
    const pageId = model.id;

    const handleNavigate = useCallback((item: ITreeProviderItem) => {
        navData?.setSelectedHref(item.href);
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
    }, [provider, pageId, navData]);

    const handleToggleNavigator = useCallback(() => {
        navData?.toggleNavigator();
    }, [navData]);

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
            </PageToolbar>
            <CategoryView
                provider={provider}
                category={categoryPath}
                onItemClick={handleNavigate}
                onFolderClick={handleNavigate}
            />
        </CategoryEditorRoot>
    );
}

const categoryEditorModule: EditorModule = {
    Editor: CategoryEditor,
    newPageModel: async (filePath?: string) => {
        const { CategoryPageModel } = await import("./CategoryPageModel");
        const { decodeCategoryLink } = await import("../../content/tree-providers/tree-provider-link");
        const model = new CategoryPageModel();
        if (filePath) {
            const link = decodeCategoryLink(filePath);
            if (link) model.initFromLink(link);
        }
        return model;
    },
    newEmptyPageModel: async (pageType: PageType) => {
        if (pageType !== "categoryPage") return null;
        const { CategoryPageModel } = await import("./CategoryPageModel");
        return new CategoryPageModel();
    },
    newPageModelFromState: async (state: Partial<IPageState>) => {
        const { CategoryPageModel } = await import("./CategoryPageModel");
        const model = new CategoryPageModel();
        return model;
    },
};

export default categoryEditorModule;
