import styled from "@emotion/styled";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Breadcrumb } from "../../components/basic/Breadcrumb";
import { Button } from "../../components/basic/Button";
import { TagsList } from "../../components/basic/TagsList";
import { TextField } from "../../components/basic/TextField";
import { HighlightedTextProvider } from "../../components/basic/useHighlightedText";
import { CollapsiblePanel, CollapsiblePanelStack } from "../../components/layout/CollapsiblePanelStack";
import { Splitter } from "../../components/layout/Splitter";
import { CategoryTree, CategoryTreeItem } from "../../components/TreeView";
import { splitWithSeparators } from "../../core/utils/utils";
import { showAppPopupMenu } from "../../ui/dialogs";
import color from "../../theme/color";
import {
    CloseIcon, GlobeIcon, OpenFileIcon, PlusIcon,
    ViewLandscapeBigIcon, ViewLandscapeIcon, ViewListIcon, ViewPortraitBigIcon, ViewPortraitIcon,
} from "../../theme/icons";
import { IncognitoIcon } from "../../theme/language-icons";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import { settings, BrowserProfile } from "../../api/settings";
import { defaultLinkEditorState, LinkViewModel, LinkEditorState } from "./LinkViewModel";
import { LinkEditorProps, LinkViewMode, LINK_DRAG, LINK_CATEGORY_DRAG } from "./linkTypes";
import { LinkItemList } from "./LinkItemList";
import { LinkItemTiles } from "./LinkItemTiles";
import { PinnedLinksPanel } from "./PinnedLinksPanel";
import { EditorError } from "../base/EditorError";
import { useContentViewModel } from "../base/useContentViewModel";

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
// useSyncExternalStore helpers
// =============================================================================

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultLinkEditorState;

// =============================================================================
// Component
// =============================================================================

