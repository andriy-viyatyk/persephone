import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "@emotion/styled";
import { Button } from "../../components/basic/Button";
import { CollapsiblePanelStack, CollapsiblePanel } from "../../components/layout/CollapsiblePanelStack";
import { FileSearch } from "../../components/file-search";
import {
    CloseIcon,
    CollapseAllIcon,
    FolderUpIcon,
    RefreshIcon,
    SearchIcon,
} from "../../theme/icons";
import color from "../../theme/color";
import { TreeProviderView, TreeProviderViewRef } from "../../components/tree-provider";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import { RawLinkEvent, ContextMenuEvent } from "../../api/events/events";
import { app } from "../../api/app";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { ILinkMetadata } from "../../api/types/io.events";
import type { PageModel } from "../../api/pages/PageModel";
import { secondaryEditorRegistry } from "./secondary-editor-registry";
import { LazySecondaryEditor } from "./LazySecondaryEditor";

const path = require("path") as typeof import("path");

// =============================================================================
// Styles
// =============================================================================

const PageNavigatorRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    backgroundColor: color.background.default,
});

// =============================================================================
// Component
// =============================================================================

interface PageNavigatorProps {
    page: PageModel;
}

export function PageNavigator({ page }: PageNavigatorProps) {
    const navModel = page.ensurePageNavigatorModel();
    const { rootPath } = navModel.state.use();
    const treeProviderRef = useRef<TreeProviderViewRef>(null);
    const [searchVisible, setSearchVisible] = useState(!!page.searchState);
    const [activePanel, setActivePanelLocal] = useState(page.activePanel);

    // Subscribe to secondary editors changes — triggers re-render on add/remove
    const { version: _secondaryVersion } = page.secondaryEditorsVersion.use();
    const secondaryEditors = page.secondaryEditors;

    // Sync local activePanel when PageModel changes (e.g., after restoreSecondaryEditors)
    useEffect(() => {
        if (page.activePanel !== activePanel) {
            setActivePanelLocal(page.activePanel);
        }
    }, [page.activePanel, _secondaryVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    const parentPath = path.dirname(rootPath);
    const canNavigateUp = parentPath !== rootPath && rootPath !== "";

    // Create/update FileTreeProvider via PageModel
    const provider = useMemo(() => {
        if (!rootPath) return null;
        // Dispose old provider if rootPath changed
        if (page.treeProvider && (page.treeProvider as FileTreeProvider).sourceUrl !== rootPath) {
            page.treeProvider.dispose?.();
            page.treeProvider = null;
        }
        if (!page.treeProvider) {
            page.treeProvider = new FileTreeProvider(rootPath);
        }
        return page.treeProvider;
    }, [rootPath, page]);

    // Initial tree state from PageModel (restored from cache)
    const initialState = useMemo((): TreeProviderViewSavedState | undefined => {
        return page.treeState;
    }, []); // Only on mount

    const { selectedHref } = page.selectionState.use();

    // Reveal selected item in tree when selection changes (e.g., from CategoryEditor)
    useEffect(() => {
        if (selectedHref && page.activePanel === "explorer") {
            treeProviderRef.current?.revealItem(selectedHref);
        }
    }, [selectedHref, page.activePanel]);

    // ── Handlers — Explorer ──────────────────────────────────────────

    const handleNavigateUp = useCallback(() => {
        page.treeState = undefined;
        navModel.navigateUp();
    }, [navModel, page]);

    const handleMakeRoot = useCallback((newRoot: string) => {
        page.treeState = undefined;
        navModel.makeRoot(newRoot);
    }, [navModel, page]);

    const handleCollapseAll = useCallback(() => {
        treeProviderRef.current?.collapseAll();
    }, []);

    const handleRefresh = useCallback(() => {
        treeProviderRef.current?.refresh();
    }, []);

    const pageId = page.mainEditor?.id ?? page.id;

    // Item click — select + navigate (skip if already selected)
    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        const current = page.selectionState.get().selectedHref;
        if (current?.toLowerCase() === item.href.toLowerCase()) return;
        page.setSelectedHref(item.href);
        const url = page.treeProvider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            url,
            undefined,
            { pageId, sourceId: "explorer" },
        ));
    }, [pageId, page]);

    // ── Handlers — Search ──────────────────────────────────────────

    const openSearch = useCallback((folder?: string) => {
        page.openSearch(folder || rootPath);
        setSearchVisible(true);
        setActivePanelLocal("search");
    }, [page, rootPath]);

    const handleOpenSearch = useCallback(() => {
        openSearch();
    }, [openSearch]);

    const handleCloseSearch = useCallback(() => {
        page.closeSearch();
        setSearchVisible(false);
        setActivePanelLocal("explorer");
    }, [page]);

    const handleSearchResultClick = useCallback((filePath: string, lineNumber?: number) => {
        // Update explorer selection so revealItem works when switching to Explorer
        page.setSelectedHref(filePath);
        const metadata: ILinkMetadata = { pageId };
        if (lineNumber) {
            metadata.revealLine = lineNumber;
            metadata.highlightText = page.searchState?.query;
        }
        app.events.openRawLink.sendAsync(new RawLinkEvent(filePath, undefined, metadata));
    }, [pageId, page]);

    // Context menu — parent adds "Make Root" and "Search in Folder" for navigable providers
    const handleContextMenu = useCallback((event: ContextMenuEvent<ITreeProviderItem>) => {
        const item = event.target;
        if (item?.isDirectory && provider?.navigable) {
            const rootLower = rootPath.toLowerCase();
            if (item.href.toLowerCase() !== rootLower) {
                event.items.push({
                    startGroup: true,
                    label: "Make Root",
                    onClick: () => handleMakeRoot(item.href),
                });
            }
            event.items.push({
                label: "Search in Folder",
                icon: <SearchIcon width={14} height={14} />,
                onClick: () => openSearch(item.href),
            });
        }
    }, [provider, handleMakeRoot, rootPath, openSearch]);

    // State persistence — tree expansion state saved to PageModel
    const handleStateChange = useCallback((state: TreeProviderViewSavedState) => {
        page.setTreeState(state);
    }, [page]);

    // ── Panel switch ─────────────────────────────────────────────────

    const handleSetActivePanel = useCallback(async (panelId: string) => {
        const previousPanel = activePanel;
        if (panelId === previousPanel) return;

        page.setActivePanel(panelId);
        setActivePanelLocal(panelId);

        // Search panel — no navigation needed, just expand
        if (panelId === "search") return;

        // Explorer panel — reveal the current selection in tree, but don't auto-navigate
        if (panelId === "explorer") {
            const sel = page.selectionState.get().selectedHref;
            if (sel) {
                treeProviderRef.current?.revealItem(sel);
            }
            return;
        }
    }, [page, pageId, activePanel]);

    // ── Render ───────────────────────────────────────────────────────

    if (!provider) {
        return <PageNavigatorRoot />;
    }

    const explorerButtons = (
        <>
            {provider.navigable && (
                <Button
                    type="icon"
                    size="small"
                    title={canNavigateUp ? `Up to ${path.basename(parentPath)}` : "Already at root"}
                    onClick={handleNavigateUp}
                    disabled={!canNavigateUp}
                >
                    <FolderUpIcon width={14} height={14} />
                </Button>
            )}
            <Button
                type="icon"
                size="small"
                title="Search"
                onClick={handleOpenSearch}
            >
                <SearchIcon width={14} height={14} />
            </Button>
            <Button
                type="icon"
                size="small"
                title="Collapse All"
                onClick={handleCollapseAll}
            >
                <CollapseAllIcon width={14} height={14} />
            </Button>
            <Button
                type="icon"
                size="small"
                title="Refresh"
                onClick={handleRefresh}
            >
                <RefreshIcon width={14} height={14} />
            </Button>
            <Button
                type="icon"
                size="small"
                title="Close Panel"
                onClick={navModel.close}
            >
                <CloseIcon width={14} height={14} />
            </Button>
        </>
    );

    const searchFolder = page.searchState?.searchFolder || rootPath;
    const searchFolderName = path.basename(searchFolder);
    const searchTitle = (
        <span title={searchFolder} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Search [{searchFolderName}]
        </span>
    );

    const searchButtons = (
        <>
            <Button
                type="icon"
                size="small"
                title="Close Search"
                onClick={handleCloseSearch}
            >
                <CloseIcon width={14} height={14} />
            </Button>
        </>
    );

    return (
        <PageNavigatorRoot>
            <CollapsiblePanelStack
                activePanel={activePanel}
                setActivePanel={handleSetActivePanel}
                style={{ flex: "1 1 auto" }}
            >
                <CollapsiblePanel
                    id="explorer"
                    title="Explorer"
                    buttons={explorerButtons}
                >
                    <TreeProviderView
                        ref={treeProviderRef}
                        key={rootPath}
                        provider={provider}
                        selectedHref={selectedHref ?? undefined}
                        onItemClick={handleItemClick}
                        onItemDoubleClick={handleItemClick}
                        onContextMenu={handleContextMenu}
                        initialState={initialState}
                        onStateChange={handleStateChange}
                    />
                </CollapsiblePanel>
                {searchVisible && (
                    <CollapsiblePanel
                        id="search"
                        title={searchTitle}
                        buttons={searchButtons}
                    >
                        <FileSearch
                            folder={rootPath}
                            state={page.searchState}
                            onStateChange={page.setSearchState}
                            onResultClick={handleSearchResultClick}
                        />
                    </CollapsiblePanel>
                )}
                {secondaryEditors.map((model) => {
                    const editorId = model.state.get().secondaryEditor;
                    if (!editorId) return null;
                    const def = secondaryEditorRegistry.get(editorId);
                    if (!def) return null;

                    // Active page's own secondary panel has no close button —
                    // it's controlled by the secondaryEditor field.
                    // Pass empty fragment to suppress chevron icons.
                    const isActivePagePanel = model.id === pageId;
                    const panelButtons = isActivePagePanel ? (<></>) : (
                        <Button
                            type="icon"
                            size="small"
                            title="Close"
                            onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                page.removeSecondaryEditor(model);
                            }}
                        >
                            <CloseIcon width={14} height={14} />
                        </Button>
                    );

                    return (
                        <CollapsiblePanel
                            key={model.id}
                            id={model.id}
                            title={def.label}
                            buttons={panelButtons}
                        >
                            <LazySecondaryEditor model={model} editorId={editorId} />
                        </CollapsiblePanel>
                    );
                })}
            </CollapsiblePanelStack>
        </PageNavigatorRoot>
    );
}
