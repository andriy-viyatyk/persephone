import styled from "@emotion/styled";
import { useCallback } from "react";
import { useDrag, useDrop } from "react-dnd";
import color from "../../theme/color";
import { GlobeIcon, OpenLinkIcon, PinFilledIcon } from "../../theme/icons";
import { pagesModel } from "../../store/pages-store";
import { LinkItem, LINK_PIN_DRAG } from "./linkTypes";
import { LinkEditorModel } from "./LinkEditorModel";
import { getHostname, getFaviconPathSync, requestFaviconSave } from "./favicon-cache";

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
        padding: "4px 8px",
        fontSize: 13,
        cursor: "default",
        borderRadius: 4,
        margin: "0 4px",
        position: "relative",
        "&:hover": {
            backgroundColor: color.background.dark,
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
        "& .pinned-favicon": {
            flexShrink: 0,
            width: 16,
            height: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            "& img": {
                width: 16,
                height: 16,
                objectFit: "contain",
            },
            "& svg": { width: 16, height: 16, opacity: 0.5 },
        },
        "& .pinned-title": {
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: color.text.default,
            minWidth: 0,
        },
        "& .pinned-open": {
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            opacity: 0,
            cursor: "pointer",
            color: color.icon.default,
            borderRadius: 4,
            padding: 2,
            transition: "opacity 0.15s ease",
            "&:hover": {
                color: color.misc.blue,
            },
            "& svg": { width: 16, height: 16 },
        },
        "&:hover .pinned-open": {
            opacity: 1,
        },
    },
});

// =============================================================================
// Pinned Item Row (extracted for useDrag/useDrop hooks)
// =============================================================================

interface PinnedItemProps {
    link: LinkItem;
    index: number;
    model: LinkEditorModel;
    onOpenLink: (link: LinkItem) => void;
}

function PinnedItem({ link, index, model, onOpenLink }: PinnedItemProps) {
    const hostname = getHostname(link.href);
    const faviconPath = getFaviconPathSync(hostname);

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
    if (isDragging) className += " dragging";
    if (isOver && dropPosition === "above") className += " drop-above";
    if (isOver && dropPosition === "below") className += " drop-below";

    return (
        <div
            ref={setRef}
            className={className}
            title={link.href || link.title}
            onClick={() => model.selectLink(link.id)}
            onDoubleClick={() => model.showLinkDialog(link.id)}
        >
            <span className="pinned-favicon">
                {faviconPath
                    ? <img src={`file://${faviconPath}`} alt="" />
                    : <GlobeIcon />}
            </span>
            <span className="pinned-title">
                {link.title || "Untitled"}
            </span>
            {link.href && (
                <span
                    className="pinned-open"
                    title="Open link"
                    onClick={(e) => {
                        e.stopPropagation();
                        model.selectLink(link.id);
                        onOpenLink(link);
                    }}
                >
                    <OpenLinkIcon />
                </span>
            )}
        </div>
    );
}

// =============================================================================
// Component
// =============================================================================

interface PinnedLinksPanelProps {
    pinnedLinks: LinkItem[];
    model: LinkEditorModel;
    style?: React.CSSProperties;
}

export function PinnedLinksPanel({ pinnedLinks, model, style }: PinnedLinksPanelProps) {
    const handleOpenLink = useCallback((link: LinkItem) => {
        if (link.href) {
            requestFaviconSave(getHostname(link.href));
            pagesModel.handleOpenUrl(link.href);
        }
    }, []);

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
                        model={model}
                        onOpenLink={handleOpenLink}
                    />
                ))}
            </div>
        </PinnedLinksPanelRoot>
    );
}
