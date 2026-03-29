import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styled from "@emotion/styled";
import { useComponentModel } from "../../core/state/model";
import RenderGrid from "../virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../virtualization/RenderGrid/RenderGridModel";
import type { RenderCellParams } from "../virtualization/RenderGrid/types";
import { TextField } from "../basic/TextField";
import { Button } from "../basic/Button";
import { CloseIcon } from "../../theme/icons";
import { highlightText } from "../basic/useHighlightedText";
import color from "../../theme/color";
import { TreeProviderItemIcon } from "./TreeProviderItemIcon";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import {
    CategoryViewModel,
    CategoryViewProps,
    defaultCategoryViewState,
} from "./CategoryViewModel";

export type { CategoryViewProps } from "./CategoryViewModel";
export type { CategoryViewMode } from "./CategoryViewModel";

const ROW_HEIGHT = 28;

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

    useEffect(() => {
        gridRef.current?.update({ all: true });
    }, [state.filteredItems, props.selectedHref]);

    const { filteredItems } = state;

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

    const searchElement = (
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
    );

    return (
        <CategoryViewRoot>
            {props.toolbarPortalRef && createPortal(searchElement, props.toolbarPortalRef)}
            <div className="cv-content">
                {filteredItems.length === 0 ? (
                    <div className="cv-empty">
                        {state.searchText ? "No matching items" : "Empty folder"}
                    </div>
                ) : (
                    <RenderGrid
                        ref={gridRef}
                        rowCount={filteredItems.length}
                        columnCount={1}
                        rowHeight={ROW_HEIGHT}
                        columnWidth={FULL_WIDTH}
                        renderCell={renderCell}
                        fitToWidth
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
