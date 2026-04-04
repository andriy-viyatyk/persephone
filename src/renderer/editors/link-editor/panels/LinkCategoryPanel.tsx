import styled from "@emotion/styled";
import { useCallback, useSyncExternalStore } from "react";
import { CategoryTree, CategoryTreeItem } from "../../../components/TreeView";
import { splitWithSeparators } from "../../../core/utils/utils";
import { app } from "../../../api/app";
import { RawLinkEvent } from "../../../api/events/events";
import color from "../../../theme/color";
import type { LinkViewModel } from "../LinkViewModel";
import { LINK_DRAG, LINK_CATEGORY_DRAG } from "../linkTypes";

// =============================================================================
// Styles
// =============================================================================

const LinkCategoryPanelRoot = styled.div({
    flex: 1,
    display: "flex",
    overflow: "hidden",
    fontSize: 13,
    paddingLeft: 4,
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
});

// =============================================================================
// Component
// =============================================================================

interface LinkCategoryPanelProps {
    vm: LinkViewModel;
    /** When true, category clicks go through openRawLink pipeline (Context B).
     *  When false, category clicks filter content directly (Context A). */
    useOpenRawLink: boolean;
}

export function LinkCategoryPanel({ vm, useOpenRawLink }: LinkCategoryPanelProps) {
    const pageState = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get(),
    );

    const handleItemClick = useCallback((item: CategoryTreeItem) => {
        if (useOpenRawLink) {
            const navUrl = vm.treeProvider.getNavigationUrl({
                title: item.category.split("/").pop() || "",
                href: item.category,
                category: "",
                tags: [],
                isDirectory: true,
            });
            app.events.openRawLink.sendAsync(new RawLinkEvent(navUrl));
        } else {
            vm.categoryItemClick(item);
        }
    }, [vm, useOpenRawLink]);

    const getTreeItemLabel = useCallback(
        (item: CategoryTreeItem) => {
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
        [vm, pageState.categoriesSize], // eslint-disable-line react-hooks/exhaustive-deps
    );

    return (
        <LinkCategoryPanelRoot>
            <CategoryTree
                categories={pageState.categories}
                separators="/\"
                rootLabel="All"
                rootCollapsible={false}
                onItemClick={handleItemClick}
                getSelected={vm.getCategoryItemSelected}
                getLabel={getTreeItemLabel}
                refreshKey={pageState.selectedCategory}
                dropTypes={[LINK_DRAG, LINK_CATEGORY_DRAG]}
                onDrop={vm.categoryDrop}
                dragType={LINK_CATEGORY_DRAG}
                getDragItem={vm.getCategoryDragItem}
            />
        </LinkCategoryPanelRoot>
    );
}
