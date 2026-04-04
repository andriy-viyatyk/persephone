import styled from "@emotion/styled";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag } from "react-dnd";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { RenderCellParams, RenderSizeOptional } from "../../components/virtualization/RenderGrid/types";
import color from "../../theme/color";
import { DeleteIcon, GlobeIcon, OpenLinkIcon, RenameIcon } from "../../theme/icons";
import type { ILink } from "../../api/types/io.tree";
import { LinkViewMode } from "./linkTypes";
import { getHostname, getFaviconPathSync, useFavicons } from "../../components/tree-provider/favicon-cache";

// =============================================================================
// Tile dimensions per view mode
// =============================================================================

interface TileDimensions {
    cellWidth: number;
    cellHeight: number;
    imageHeight: number;
}

const TILE_DIMENSIONS: Record<Exclude<LinkViewMode, "list">, TileDimensions> = {
    "tiles-landscape":     { cellWidth: 252, cellHeight: 192, imageHeight: 144 },
    "tiles-landscape-big": { cellWidth: 372, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait":      { cellWidth: 168, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait-big":  { cellWidth: 252, cellHeight: 408, imageHeight: 336 },
};

const defaultGetId = (link: ILink) => link.id ?? link.href;

// =============================================================================
// Styles
// =============================================================================

const LinksTilesRoot = styled(RenderGrid)({
    flex: 1,
    "& .tile-cell": {
        boxSizing: "border-box",
        padding: 4,
    },
    "& .tile-inner": {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 8,
        overflow: "hidden",
        cursor: "default",
        position: "relative",
        border: `1px solid ${color.border.default}`,
        "&.selected": {
            borderColor: color.border.active,
            "&::before": {
                content: "''",
                position: "absolute",
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                backgroundColor: color.background.selection,
                opacity: 0.3,
                pointerEvents: "none",
            },
        },
        "&:hover": {
            "& .tile-actions": {
                opacity: 1,
            },
        },
    },
    "& .tile-image": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        "& img": {
            maxWidth: "calc(100% - 8px)",
            maxHeight: "calc(100% - 8px)",
            objectFit: "contain",
            margin: 4,
        },
    },
    "& .tile-no-image": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color.text.light,
        fontSize: 12,
        "& svg": {
            width: 32,
            height: 32,
            opacity: 0.3,
        },
    },
    "& .tile-title": {
        flex: 1,
        display: "flex",
        alignItems: "center",
        padding: "4px 4px 4px 8px",
        fontSize: 12,
        color: color.text.default,
        overflow: "hidden",
        "& span": {
            flex: 1,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            textOverflow: "ellipsis",
            minWidth: 0,
            wordBreak: "break-word",
        },
        "& .tile-open-link": {
            flex: "0 0 auto",
            width: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 2,
            cursor: "pointer",
            color: color.icon.default,
            opacity: 0.5,
            borderRadius: 4,
            "&:hover": {
                opacity: 1,
                color: color.misc.blue,
            },
            "& svg": {
                width: 24,
                height: 24,
            },
        },
    },
    "& .tile-additional-icon": {
        position: "absolute",
        top: 4,
        left: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
        backgroundColor: color.background.overlay,
        border: `1px solid ${color.border.default}`,
        borderRadius: 6,
        opacity: 0.8,
        "& svg": { width: 14, height: 14 },
    },
    "& .tile-actions": {
        position: "absolute",
        top: 4,
        right: 4,
        display: "flex",
        gap: 2,
        opacity: 0,
        transition: "opacity 0.15s ease",
        "& button": {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 3,
            backgroundColor: color.background.overlay,
            border: `1px solid ${color.border.default}`,
            borderRadius: 6,
            cursor: "pointer",
            color: color.icon.default,
            opacity: 0.7,
            "&:hover": {
                opacity: 1,
            },
        },
    },
});

// =============================================================================
// Tile Cell
// =============================================================================

