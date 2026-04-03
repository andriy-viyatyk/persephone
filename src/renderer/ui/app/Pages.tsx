import styled from "@emotion/styled";
import { Splitter } from "../../components/layout/Splitter";
import { pagesModel } from "../../api/pages";
import { RenderEditor } from "./RenderEditor";
import { CompareEditor } from "../../editors/compare";
import { isTextFileModel } from "../../editors/text";
import { PageNavigator } from "../navigation/PageNavigator";
import { AppPageManager } from "../../components/page-manager/AppPageManager";
import type { PageModel } from "../../api/pages/PageModel";
import { useOptionalState } from "../../core/state/state";

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

function NavigationWrapper({ page }: { page: PageModel }) {
    const hasSidebar = page.state.use((s) => s.hasSidebar);
    if (!hasSidebar) return null;
    return <NavigationContent page={page} />;
}

function NavigationContent({ page }: { page: PageModel }) {
    const navModel = page.ensurePageNavigatorModel();
    const { open, width } = navModel.state.use();
    if (!open) return null;

    return (
        <>
            <div className="nav-panel-container" style={{ width, flexShrink: 0, overflow: "hidden", height: "100%" }}>
                <PageNavigator page={page} />
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

    // Subscribe to mainEditorId — changes on navigation, triggers re-render for editor swap
    page.state.use((s) => s.mainEditorId);
    const editor = page.mainEditor;

    // Subscribe to compareMode — unconditional hook, safe across editor type changes
    const textEditor = editor && isTextFileModel(editor) ? editor : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compareMode = useOptionalState(textEditor?.state as any, (s: any) => s.compareMode, false);

    if (compareMode) {
        // Check if this page is the LEFT side of a group — render CompareEditor
        const { leftRight } = pagesModel.state.get();
        const rightId = leftRight.get(pageId);
        if (rightId) {
            const rightPage = pagesModel.query.findPage(rightId);
            const rightEditor = rightPage?.mainEditor;
            if (editor && rightEditor && isTextFileModel(editor) && isTextFileModel(rightEditor)) {
                return <CompareEditor model={editor} groupedModel={rightEditor} />;
            }
        }

        // This page is the RIGHT side of a compare-mode group — render nothing
        // (CompareEditor is rendered in the left page's portal)
        return null;
    }

    return (
        <>
            <NavigationWrapper page={page} />
            <PageEditorContainer key={page.id}>
                {editor && <RenderEditor model={editor} />}
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
        const editor = page?.mainEditor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (editor && isTextFileModel(editor) && (editor.state.get() as any).compareMode) {
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