export function LinkEditor(props: LinkEditorProps) {
    const { model, swapLayout } = props;
    const vm = useContentViewModel<LinkViewModel>(model, "link-view");

    const pageState: LinkEditorState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    // Initialize browser selection for standalone mode (BookmarksDrawer skips this)
    useEffect(() => {
        if (vm && !swapLayout) {
            vm.initBrowserSelection();
        }
    }, [vm, swapLayout]);

    // Update grid when filtered links change (React rendering concern)
    useEffect(() => {
        vm?.gridModel?.update({ all: true });
    }, [vm, pageState.filteredLinks]);

    const allLinks = pageState.data.links;
    const links = pageState.filteredLinks;
    const viewMode = vm?.getViewMode() ?? "list";
    const pinnedLinks = vm?.getPinnedLinks() ?? [];
    const pinnedLinkIds = useMemo(
        () => new Set(pageState.data.state.pinnedLinks ?? []),
        [pageState.data.state.pinnedLinks],
    );
    const pinnedPanelWidth = pageState.data.state.pinnedPanelWidth ?? 100;

    const browserProfiles = settings.use("browser-profiles");

    const showBrowserSelectorMenu = useCallback((e: React.MouseEvent) => {
        if (!vm) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const items = [
            {
                label: "OS Default Browser",
                icon: <OpenFileIcon />,
                selected: pageState.selectedBrowser === "os-default",
                onClick: () => vm.setSelectedBrowser("os-default"),
            },
            {
                label: "Internal Browser",
                icon: <GlobeIcon color={DEFAULT_BROWSER_COLOR} />,
                selected: pageState.selectedBrowser === "internal-default",
                onClick: () => vm.setSelectedBrowser("internal-default"),
                startGroup: true,
            },
            ...browserProfiles.map((profile) => ({
                label: profile.name,
                icon: <GlobeIcon color={profile.color} />,
                selected: pageState.selectedBrowser === `profile:${profile.name}`,
                onClick: () => vm.setSelectedBrowser(`profile:${profile.name}`),
            })),
            {
                label: "Incognito",
                icon: <IncognitoIcon />,
                selected: pageState.selectedBrowser === "incognito",
                onClick: () => vm.setSelectedBrowser("incognito"),
                startGroup: true,
            },
        ];
        showAppPopupMenu(rect.left, rect.bottom + 2, items);
    }, [vm, pageState.selectedBrowser, browserProfiles]);

    const showViewModeMenu = useCallback((e: React.MouseEvent) => {
        if (!vm) return;
        const rect = e.currentTarget.getBoundingClientRect();
        showAppPopupMenu(rect.left, rect.bottom + 2, VIEW_MODE_ORDER.map((mode) => ({
            label: VIEW_MODE_LABELS[mode],
            icon: VIEW_MODE_ICONS[mode],
            selected: mode === viewMode,
            onClick: () => vm.setViewMode(mode),
        })));
    }, [vm, viewMode]);

    // Category tree label with link count
    const getTreeItemLabel = useCallback(
        (item: CategoryTreeItem) => {
            if (!vm) return null;
            const name = splitWithSeparators(item.category, "/\\").pop() || "";
            const size = vm.getCategoryCount(item.category);
            return (
                <>
                    <span className="category-label-name">{name || "All"}</span>
                    {size !== undefined && (
                        <span className="category-label-size">{size}</span>
                    )}
                </>
            );
        },
        [vm, pageState.categoriesSize],
    );

    if (!vm) return null;

    if (pageState.error) {
        return (
            <LinkEditorRoot>
                <EditorError>{pageState.error}</EditorError>
            </LinkEditorRoot>
        );
    }

    // Portal refs: use props when provided, otherwise fall back to model refs
    const toolbarFirst = props.toolbarRefFirst !== undefined ? props.toolbarRefFirst : model.editorToolbarRefFirst;
    const toolbarLast = props.toolbarRefLast !== undefined ? props.toolbarRefLast : model.editorToolbarRefLast;
    const footerLast = props.footerRefLast !== undefined ? props.footerRefLast : model.editorFooterRefLast;

    return (
        <>
            {Boolean(toolbarFirst) &&
                createPortal(
                    pageState.expandedPanel === "tags" ? (
                        <Breadcrumb
                            rootLabel="Tags"
                            value={pageState.selectedTag}
                            onChange={vm.setSelectedTag}
                            separators=":"
                            trailingParentSeparator
                        />
                    ) : pageState.expandedPanel === "hostnames" ? (
                        <Breadcrumb
                            rootLabel="Hostnames"
                            value={pageState.selectedHostname}
                            onChange={vm.setSelectedHostname}
                        />
                    ) : (
                        <Breadcrumb
                            rootLabel="Categories"
                            value={pageState.selectedCategory}
                            onChange={vm.setSelectedCategory}
                        />
                    ),
                    toolbarFirst!,
                )}
            {Boolean(toolbarLast) &&
                createPortal(
                    <>
                        {!swapLayout && (
                            <Button
                                className="link-btn-browser-selector"
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
                            className="link-btn-add"
                            size="small"
                            type="raised"
                            title="Add Link"
                            onClick={() => vm.showLinkDialog()}
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
                            onChange={vm.setSearchText}
                            placeholder="Search..."
                            width={180}
                            endButtons={
                                pageState.searchText ? [
                                    <Button
                                        key="clear"
                                        size="small"
                                        type="icon"
                                        title="Clear search"
                                        onClick={vm.clearSearch}
                                    >
                                        <CloseIcon />
                                    </Button>,
                                ] : undefined
                            }
                        />
                    </>,
                    toolbarLast!,
                )}
            <LinkEditorRoot ref={(el) => { vm.containerElement = el; }} tabIndex={-1} className={clsx({ "swap-layout": swapLayout })}>
                <CollapsiblePanelStack
                    className="left-panel"
                    style={{ width: pageState.leftPanelWidth }}
                    activePanel={pageState.expandedPanel}
                    setActivePanel={vm.setExpandedPanel}
                >
                    <CollapsiblePanel id="tags" title="Tags">
                        <div className="tags-list-container">
                            <TagsList
                                tags={pageState.tags}
                                value={pageState.selectedTag}
                                onChange={vm.setSelectedTag}
                                getCount={vm.getTagCount}
                            />
                        </div>
                    </CollapsiblePanel>
                    <CollapsiblePanel id="hostnames" title="Hostnames">
                        <div className="tags-list-container">
                            <TagsList
                                tags={pageState.hostnames}
                                value={pageState.selectedHostname}
                                onChange={vm.setSelectedHostname}
                                getCount={vm.getHostnameCount}
                                separator={"\0"}
                                rootLabel="All"
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
                                onItemClick={vm.categoryItemClick}
                                getSelected={vm.getCategoryItemSelected}
                                getLabel={getTreeItemLabel}
                                refreshKey={pageState.selectedCategory}
                                dropTypes={[LINK_DRAG, LINK_CATEGORY_DRAG]}
                                onDrop={vm.categoryDrop}
                                dragType={LINK_CATEGORY_DRAG}
                                getDragItem={vm.getCategoryDragItem}
                            />
                        </div>
                    </CollapsiblePanel>
                </CollapsiblePanelStack>
                <Splitter
                    type="vertical"
                    initialWidth={pageState.leftPanelWidth}
                    onChangeWidth={vm.setLeftPanelWidth}
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
                                model={vm}
                                selectedLinkId={pageState.selectedLinkId}
                                pinnedLinkIds={pinnedLinkIds}
                            />
                        ) : (
                            <LinkItemTiles
                                links={links}
                                model={vm}
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
                            onChangeWidth={vm.setPinnedPanelWidth}
                            borderSized={swapLayout ? "right" : "left"}
                        />
                        <PinnedLinksPanel
                            pinnedLinks={pinnedLinks}
                            model={vm}
                            style={{ width: pinnedPanelWidth }}
                        />
                    </>
                )}
            </LinkEditorRoot>
            {Boolean(footerLast) &&
                createPortal(
                    <span>
                        {links.length === allLinks.length
                            ? `${allLinks.length} links`
                            : `${links.length} of ${allLinks.length} links`}
                    </span>,
                    footerLast!,
                )}
        </>
    );
}
