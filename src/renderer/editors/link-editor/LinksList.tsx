import styled from "@emotion/styled";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useDrag } from "react-dnd";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { RenderCellParams, RenderSizeOptional } from "../../components/virtualization/RenderGrid/types";
import { highlightText } from "../../components/basic/useHighlightedText";
import { Button } from "../../components/basic/Button";
import color from "../../theme/color";
import { DeleteIcon, OpenLinkIcon, RenameIcon } from "../../theme/icons";
import type { ILink } from "../../api/types/io.tree";
import { TreeProviderItemIcon } from "../../components/tree-provider/TreeProviderItemIcon";
import { LinkTooltip } from "./LinkTooltip";
import { useFavicons } from "../../components/tree-provider/favicon-cache";

const ROW_HEIGHT = 28;

const defaultGetId = (link: ILink) => link.id ?? link.href;

// =============================================================================
// Styles
// =============================================================================

const LinksListRoot = styled(RenderGrid)({
    flex: 1,
    "& .link-row-cell": {
        boxSizing: "border-box",
        padding: "0 4px",
        display: "flex",
        alignItems: "stretch",
    },
    "& .link-row": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        borderRadius: 6,
        fontSize: 13,
        cursor: "default",
        boxSizing: "border-box",
        flex: 1,
        minWidth: 0,
        position: "relative",
        "&:hover": {
            backgroundColor: color.background.dark,
        },
        "&.selected::after": {
            content: "''",
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            backgroundColor: color.background.selection,
            opacity: 0.3,
            pointerEvents: "none",
            borderRadius: "inherit",
        },
        "& .link-open-btn": {
            flexShrink: 0,
            position: "relative",
            "& .icon-open": {
                display: "none",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                "& .icon-open-bg": {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: color.background.default,
                    opacity: 0.7,
                    borderRadius: 4,
                },
                "& svg": {
                    position: "relative",
                    color: color.misc.blue,
                },
            },
        },
        "&:hover .link-open-btn .icon-open": {
            display: "flex",
        },
        "& .link-title": {
            flex: "1 1 auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.strong,
            minWidth: 0,
        },
        "& .link-title-folder": {
            flex: "1 1 auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.strong,
            fontWeight: 500,
            minWidth: 0,
        },
        "& .link-additional-icon": {
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            "& svg": { width: 16, height: 16 },
        },
        "& .link-actions": {
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
            opacity: 0,
            transition: "opacity 0.15s ease",
        },
        "&:hover .link-actions": {
            opacity: 1,
        },
    },
});

// =============================================================================
// Link Row
// =============================================================================

interface LinksListRowProps {
    link: ILink;
    isSelected: boolean;
    searchText: string;
    additionalIcon?: React.ReactNode;
    dragType?: string;
    getDragItem?: (link: ILink) => unknown;
    onSelect?: (link: ILink) => void;
    onOpen?: (link: ILink) => void;
    onEdit?: (link: ILink) => void;
    onDelete?: (link: ILink, skipConfirm: boolean) => void;
    onDoubleClick?: (link: ILink) => void;
    onContextMenu?: (e: React.MouseEvent, link: ILink) => void;
}

function LinksListRow({
    link, isSelected, searchText, additionalIcon,
    dragType, getDragItem, onSelect, onOpen, onEdit, onDelete, onDoubleClick, onContextMenu,
}: LinksListRowProps) {
    const tooltipId = useMemo(() => crypto.randomUUID(), []);

    const [{ isDragging }, drag] = useDrag({
        type: dragType || "NONE",
        item: getDragItem ? () => getDragItem(link) : { type: dragType || "NONE" },
        canDrag: !!dragType,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    const handleDoubleClick = onDoubleClick
        ? () => onDoubleClick(link)
        : onEdit ? () => onEdit(link) : undefined;

    return (
        <div
            ref={(node) => { drag(node); }}
            className={isSelected ? "link-row selected" : "link-row"}
            style={isDragging ? { opacity: 0.4 } : undefined}
            onClick={() => onSelect?.(link)}
            onDoubleClick={handleDoubleClick}
            onContextMenu={(e) => onContextMenu?.(e, link)}
        >
            <Button
                className="link-open-btn"
                size="small"
                type="flat"
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect?.(link);
                    onOpen?.(link);
                }}
            >
                <TreeProviderItemIcon item={link} />
                <span className="icon-open"><div className="icon-open-bg" /><OpenLinkIcon /></span>
            </Button>
            <span
                className={link.isDirectory ? "link-title-folder" : "link-title"}
                data-tooltip-id={tooltipId}
            >
                {searchText ? highlightText(searchText, link.title || "Untitled") : (link.title || "Untitled")}
            </span>
            {additionalIcon && (
                <span className="link-additional-icon">
                    {additionalIcon}
                </span>
            )}
            {(onEdit || onDelete) && (
                <span className="link-actions">
                    {onEdit && (
                        <Button
                            size="small"
                            type="flat"
                            title="Edit"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect?.(link);
                                onEdit(link);
                            }}
                        >
                            <RenameIcon />
                        </Button>
                    )}
                    {onDelete && (
                        <Button
                            size="small"
                            type="flat"
                            title="Delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect?.(link);
                                onDelete(link, e.ctrlKey);
                            }}
                        >
                            <DeleteIcon />
                        </Button>
                    )}
                </span>
            )}
            <LinkTooltip id={tooltipId} link={link} />
        </div>
    );
}

