import styled from "@emotion/styled";
import { useCallback, useSyncExternalStore } from "react";
import { TreeProviderView } from "../../../components/tree-provider/TreeProviderView";
import { highlightText } from "../../../components/basic/useHighlightedText";
import { app } from "../../../api/app";
import { RawLinkEvent } from "../../../api/events/events";
import type { ILink } from "../../../api/types/io.tree";
import color from "../../../theme/color";
import type { LinkViewModel } from "../LinkViewModel";

// =============================================================================
// Styles
// =============================================================================

const LinkCategoryPanelRoot = styled.div({
    flex: 1,
    display: "flex",
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

    const handleItemClick = useCallback((item: ILink) => {
        if (useOpenRawLink) {
            const navUrl = vm.treeProvider.getNavigationUrl(item);
            app.events.openRawLink.sendAsync(
                new RawLinkEvent(navUrl, undefined, pageId ? { pageId } : undefined),
            );
        } else {
            vm.setSelectedCategory(item.href);
        }
    }, [vm, useOpenRawLink, pageId]);

    const getTreeItemLabel = useCallback(
        (item: ILink, searchText: string) => {
            const label = searchText ? highlightText(searchText, item.title) : (item.title || "All");
            return (
                <>
                    <span className="category-label-name">{label}</span>
                    {item.isDirectory && item.size !== undefined && (
                        <span className="category-label-size">{item.size}</span>
                    )}
                </>
            );
        },
        [],
    );

    return (
        <LinkCategoryPanelRoot>
            <TreeProviderView
                provider={vm.treeProvider}
                showLinks={!categoriesOnly}
                selectedHref={selectedCategory}
                onItemClick={handleItemClick}
                getLabel={getTreeItemLabel}
                rootLabel="All"
            />
        </LinkCategoryPanelRoot>
    );
}
