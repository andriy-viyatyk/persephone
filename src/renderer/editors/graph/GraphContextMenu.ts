import type { MenuItem } from "../../components/overlay/PopupMenu";

// =============================================================================
// Context menu action interface
// =============================================================================

export interface ContextMenuActions {
    addNode: (worldX: number, worldY: number) => void;
    addChild: (parentId: string) => void;
    deleteNode: (nodeId: string) => void;
    deleteLink: (sourceId: string, targetId: string) => void;
    setRootNode: (nodeId: string) => void;
    collapseNode: (nodeId: string) => void;
}

// =============================================================================
// Menu builders
// =============================================================================

/** Build context menu for right-click on a node. */
export function buildNodeContextMenu(
    nodeId: string,
    neighborIds: string[],
    getNodeLabel: (id: string) => string,
    isRoot: boolean,
    hasVisibilityFilter: boolean,
    actions: ContextMenuActions,
): MenuItem[] {
    const items: MenuItem[] = [
        { label: "Add Child", onClick: () => actions.addChild(nodeId) },
        { label: "Set as Root", onClick: () => actions.setRootNode(nodeId), disabled: isRoot },
        { label: "Collapse", onClick: () => actions.collapseNode(nodeId), disabled: !hasVisibilityFilter },
        { label: "Delete Node", onClick: () => actions.deleteNode(nodeId), startGroup: true },
    ];

    // Build "Delete Link" submenu for connected nodes
    if (neighborIds.length > 0) {
        items.push({
            label: "Delete Link",
            startGroup: true,
            items: neighborIds.map((nId) => ({
                label: getNodeLabel(nId),
                onClick: () => actions.deleteLink(nodeId, nId),
            })),
        });
    }

    return items;
}

/** Build context menu for right-click on empty area. */
export function buildEmptyAreaContextMenu(
    worldX: number,
    worldY: number,
    actions: ContextMenuActions,
): MenuItem[] {
    return [
        { label: "Add Node", onClick: () => actions.addNode(worldX, worldY) },
    ];
}
