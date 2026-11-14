import type { TreeProps } from "./types";

/** Return only native DOM props after removing all Tree-owned props. */
export function getTreeViewRestProps<T>(props: TreeProps<T>): Record<string, unknown> {
    const {
        /* eslint-disable @typescript-eslint/no-unused-vars */
        name: _name, searchText: _searchText,
        keyboardNav: _keyboardNav, focusSelection: _focusSelection,
        multiSelect: _multiSelect, rowHeight: _rowHeight, indentSize: _indentSize,
        growToHeight: _growToHeight, whiteSpaceY: _whiteSpaceY, activeIndex: _activeIndex,
        getTooltip: _getTooltip, getName: _getName, loading: _loading, emptyMessage: _emptyMessage,
        getIconElement: _getIconElement, getHideChevron: _getHideChevron,
        getSecondaryLabel: _getSecondaryLabel,
        getTrailingVisibility: _getTrailingVisibility,
        renderTrailing: _renderTrailing, trailingElement: _trailingElement,
        onItemContextMenu: _onItemContextMenu,
        items: _items, value: _value, onChange: _onChange,
        onItemDoubleClick: _onItemDoubleClick, isSelected: _isSelected,
        onSelectionChange: _onSelectionChange, onActiveChange: _onActiveChange,
        onContextMenu: _onContextMenu, getContextMenu: _getContextMenu,
        getChildren: _getChildren, defaultExpandedValues: _defaultExpandedValues,
        defaultExpandAll: _defaultExpandAll, expanded: _expanded,
        onExpandedChange: _onExpandedChange, onExpandChange: _onExpandChange, id: _id,
        getHasChildren: _getHasChildren,
        canCollapse: _canCollapse, traitTypeId: _traitTypeId, getDragData: _getDragData,
        acceptsDrop: _acceptsDrop, canTraitDrop: _canTraitDrop, onTraitDrop: _onTraitDrop,
        expandOnDragHoverDelay: _expandOnDragHoverDelay, acceptsFileDrop: _acceptsFileDrop,
        onDragStartOverride: _onDragStartOverride,
        collapseDescendants: _collapseDescendants,
        /* eslint-enable @typescript-eslint/no-unused-vars */
        ...rest
    } = props;
    return rest as Record<string, unknown>;
}
