import { useCallback, useMemo, useRef } from "react";
import styled from "@emotion/styled";
import { Button } from "../../components/basic/Button";
import {
    CloseIcon,
    CollapseAllIcon,
    FolderUpIcon,
    RefreshIcon,
} from "../../theme/icons";
import color from "../../theme/color";
import { TreeProviderView, TreeProviderViewRef } from "../../components/tree-provider";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import { RawLinkEvent, ContextMenuEvent } from "../../api/events/events";
import { app } from "../../api/app";
import type { ITreeProviderItem } from "../../api/types/io.tree";
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

    "& .pn-header": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        padding: "4px 4px 4px 4px",
        borderBottom: `1px solid ${color.border.light}`,
        flexShrink: 0,
    },

    "& .pn-header-spacer": {
        flex: "1 1 auto",
    },

    "& .pn-content": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
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
    const { rootFilePath } = navModel.state.use();
    const treeProviderRef = useRef<TreeProviderViewRef>(null);

    const parentPath = path.dirname(rootFilePath);
    const canNavigateUp = parentPath !== rootFilePath && rootFilePath !== "";

    // Create/update FileTreeProvider via NavigationData
    const provider = useMemo(() => {
        if (!rootFilePath) return null;
        // Dispose old provider if rootPath changed
        if (navigationData.treeProvider && (navigationData.treeProvider as FileTreeProvider).sourceUrl !== rootFilePath) {
            navigationData.treeProvider.dispose?.();
            navigationData.treeProvider = null;
        }
        if (!navigationData.treeProvider) {
            navigationData.treeProvider = new FileTreeProvider(rootFilePath);
        }
        return navigationData.treeProvider;
    }, [rootFilePath, navigationData]);

    // Convert NavPanelModel's fileExplorerState to TreeProviderViewSavedState
    const initialState = useMemo((): TreeProviderViewSavedState | undefined => {
        const saved = navModel.fileExplorerState;
        if (!saved?.expandedPaths?.length) return undefined;
        return {
            expandedPaths: saved.expandedPaths,
            selectedHref: saved.selectedFilePath,
        };
    }, []); // Only on mount

    // ── Handlers ─────────────────────────────────────────────────────

    const handleNavigateUp = useCallback(() => {
        if (!canNavigateUp) return;
        navModel.fileExplorerState = undefined;
        navModel.state.update((s) => {
            s.rootFilePath = parentPath;
        });
    }, [canNavigateUp, parentPath, navModel]);

    const handleMakeRoot = useCallback((newRoot: string) => {
        if (newRoot.toLowerCase() === rootFilePath.toLowerCase()) return;
        navModel.fileExplorerState = undefined;
        navModel.state.update((s) => {
            s.rootFilePath = newRoot;
        });
    }, [rootFilePath, navModel]);

    const handleCollapseAll = useCallback(() => {
        treeProviderRef.current?.collapseAll();
    }, []);

    const handleRefresh = useCallback(() => {
        treeProviderRef.current?.refresh();
    }, []);

    // File click — open through raw link pipeline with pageId for navigation
    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            item.href,
            undefined,
            { pageId },
        ));
    }, [pageId]);

    // Folder double-click — make root (when navigable)
    const handleFolderDoubleClick = useCallback((item: ITreeProviderItem) => {
        if (provider?.navigable) {
            handleMakeRoot(item.href);
        }
    }, [provider, handleMakeRoot]);

    // Context menu — parent adds "Make Root" for navigable providers
    const handleContextMenu = useCallback((event: ContextMenuEvent<ITreeProviderItem>) => {
        const item = event.target;
        if (item?.isDirectory && provider?.navigable) {
            const rootLower = rootFilePath.toLowerCase();
            if (item.href.toLowerCase() !== rootLower) {
                event.items.push({
                    startGroup: true,
                    label: "Make Root",
                    onClick: () => handleMakeRoot(item.href),
                });
            }
        }
    }, [provider, handleMakeRoot, rootFilePath]);

    // State persistence — convert TreeProviderViewSavedState back to FileExplorerSavedState
    const handleStateChange = useCallback((state: TreeProviderViewSavedState) => {
        navModel.setFileExplorerState({
            expandedPaths: state.expandedPaths,
            selectedFilePath: state.selectedHref,
        });
    }, [navModel]);

    // ── Render ───────────────────────────────────────────────────────

    if (!provider) {
        return <PageNavigatorRoot />;
    }

    return (
        <PageNavigatorRoot>
            <div className="pn-header">
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
                <span className="pn-header-spacer" />
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
            </div>
            <div className="pn-content">
                <TreeProviderView
                    ref={treeProviderRef}
                    key={rootFilePath}
                    provider={provider}
                    onItemClick={handleItemClick}
                    onItemDoubleClick={handleItemClick}
                    onFolderDoubleClick={handleFolderDoubleClick}
                    onContextMenu={handleContextMenu}
                    initialState={initialState}
                    onStateChange={handleStateChange}
                />
            </div>
        </PageNavigatorRoot>
    );
}
