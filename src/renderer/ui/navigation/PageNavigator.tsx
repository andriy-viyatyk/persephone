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
import type { NavigationData } from "./NavigationData";
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
    navigationData: NavigationData;
    pageId: string;
}

export function PageNavigator({ navigationData, pageId }: PageNavigatorProps) {
    const navModel = navigationData.ensurePageNavigatorModel();
    const { rootPath } = navModel.state.use();
    const treeProviderRef = useRef<TreeProviderViewRef>(null);
    const [searchVisible, setSearchVisible] = useState(!!navigationData.searchState);
    const [activePanel, setActivePanelLocal] = useState(navigationData.activePanel);

    // Subscribe to secondary models changes — triggers re-render on add/remove
    const { version: _secondaryVersion } = navigationData.secondaryModelsVersion.use();
    const secondaryModels = navigationData.secondaryModels;

    // Sync local activePanel when NavigationData changes (e.g., after restoreSecondaryModels)
    useEffect(() => {
        if (navigationData.activePanel !== activePanel) {
            setActivePanelLocal(navigationData.activePanel);
        }
    }, [navigationData.activePanel, _secondaryVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    const parentPath = path.dirname(rootPath);
    const canNavigateUp = parentPath !== rootPath && rootPath !== "";

    // Create/update FileTreeProvider via NavigationData
    const provider = useMemo(() => {
        if (!rootPath) return null;
        // Dispose old provider if rootPath changed
        if (navigationData.treeProvider && (navigationData.treeProvider as FileTreeProvider).sourceUrl !== rootPath) {
            navigationData.treeProvider.dispose?.();
            navigationData.treeProvider = null;
        }
        if (!navigationData.treeProvider) {
            navigationData.treeProvider = new FileTreeProvider(rootPath);
        }
        return navigationData.treeProvider;
    }, [rootPath, navigationData]);

    // Initial tree state from NavigationData (restored from cache)
    const initialState = useMemo((): TreeProviderViewSavedState | undefined => {
        return navigationData.treeState;
    }, []); // Only on mount

    const { selectedHref } = navigationData.selectionState.use();

    // Reveal selected item in tree when selection changes (e.g., from CategoryEditor)
    useEffect(() => {
        if (selectedHref && navigationData.activePanel === "explorer") {
            treeProviderRef.current?.revealItem(selectedHref);
        }
    }, [selectedHref, navigationData.activePanel]);

    // ── Handlers — Explorer ──────────────────────────────────────────

    const handleNavigateUp = useCallback(() => {
        navigationData.treeState = undefined;
        navModel.navigateUp();
    }, [navModel, navigationData]);

    const handleMakeRoot = useCallback((newRoot: string) => {
        navigationData.treeState = undefined;
        navModel.makeRoot(newRoot);
    }, [navModel, navigationData]);

    const handleCollapseAll = useCallback(() => {
        treeProviderRef.current?.collapseAll();
    }, []);

    const handleRefresh = useCallback(() => {
        treeProviderRef.current?.refresh();
    }, []);

    // Item click — select + navigate (skip if already selected)
    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        const current = navigationData.selectionState.get().selectedHref;
        if (current?.toLowerCase() === item.href.toLowerCase()) return;
        navigationData.setSelectedHref(item.href);
        const url = navigationData.treeProvider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            url,
            undefined,
            { pageId, sourceId: "explorer" },
        ));
    }, [pageId, navigationData]);

    // ── Handlers — Search ──────────────────────────────────────────

    const openSearch = useCallback((folder?: string) => {
        navigationData.openSearch(folder || rootPath);
        setSearchVisible(true);
        setActivePanelLocal("search");
    }, [navigationData, rootPath]);

    const handleOpenSearch = useCallback(() => {
        openSearch();
    }, [openSearch]);

    const handleCloseSearch = useCallback(() => {
        navigationData.closeSearch();
        setSearchVisible(false);
        setActivePanelLocal("explorer");
    }, [navigationData]);

    const handleSearchResultClick = useCallback((filePath: string, lineNumber?: number) => {
        // Update explorer selection so revealItem works when switching to Explorer
        navigationData.setSelectedHref(filePath);
        const metadata: ILinkMetadata = { pageId };
        if (lineNumber) {
            metadata.revealLine = lineNumber;
            metadata.highlightText = navigationData.searchState?.query;
        }
        app.events.openRawLink.sendAsync(new RawLinkEvent(filePath, undefined, metadata));
    }, [pageId, navigationData]);

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

    // State persistence — tree expansion state saved to NavigationData
    const handleStateChange = useCallback((state: TreeProviderViewSavedState) => {
        navigationData.setTreeState(state);
    }, [navigationData]);

    // ── Panel switch ─────────────────────────────────────────────────

    const handleSetActivePanel = useCallback(async (panelId: string) => {
        const previousPanel = activePanel;
        if (panelId === previousPanel) return;

        navigationData.setActivePanel(panelId);
        setActivePanelLocal(panelId);

        // Search panel — no navigation needed, just expand
        if (panelId === "search") return;

        // Explorer panel — reveal the current selection in tree, but don't auto-navigate
        if (panelId === "explorer") {
            const sel = navigationData.selectionState.get().selectedHref;
            if (sel) {
                treeProviderRef.current?.revealItem(sel);
            }
            return;
        }
    }, [navigationData, pageId, activePanel]);

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

    const searchFolder = navigationData.searchState?.searchFolder || rootPath;
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
                            state={navigationData.searchState}
                            onStateChange={navigationData.setSearchState}
                            onResultClick={handleSearchResultClick}
                        />
                    </CollapsiblePanel>
                )}
                {secondaryModels.map((model) => {
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
                                navigationData.removeSecondaryModel(model);
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
