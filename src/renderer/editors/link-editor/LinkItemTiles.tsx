import styled from "@emotion/styled";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { RenderCellParams, RenderSizeOptional } from "../../components/virtualization/RenderGrid/types";
import color from "../../theme/color";
import { CopyIcon, DeleteIcon, GlobeIcon, OpenFileIcon, OpenLinkIcon, RenameIcon } from "../../theme/icons";
import { IncognitoIcon } from "../../theme/language-icons";
import { pagesModel } from "../../store/pages-store";
import { LinkItem, LinkViewMode } from "./linkTypes";
import { LinkEditorModel } from "./LinkEditorModel";

const { shell, clipboard } = require("electron");

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

// =============================================================================
// Styles
// =============================================================================

const LinkItemTilesRoot = styled(RenderGrid)({
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
// Component
// =============================================================================

interface LinkItemTilesProps {
    links: LinkItem[];
    model: LinkEditorModel;
    viewMode: Exclude<LinkViewMode, "list">;
    selectedLinkId: string;
}

export function LinkItemTiles({ links, model, viewMode, selectedLinkId }: LinkItemTilesProps) {
    const gridRef = useRef<RenderGridModel>(null);
    const [gridSize, setGridSize] = useState<RenderSizeOptional>({
        width: undefined,
        height: undefined,
    });

    const dims = TILE_DIMENSIONS[viewMode];

    useEffect(() => {
        model.setGridModel(gridRef.current);
        return () => model.setGridModel(null);
    }, []);

    useEffect(() => {
        gridRef.current?.scrollToRow(0);
        gridRef.current?.update({ all: true });
    }, [links, viewMode]);

    useEffect(() => {
        gridRef.current?.update({ all: true });
    }, [selectedLinkId]);

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

    const handleOpenLink = useCallback((link: LinkItem) => {
        if (link.href) {
            pagesModel.handleOpenUrl(link.href);
        }
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent, link: LinkItem) => {
        model.selectLink(link.id);
        const nativeEvent = e.nativeEvent as any;
        if (!nativeEvent.menuItems) nativeEvent.menuItems = [];
        nativeEvent.menuItems.push(
            {
                label: "Edit",
                icon: <RenameIcon />,
                onClick: () => model.showLinkDialog(link.id),
            },
            {
                label: "Open in Default Browser",
                icon: <OpenFileIcon />,
                onClick: () => { if (link.href) shell.openExternal(link.href); },
                disabled: !link.href,
                startGroup: true,
            },
            {
                label: "Open in Internal Browser",
                icon: <GlobeIcon />,
                onClick: async () => {
                    if (link.href) {
                        const { openUrlInBrowserTab } = await import("../../store/page-actions");
                        openUrlInBrowserTab(link.href);
                    }
                },
                disabled: !link.href,
            },
            {
                label: "Open in Incognito",
                icon: <IncognitoIcon />,
                onClick: async () => {
                    if (link.href) {
                        const { openUrlInBrowserTab } = await import("../../store/page-actions");
                        openUrlInBrowserTab(link.href, { incognito: true });
                    }
                },
                disabled: !link.href,
            },
            {
                label: "Copy URL",
                icon: <CopyIcon />,
                onClick: () => {
                    if (link.href) clipboard.writeText(link.href);
                },
                disabled: !link.href,
            },
        );
        if (link.imgSrc) {
            const imgUrl = link.imgSrc;
            nativeEvent.menuItems.push(
                {
                    label: "Copy Image URL",
                    icon: <CopyIcon />,
                    onClick: () => clipboard.writeText(imgUrl),
                    startGroup: true,
                },
                {
                    label: "Open Image in New Tab",
                    icon: <OpenFileIcon />,
                    onClick: async () => {
                        const { openImageInNewTab } = await import("../../store/page-actions");
                        openImageInNewTab(imgUrl);
                    },
                },
            );
        }
        nativeEvent.menuItems.push(
            {
                label: "Delete",
                icon: <DeleteIcon />,
                onClick: () => model.deleteLink(link.id),
                startGroup: true,
            },
        );
    }, [model]);

    const renderCell = useCallback(
        (p: RenderCellParams) => {
            const index = p.row * counts.colCount + p.col;
            const link = links[index];
            if (!link) return <div key={p.key} style={p.style} />;

            const isSelected = link.id === selectedLinkId;

            return (
                <div key={p.key} style={p.style} className="tile-cell">
                    <div
                        className={isSelected ? "tile-inner selected" : "tile-inner"}
                        title={link.href || link.title}
                        onClick={() => model.selectLink(link.id)}
                        onDoubleClick={() => model.showLinkDialog(link.id)}
                        onContextMenu={(e) => handleContextMenu(e, link)}
                    >
                        <div
                            className={link.imgSrc ? "tile-image" : "tile-image tile-no-image"}
                            style={{ height: dims.imageHeight }}
                        >
                            {link.imgSrc ? (
                                <img src={link.imgSrc} alt={link.title} loading="lazy" />
                            ) : (
                                <GlobeIcon />
                            )}
                        </div>
                        <div className="tile-title">
                            <span>{link.title || "Untitled"}</span>
                            {link.href && (
                                <span
                                    className="tile-open-link"
                                    title="Open link"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        model.selectLink(link.id);
                                        handleOpenLink(link);
                                    }}
                                >
                                    <OpenLinkIcon />
                                </span>
                            )}
                        </div>
                        <div className="tile-actions">
                            <button
                                title="Edit"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    model.selectLink(link.id);
                                    model.showLinkDialog(link.id);
                                }}
                            >
                                <RenameIcon />
                            </button>
                            <button
                                title="Delete"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    model.selectLink(link.id);
                                    model.deleteLink(link.id, e.ctrlKey);
                                }}
                            >
                                <DeleteIcon />
                            </button>
                        </div>
                    </div>
                </div>
            );
        },
        [links, counts.colCount, model, dims, selectedLinkId, handleOpenLink, handleContextMenu],
    );

    return (
        <LinkItemTilesRoot
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
