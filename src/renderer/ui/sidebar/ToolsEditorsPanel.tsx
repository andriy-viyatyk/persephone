import { useCallback, useMemo, useRef } from "react";
import styled from "@emotion/styled";
import { useDrag, useDrop } from "react-dnd";
import color from "../../theme/color";
import { settings } from "../../api/settings";
import { CreatableItem, DEFAULT_PINNED_EDITORS, getCreatableItems } from "./tools-editors-registry";
import { PinIcon, PinFilledIcon } from "../../theme/icons";

// =============================================================================
// Constants
// =============================================================================

const PINNED_DRAG_TYPE = "PINNED_EDITOR_DRAG";

// =============================================================================
// Styles
// =============================================================================

const PanelRoot = styled.div({
    flex: "1 1 auto",
    overflow: "auto",
    padding: "8px 0",

    "& .section-header": {
        fontSize: 11,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase" as const,
        letterSpacing: "0.5px",
        padding: "8px 12px 4px",
    },

    "& .item-row": {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        cursor: "pointer",
        fontSize: 13,
        color: color.text.default,
        "&:hover": {
            background: color.background.light,
        },
    },

    "& .item-row.dragging": {
        opacity: 0.4,
    },

    "& .item-row.drag-over": {
        borderTop: `2px solid ${color.border.active}`,
    },

    "& .item-icon": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        flexShrink: 0,
        "& svg": {
            width: 16,
            height: 16,
        },
    },

    "& .item-label": {
        flex: "1 1 auto",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    "& .pin-button": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        flexShrink: 0,
        cursor: "pointer",
        borderRadius: 3,
        opacity: 0,
        color: color.text.light,
        "&:hover": {
            background: color.background.selection,
            color: color.text.default,
        },
        "& svg": {
            width: 14,
            height: 14,
        },
    },

    "& .item-row:hover .pin-button": {
        opacity: 1,
    },

    "& .drag-handle": {
        display: "flex",
        alignItems: "center",
        cursor: "grab",
        color: color.text.light,
        flexShrink: 0,
        fontSize: 11,
        opacity: 0,
        userSelect: "none",
    },

    "& .item-row:hover .drag-handle": {
        opacity: 0.6,
    },

    "& .separator": {
        height: 1,
        background: color.border.light,
        margin: "6px 12px",
    },
});

// =============================================================================
// Pinned Item (draggable)
// =============================================================================

function PinnedItem({ item, index, onUnpin, onClick, onMove }: {
    item: CreatableItem;
    index: number;
    onUnpin: (id: string) => void;
    onClick: (item: CreatableItem) => void;
    onMove: (dragIndex: number, hoverIndex: number) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);

    const [{ isDragging }, drag] = useDrag({
        type: PINNED_DRAG_TYPE,
        item: { index },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    const [{ isOver }, drop] = useDrop({
        accept: PINNED_DRAG_TYPE,
        hover({ index: dragIndex }: { index: number }) {
            if (dragIndex !== index) {
                onMove(dragIndex, index);
            }
        },
        collect: (monitor) => ({
            isOver: monitor.isOver(),
        }),
    });

    drag(drop(ref));

    const handleUnpin = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onUnpin(item.id);
    }, [onUnpin, item.id]);

    return (
        <div
            ref={ref}
            className={`item-row${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
            onClick={() => onClick(item)}
        >
            <span className="drag-handle">⋮⋮</span>
            <span className="item-icon">{item.icon}</span>
            <span className="item-label">{item.label}</span>
            <span className="pin-button" onClick={handleUnpin} title="Unpin">
                <PinFilledIcon />
            </span>
        </div>
    );
}

// =============================================================================
// Unpinned Item
// =============================================================================

function UnpinnedItem({ item, onPin, onClick }: {
    item: CreatableItem;
    onPin: (id: string) => void;
    onClick: (item: CreatableItem) => void;
}) {
    const handlePin = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onPin(item.id);
    }, [onPin, item.id]);

    return (
        <div className="item-row" onClick={() => onClick(item)}>
            <span className="item-icon">{item.icon}</span>
            <span className="item-label">{item.label}</span>
            <span className="pin-button" onClick={handlePin} title="Pin to menu">
                <PinIcon />
            </span>
        </div>
    );
}

// =============================================================================
// Panel
// =============================================================================

interface ToolsEditorsPanelProps {
    onClose?: () => void;
}

export function ToolsEditorsPanel({ onClose }: ToolsEditorsPanelProps) {
    const browserProfiles = settings.use("browser-profiles");
    const pinnedIds: string[] = settings.use("pinned-editors") ?? DEFAULT_PINNED_EDITORS;

    const allItems = useMemo(
        () => getCreatableItems(browserProfiles),
        [browserProfiles],
    );

    // Drag reorder tracking — use a ref to avoid re-render loops during drag
    const dragOrderRef = useRef<string[] | null>(null);

    const pinnedItems = useMemo(() => {
        const ids = dragOrderRef.current ?? pinnedIds;
        return ids
            .map((id) => allItems.find((item) => item.id === id))
            .filter(Boolean) as CreatableItem[];
    }, [pinnedIds, allItems]);

    const unpinnedItems = useMemo(() => {
        const pinSet = new Set(pinnedIds);
        return allItems
            .filter((item) => !pinSet.has(item.id))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [pinnedIds, allItems]);

    const handleClick = useCallback((item: CreatableItem) => {
        item.create();
        onClose?.();
    }, [onClose]);

    const handlePin = useCallback((id: string) => {
        const current: string[] = settings.get("pinned-editors") ?? DEFAULT_PINNED_EDITORS;
        if (!current.includes(id)) {
            settings.set("pinned-editors", [...current, id]);
        }
        dragOrderRef.current = null;
    }, []);

    const handleUnpin = useCallback((id: string) => {
        const current: string[] = settings.get("pinned-editors") ?? DEFAULT_PINNED_EDITORS;
        settings.set("pinned-editors", current.filter((i) => i !== id));
        dragOrderRef.current = null;
    }, []);

    const handleMove = useCallback((dragIndex: number, hoverIndex: number) => {
        const current: string[] = dragOrderRef.current
            ?? [...(settings.get("pinned-editors") ?? DEFAULT_PINNED_EDITORS)];
        const [removed] = current.splice(dragIndex, 1);
        current.splice(hoverIndex, 0, removed);
        dragOrderRef.current = current;
        settings.set("pinned-editors", [...current]);
    }, []);

    return (
        <PanelRoot>
            {pinnedItems.length > 0 && (
                <>
                    <div className="section-header">Pinned</div>
                    {pinnedItems.map((item, index) => (
                        <PinnedItem
                            key={item.id}
                            item={item}
                            index={index}
                            onUnpin={handleUnpin}
                            onClick={handleClick}
                            onMove={handleMove}
                        />
                    ))}
                </>
            )}
            {unpinnedItems.length > 0 && (
                <>
                    {pinnedItems.length > 0 && <div className="separator" />}
                    <div className="section-header">All Editors & Tools</div>
                    {unpinnedItems.map((item) => (
                        <UnpinnedItem
                            key={item.id}
                            item={item}
                            onPin={handlePin}
                            onClick={handleClick}
                        />
                    ))}
                </>
            )}
        </PanelRoot>
    );
}
