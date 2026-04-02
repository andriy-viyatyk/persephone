import styled from "@emotion/styled";
import { useCallback } from "react";
import { Splitter } from "../../components/layout/Splitter";
import { EditorModel } from "../../editors/base";
import { pagesModel } from "../../api/pages";
import { RenderEditor } from "./RenderEditor";
import { CompareEditor } from "../../editors/compare";
import { isTextFileModel } from "../../editors/text";
import { NavigationData } from "../navigation/NavigationData";
import { PageNavigator } from "../navigation/PageNavigator";
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

function NavigationWrapper({ model }: { model: EditorModel }) {
    const hasNavigator = model.state.use((s) => s.hasNavigator || (s as any).hasNavPanel); // eslint-disable-line @typescript-eslint/no-explicit-any
    const navData = hasNavigator ? model.navigationData : null;
    if (!navData) return null;
    return <NavigationContent navData={navData} pageId={model.id} />;
}

function NavigationContent({ navData, pageId }: { navData: NavigationData; pageId: string }) {
    const navModel = navData.ensurePageNavigatorModel();
    const { open, width } = navModel.state.use();
    if (!open) return null;

    return (
        <>
            <div className="nav-panel-container" style={{ width, flexShrink: 0, overflow: "hidden", height: "100%" }}>
                <PageNavigator navigationData={navData} pageId={pageId} />
            </div>
            <Splitter
                type="vertical"
                initialWidth={width}
                onChangeWidth={navModel.setWidth}
            />
        </>
    );
}

/** Renders a single page's content (Navigator + Editor), or CompareEditor if in compare mode */
function PageContent({ pageId }: { pageId: string }) {
    const page = pagesModel.query.findPage(pageId);
    if (!page) return null;

    // Subscribe to compareMode if this is a text page
    const compareMode = isTextFileModel(page)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? page.state.use((s: any) => s.compareMode)
        : false;

    if (compareMode) {
        // Check if this page is the LEFT side of a group — render CompareEditor
        const { leftRight } = pagesModel.state.get();
        const rightId = leftRight.get(pageId);
        if (rightId) {
            const rightPage = pagesModel.query.findPage(rightId);
            if (rightPage && isTextFileModel(page) && isTextFileModel(rightPage)) {
                return <CompareEditor model={page} groupedModel={rightPage} />;
            }
        }

        // This page is the RIGHT side of a compare-mode group — render nothing
        // (CompareEditor is rendered in the left page's portal)
        return null;
    }

    return (
        <>
            <NavigationWrapper model={page} />
            <PageEditorContainer key={page.id}>
                <RenderEditor model={page} />
            </PageEditorContainer>
        </>
    );
}

export function Pages() {
    const { pages, leftRight } = pagesModel.state.use();
    const activePage = pagesModel.activePage;
    const groupedPage = pagesModel.groupedPage;

    const compareModeIds = new Set<string>();
    for (const [leftId] of leftRight) {
        const page = pages.find((p) => p.id === leftId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (page && isTextFileModel(page) && (page.state.get() as any).compareMode) {
            compareModeIds.add(leftId);
        }
    }

    const getStableKey = useCallback((pageId: string) => {
        const page = pagesModel.query.findPage(pageId);
        return page?.navigationData?.renderId;
    }, [pages]);

    return (
        <AppPageManager
            pageIds={pages.map((p) => p.id)}
            activeId={activePage?.id ?? ""}
            groupedActiveId={groupedPage?.id}
            grouping={leftRight}
            compareModeIds={compareModeIds}
            renderPage={(id) => <PageContent pageId={id} />}
            getStableKey={getStableKey}
        />
    );
}
