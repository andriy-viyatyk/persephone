import { useCallback, useEffect, useRef } from "react";
import styled from "@emotion/styled";
import { useComponentModel } from "../../core/state/model";
import { TreeView } from "../TreeView/TreeView";
import { TreeViewRef } from "../TreeView";
import { TextField } from "../basic/TextField";
import { Button } from "../basic/Button";
import { CloseIcon } from "../../theme/icons";
import { highlightText } from "../basic/useHighlightedText";
import color from "../../theme/color";
import { TreeProviderItemIcon } from "./TreeProviderItemIcon";
import { LINK } from "../../editors/link-editor/linkTraits";
import { TraitTypeId, resolveTraits } from "../../core/traits";
import type { TraitDragPayload } from "../../core/traits";
import {
    TreeProviderViewModel,
    TreeProviderViewProps,
    TreeProviderViewSavedState,
    TreeProviderNode,
    defaultTreeProviderViewState,
} from "./TreeProviderViewModel";

export type { TreeProviderViewProps, TreeProviderViewSavedState };

const TreeProviderViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    outline: "none",

    "& .tpv-tree": {
        flex: "1 1 auto",
        overflow: "hidden",
        paddingLeft: 4,
    },

    "& .tpv-search": {
        padding: 4,
        borderTop: `1px solid ${color.border.light}`,
        flexShrink: 0,
        "& .text-field": {
            width: "100%",
        },
    },

    "& .tpv-error": {
        padding: 8,
        fontSize: 12,
        color: color.misc.red,
    },

    "& .tpv-empty": {
        padding: 8,
        fontSize: 12,
        color: color.text.light,
    },

    "& .tpv-item-label": {
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontSize: 14,
    },
});

export interface TreeProviderViewRef {
    refresh(): void;
    showSearch(): void;
    hideSearch(): void;
    collapseAll(): void;
    getState(): TreeProviderViewSavedState;
    getScrollTop(): number;
    setScrollTop(value: number): void;
    /** Expand ancestors, load children if needed, and scroll to show item. */
    revealItem(href: string): void;
}

