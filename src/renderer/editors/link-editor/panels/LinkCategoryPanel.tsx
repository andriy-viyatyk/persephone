import styled from "@emotion/styled";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { TreeProviderView } from "../../../components/tree-provider/TreeProviderView";
import { highlightText } from "../../../components/basic/useHighlightedText";
import { app } from "../../../api/app";
import type { ContextMenuEvent } from "../../../api/events/events";
import { createLinkData } from "../../../../shared/link-data";
import type { ILink } from "../../../api/types/io.tree";
import color from "../../../theme/color";
import type { LinkViewModel } from "../LinkViewModel";
import { Tooltip } from "../../../components/basic/Tooltip";
import { CopyIcon } from "../../../theme/icons";

// =============================================================================
// Styles
// =============================================================================

const LinkCategoryPanelRoot = styled.div({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontSize: 13,
    "& .category-label-name": {
        flex: "1 1 auto",
    },
    "& .category-label-size": {
        margin: "0 4px",
        fontSize: 12,
    },
    "& .tpv-item-label": {
        display: "flex",
        alignItems: "center",
    },
    "& .tree-cell": {
        color: color.text.light,
        "&.selected": {
            color: color.misc.blue,
        },
    },
});

// =============================================================================
// Component
// =============================================================================

interface LinkCategoryPanelProps {
    vm: LinkViewModel;
    /** When true, category clicks go through openRawLink pipeline (Context B).
     *  When false, category clicks filter content directly (Context A). */
    useOpenRawLink: boolean;
    /** When true, shows only category folders. When false, shows categories + links. Default: true. */
    categoriesOnly?: boolean;
    /** Page ID to include in openRawLink metadata (navigates within this page). */
    pageId?: string;
}

export function LinkCategoryPanel({ vm, useOpenRawLink, categoriesOnly = true, pageId }: LinkCategoryPanelProps) {
    const selectedCategory = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().selectedCategory,
    );
    // Derive selected item href from LinkViewModel's selectedLinkId (single source of truth)
    const selectedLinkId = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().selectedLinkId,
    );
    const selectedItemHref = useMemo(() => {
        if (!selectedLinkId) return undefined;
        const link = vm.state.get().data.links.find((l) => l.id === selectedLinkId);
        return link?.href;
    }, [selectedLinkId, vm]);
    const tooltipId = useMemo(() => "lcp-" + crypto.randomUUID(), []);

    const handleItemClick = useCallback((item: ILink) => {
        if (useOpenRawLink) {
            if (item.id) vm.selectLink(item.id);
            const navUrl = vm.treeProvider.getNavigationUrl(item);
            app.events.openRawLink.sendAsync(
                createLinkData(navUrl, {
                    target: item.target || undefined,
                    sourceId: "link-category",
                    category: item.category,
                    ...(pageId ? { pageId, fallbackTarget: "monaco", title: item.title } : undefined),
                }),
            );
        } else {
            vm.setSelectedCategory(item.href);
        }
    }, [vm, useOpenRawLink, pageId]);

    const handleContextMenu = useCallback((event: ContextMenuEvent<ILink>) => {
        const item = event.target;
        if (!item || item.isDirectory) return;
        // Add "Edit Link" at the beginning of the menu
        event.items.unshift({
            label: "Edit Link",
            onClick: () => vm.showLinkDialog(item.id),
        });
    }, [vm]);

    const getTreeItemLabel = useCallback(
        (item: ILink, searchText: string) => {
            const label = searchText ? highlightText(searchText, item.title) : (item.title || "All");
            if (item.isDirectory) {
                return (
                    <>
                        <span className="category-label-name">{label}</span>
                        {item.size !== undefined && (
                            <span className="category-label-size">{item.size}</span>
                        )}
                    </>
                );
            }
            return (
                <span
                    className="category-label-name"
                    data-tooltip-id={tooltipId}
                    data-tooltip-href={item.href}
                    data-tooltip-title={item.title}
                    data-tooltip-img={item.imgSrc || ""}
                    data-tooltip-link={JSON.stringify(item, null, 4)}
                >
                    {label}
                </span>
            );
        },
        [tooltipId],
    );

    return (
        <LinkCategoryPanelRoot>
            <TreeProviderView
                provider={vm.treeProvider}
                showLinks={!categoriesOnly}
                selectedHref={categoriesOnly ? selectedCategory : selectedItemHref}
                onItemClick={handleItemClick}
                onContextMenu={!categoriesOnly ? handleContextMenu : undefined}
                getLabel={getTreeItemLabel}
                rootLabel="All"
            />
            {!categoriesOnly && (
                <Tooltip id={tooltipId} place="bottom" delayShow={800}
                    render={({ activeAnchor }) => {
                        const title = activeAnchor?.getAttribute("data-tooltip-title");
                        const href = activeAnchor?.getAttribute("data-tooltip-href");
                        const img = activeAnchor?.getAttribute("data-tooltip-img");
                        const linkJson = activeAnchor?.getAttribute("data-tooltip-link");
                        if (!title && !href) return null;
                        return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 360, padding: 4 }}>
                                <div style={{ display: "flex", alignItems: "start", gap: 4 }}>
                                    <span style={{ flex: 1, fontWeight: 600, color: color.text.strong, whiteSpace: "normal", wordBreak: "break-word" }}>{title || "Untitled"}</span>
                                    {linkJson && (
                                        <span
                                            style={{ cursor: "pointer", color: color.text.light, flexShrink: 0, marginTop: 1 }}
                                            title="Copy link as JSON"
                                            onClick={() => navigator.clipboard.writeText(linkJson)}
                                        >
                                            <CopyIcon width={14} height={14} />
                                        </span>
                                    )}
                                </div>
                                {href && <span style={{ fontSize: 12, color: color.text.light, whiteSpace: "normal", wordBreak: "break-all", maxHeight: 100, overflow: "auto" }}>{href.length > 200 ? href.slice(0, 200) + "…" : href}</span>}
                                {img && <img style={{ marginTop: 4, maxWidth: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 4, border: `1px solid ${color.border.default}` }} src={img} alt="" />}
                            </div>
                        );
                    }}
                />
            )}
        </LinkCategoryPanelRoot>
    );
}
