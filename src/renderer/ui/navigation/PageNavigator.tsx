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
import type { NavPanelModel } from "./nav-panel-store";

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

/**
 * PageNavigator — replacement for NavigationPanel.
 *
 * Uses NavPanelModel for backward compatibility with existing page model
 * infrastructure (PageModel.navPanel, TextToolbar creation, etc.).
 * Uses rootFilePath from NavPanelModel as the FileTreeProvider root.
 */
interface PageNavigatorProps {
    model: NavPanelModel;
    pageId: string;
}

export function PageNavigator({ model, pageId }: PageNavigatorProps) {
    const { rootFilePath } = model.state.use();
    const treeProviderRef = useRef<TreeProviderViewRef>(null);

    const parentPath = path.dirname(rootFilePath);
    const canNavigateUp = parentPath !== rootFilePath && rootFilePath !== "";

    // Create FileTreeProvider for the current rootPath
    const provider = useMemo(() => {
        if (!rootFilePath) return null;
        return new FileTreeProvider(rootFilePath);
    }, [rootFilePath]);

    // Convert NavPanelModel's fileExplorerState to TreeProviderViewSavedState
    const initialState = useMemo((): TreeProviderViewSavedState | undefined => {
        const saved = model.fileExplorerState;
        if (!saved?.expandedPaths?.length) return undefined;
        return {
            expandedPaths: saved.expandedPaths,
            selectedHref: saved.selectedFilePath,
        };
    }, []); // Only on mount

    // ── Handlers ─────────────────────────────────────────────────────

    const handleNavigateUp = useCallback(() => {
        if (!canNavigateUp) return;
        model.fileExplorerState = undefined;
        model.state.update((s) => {
            s.rootFilePath = parentPath;
        });
    }, [canNavigateUp, parentPath, model]);

    const handleMakeRoot = useCallback((newRoot: string) => {
        if (newRoot.toLowerCase() === rootFilePath.toLowerCase()) return;
        model.fileExplorerState = undefined;
        model.state.update((s) => {
            s.rootFilePath = newRoot;
        });
    }, [rootFilePath, model]);

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
        model.setFileExplorerState({
            expandedPaths: state.expandedPaths,
            selectedFilePath: state.selectedHref,
        });
    }, [model]);

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
                    onClick={model.close}
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
