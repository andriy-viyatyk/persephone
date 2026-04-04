import { useCallback, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { highlightText } from "../basic/useHighlightedText";
import { TreeProviderItemIcon } from "./TreeProviderItemIcon";
import { getHostname, getFaviconPathSync } from "./favicon-cache";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { CategoryViewMode } from "./CategoryViewModel";

// =============================================================================
// Tile dimensions per view mode
// =============================================================================

interface TileDimensions {
    cellWidth: number;
    cellHeight: number;
    imageHeight: number;
}

export const TILE_DIMENSIONS: Record<Exclude<CategoryViewMode, "list">, TileDimensions> = {
    "tiles-landscape":     { cellWidth: 252, cellHeight: 192, imageHeight: 144 },
    "tiles-landscape-big": { cellWidth: 372, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait":      { cellWidth: 168, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait-big":  { cellWidth: 252, cellHeight: 408, imageHeight: 336 },
};

// =============================================================================
// Styles
// =============================================================================

const TileRoot = styled.div({
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    borderRadius: 8,
    overflow: "hidden",
    cursor: "default",
    position: "relative",
    border: `1px solid ${color.border.default}`,
    boxSizing: "border-box",
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
        backgroundColor: color.background.dark,
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
        gap: 6,
        padding: "4px 8px",
        fontSize: 12,
        color: color.text.default,
        overflow: "hidden",
        "& .tile-title-icon": {
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
        },
        "& .tile-title-text": {
            flex: 1,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            textOverflow: "ellipsis",
            minWidth: 0,
            wordBreak: "break-word",
        },
    },
});

// =============================================================================
// Image source resolution
// =============================================================================

function getImageSrc(item: ITreeProviderItem): string | null {
    if (!item.imgSrc) return null;
    // Archive paths (contain "::") can't be rendered as <img src>
    if (item.imgSrc.includes("::")) return null;
    return item.imgSrc;
}

function getFaviconSrc(item: ITreeProviderItem): string | null {
    const hostname = getHostname(item.href);
    if (!hostname) return null;
    const fp = getFaviconPathSync(hostname);
    return fp ? `file://${fp}` : null;
}

// =============================================================================
// Component
// =============================================================================

interface ItemTileProps {
    item: ITreeProviderItem;
    imageHeight: number;
    isSelected?: boolean;
    searchText?: string;
    onClick?: () => void;
    onDoubleClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export function ItemTile({
    item,
    imageHeight,
    isSelected,
    searchText,
    onClick,
    onDoubleClick,
    onContextMenu,
}: ItemTileProps) {
    const [imgError, setImgError] = useState(false);
    const handleImgError = useCallback(() => setImgError(true), []);

    const imgSrc = getImageSrc(item);
    const faviconSrc = !imgSrc ? getFaviconSrc(item) : null;
    const showImage = (imgSrc && !imgError) || faviconSrc;

    return (
        <TileRoot
            className={isSelected ? "selected" : undefined}
            title={item.href}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
        >
            <div
                className={showImage ? "tile-image" : "tile-image tile-no-image"}
                style={{ height: imageHeight }}
            >
                {imgSrc && !imgError ? (
                    <img src={imgSrc} alt={item.name} loading="lazy" onError={handleImgError} />
                ) : faviconSrc ? (
                    <img src={faviconSrc} alt="" />
                ) : (
                    <TreeProviderItemIcon item={item} />
                )}
            </div>
            <div className="tile-title">
                <span className="tile-title-icon">
                    <TreeProviderItemIcon item={item} />
                </span>
                <span className="tile-title-text">
                    {searchText
                        ? highlightText(searchText, item.name)
                        : item.name}
                </span>
            </div>
        </TileRoot>
    );
}
