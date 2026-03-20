import styled from "@emotion/styled";
import { Splitter } from "../../components/layout/Splitter";
import { PageModel } from "../../editors/base";
import { pagesModel } from "../../api/pages";
import { RenderEditor } from "./RenderEditor";
import { CompareEditor } from "../../editors/compare";
import { isTextFileModel } from "../../editors/text";
import { NavPanelModel } from "../navigation/nav-panel-store";
import { NavigationPanel } from "../navigation/NavigationPanel";
import { AppPageManager } from "../../components/page-manager/AppPageManager";

const PageEditorContainer = styled.div(
    {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 100,
    },
    { label: "PageEditorContainer" },
);

function NavPanelWrapper({ model }: { model: PageModel }) {
    // Subscribe to hasNavPanel state to re-render when NavPanel is created
    const hasNavPanel = model.state.use((s) => s.hasNavPanel);
    const panel = hasNavPanel ? model.navPanel : null;
    if (!panel) return null;
    return <NavPanelContent model={panel} pageId={model.id} />;
}

function NavPanelContent({ model, pageId }: { model: NavPanelModel; pageId: string }) {
    const { open, width } = model.state.use();
    if (!open) return null;

    return (
        <>
            <div className="nav-panel-container" style={{ width, flexShrink: 0, overflow: "hidden", height: "100%" }}>
                <NavigationPanel model={model} pageId={pageId} />
            </div>
            <Splitter
                type="vertical"
                initialWidth={width}
                onChangeWidth={model.setWidth}
            />
        </>
    );
}

/** Renders a single page's content (NavPanel + Editor), or CompareEditor if in compare mode */
function PageContent({ pageId }: { pageId: string }) {
    const page = pagesModel.query.findPage(pageId);
    if (!page) return null;

    // Subscribe to compareMode if this is a text page
    const compareMode = isTextFileModel(page)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? page.state.use((s: any) => s.compareMode)
        : false;

    // If this page is the LEFT side of a group and in compare mode, render CompareEditor
    const groupedPage = pagesModel.getGroupedPage(pageId);
    if (compareMode && groupedPage && isTextFileModel(page) && isTextFileModel(groupedPage)) {
        return <CompareEditor model={page} groupedModel={groupedPage} />;
    }

    // If this page is the RIGHT side of a compare-mode group, render nothing
    // (CompareEditor handles both pages from the left side's portal)
    const leftPage = findLeftPage(pageId);
    if (leftPage && isTextFileModel(leftPage)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const leftCompare = (leftPage.state.get() as any).compareMode;
        if (leftCompare) return null;
    }

    return (
        <>
            <NavPanelWrapper model={page} />
            <PageEditorContainer>
                <RenderEditor model={page} />
            </PageEditorContainer>
        </>
    );
}

/** Find the left page if this page is the right side of a group */
function findLeftPage(pageId: string): PageModel | undefined {
    const { leftRight } = pagesModel.state.get();
    for (const [leftId, rightId] of leftRight) {
        if (rightId === pageId) return pagesModel.query.findPage(leftId);
    }
    return undefined;
}

export function Pages() {
    const { pages, leftRight } = pagesModel.state.use();
    const activePage = pagesModel.activePage;
    const groupedPage = pagesModel.groupedPage;

    return (
        <AppPageManager
            pageIds={pages.map((p) => p.id)}
            activeId={activePage?.id ?? ""}
            groupedActiveId={groupedPage?.id}
            grouping={leftRight}
            renderPage={(id) => <PageContent pageId={id} />}
        />
    );
}
