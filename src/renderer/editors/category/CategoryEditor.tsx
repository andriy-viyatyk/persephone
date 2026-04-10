import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "@emotion/styled";
import { CategoryView } from "../../components/tree-provider/CategoryView";
import type { CategoryViewMode } from "../../components/tree-provider/CategoryViewModel";
import { PageToolbar } from "../base/EditorToolbar";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { NavPanelIcon } from "../../theme/icons";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import type { TOneState } from "../../core/state/state";
import type { NavigationState } from "../../api/pages/PageModel";
import type { EditorModel } from "../base";
import type { CategoryEditorModel } from "./CategoryEditorModel";
import type { EditorModule } from "../types";
import type { EditorType, IEditorState } from "../../../shared/types";
import color from "../../theme/color";
import { folderViewModeService } from "./FolderViewModeService";

// =============================================================================
// ITreeProviderHost — duck-type for secondary editors that expose a tree provider
// =============================================================================

interface ITreeProviderHost {
    treeProvider: ITreeProvider | null;
    selectionState: TOneState<NavigationState>;
}

function isTreeProviderHost(editor: EditorModel): editor is EditorModel & ITreeProviderHost {
    return "treeProvider" in editor && "selectionState" in editor;
}

function findTreeProviderHost(
    secondaryEditors: EditorModel[],
    type: string,
    sourceUrl: string,
): ITreeProviderHost | null {
    for (const editor of secondaryEditors) {
        if (!isTreeProviderHost(editor)) continue;
        const tp = editor.treeProvider;
        if (tp && tp.type === type && tp.sourceUrl === sourceUrl) {
            return editor;
        }
    }
    return null;
}

// =============================================================================
// Styles
// =============================================================================

const CategoryEditorRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: color.background.default,
});

// =============================================================================
// Component
// =============================================================================

export function CategoryEditor({ model }: { model: CategoryEditorModel }) {
    const page = model.page;
    const link = model.decodedLink;
    const categoryPath = model.categoryPath;
    const pageId = model.id;

    // Subscribe to model state to detect providerVersion changes
    model.state.use();

    // Find the matching secondary editor by provider type + sourceUrl
    const host = useMemo(() => {
        if (!page || !link) return null;
        return findTreeProviderHost(page.secondaryEditors, link.type, link.url);
    }, [page, link, model.providerVersion]);

    const provider = host?.treeProvider ?? null;
    const hostId = host ? (host as unknown as EditorModel).id : undefined;

    // Track selection from the host's selectionState via manual subscription
    // (can't use .use() directly — host may be null on some renders, violating hook call order)
    const [selectedHref, setSelectedHref] = useState<string | null>(null);
    useEffect(() => {
        if (!host) { setSelectedHref(null); return; }
        const sel = host.selectionState;
        setSelectedHref(sel.get().selectedHref);
        return sel.subscribe(() => setSelectedHref(sel.get().selectedHref));
    }, [host]);

    const [searchPortal, setSearchPortal] = useState<HTMLDivElement | null>(null);
    const [viewMode, setViewMode] = useState<CategoryViewMode>("list");

    // Load persisted view mode for this folder (with inheritance)
    useEffect(() => {
        folderViewModeService.getViewMode(categoryPath).then(setViewMode);
    }, [categoryPath]);

    // Retry provider resolution after mount (secondary editors may restore asynchronously)
    useEffect(() => {
        if (!provider && link) {
            const timer = setTimeout(() => model.onSecondaryEditorsChanged(), 50);
            return () => clearTimeout(timer);
        }
    }, [provider, link, model]);

    const handleViewModeChange = useCallback((mode: CategoryViewMode) => {
        setViewMode(mode);
        folderViewModeService.setViewMode(categoryPath, mode);
    }, [categoryPath]);

    const handleSelect = useCallback((item: ITreeProviderItem) => {
        host?.selectionState.update((s) => { s.selectedHref = item.href; });
    }, [host]);

    const handleNavigate = useCallback((item: ITreeProviderItem) => {
        host?.selectionState.update((s) => { s.selectedHref = item.href; });
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(createLinkData(url, { pageId, sourceId: hostId }));
    }, [provider, pageId, hostId]);

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
                        title="Navigation Panel"
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
                    title="Navigation Panel"
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
