import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "@emotion/styled";
import { useComponentModel } from "../../core/state/model";
import RenderGrid from "../virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../virtualization/RenderGrid/RenderGridModel";
import type { RenderCellParams, RenderSizeOptional } from "../virtualization/RenderGrid/types";
import { TextField } from "../basic/TextField";
import { Button } from "../basic/Button";
import {
    CloseIcon,
    ViewListIcon, ViewLandscapeIcon, ViewLandscapeBigIcon,
    ViewPortraitIcon, ViewPortraitBigIcon,
} from "../../theme/icons";
import { showAppPopupMenu } from "../../ui/dialogs";
import { highlightText } from "../basic/useHighlightedText";
import color from "../../theme/color";
import { TreeProviderItemIcon } from "./TreeProviderItemIcon";
import { ItemTile, TILE_DIMENSIONS } from "./ItemTile";
import { useFavicons } from "./favicon-cache";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import {
    CategoryViewModel,
    CategoryViewProps,
    CategoryViewMode,
    defaultCategoryViewState,
} from "./CategoryViewModel";

export type { CategoryViewProps } from "./CategoryViewModel";
export type { CategoryViewMode } from "./CategoryViewModel";

const ROW_HEIGHT = 28;
const EMPTY_ARRAY: ITreeProviderItem[] = [];

// =============================================================================
// View mode constants
// =============================================================================

const VIEW_MODE_LABELS: Record<CategoryViewMode, string> = {
    "list": "List",
    "tiles-landscape": "Landscape",
    "tiles-landscape-big": "Landscape (Large)",
    "tiles-portrait": "Portrait",
    "tiles-portrait-big": "Portrait (Large)",
};

const VIEW_MODE_ICONS: Record<CategoryViewMode, React.ReactNode> = {
    "list": <ViewListIcon />,
    "tiles-landscape": <ViewLandscapeIcon />,
    "tiles-landscape-big": <ViewLandscapeBigIcon />,
    "tiles-portrait": <ViewPortraitIcon />,
    "tiles-portrait-big": <ViewPortraitBigIcon />,
};

const VIEW_MODE_ORDER: CategoryViewMode[] = [
    "list", "tiles-landscape", "tiles-landscape-big",
    "tiles-portrait", "tiles-portrait-big",
];

const CategoryViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "hidden",

    "& .cv-content": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },

    "& .cv-footer": {
        padding: "2px 8px",
        borderTop: `1px solid ${color.border.light}`,
        flexShrink: 0,
        fontSize: 11,
        color: color.text.light,
    },

    "& .cv-error": {
        padding: 8,
        fontSize: 12,
        color: color.misc.red,
    },

    "& .cv-empty": {
        padding: 8,
        fontSize: 12,
        color: color.text.light,
    },

    "& .cv-loading": {
        padding: 8,
        fontSize: 12,
        color: color.text.light,
    },

    "& .cv-row-cell": {
        boxSizing: "border-box",
        padding: "0 4px",
        display: "flex",
        alignItems: "stretch",
    },

    "& .cv-tile-cell": {
        boxSizing: "border-box",
        padding: 4,
    },

    "& .cv-row": {
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
        "& .cv-row-icon": {
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
        },
        "& .cv-row-name": {
            flex: "1 1 auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.strong,
            minWidth: 0,
        },
        "& .cv-row-name-folder": {
            flex: "1 1 auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.strong,
            fontWeight: 500,
            minWidth: 0,
        },
    },
});

type Percent = `${number}%`;
const FULL_WIDTH = () => "100%" as Percent;

