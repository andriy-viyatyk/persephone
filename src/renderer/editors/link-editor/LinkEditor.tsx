import styled from "@emotion/styled";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Breadcrumb } from "../../components/basic/Breadcrumb";
import { Button } from "../../components/basic/Button";
import { TextField } from "../../components/basic/TextField";
import { HighlightedTextProvider } from "../../components/basic/useHighlightedText";
import { CollapsiblePanel, CollapsiblePanelStack } from "../../components/layout/CollapsiblePanelStack";
import { Splitter } from "../../components/layout/Splitter";
import { showAppPopupMenu } from "../../ui/dialogs";
import { pageNavigatorToggled, panelExpanded } from "../../core/state/events";
import color from "../../theme/color";
import {
    CloseIcon, PlusIcon,
    ViewLandscapeBigIcon, ViewLandscapeIcon, ViewListIcon, ViewPortraitBigIcon, ViewPortraitIcon,
} from "../../theme/icons";
import { defaultLinkEditorState, LinkViewModel, LinkEditorState } from "./LinkViewModel";
import { LinkEditorProps, LinkViewMode } from "./linkTypes";
import { LinkCategoryPanel } from "./panels/LinkCategoryPanel";
import { LinkTagsPanel } from "./panels/LinkTagsPanel";
import { LinkHostnamesPanel } from "./panels/LinkHostnamesPanel";
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
// Helpers
// =============================================================================

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultLinkEditorState;

function buildPanelList(hasTags: boolean, hasHostnames: boolean): string[] {
    const panels = ["link-category"];
    if (hasTags) panels.push("link-tags");
    if (hasHostnames) panels.push("link-hostnames");
    return panels;
}

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

    // ── PageNavigator state via global event ────────────────────────────

    const hasPage = !!model.page;
    const pageId = model.page?.id;

    const [isNavigatorOpen, setIsNavigatorOpen] = useState(() =>
        model.page?.pageNavigatorModel?.state.get().open ?? false
    );

    useEffect(() => {
        if (!pageId) return;
        const subs = [
            pageNavigatorToggled.subscribe((event) => {
                if (event?.pageId === pageId) {
                    setIsNavigatorOpen(event.isOpen);
                }
            }),
            panelExpanded.subscribe((event) => {
                if (!vm || event?.pageId !== pageId) return;
                // Map sidebar panel IDs to LinkViewModel's expandedPanel values
                const map: Record<string, string> = {
                    "link-category": "categories",
                    "link-tags": "tags",
                    "link-hostnames": "hostnames",
                };
                const expandedPanel = map[event.panelId];
                if (expandedPanel) {
                    vm.setExpandedPanel(expandedPanel);
                }
            }),
        ];
        return () => subs.forEach((s) => s.unsubscribe());
    }, [pageId, vm]);

    // ── Secondary editor registration ───────────────────────────────────

    const hasTags = pageState.tags.length > 0;
    const hasHostnames = pageState.hostnames.length > 0;
    const showPanelsInSidebar = hasPage && isNavigatorOpen;

    useEffect(() => {
        if (!vm) return;

        if (!showPanelsInSidebar) {
            if (model.secondaryEditor?.length) {
                model.secondaryEditor = undefined;
            }
            return;
        }

        const panels = buildPanelList(hasTags, hasHostnames);
        model.secondaryEditor = panels;

        // Expand the sidebar panel matching LinkViewModel's current expandedPanel
        const reverseMap: Record<string, string> = {
            "categories": "link-category",
            "tags": "link-tags",
            "hostnames": "link-hostnames",
        };
        const panelToExpand = reverseMap[pageState.expandedPanel] ?? "link-category";
        if (panels.includes(panelToExpand)) {
            model.page?.expandPanel(panelToExpand);
        }

        return () => {
            // Don't clear panels if this model was demoted to secondary-only
            // (still in secondaryEditors[] but no longer mainEditor)
            const page = model.page;
            if (page && page.mainEditor !== model && page.secondaryEditors.includes(model)) {
                return;
            }
            model.secondaryEditor = undefined;
        };
    }, [vm, showPanelsInSidebar, hasTags, hasHostnames]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Grid and view mode ──────────────────────────────────────────────

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
                {!showPanelsInSidebar && (
                    <>
                        <CollapsiblePanelStack
                            className="left-panel"
                            style={{ width: pageState.leftPanelWidth }}
                            activePanel={pageState.expandedPanel}
                            setActivePanel={vm.setExpandedPanel}
                        >
                            <CollapsiblePanel id="categories" title="Categories">
                                <LinkCategoryPanel vm={vm} useOpenRawLink={false} />
                            </CollapsiblePanel>
                            <CollapsiblePanel id="tags" title="Tags">
                                <LinkTagsPanel vm={vm} />
                            </CollapsiblePanel>
                            <CollapsiblePanel id="hostnames" title="Hostnames">
                                <LinkHostnamesPanel vm={vm} />
                            </CollapsiblePanel>
                        </CollapsiblePanelStack>
                        <Splitter
                            type="vertical"
                            initialWidth={pageState.leftPanelWidth}
                            onChangeWidth={vm.setLeftPanelWidth}
                            borderSized={swapLayout ? "left" : "right"}
                        />
                    </>
                )}
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
                            selectedLinkId={pageState.selectedLinkId}
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
