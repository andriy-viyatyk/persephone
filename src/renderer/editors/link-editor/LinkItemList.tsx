import styled from "@emotion/styled";
import { useCallback, useEffect, useRef, useState } from "react";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { RenderCellParams, RenderSizeOptional } from "../../components/virtualization/RenderGrid/types";
import { highlightText, useHighlightedText } from "../../components/basic/useHighlightedText";
import { Button } from "../../components/basic/Button";
import color from "../../theme/color";
import { CopyIcon, DeleteIcon, GlobeIcon, OpenFileIcon, OpenLinkIcon, RenameIcon } from "../../theme/icons";
import { IncognitoIcon } from "../../theme/language-icons";
import { pagesModel } from "../../store/pages-store";
import { LinkItem } from "./linkTypes";
import { LinkEditorModel } from "./LinkEditorModel";

const { shell, clipboard } = require("electron");

const ROW_HEIGHT = 28;

// =============================================================================
// Styles
// =============================================================================

const LinkItemListRoot = styled(RenderGrid)({
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
            "& .icon-default": {
                display: "flex",
            },
            "& .icon-open": {
                display: "none",
            },
        },
        "&:hover .link-open-btn": {
            "& .icon-default": {
                display: "none",
            },
            "& .icon-open": {
                display: "flex",
            },
        },
        "& .link-title": {
            width: "fit-content",
            maxWidth: "60%",
            flexShrink: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.strong,
            border: `1px solid ${color.border.default}`,
            borderRadius: 4,
            padding: "0 6px",
        },
        "& .link-href": {
            flex: "1 1 auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.light,
            fontSize: 12,
            minWidth: 0,
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
// Component
// =============================================================================

interface LinkItemListProps {
    links: LinkItem[];
    model: LinkEditorModel;
    selectedLinkId: string;
}

export function LinkItemList({ links, model, selectedLinkId }: LinkItemListProps) {
    const gridRef = useRef<RenderGridModel>(null);
    const [gridWidth, setGridWidth] = useState<number | undefined>(undefined);
    const searchText = useHighlightedText();

    useEffect(() => {
        model.setGridModel(gridRef.current);
        return () => model.setGridModel(null);
    }, []);

    useEffect(() => {
        gridRef.current?.update({ all: true });
    }, [links, selectedLinkId]);

    const handleResize = useCallback((size: RenderSizeOptional) => {
        setGridWidth(size.width);
    }, []);

    const columnWidth = useCallback(() => gridWidth ?? 400, [gridWidth]);

    const handleLinkClick = useCallback((link: LinkItem) => {
        if (link.href) {
            pagesModel.handleOpenUrl(link.href);
        }
    }, []);

    const handleCopyUrl = useCallback((link: LinkItem) => {
        if (link.href) {
            clipboard.writeText(link.href);
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
                onClick: () => handleCopyUrl(link),
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
    }, [model, handleCopyUrl]);

    const renderCell = useCallback(
        (p: RenderCellParams) => {
            const link = links[p.row];
            if (!link) return null;
            const isSelected = link.id === selectedLinkId;
            return (
                <div key={p.key} style={p.style} className="link-row-cell">
                    <div
                        className={isSelected ? "link-row selected" : "link-row"}
                        onClick={() => model.selectLink(link.id)}
                        onDoubleClick={() => model.showLinkDialog(link.id)}
                        onContextMenu={(e) => handleContextMenu(e, link)}
                    >
                        <Button
                            className="link-open-btn"
                            size="small"
                            type="flat"
                            title="Open link"
                            onClick={(e) => {
                                e.stopPropagation();
                                model.selectLink(link.id);
                                handleLinkClick(link);
                            }}
                        >
                            <span className="icon-default"><GlobeIcon /></span>
                            <span className="icon-open"><OpenLinkIcon /></span>
                        </Button>
                        <span
                            className="link-title"
                            title={link.href || link.title}
                        >
                            {searchText ? highlightText(searchText, link.title || "Untitled") : (link.title || "Untitled")}
                        </span>
                        <span className="link-href">
                            {link.href}
                        </span>
                        <span className="link-actions">
                            <Button
                                size="small"
                                type="flat"
                                title="Edit"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    model.selectLink(link.id);
                                    model.showLinkDialog(link.id);
                                }}
                            >
                                <RenameIcon />
                            </Button>
                            <Button
                                size="small"
                                type="flat"
                                title="Delete"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    model.selectLink(link.id);
                                    model.deleteLink(link.id, e.ctrlKey);
                                }}
                            >
                                <DeleteIcon />
                            </Button>
                        </span>
                    </div>
                </div>
            );
        },
        [links, model, searchText, selectedLinkId, handleLinkClick, handleContextMenu],
    );

    return (
        <LinkItemListRoot
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
