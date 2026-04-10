import styled from "@emotion/styled";
import { useCallback } from "react";
import { useDrag, useDrop } from "react-dnd";
import color from "../../theme/color";
import { CopyIcon, DeleteIcon, OpenFileIcon, PinFilledIcon, RenameIcon } from "../../theme/icons";
import { appendLinkOpenMenuItems } from "../shared/link-open-menu";
import { ContextMenuEvent } from "../../api/events/events";
import { LinkItem, LINK_PIN_DRAG } from "./linkTypes";
import { LinkViewModel } from "./LinkViewModel";
import { LinkTooltip } from "./LinkTooltip";
import { TreeProviderItemIcon } from "../../components/tree-provider/TreeProviderItemIcon";
import { getHostname, requestFaviconSave, useFavicons } from "../../components/tree-provider/favicon-cache";

const { clipboard } = require("electron");

// =============================================================================
// Styles
// =============================================================================

const PinnedLinksPanelRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 100,
    maxWidth: "40%",
    "& .pinned-header": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 8px",
        fontSize: 12,
        color: color.text.light,
        borderBottom: `1px solid ${color.border.default}`,
        flexShrink: 0,
        "& svg": { width: 14, height: 14, color: color.misc.blue },
    },
    "& .pinned-list": {
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        padding: "4px 0",
    },
    "& .pinned-item": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        height: 28,
        fontSize: 13,
        cursor: "default",
        boxSizing: "border-box",
        borderRadius: 6,
        margin: "0 4px",
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
        "&.drop-above::before": {
            content: "''",
            position: "absolute",
            top: 0,
            left: 4,
            right: 4,
            height: 2,
            backgroundColor: color.misc.blue,
            borderRadius: 1,
        },
        "&.drop-below::after": {
            content: "''",
            position: "absolute",
            bottom: 0,
            left: 4,
            right: 4,
            height: 2,
            backgroundColor: color.misc.blue,
            borderRadius: 1,
        },
        "&.dragging": {
            opacity: 0.4,
        },
        "& .pinned-icon": {
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
        },
        "& .pinned-title": {
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.strong,
            minWidth: 0,
        },
    },
});

// =============================================================================
// Pinned Item Row (extracted for useDrag/useDrop hooks)
// =============================================================================

interface PinnedItemProps {
    link: LinkItem;
    index: number;
    isSelected: boolean;
    model: LinkViewModel;
    onOpenLink: (link: LinkItem) => void;
    onContextMenu: (e: React.MouseEvent, link: LinkItem) => void;
}

function PinnedItem({ link, index, isSelected, model, onOpenLink, onContextMenu }: PinnedItemProps) {
    const [{ isDragging }, drag] = useDrag({
        type: LINK_PIN_DRAG,
        item: { type: LINK_PIN_DRAG, index },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    const [{ isOver, dropPosition }, drop] = useDrop({
        accept: LINK_PIN_DRAG,
        drop(dragItem: { index: number }) {
            if (dragItem.index !== index) {
                const toIndex = dragItem.index < index ? index : index;
                model.reorderPinnedLink(dragItem.index, toIndex);
            }
        },
        collect: (monitor) => {
            if (!monitor.isOver()) return { isOver: false, dropPosition: "" };
            const dragItem = monitor.getItem<{ index: number }>();
            if (!dragItem || dragItem.index === index) return { isOver: false, dropPosition: "" };
            return {
                isOver: true,
                dropPosition: dragItem.index < index ? "below" : "above",
            };
        },
    });

    const setRef = useCallback(
        (node: HTMLDivElement | null) => {
            drag(node);
            drop(node);
        },
        [drag, drop],
    );

    let className = "pinned-item";
    if (isSelected) className += " selected";
    if (isDragging) className += " dragging";
    if (isOver && dropPosition === "above") className += " drop-above";
    if (isOver && dropPosition === "below") className += " drop-below";

    const tooltipId = `pinned-${link.id}`;

    return (
        <div
            ref={setRef}
            className={className}
            onClick={() => model.selectLink(link.id)}
            onDoubleClick={() => { if (link.href) onOpenLink(link); }}
            onContextMenu={(e) => onContextMenu(e, link)}
        >
            <span className="pinned-icon">
                <TreeProviderItemIcon item={link} />
            </span>
            <span className="pinned-title" data-tooltip-id={tooltipId}>
                {link.title || "Untitled"}
            </span>
            <LinkTooltip id={tooltipId} link={link} />
        </div>
    );
}

// =============================================================================
// Component
// =============================================================================

interface PinnedLinksPanelProps {
    pinnedLinks: LinkItem[];
    model: LinkViewModel;
    selectedLinkId?: string;
    style?: React.CSSProperties;
}

export function PinnedLinksPanel({ pinnedLinks, model, selectedLinkId, style }: PinnedLinksPanelProps) {
    useFavicons(pinnedLinks);

    const handleOpenLink = useCallback((link: LinkItem) => {
        if (link.href) {
            requestFaviconSave(getHostname(link.href));
            model.openLink(link);
        }
    }, [model]);

    const handleContextMenu = useCallback((e: React.MouseEvent, link: LinkItem) => {
        model.selectLink(link.id);
        const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "link-pinned");
        const customItems = model.onGetLinkMenuItems?.(link);
        if (customItems?.length) {
            ctxEvent.items.push(...customItems);
        }
        ctxEvent.items.push(
            {
                label: "Edit",
                icon: <RenameIcon />,
                onClick: () => model.showLinkDialog(link.id),
                startGroup: customItems?.length ? true : undefined,
            },
        );
        if (link.href) {
            appendLinkOpenMenuItems(ctxEvent.items, link.href, { startGroup: true });
        }
        ctxEvent.items.push(
            {
                label: "Copy URL",
                icon: <CopyIcon />,
                onClick: () => { if (link.href) clipboard.writeText(link.href); },
                disabled: !link.href,
            },
        );
        if (link.imgSrc) {
            const imgUrl = link.imgSrc;
            ctxEvent.items.push(
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
                        const { pagesModel } = await import("../../api/pages");
                        pagesModel.openImageInNewTab(imgUrl);
                    },
                },
            );
        }
        ctxEvent.items.push(
            {
                label: "Unpin",
                icon: <PinFilledIcon />,
                onClick: () => model.togglePinLink(link.id),
                startGroup: true,
            },
            {
                label: "Delete",
                icon: <DeleteIcon />,
                onClick: () => model.deleteLink(link.id),
            },
        );
    }, [model]);

    return (
        <PinnedLinksPanelRoot style={style}>
            <div className="pinned-header">
                <PinFilledIcon /> Pinned
            </div>
            <div className="pinned-list">
                {pinnedLinks.map((link, i) => (
                    <PinnedItem
                        key={link.id}
                        link={link}
                        index={i}
                        isSelected={link.id === selectedLinkId}
                        model={model}
                        onOpenLink={handleOpenLink}
                        onContextMenu={handleContextMenu}
                    />
                ))}
            </div>
        </PinnedLinksPanelRoot>
    );
}