interface LinksTileCellProps {
    link: ILink;
    isSelected: boolean;
    imageHeight: number;
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

function LinksTileCell({
    link, isSelected, imageHeight, additionalIcon,
    dragType, getDragItem, onSelect, onOpen, onEdit, onDelete, onDoubleClick, onContextMenu,
}: LinksTileCellProps) {
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
            className={isSelected ? "tile-inner selected" : "tile-inner"}
            style={isDragging ? { opacity: 0.4 } : undefined}
            title={link.href || link.title}
            onClick={() => onSelect?.(link)}
            onDoubleClick={handleDoubleClick}
            onContextMenu={(e) => onContextMenu?.(e, link)}
        >
            <div
                className={link.imgSrc ? "tile-image" : "tile-image tile-no-image"}
                style={{ height: imageHeight }}
            >
                {link.imgSrc ? (
                    <img src={link.imgSrc} alt={link.title} loading="lazy" />
                ) : (() => {
                    const fp = getFaviconPathSync(getHostname(link.href));
                    return fp
                        ? <img src={`file://${fp}`} alt="" />
                        : <GlobeIcon />;
                })()}
            </div>
            <div className="tile-title">
                <span>{link.title || "Untitled"}</span>
                {link.href && (
                    <span
                        className="tile-open-link"
                        title="Open link"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect?.(link);
                            onOpen?.(link);
                        }}
                    >
                        <OpenLinkIcon />
                    </span>
                )}
            </div>
            {additionalIcon && (
                <span className="tile-additional-icon">
                    {additionalIcon}
                </span>
            )}
            {(onEdit || onDelete) && (
                <div className="tile-actions">
                    {onEdit && (
                        <button
                            title="Edit"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect?.(link);
                                onEdit(link);
                            }}
                        >
                            <RenameIcon />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            title="Delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect?.(link);
                                onDelete(link, e.ctrlKey);
                            }}
                        >
                            <DeleteIcon />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// Component
// =============================================================================

export interface LinksTilesProps {
    links: ILink[];
    viewMode: Exclude<LinkViewMode, "list">;
    selectedId?: string;
    /** Extract ID from a link for selection matching. Defaults to link.id ?? link.href. */
    getId?: (link: ILink) => string;
    onSelect?: (link: ILink) => void;
    onOpen?: (link: ILink) => void;
    onEdit?: (link: ILink) => void;
    onDelete?: (link: ILink, skipConfirm: boolean) => void;
    /** Override double-click behavior. When not set, double-click calls onEdit. */
    onDoubleClick?: (link: ILink) => void;
    onContextMenu?: (e: React.MouseEvent, link: ILink) => void;
    /** Callback to get additional icon for a tile (e.g., pin indicator). */
    getAdditionalIcon?: (link: ILink) => React.ReactNode;
    /** Drag type for react-dnd. Tiles are draggable only when set. */
    dragType?: string;
    /** Build drag item data for a link. Required when dragType is set. */
    getDragItem?: (link: ILink) => unknown;
    /** Called with the RenderGridModel on mount, null on unmount. */
    onGridModel?: (model: RenderGridModel | null) => void;
}

export function LinksTiles({
    links, viewMode, selectedId, getId = defaultGetId,
    onSelect, onOpen, onEdit, onDelete, onDoubleClick, onContextMenu,
    getAdditionalIcon, dragType, getDragItem, onGridModel,
}: LinksTilesProps) {
    const gridRef = useRef<RenderGridModel>(null);
    const [gridSize, setGridSize] = useState<RenderSizeOptional>({
        width: undefined,
        height: undefined,
    });
    const faviconVersion = useFavicons(links);

    const dims = TILE_DIMENSIONS[viewMode];

    // Expose grid model to parent
    const gridModelNotified = useRef(false);
    if (gridRef.current && !gridModelNotified.current) {
        gridModelNotified.current = true;
        onGridModel?.(gridRef.current);
    }

    useEffect(() => {
        gridRef.current?.scrollToRow(0);
        gridRef.current?.update({ all: true });
    }, [links, viewMode]);

    useEffect(() => {
        gridRef.current?.update({ all: true });
    }, [selectedId]);

    const counts = useMemo(() => {
        const colCount = gridSize.width
            ? Math.max(1, Math.floor(gridSize.width / dims.cellWidth))
            : 1;
        const rowCount = links.length > 0
            ? Math.ceil(links.length / colCount)
            : 0;

        setTimeout(() => {
            gridRef.current?.update({ all: true });
        }, 0);

        return { colCount, rowCount };
    }, [gridSize.width, links.length, dims.cellWidth]);

    const renderCell = useCallback(
        (p: RenderCellParams) => {
            const index = p.row * counts.colCount + p.col;
            const link = links[index];
            if (!link) return <div key={p.key} style={p.style} />;

            return (
                <div key={p.key} style={p.style} className="tile-cell">
                    <LinksTileCell
                        link={link}
                        isSelected={getId(link) === selectedId}
                        imageHeight={dims.imageHeight}
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
        [links, counts.colCount, dims, selectedId, getId, getAdditionalIcon,
         dragType, getDragItem, onSelect, onOpen, onEdit, onDelete, onDoubleClick, onContextMenu, faviconVersion],
    );

    return (
        <LinksTilesRoot
            ref={gridRef}
            rowCount={counts.rowCount}
            columnCount={counts.colCount}
            rowHeight={dims.cellHeight}
            columnWidth={dims.cellWidth}
            renderCell={renderCell}
            onResize={setGridSize}
        />
    );
}
