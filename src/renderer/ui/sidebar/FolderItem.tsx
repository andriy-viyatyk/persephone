import styled from "@emotion/styled";
import clsx from "clsx";
import { useCallback, useMemo, useRef, useState } from "react";
import { TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData } from "../../core/traits";
import color from "../../theme/color";
import { OverflowTooltipText } from "../../components/basic/OverflowTooltipText";
import { Tooltip } from "../../components/basic/Tooltip";

import { menuFolders } from "../../api/menu-folders";
import type { MenuFolder } from "../../api/menu-folders";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { ContextMenuEvent } from "../../api/events/events";

const FolderItemRoot = styled.div({
    paddingLeft: 4,
    cursor: "pointer",
    color: color.text.default,
    flexDirection: "row",
    columnGap: 6,
    display: "inline-flex",
    alignItems: "center",
    overflow: "hidden",
    "&.dragging": {
        opacity: 0.5,
    },
    "&.drag-over": {
        borderTop: `2px solid ${color.border.active}`,
    },
    "& .item-text": {
        flex: "1 1",
        whiteSpace: "nowrap",
    },
});

export interface FolderItemProps {
    folder: MenuFolder;
    index: number;
    style: React.CSSProperties;
    selected: boolean;
    onClick: (folder: MenuFolder, index?: number, e?: React.MouseEvent) => void;
    onDoubleClick?: (folder: MenuFolder) => void;
    icon: React.ReactNode;
    label: React.ReactNode;
    selectedIcon?: React.ReactNode;
    onSelectedIconClick?: (folder: MenuFolder, e: React.MouseEvent) => void;
    itemMarginY?: number;
    getTooltip?: (folder: MenuFolder, index?: number) => string | undefined;
    getContextMenu?: (folder: MenuFolder, index?: number) => MenuItem[] | undefined;
    canDrag?: boolean;
    canDrop?: boolean;
}

export function FolderItem(props: FolderItemProps) {
    const {
        folder,
        index,
        style,
        selected,
        onClick,
        onDoubleClick,
        icon,
        label,
        selectedIcon,
        onSelectedIconClick,
        itemMarginY,
        getTooltip,
        getContextMenu,
        canDrag = true,
        canDrop = true,
    } = props;

    const id = useMemo(() => crypto.randomUUID(), []);
    const ref = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);
    const dragEnterCount = useRef(0);

    const handleFolderDragStart = useCallback((e: React.DragEvent) => {
        if (!canDrag) { e.preventDefault(); return; }
        e.stopPropagation();
        setTraitDragData(e.dataTransfer, TraitTypeId.MenuFolder, { id: folder.id });
        setIsDragging(true);
    }, [canDrag, folder.id]);

    const handleFolderDragEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleFolderDragEnter = useCallback((e: React.DragEvent) => {
        dragEnterCount.current++;
        if (canDrop && hasTraitDragData(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsOver(true);
        }
    }, [canDrop]);

    const handleFolderDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragEnterCount.current = 0;
        setIsOver(false);
        if (!canDrop) return;
        const payload = getTraitDragData(e.dataTransfer);
        if (payload?.typeId === TraitTypeId.MenuFolder) {
            const data = payload.data as { id: string };
            if (data.id !== folder.id && folder.id) {
                menuFolders.move(data.id, folder.id);
            }
        }
    }, [canDrop, folder.id]);

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            onClick(folder, index, e);
        },
        [onClick, folder, index]
    );

    const handleDoubleClick = useCallback(
        () => {
            onDoubleClick?.(folder);
        },
        [onDoubleClick, folder]
    );

    const handleSelectedIconClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onSelectedIconClick?.(folder, e);
        },
        [onSelectedIconClick, folder]
    );

    const handleContextMenu = useCallback(
        (e: React.MouseEvent) => {
            onClick?.(folder, index, e);
            const menuItems = getContextMenu?.(folder, index);
            if (menuItems) {
                const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "sidebar-folder");
                ctxEvent.items.push(...menuItems);
            }
        },
        [getContextMenu, folder, index, onClick]
    );

    const handleDragOver = useCallback(
        (e: React.DragEvent) => {
            if (!canDrop) {
                e.dataTransfer.dropEffect = "none";
                return;
            }
            if (hasTraitDragData(e.dataTransfer)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
            }
        },
        [canDrop]
    );

    const handleDragLeave = useCallback(() => {
        dragEnterCount.current--;
        if (dragEnterCount.current <= 0) {
            dragEnterCount.current = 0;
            setIsOver(false);
        }
    }, []);

    const tooltip = useMemo(
        () => getTooltip?.(folder, index),
        [getTooltip, folder, index]
    );

    const { top, height, ...restStyle } = style;
    const adjustedTop = itemMarginY
        ? (top as number) + itemMarginY
        : (top as number);
    const adjustedHeight = itemMarginY
        ? (height as number) - itemMarginY * 2
        : (height as number);

    return (
        <FolderItemRoot
            ref={ref}
            style={{ ...restStyle, top: adjustedTop, height: adjustedHeight }}
            draggable={canDrag}
            onDragStart={handleFolderDragStart}
            onDragEnd={handleFolderDragEnd}
            onDragEnter={handleFolderDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleFolderDrop}
            className={clsx("list-item", {
                selected,
                dragging: isDragging,
                "drag-over": isOver,
            })}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            data-tooltip-id={id}
        >
            {Boolean(icon) && icon}
            <OverflowTooltipText className="item-text">{label}</OverflowTooltipText>
            {selected && selectedIcon && (
                onSelectedIconClick ? (
                    <span
                        className="selected-icon-button"
                        onClick={handleSelectedIconClick}
                        title="Open folder in new tab"
                    >
                        {selectedIcon}
                    </span>
                ) : selectedIcon
            )}
            {Boolean(tooltip) && (
                <Tooltip id={id} delayShow={1500}>
                    {tooltip}
                </Tooltip>
            )}
        </FolderItemRoot>
    );
}
