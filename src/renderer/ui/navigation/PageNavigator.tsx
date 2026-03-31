import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "@emotion/styled";
import { Button } from "../../components/basic/Button";
import { CollapsiblePanelStack, CollapsiblePanel } from "../../components/layout/CollapsiblePanelStack";
import { CircularProgress } from "../../components/basic/CircularProgress";
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
import { isArchiveFile } from "../../core/utils/file-path";
import { RawLinkEvent, ContextMenuEvent } from "../../api/events/events";
import { app } from "../../api/app";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { ILinkMetadata } from "../../api/types/io.events";
import type { NavigationData } from "./NavigationData";

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
    const secondaryTreeRef = useRef<TreeProviderViewRef>(null);
    const [secondaryLoading, setSecondaryLoading] = useState(false);
    const [searchVisible, setSearchVisible] = useState(!!navigationData.searchState);
    const [activePanel, setActivePanelLocal] = useState(navigationData.activePanel);

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

    const secondaryInitialState = useMemo((): TreeProviderViewSavedState | undefined => {
        return navigationData.secondaryTreeState;
    }, [navigationData.secondaryDescriptor?.sourceUrl]); // Reset when secondary changes

    const { selectedHref } = navigationData.selectionState.use();
    const { selectedHref: secondarySelectedHref } = navigationData.secondarySelectionState.use();
    const secondaryDescriptor = navigationData.secondaryDescriptor;
    const secondaryProvider = navigationData.secondaryProvider;

    // Reveal selected item in tree when selection changes (e.g., from CategoryEditor)
    useEffect(() => {
        if (selectedHref && navigationData.activePanel === "explorer") {
            treeProviderRef.current?.revealItem(selectedHref);
        }
    }, [selectedHref, navigationData.activePanel]);

    useEffect(() => {
        if (secondarySelectedHref && navigationData.activePanel === "secondary") {
            secondaryTreeRef.current?.revealItem(secondarySelectedHref);
        }
    }, [secondarySelectedHref, navigationData.activePanel]);

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
            { pageId },
        ));

        // Detect archive files → show secondary panel
        if (!item.isDirectory) {
            if (isArchiveFile(item.href)) {
                navigationData.setSecondaryDescriptor({
                    type: "zip",
                    sourceUrl: item.href,
                    label: "Archive",
                });
            } else {
                navigationData.clearSecondary();
            }
        }
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

    // ── Handlers — Secondary ─────────────────────────────────────────

    const handleSecondaryItemClick = useCallback((item: ITreeProviderItem) => {
        const current = navigationData.secondarySelectionState.get().selectedHref;
        if (current?.toLowerCase() === item.href.toLowerCase()) return;
        navigationData.setSecondarySelectedHref(item.href);
        const url = navigationData.secondaryProvider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
    }, [pageId, navigationData]);

    const handleSecondaryCollapseAll = useCallback(() => {
        secondaryTreeRef.current?.collapseAll();
    }, []);

    const handleSecondaryRefresh = useCallback(() => {
        secondaryTreeRef.current?.refresh();
    }, []);

    const handleSecondaryStateChange = useCallback((state: TreeProviderViewSavedState) => {
        navigationData.setSecondaryTreeState(state);
    }, [navigationData]);

    // ── Panel switch ─────────────────────────────────────────────────

    const handleSetActivePanel = useCallback(async (panelId: string) => {
        const previousPanel = activePanel;
        if (panelId === previousPanel) return;

        if (panelId === "secondary") {
            // Lazy create provider with delayed loading indicator
            if (!navigationData.secondaryProvider) {
                const loadingTimer = setTimeout(() => setSecondaryLoading(true), 200);
                try {
                    const created = await navigationData.createSecondaryProvider();
                    if (!created) return; // creation failed, stay on current panel
                } finally {
                    clearTimeout(loadingTimer);
                    setSecondaryLoading(false);
                }
            }
        }

        navigationData.setActivePanel(panelId);
        setActivePanelLocal(panelId);

        // Search panel — no navigation needed, just expand
        if (panelId === "search") return;

        // Switching from Search to Explorer — just reveal the current file in tree, don't navigate
        if (panelId === "explorer" && previousPanel === "search") {
            const sel = navigationData.selectionState.get().selectedHref;
            if (sel) {
                treeProviderRef.current?.revealItem(sel);
            }
            return;
        }

        // Navigate to the active panel's selection
        const activeProvider = navigationData.activeProvider;
        if (!activeProvider) return;

        const sel = navigationData.activeSelectionState.get().selectedHref;
        if (sel) {
            const url = await activeProvider.getNavigationUrlByHref(sel);
            app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
        } else if (panelId === "secondary") {
            // First time opening secondary — navigate to root category
            const url = await activeProvider.getNavigationUrlByHref(activeProvider.rootPath);
            app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
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

    const secondaryButtons = secondaryDescriptor ? (
        <>
            <Button
                type="icon"
                size="small"
                title="Collapse All"
                onClick={handleSecondaryCollapseAll}
            >
                <CollapseAllIcon width={14} height={14} />
            </Button>
            <Button
                type="icon"
                size="small"
                title="Refresh"
                onClick={handleSecondaryRefresh}
            >
                <RefreshIcon width={14} height={14} />
            </Button>
        </>
    ) : null;

    const secondaryTitle = secondaryDescriptor
        ? (secondaryLoading
            ? <>{secondaryDescriptor.label} <CircularProgress size={12} /></>
            : secondaryDescriptor.label)
        : "";

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
                {secondaryDescriptor && (
                    <CollapsiblePanel
                        id="secondary"
                        title={secondaryTitle}
                        buttons={secondaryButtons}
                    >
                        {secondaryProvider ? (
                            <TreeProviderView
                                ref={secondaryTreeRef}
                                key={secondaryDescriptor.sourceUrl}
                                provider={secondaryProvider}
                                selectedHref={secondarySelectedHref ?? undefined}
                                onItemClick={handleSecondaryItemClick}
                                onItemDoubleClick={handleSecondaryItemClick}
                                initialState={secondaryInitialState}
                                onStateChange={handleSecondaryStateChange}
                            />
                        ) : null}
                    </CollapsiblePanel>
                )}
            </CollapsiblePanelStack>
        </PageNavigatorRoot>
    );
}