export function CategoryView(props: CategoryViewProps) {
    const model = useComponentModel(
        props,
        CategoryViewModel,
        defaultCategoryViewState,
    );
    const state = model.state.use();
    const gridRef = useRef<RenderGridModel>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const viewMode = props.viewMode ?? "list";
    const isTileMode = viewMode !== "list";
    const { filteredItems } = state;

    // Track grid size for tile column calculation
    const [gridSize, setGridSize] = useState<RenderSizeOptional>({ width: undefined, height: undefined });

    // Favicon preloading for tile mode
    const faviconVersion = useFavicons(isTileMode ? filteredItems : EMPTY_ARRAY);

    // Tile grid layout
    const tileLayout = useMemo(() => {
        if (!isTileMode) return null;
        const dims = TILE_DIMENSIONS[viewMode as Exclude<CategoryViewMode, "list">];
        const colCount = gridSize.width
            ? Math.max(1, Math.floor(gridSize.width / dims.cellWidth))
            : 1;
        const rowCount = filteredItems.length > 0
            ? Math.ceil(filteredItems.length / colCount)
            : 0;
        return { dims, colCount, rowCount };
    }, [isTileMode, viewMode, gridSize.width, filteredItems.length]);

    useEffect(() => {
        gridRef.current?.update({ all: true });
    }, [state.filteredItems, props.selectedHref, faviconVersion]);

    useEffect(() => {
        gridRef.current?.scrollToRow(0);
        gridRef.current?.update({ all: true });
    }, [viewMode]);

    const renderCell = useCallback(
        (p: RenderCellParams) => {
            const item = filteredItems[p.row];
            if (!item) return null;
            const isSelected = item.href === props.selectedHref;
            return (
                <div key={p.key} style={p.style} className="cv-row-cell">
                    <CategoryViewRow
                        item={item}
                        isSelected={isSelected}
                        searchText={state.searchText}
                        onClick={model.onItemClick}
                        onDoubleClick={model.onItemDoubleClick}
                        onContextMenu={model.onItemContextMenu}
                    />
                </div>
            );
        },
        [filteredItems, props.selectedHref, state.searchText, model],
    );

    const renderTileCell = useCallback(
        (p: RenderCellParams) => {
            if (!tileLayout) return null;
            const index = p.row * tileLayout.colCount + p.col;
            const item = filteredItems[index];
            if (!item) return <div key={p.key} style={p.style} />;

            const isSelected = item.href === props.selectedHref;
            return (
                <div key={p.key} style={p.style} className="cv-tile-cell">
                    <ItemTile
                        item={item}
                        imageHeight={tileLayout.dims.imageHeight}
                        isSelected={isSelected}
                        searchText={state.searchText}
                        onClick={() => model.onItemClick(item)}
                        onDoubleClick={() => model.onItemDoubleClick(item)}
                        onContextMenu={(e) => model.onItemContextMenu(item, e)}
                    />
                </div>
            );
        },
        [filteredItems, tileLayout, props.selectedHref, state.searchText, model, faviconVersion],
    );

    const handleViewModeMenu = useCallback((e: React.MouseEvent) => {
        if (!props.onViewModeChange) return;
        const rect = e.currentTarget.getBoundingClientRect();
        showAppPopupMenu(rect.left, rect.bottom + 2, VIEW_MODE_ORDER.map((mode) => ({
            label: VIEW_MODE_LABELS[mode],
            icon: VIEW_MODE_ICONS[mode],
            selected: mode === viewMode,
            onClick: () => props.onViewModeChange!(mode),
        })));
    }, [viewMode, props.onViewModeChange]);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            model.setSearchText("");
        }
    }, [model]);

    const handleSearchClose = useCallback(() => {
        model.setSearchText("");
        searchInputRef.current?.blur();
    }, [model]);

    // Error state
    if (state.error) {
        return (
            <CategoryViewRoot>
                <div className="cv-error">{state.error}</div>
            </CategoryViewRoot>
        );
    }

    // Loading state
    if (state.loading && state.items.length === 0) {
        return (
            <CategoryViewRoot>
                <div className="cv-loading">Loading...</div>
            </CategoryViewRoot>
        );
    }

    const totalCount = state.items.length;
    const filteredCount = filteredItems.length;

    const toolbarElement = (
        <>
            <TextField
                ref={searchInputRef}
                value={state.searchText}
                onChange={model.setSearchText}
                placeholder="Search..."
                onKeyDown={handleSearchKeyDown}
                endButtons={[
                    <Button
                        size="small"
                        type="icon"
                        key="close-search"
                        title="Clear"
                        onClick={handleSearchClose}
                        invisible={!state.searchText}
                    >
                        <CloseIcon />
                    </Button>,
                ]}
            />
            {props.onViewModeChange && (
                <Button type="icon" size="small" title="View Mode" onClick={handleViewModeMenu}>
                    {VIEW_MODE_ICONS[viewMode]}
                </Button>
            )}
        </>
    );

    return (
        <CategoryViewRoot>
            {props.toolbarPortalRef && createPortal(toolbarElement, props.toolbarPortalRef)}
            <div className="cv-content">
                {filteredItems.length === 0 ? (
                    <div className="cv-empty">
                        {state.searchText ? "No matching items" : "Empty folder"}
                    </div>
                ) : isTileMode && tileLayout ? (
                    <RenderGrid
                        ref={gridRef}
                        rowCount={tileLayout.rowCount}
                        columnCount={tileLayout.colCount}
                        rowHeight={tileLayout.dims.cellHeight}
                        columnWidth={tileLayout.dims.cellWidth}
                        renderCell={renderTileCell}
                        onResize={setGridSize}
                    />
                ) : (
                    <RenderGrid
                        ref={gridRef}
                        rowCount={filteredItems.length}
                        columnCount={1}
                        rowHeight={ROW_HEIGHT}
                        columnWidth={FULL_WIDTH}
                        renderCell={renderCell}
                        fitToWidth
                        onResize={setGridSize}
                    />
                )}
            </div>
            <div className="cv-footer">
                {filteredCount === totalCount
                    ? `${totalCount} items`
                    : `${filteredCount} of ${totalCount} items`}
            </div>
        </CategoryViewRoot>
    );
}