export function TreeProviderView(
    props: TreeProviderViewProps & { ref?: React.Ref<TreeProviderViewRef> },
) {
    const { ref, ...viewProps } = props;
    const model = useComponentModel(
        viewProps,
        TreeProviderViewModel,
        defaultTreeProviderViewState,
    );
    const state = model.state.use();
    const treeViewRef = useRef<TreeViewRef>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        model.setTreeViewRef(treeViewRef.current);
    });

    // Expose ref methods
    useEffect(() => {
        if (!ref) return;
        const refValue: TreeProviderViewRef = {
            refresh: model.buildTree,
            showSearch: () => {
                model.showSearch();
                setTimeout(() => searchInputRef.current?.focus(), 0);
            },
            hideSearch: () => {
                model.hideSearch();
                rootRef.current?.focus();
            },
            collapseAll: () => {
                treeViewRef.current?.collapseAll();
                props.onStateChange?.({ expandedPaths: [] });
            },
            getState: model.getState,
            getScrollTop: () => treeViewRef.current?.getScrollTop() ?? 0,
            setScrollTop: (value: number) => treeViewRef.current?.setScrollTop(value),
            revealItem: model.revealItem,
        };
        if (typeof ref === "function") {
            ref(refValue);
        } else {
            (ref as React.MutableRefObject<TreeProviderViewRef | null>).current = refValue;
        }
        return () => {
            if (typeof ref === "function") {
                ref(null);
            } else {
                (ref as React.MutableRefObject<TreeProviderViewRef | null>).current = null;
            }
        };
    }, [ref, model]);

    const isDeepSearch = state.searchText.length >= 3;

    const getLabel = useCallback((node: TreeProviderNode) => {
        if (props.getLabel) {
            return props.getLabel(node.data, state.searchText);
        }
        return (
            <span className="tpv-item-label" title={node.data.href}>
                {state.searchText
                    ? highlightText(state.searchText, node.data.title)
                    : node.data.title
                }
            </span>
        );
    }, [state.searchText, props.getLabel]);

    const getIcon = useCallback((node: TreeProviderNode) => (
        <TreeProviderItemIcon item={node.data} />
    ), []);

    const getId = useCallback((node: TreeProviderNode) => node.data.href, []);

    const showLinks = props.showLinks !== false;
    const getHasChildren = useCallback(
        (node: TreeProviderNode) => {
            if (!node.data.isDirectory) return false;
            const { hasSubDirectories, hasItems } = node.data;
            // When flags are undefined (FileTreeProvider, ArchiveTreeProvider), assume expandable
            if (hasSubDirectories === undefined && hasItems === undefined) return true;
            // When flags are set, decide based on showLinks mode
            if (showLinks) return !!(hasSubDirectories || hasItems);
            return !!hasSubDirectories;
        },
        [showLinks],
    );

    const getSelected = useCallback((node: TreeProviderNode) => {
        if (!props.selectedHref) return false;
        return node.data.href.toLowerCase() === props.selectedHref.toLowerCase();
    }, [props.selectedHref]);

    // Drag-drop (only if writable)
    const writable = props.provider.writable;

    const getDragData = useCallback((node: TreeProviderNode) => {
        if (!writable) return null;
        // Don't drag root
        if (node.data.href === props.provider.rootPath) return null;
        return { items: [node.data], sourceId: props.provider.sourceUrl };
    }, [writable, props.provider.rootPath, props.provider.sourceUrl]);

    const canTraitDrop = useCallback((dropNode: TreeProviderNode, payload: TraitDragPayload) => {
        if (!writable) return false;
        const traits = resolveTraits(payload.typeId);
        const linkTrait = traits?.get(LINK);
        if (!linkTrait) return false;
        const items = linkTrait.getItems(payload.data);
        if (items.length === 1 && items[0].href === dropNode.data.href) return false;
        return true;
    }, [writable]);

    const onTraitDrop = useCallback((dropNode: TreeProviderNode, payload: TraitDragPayload) => {
        const traits = resolveTraits(payload.typeId);
        const linkTrait = traits?.get(LINK);
        if (!linkTrait) return;
        const items = linkTrait.getItems(payload.data);
        if (items.length) {
            model.moveItems(items, dropNode);
        }
    }, [model]);

    // Keyboard
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.ctrlKey && e.key === "f") {
            e.preventDefault();
            e.stopPropagation();
            model.showSearch();
            setTimeout(() => searchInputRef.current?.focus(), 0);
        }
        if (e.key === "Escape" && state.searchVisible) {
            e.preventDefault();
            e.stopPropagation();
            model.hideSearch();
            rootRef.current?.focus();
        }
    }, [state.searchVisible, model]);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            model.hideSearch();
            rootRef.current?.focus();
        }
    }, [model]);

    const handleSearchBlur = useCallback(() => {
        if (!state.searchText) {
            model.hideSearch();
        }
    }, [state.searchText, model]);

    const handleSearchClose = useCallback(() => {
        model.hideSearch();
        rootRef.current?.focus();
    }, [model]);

    // Error/empty states
    if (state.error) {
        return (
            <TreeProviderViewRoot>
                <div className="tpv-error">{state.error}</div>
            </TreeProviderViewRoot>
        );
    }

    if (!state.displayTree) {
        return (
            <TreeProviderViewRoot>
                <div className="tpv-empty">No content</div>
            </TreeProviderViewRoot>
        );
    }

    return (
        <TreeProviderViewRoot
            ref={rootRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onContextMenu={model.onBackgroundContextMenu}
        >
            <div className="tpv-tree">
                <TreeView<TreeProviderNode>
                    key={state.treeViewKey}
                    ref={treeViewRef}
                    root={state.displayTree}
                    getId={getId}
                    getLabel={getLabel}
                    getIcon={getIcon}
                    getHasChildren={getHasChildren}
                    getSelected={getSelected}
                    onItemClick={model.onItemClick}
                    onItemDoubleClick={model.onItemDoubleClick}
                    onItemContextMenu={model.onItemContextMenu}
                    onExpandChange={model.onExpandChange}
                    traitTypeId={writable ? TraitTypeId.ILink : undefined}
                    getDragData={writable ? getDragData : undefined}
                    acceptsDrop={writable}
                    canTraitDrop={writable ? canTraitDrop : undefined}
                    onTraitDrop={writable ? onTraitDrop : undefined}
                    rootCollapsible={false}
                    defaultExpandAll={isDeepSearch}
                    initialExpandMap={model.initialExpandMap}
                    refreshKey={`${props.selectedHref || ""}-${state.searchText}`}
                />
            </div>
            {state.searchVisible && (
                <div className="tpv-search">
                    <TextField
                        ref={searchInputRef}
                        value={state.searchText}
                        onChange={model.setSearchText}
                        placeholder="Search..."
                        onKeyDown={handleSearchKeyDown}
                        onBlur={handleSearchBlur}
                        endButtons={[
                            <Button
                                size="small"
                                type="icon"
                                key="close-search"
                                title="Close Search"
                                onClick={handleSearchClose}
                                invisible={!state.searchText}
                            >
                                <CloseIcon />
                            </Button>,
                        ]}
                    />
                </div>
            )}
        </TreeProviderViewRoot>
    );
}
