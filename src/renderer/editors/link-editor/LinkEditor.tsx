import styled from "@emotion/styled";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Breadcrumb } from "../../components/basic/Breadcrumb";
import { Button } from "../../components/basic/Button";
import { TagsList } from "../../components/basic/TagsList";
import { TextField } from "../../components/basic/TextField";
import { HighlightedTextProvider } from "../../components/basic/useHighlightedText";
import { CollapsiblePanel, CollapsiblePanelStack } from "../../components/layout/CollapsiblePanelStack";
import { Splitter } from "../../components/layout/Splitter";
import { CategoryTree, CategoryTreeItem } from "../../components/TreeView";
import { useComponentModel } from "../../core/state/model";
import { splitWithSeparators } from "../../core/utils/utils";
import { showAppPopupMenu } from "../../features/dialogs";
import color from "../../theme/color";
import {
    CloseIcon, GlobeIcon, OpenFileIcon, PlusIcon,
    ViewLandscapeBigIcon, ViewLandscapeIcon, ViewListIcon, ViewPortraitBigIcon, ViewPortraitIcon,
} from "../../theme/icons";
import { IncognitoIcon } from "../../theme/language-icons";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import { appSettings, BrowserProfile } from "../../store/app-settings";
import { defaultLinkEditorState, LinkEditorModel } from "./LinkEditorModel";
import { LinkEditorProps, LinkViewMode, LINK_DRAG, LINK_CATEGORY_DRAG } from "./linkTypes";
import { LinkItemList } from "./LinkItemList";
import { LinkItemTiles } from "./LinkItemTiles";
import { PinnedLinksPanel } from "./PinnedLinksPanel";
import { EditorError } from "../base/EditorError";

// =============================================================================
// Styles
// =============================================================================

const LinkEditorRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
    "&.swap-layout": {
        flexDirection: "row-reverse",
    },
    "& .left-panel": {
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: color.background.dark,
        minWidth: 100,
        maxWidth: "80%",
    },
    "& .category-tree-container": {
        flex: 1,
        display: "flex",
        overflow: "hidden",
        fontSize: 13,
        paddingLeft: 4,
    },
    "& .tags-list-container": {
        flex: 1,
        display: "flex",
        overflow: "hidden",
        width: "100%",
    },
    "& .category-label-name": {
        flex: "1 1 auto",
    },
    "& .category-label-size": {
        margin: "0 4px",
        fontSize: 12,
    },
    "& .tree-cell": {
        color: color.text.light,
        "&.selected": {
            color: color.misc.blue,
        },
    },
    "& .center-panel": {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
    },
    "& .empty-state": {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 16,
        color: color.text.light,
        fontSize: 14,
    },
    "& .title": {
        fontSize: 24,
        color: color.text.default,
    },
    "& .subtitle": {
        color: color.text.light,
    },
});

const SearchField = styled(TextField)({
    "& input": {
        color: color.misc.blue,
    },
});

// =============================================================================
// View mode labels
// =============================================================================

const VIEW_MODE_LABELS: Record<LinkViewMode, string> = {
    "list": "List",
    "tiles-landscape": "Landscape",
    "tiles-landscape-big": "Landscape (Large)",
    "tiles-portrait": "Portrait",
    "tiles-portrait-big": "Portrait (Large)",
};

const VIEW_MODE_ICONS: Record<LinkViewMode, React.ReactNode> = {
    "list": <ViewListIcon />,
    "tiles-landscape": <ViewLandscapeIcon />,
    "tiles-landscape-big": <ViewLandscapeBigIcon />,
    "tiles-portrait": <ViewPortraitIcon />,
    "tiles-portrait-big": <ViewPortraitBigIcon />,
};

const VIEW_MODE_ORDER: LinkViewMode[] = [
    "list",
    "tiles-landscape",
    "tiles-landscape-big",
    "tiles-portrait",
    "tiles-portrait-big",
];

// =============================================================================
// Browser selector helpers
// =============================================================================

function getBrowserSelectorIcon(selectedBrowser: string, profiles: BrowserProfile[]): React.ReactNode {
    if (selectedBrowser === "os-default") return <OpenFileIcon />;
    if (selectedBrowser === "incognito") return <IncognitoIcon />;
    if (selectedBrowser.startsWith("profile:")) {
        const name = selectedBrowser.slice("profile:".length);
        const profile = profiles.find((p) => p.name === name);
        return <GlobeIcon color={profile?.color || DEFAULT_BROWSER_COLOR} />;
    }
    return <GlobeIcon color={DEFAULT_BROWSER_COLOR} />;
}

