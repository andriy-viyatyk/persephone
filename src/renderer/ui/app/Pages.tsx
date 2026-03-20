import styled from "@emotion/styled";
import { useEffect, useRef, useState } from "react";
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
            <NavPanelWrapper model={page} />
            <PageEditorContainer>
                <RenderEditor model={page} />
            </PageEditorContainer>
        </>
    );
}

export function Pages() {
    const { pages, leftRight } = pagesModel.state.use();
    const activePage = pagesModel.activePage;
    const groupedPage = pagesModel.groupedPage;

    // Subscribe to compareMode changes on the active page to update layout
    const [, forceUpdate] = useState(0);
    const prevCompareModeRef = useRef(false);
    useEffect(() => {
        if (!activePage || !isTextFileModel(activePage)) return;
        const unsubscribe = activePage.state.subscribe(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cm = (activePage.state.get() as any).compareMode as boolean;
            if (cm !== prevCompareModeRef.current) {
                prevCompareModeRef.current = cm;
                forceUpdate((n) => n + 1);
            }
        });
        return unsubscribe;
    }, [activePage]);

    // Build compareModeIds from current state
    const compareModeIds = new Set<string>();
    for (const [leftId] of leftRight) {
        const page = pages.find((p) => p.id === leftId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (page && isTextFileModel(page) && (page.state.get() as any).compareMode) {
            compareModeIds.add(leftId);
        }
    }

    return (
        <AppPageManager
            pageIds={pages.map((p) => p.id)}
            activeId={activePage?.id ?? ""}
            groupedActiveId={groupedPage?.id}
            grouping={leftRight}
            compareModeIds={compareModeIds}
            renderPage={(id) => <PageContent pageId={id} />}
        />
    );
}
