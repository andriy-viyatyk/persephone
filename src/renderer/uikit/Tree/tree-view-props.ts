import { splitProps, type CompleteKeys } from "../shared/dom-props";
import type { TreeProps, TreeOwnProps } from "./types";

const TREE_OWN_KEYS = ["name", "items", "getChildren", "value", "onChange", "onItemDoubleClick", "isSelected", "multiSelect", "onSelectionChange", "activeIndex", "onActiveChange", "searchText", "getTooltip", "getName", "getSecondaryLabel", "getIconElement", "getHideChevron", "getTrailingVisibility", "renderTrailing", "trailingElement", "repaintSignal", "onItemContextMenu", "getContextMenu", "onContextMenu", "defaultExpandedValues", "defaultExpandAll", "expanded", "onExpandedChange", "onExpandChange", "rowHeight", "growToHeight", "whiteSpaceY", "indentSize", "loading", "emptyMessage", "keyboardNav", "focusSelection", "canCollapse", "collapseDescendants", "getHasChildren", "traitTypeId", "getDragData", "acceptsDrop", "acceptsFileDrop", "canTraitDrop", "onTraitDrop", "expandOnDragHoverDelay", "onDragStartOverride"] as const satisfies readonly (keyof TreeOwnProps)[];
const checkedOwnKeys: CompleteKeys<TreeOwnProps, typeof TREE_OWN_KEYS> = TREE_OWN_KEYS;
const TREE_LEGACY_KEYS = ["id"] as const satisfies readonly (keyof TreeProps)[];



/** Return only native DOM props after removing all Tree-owned props. */
export function getTreeViewRestProps<T>(props: TreeProps<T>): Record<string, unknown> {
    const rest = splitProps(props, [...checkedOwnKeys, ...TREE_LEGACY_KEYS] as const);
    return rest as Record<string, unknown>;
}