// =============================================================================
// Component
// =============================================================================

export interface LinksListProps {
    links: ILink[];
    selectedId?: string;
    /** Extract ID from a link for selection matching. Defaults to link.id ?? link.href. */
    getId?: (link: ILink) => string;
    searchText?: string;
    onSelect?: (link: ILink) => void;
    onOpen?: (link: ILink) => void;
    onEdit?: (link: ILink) => void;
    onDelete?: (link: ILink, skipConfirm: boolean) => void;
    /** Override double-click behavior. When not set, double-click calls onEdit. */
    onDoubleClick?: (link: ILink) => void;
    onContextMenu?: (e: React.MouseEvent, link: ILink) => void;
    /** Callback to get additional icon for a link row (e.g., pin indicator). */
    getAdditionalIcon?: (link: ILink) => React.ReactNode;
    /** Drag type for react-dnd. Rows are draggable only when set. */
    dragType?: string;
    /** Build drag item data for a link. Required when dragType is set. */
    getDragItem?: (link: ILink) => unknown;
    /** Called with the RenderGridModel on mount, null on unmount. */
    onGridModel?: (model: RenderGridModel | null) => void;
}

export function LinksList({
    links, selectedId, getId = defaultGetId, searchText = "",
    onSelect, onOpen, onEdit, onDelete, onDoubleClick, onContextMenu,
    getAdditionalIcon, dragType, getDragItem, onGridModel,
}: LinksListProps) {
    const gridRef = useRef<RenderGridModel>(null);
    const [gridWidth, setGridWidth] = useState<number | undefined>(undefined);
    const faviconVersion = useFavicons(links);

    // Expose grid model to parent
    const gridModelNotified = useRef(false);
    if (gridRef.current && !gridModelNotified.current) {
        gridModelNotified.current = true;
        onGridModel?.(gridRef.current);
    }

    const handleResize = useCallback((size: RenderSizeOptional) => {
        setGridWidth(size.width);
    }, []);

    const columnWidth = useCallback(() => gridWidth ?? 400, [gridWidth]);

    const renderCell = useCallback(
        (p: RenderCellParams) => {
            const link = links[p.row];
            if (!link) return null;
            return (
                <div key={p.key} style={p.style} className="link-row-cell">
                    <LinksListRow
                        link={link}
                        isSelected={getId(link) === selectedId}
                        searchText={searchText}
                        additionalIcon={getAdditionalIcon?.(link)}
                        dragType={dragType}
                        getDragItem={getDragItem}
                        onSelect={onSelect}
                        onOpen={onOpen}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onDoubleClick={onDoubleClick}
                        onContextMenu={onContextMenu}
                    />
                </div>
            );
        },
        [links, selectedId, getId, searchText, getAdditionalIcon, dragType, getDragItem,
         onSelect, onOpen, onEdit, onDelete, onDoubleClick, onContextMenu, faviconVersion],
    );

    return (
        <LinksListRoot
            ref={gridRef}
            rowCount={links.length}
            columnCount={1}
            rowHeight={ROW_HEIGHT}
            columnWidth={columnWidth}
            renderCell={renderCell}
            fitToWidth
            onResize={handleResize}
        />
    );
}