function getBrowserSelectorLabel(selectedBrowser: string): string {
    if (selectedBrowser === "os-default") return "OS Browser";
    if (selectedBrowser === "incognito") return "Incognito";
    if (selectedBrowser.startsWith("profile:")) return selectedBrowser.slice("profile:".length);
    return "Browser";
}

// =============================================================================
// Component
// =============================================================================

export function LinkEditor(props: LinkEditorProps) {
    const { model, swapLayout } = props;
    const pageModel = useComponentModel(
        props,
        LinkEditorModel,
        defaultLinkEditorState,
    );
    const state = model.state.use();
    const pageState = pageModel.state.use();
    const allLinks = pageState.data.links;
    const links = pageState.filteredLinks;
    const viewMode = pageModel.getViewMode();
    const pinnedLinks = pageModel.getPinnedLinks();
    const pinnedLinkIds = useMemo(
        () => new Set(pageState.data.state.pinnedLinks ?? []),
        [pageState.data.state.pinnedLinks],
    );
    const pinnedPanelWidth = pageState.data.state.pinnedPanelWidth ?? 100;

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        pageModel.init();
        pageModel.containerElement = containerRef.current;
        return () => {
            pageModel.containerElement = null;
            pageModel.dispose();
        };
    }, []);

    useEffect(() => {
        pageModel.updateContent(state.content || "");
    }, [state.content]);

    useEffect(() => {
        pageModel.gridModel?.update({ all: true });
    }, [links]);

    const browserProfiles = appSettings.use("browser-profiles");

    const showBrowserSelectorMenu = useCallback((e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const items = [
            {
                label: "OS Default Browser",
                icon: <OpenFileIcon />,
                selected: pageState.selectedBrowser === "os-default",
                onClick: () => pageModel.setSelectedBrowser("os-default"),
            },
            {
                label: "Internal Browser",
                icon: <GlobeIcon color={DEFAULT_BROWSER_COLOR} />,
                selected: pageState.selectedBrowser === "internal-default",
                onClick: () => pageModel.setSelectedBrowser("internal-default"),
                startGroup: true,
            },
            ...browserProfiles.map((profile) => ({
                label: profile.name,
                icon: <GlobeIcon color={profile.color} />,
                selected: pageState.selectedBrowser === `profile:${profile.name}`,
                onClick: () => pageModel.setSelectedBrowser(`profile:${profile.name}`),
            })),
            {
                label: "Incognito",
                icon: <IncognitoIcon />,
                selected: pageState.selectedBrowser === "incognito",
                onClick: () => pageModel.setSelectedBrowser("incognito"),
                startGroup: true,
            },
        ];
        showAppPopupMenu(rect.left, rect.bottom + 2, items);
    }, [pageState.selectedBrowser, browserProfiles, pageModel]);

    const showViewModeMenu = useCallback((e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        showAppPopupMenu(rect.left, rect.bottom + 2, VIEW_MODE_ORDER.map((mode) => ({
            label: VIEW_MODE_LABELS[mode],
            icon: VIEW_MODE_ICONS[mode],
            selected: mode === viewMode,
            onClick: () => pageModel.setViewMode(mode),
        })));
    }, [viewMode, pageModel]);

    // Category tree label with link count
    const getTreeItemLabel = useCallback(
        (item: CategoryTreeItem) => {
            const name = splitWithSeparators(item.category, "/\\").pop() || "";
            const size = pageModel.getCategoryCount(item.category);
            return (
                <>
                    <span className="category-label-name">{name || "All"}</span>
                    {size !== undefined && (
                        <span className="category-label-size">{size}</span>
                    )}
                </>
            );
        },
        [pageModel, pageState.categoriesSize],
    );

    if (pageState.error) {
        return (
            <LinkEditorRoot>
                <EditorError>{pageState.error}</EditorError>
            </LinkEditorRoot>
        );
    }

    return (
        <>
            {Boolean(model.editorToolbarRefFirst) &&
                createPortal(
                    pageState.expandedPanel === "tags" ? (
                        <Breadcrumb
                            rootLabel="Tags"
                            value={pageState.selectedTag}
                            onChange={pageModel.setSelectedTag}
                            separators=":"
                            trailingParentSeparator
                        />
                    ) : (
                        <Breadcrumb
                            rootLabel="Categories"
                            value={pageState.selectedCategory}
                            onChange={pageModel.setSelectedCategory}
                        />
                    ),
                    model.editorToolbarRefFirst,
                )}
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        {!swapLayout && (
                            <Button
                                size="small"
                                type="flat"
                                title="Open links in..."
                                onClick={showBrowserSelectorMenu}
                            >
                                {getBrowserSelectorIcon(pageState.selectedBrowser, browserProfiles)}
                                {" "}
                                {getBrowserSelectorLabel(pageState.selectedBrowser)}
                            </Button>
                        )}
                        <Button
                            size="small"
                            type="raised"
                            title="Add Link"
                            onClick={() => pageModel.showLinkDialog()}
                            style={{ borderColor: color.border.active }}
                        >
                            <PlusIcon /> Add Link&nbsp;
                        </Button>
                        <Button
                            size="small"
                            type="flat"
                            title="View Mode"
                            onClick={showViewModeMenu}
                        >
                            {VIEW_MODE_ICONS[viewMode]} {VIEW_MODE_LABELS[viewMode]}
                        </Button>
                        <SearchField
                            value={pageState.searchText}
                            onChange={pageModel.setSearchText}
                            placeholder="Search..."
                            width={180}
                            endButtons={
                                pageState.searchText ? [
                                    <Button
                                        key="clear"
                                        size="small"
                                        type="icon"
                                        title="Clear search"
                                        onClick={pageModel.clearSearch}
                                    >
                                        <CloseIcon />
                                    </Button>,
                                ] : undefined
                            }
                        />
                    </>,
                    model.editorToolbarRefLast,
                )}
            <LinkEditorRoot ref={containerRef} tabIndex={-1} className={clsx({ "swap-layout": swapLayout })}>
                <CollapsiblePanelStack
                    className="left-panel"
                    style={{ width: pageState.leftPanelWidth }}
                    activePanel={pageState.expandedPanel}
                    setActivePanel={pageModel.setExpandedPanel}
                >
                    <CollapsiblePanel id="tags" title="Tags">
                        <div className="tags-list-container">
                            <TagsList
                                tags={pageState.tags}
                                value={pageState.selectedTag}
                                onChange={pageModel.setSelectedTag}
                                getCount={pageModel.getTagCount}
                            />
                        </div>
                    </CollapsiblePanel>
                    <CollapsiblePanel id="categories" title="Categories">
                        <div className="category-tree-container">
                            <CategoryTree
                                categories={pageState.categories}
                                separators="/\"
                                rootLabel="All"
                                rootCollapsible={false}
                                onItemClick={pageModel.categoryItemClick}
                                getSelected={pageModel.getCategoryItemSelected}
                                getLabel={getTreeItemLabel}
                                refreshKey={pageState.selectedCategory}
                                dropTypes={[LINK_DRAG, LINK_CATEGORY_DRAG]}
                                onDrop={pageModel.categoryDrop}
                                dragType={LINK_CATEGORY_DRAG}
                                getDragItem={pageModel.getCategoryDragItem}
                            />
                        </div>
                    </CollapsiblePanel>
                </CollapsiblePanelStack>
                <Splitter
                    type="vertical"
                    initialWidth={pageState.leftPanelWidth}
                    onChangeWidth={pageModel.setLeftPanelWidth}
                    borderSized={swapLayout ? "left" : "right"}
                />
                <HighlightedTextProvider value={pageState.searchText}>
                    <div className="center-panel">
                        {allLinks.length === 0 ? (
                            <div className="empty-state">
                                <div className="title">Links</div>
                                <div className="subtitle">No links yet</div>
                                <div className="subtitle">
                                    Click "Add Link" to create your first link
                                </div>
                            </div>
                        ) : links.length === 0 ? (
                            <div className="empty-state">
                                <div className="subtitle">No links match the current filter</div>
                            </div>
                        ) : viewMode === "list" ? (
                            <LinkItemList
                                links={links}
                                model={pageModel}
                                selectedLinkId={pageState.selectedLinkId}
                                pinnedLinkIds={pinnedLinkIds}
                            />
                        ) : (
                            <LinkItemTiles
                                links={links}
                                model={pageModel}
                                viewMode={viewMode}
                                selectedLinkId={pageState.selectedLinkId}
                                pinnedLinkIds={pinnedLinkIds}
                            />
                        )}
                    </div>
                </HighlightedTextProvider>
                {pinnedLinks.length > 0 && (
                    <>
                        <Splitter
                            type="vertical"
                            initialWidth={pinnedPanelWidth}
                            onChangeWidth={pageModel.setPinnedPanelWidth}
                            borderSized={swapLayout ? "right" : "left"}
                        />
                        <PinnedLinksPanel
                            pinnedLinks={pinnedLinks}
                            model={pageModel}
                            style={{ width: pinnedPanelWidth }}
                        />
                    </>
                )}
            </LinkEditorRoot>
            {Boolean(model.editorFooterRefLast) &&
                createPortal(
                    <span>
                        {links.length === allLinks.length
                            ? `${allLinks.length} links`
                            : `${links.length} of ${allLinks.length} links`}
                    </span>,
                    model.editorFooterRefLast,
                )}
        </>
    );
}