// =============================================================================
// Row component
// =============================================================================

interface CategoryViewRowProps {
    item: ITreeProviderItem;
    isSelected: boolean;
    searchText: string;
    onClick: (item: ITreeProviderItem) => void;
    onDoubleClick: (item: ITreeProviderItem) => void;
    onContextMenu: (item: ITreeProviderItem, e: React.MouseEvent) => void;
}

function CategoryViewRow({
    item,
    isSelected,
    searchText,
    onClick,
    onDoubleClick,
    onContextMenu,
}: CategoryViewRowProps) {
    const [handleClick, handleDblClick, handleCtxMenu] = useItemHandlers(item, onClick, onDoubleClick, onContextMenu);

    return (
        <div
            className={isSelected ? "cv-row selected" : "cv-row"}
            onClick={handleClick}
            onDoubleClick={handleDblClick}
            onContextMenu={handleCtxMenu}
        >
            <span className="cv-row-icon">
                <TreeProviderItemIcon item={item} />
            </span>
            <span
                className={item.isDirectory ? "cv-row-name-folder" : "cv-row-name"}
                title={item.href}
            >
                {searchText
                    ? highlightText(searchText, item.name)
                    : item.name}
            </span>
        </div>
    );
}

function useItemHandlers(
    item: ITreeProviderItem,
    onClick: (item: ITreeProviderItem) => void,
    onDoubleClick: (item: ITreeProviderItem) => void,
    onContextMenu: (item: ITreeProviderItem, e: React.MouseEvent) => void,
) {
    const handleClick = useCallback(() => onClick(item), [item, onClick]);
    const handleDblClick = useCallback(() => onDoubleClick(item), [item, onDoubleClick]);
    const handleCtxMenu = useCallback((e: React.MouseEvent) => onContextMenu(item, e), [item, onContextMenu]);
    return [handleClick, handleDblClick, handleCtxMenu] as const;
}
