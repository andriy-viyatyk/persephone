import styled from "@emotion/styled";
import { useCallback, useMemo, useRef, useState } from "react";
import { useFloating, offset as floatingOffset, autoUpdate } from "@floating-ui/react";
import color from "../../theme/color";
import { TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData } from "../../core/traits";
import { CloseIcon, GlobeIcon, PlusIcon, VolumeIcon, VolumeMutedIcon } from "../../theme/icons";
import { BrowserEditorModel, BrowserTabData } from "./BrowserEditorModel";
import { Button } from "../../components/basic/Button";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { ContextMenuEvent } from "../../api/events/events";

/** Below this width, hide tab titles and show icon-only compact mode. */
const COMPACT_THRESHOLD = 70;

/** Below this width, hide the close button even in normal mode. */
const CLOSE_BUTTON_THRESHOLD = 100;

const BrowserTabsPanelRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: color.background.default,
    height: "100%",

    "& .tabs-list": {
        flex: "1 1 auto",
        overflowY: "auto",
        overflowX: "hidden",
    },

    "& .tab-item": {
        display: "flex",
        alignItems: "center",
        height: 28,
        boxSizing: "border-box",
        padding: "0 4px 0 6px",
        margin: "0 4px 0 8px",
        gap: 6,
        cursor: "pointer",
        borderRadius: 4,
        border: "1px solid transparent",
        position: "relative",
        "&::before": {
            content: '""',
            position: "absolute",
            left: -5,
            top: 2,
            bottom: 2,
            width: 2,
            borderRadius: 1,
            backgroundColor: "var(--group-color)",
        },
        "&:hover": {
            backgroundColor: color.background.light,
        },
        "&.active": {
            backgroundColor: color.background.dark,
            border: `1px solid ${color.border.active}`,
        },
        "&:hover .tab-close, &.active .tab-close": {
            opacity: 1,
        },
        "&.dragging": {
            opacity: 0.4,
        },
        "&.drop-target": {
            borderColor: color.border.active,
        },
    },

    "& .tab-item.compact": {
        justifyContent: "center",
        padding: "0 4px",
        margin: "0 4px",
    },

    "& .tab-item.extended": {
        borderRadius: "4px 0 0 4px",
    },

    "& .tab-favicon": {
        width: 14,
        height: 14,
        flexShrink: 0,
        "& svg": {
            width: 14,
            height: 14,
            color: color.icon.default,
            "&.hidden": { display: "none" },
        },
        "& img": {
            width: 14,
            height: 14,
            display: "block",
            objectFit: "contain",
            filter: "drop-shadow(0 0 1.5px rgba(255,255,255,0.9))",
        },
    },

    "& .tab-title": {
        flex: "1 1 auto",
        fontSize: 12,
        color: color.text.default,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    "& .tab-close": {
        flexShrink: 0,
        opacity: 0,
    },

    "& .add-tab-button": {
        height: 28,
        padding: "0 4px 0 8px",
        display: "flex",
        alignItems: "center",
    },

    "& .add-tab-button.compact": {
        justifyContent: "center",
        padding: "0 4px",
    },

    "& .tab-extension": {
        display: "flex",
        alignItems: "center",
        width: 140,
        height: 28,
        boxSizing: "border-box",
        padding: "0 4px 0 6px",
        gap: 6,
        borderRadius: "0 4px 4px 0",
        border: `1px solid ${color.border.default}`,
        borderLeft: "none",
        backgroundColor: color.background.light,
        "& .tab-extension-title": {
            flex: "1 1 auto",
            fontSize: 12,
            color: color.text.default,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        "&.active": {
            backgroundColor: color.background.dark,
            border: `1px solid ${color.border.active}`,
            borderLeft: "none",
        },
    },
});

// =============================================================================
// Tab Item
// =============================================================================

interface TabItemProps {
    tab: BrowserTabData;
    model: BrowserEditorModel;
    isActive: boolean;
    compact: boolean;
    showClose: boolean;
    isHovered: boolean;
    groupColorIndex: number;
    onSwitch: (tabId: string) => void;
    onClose: (e: React.MouseEvent, tabId: string) => void;
    onToggleMute: (e: React.MouseEvent, tabId: string) => void;
    onContextMenu: (e: React.MouseEvent, tabId: string) => void;
    onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>, tabId: string) => void;
    onMouseLeave?: () => void;
}

const GROUP_COLORS = [
    "rgba(255,255,255,0.25)",
    "rgba(255,255,255,0.55)",
];

function TabItem({
    tab, model, isActive, compact, showClose, isHovered, groupColorIndex,
    onSwitch, onClose, onToggleMute, onContextMenu, onMouseEnter, onMouseLeave,
}: TabItemProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);
    const dragEnterCount = useRef(0);

    const handleDragStart = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        setTraitDragData(e.dataTransfer, TraitTypeId.BrowserTab, { tabId: tab.id });
        setIsDragging(true);
    }, [tab.id]);

    const handleDragEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        dragEnterCount.current++;
        if (hasTraitDragData(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsOver(true);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (hasTraitDragData(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        }
    }, []);

    const handleDragLeave = useCallback(() => {
        dragEnterCount.current--;
        if (dragEnterCount.current <= 0) {
            dragEnterCount.current = 0;
            setIsOver(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragEnterCount.current = 0;
        setIsOver(false);
        const payload = getTraitDragData(e.dataTransfer);
        if (!payload || payload.typeId !== TraitTypeId.BrowserTab) return;
        const data = payload.data as { tabId: string };
        model.moveTab(data.tabId, tab.id);
    }, [model, tab.id]);

    const cls = [
        "tab-item",
        isActive && "active",
        compact && "compact",
        isHovered && "extended",
        isDragging && "dragging",
        isOver && "drop-target",
    ].filter(Boolean).join(" ");

    const groupBorderColor = GROUP_COLORS[groupColorIndex % GROUP_COLORS.length];

    return (
        <div
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cls}
            style={{ "--group-color": groupBorderColor } as React.CSSProperties}
            onClick={() => onSwitch(tab.id)}
            onContextMenu={(e) => onContextMenu(e, tab.id)}
            onMouseEnter={onMouseEnter ? (e) => onMouseEnter(e, tab.id) : undefined}
            onMouseLeave={onMouseLeave}
        >
            <div className="tab-favicon">
                {tab.favicon ? (
                    <img
                        src={tab.favicon}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                            // Hide broken image, show fallback globe icon
                            (e.target as HTMLImageElement).style.display = "none";
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                        }}
                    />
                ) : null}
                <GlobeIcon className={tab.favicon ? "hidden" : ""} />
            </div>
            {!compact && (
                <div className="tab-title">
                    {tab.pageTitle || tab.url || "New Tab"}
                </div>
            )}
            {!compact && (tab.audible || tab.muted) && (
                <Button
                    type="icon"
                    size="small"
                    title={tab.muted ? "Unmute Tab" : "Mute Tab"}
                    onClick={(e) => onToggleMute(e, tab.id)}
                >
                    {tab.muted ? <VolumeMutedIcon /> : <VolumeIcon />}
                </Button>
            )}
            {showClose && (
                <div className="tab-close">
                    <Button
                        type="icon"
                        size="small"
                        title="Close Tab"
                        onClick={(e) => onClose(e, tab.id)}
                    >
                        <CloseIcon />
                    </Button>
                </div>
            )}
        </div>
    );
}

// =============================================================================
// Panel
// =============================================================================

interface BrowserTabsPanelProps {
    model: BrowserEditorModel;
    tabs: BrowserTabData[];
    activeTabId: string;
    width: number;
}

export function BrowserTabsPanel({
    model,
    tabs,
    activeTabId,
    width,
}: BrowserTabsPanelProps) {
    const compact = width < COMPACT_THRESHOLD;
    const showClose = !compact && width >= CLOSE_BUTTON_THRESHOLD;

    /** Map each tab's groupId to a sequential index (0, 1, 0, 1, ...) based on
     *  the order groups first appear in the tab list. */
    const groupColorMap = useMemo(() => {
        const map = new Map<string, number>();
        let idx = 0;
        for (const tab of tabs) {
            if (!map.has(tab.groupId)) {
                map.set(tab.groupId, idx++);
            }
        }
        return map;
    }, [tabs]);

    const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
    const hoveredTabRef = useRef<HTMLDivElement | null>(null);
    const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { refs, floatingStyles } = useFloating({
        placement: "right-start",
        middleware: [floatingOffset({ mainAxis: -1 })],
        strategy: "fixed",
        whileElementsMounted: autoUpdate,
    });

    const hoveredTab = hoveredTabId
        ? tabs.find((t) => t.id === hoveredTabId) ?? null
        : null;

    const handleTabHover = useCallback(
        (e: React.MouseEvent<HTMLDivElement>, tabId: string) => {
            if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
            }
            hoveredTabRef.current = e.currentTarget;
            refs.setReference(e.currentTarget);
            setHoveredTabId(tabId);
        },
        [refs],
    );

    const scheduleClose = useCallback(() => {
        closeTimeoutRef.current = setTimeout(() => {
            setHoveredTabId(null);
            closeTimeoutRef.current = null;
        }, 100);
    }, []);

    const cancelClose = useCallback(() => {
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
    }, []);

    const handleNewTab = useCallback(() => {
        model.addTab();
    }, [model]);

    const handleSwitchTab = useCallback(
        (tabId: string) => {
            model.switchTab(tabId);
        },
        [model],
    );

    const handleCloseTab = useCallback(
        (e: React.MouseEvent, tabId: string) => {
            e.stopPropagation();
            model.closeTab(tabId);
        },
        [model],
    );

    const handleToggleMute = useCallback(
        (e: React.MouseEvent, tabId: string) => {
            e.stopPropagation();
            model.toggleMute(tabId);
        },
        [model],
    );

    const handleExtensionClose = useCallback(
        (e: React.MouseEvent, tabId: string) => {
            e.stopPropagation();
            model.closeTab(tabId);
            setHoveredTabId(null);
        },
        [model],
    );

    const handleContextMenu = useCallback(
        (e: React.MouseEvent, tabId: string) => {
            const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "browser-tab");

            const tabIndex = tabs.findIndex((t) => t.id === tabId);
            const hasTabsBelow = tabIndex < tabs.length - 1;

            const menuItems: MenuItem[] = [
                {
                    label: "Close Tab",
                    onClick: () => model.closeTab(tabId),
                    disabled: tabs.length <= 1,
                },
                {
                    label: "Close Other Tabs",
                    onClick: () => model.closeOtherTabs(tabId),
                    disabled: tabs.length <= 1,
                },
                {
                    label: "Close Tabs Below",
                    onClick: () => model.closeTabsBelow(tabId),
                    disabled: !hasTabsBelow,
                },
            ];

            ctxEvent.items.push(...menuItems);
        },
        [model, tabs],
    );

    return (
        <BrowserTabsPanelRoot>
            <div className="tabs-list">
                {tabs.map((tab) => (
                    <TabItem
                        key={tab.id}
                        tab={tab}
                        model={model}
                        isActive={tab.id === activeTabId}
                        compact={compact}
                        showClose={showClose}
                        isHovered={tab.id === hoveredTabId}
                        groupColorIndex={groupColorMap.get(tab.groupId) ?? 0}
                        onSwitch={handleSwitchTab}
                        onClose={handleCloseTab}
                        onToggleMute={handleToggleMute}
                        onContextMenu={handleContextMenu}
                        onMouseEnter={compact ? handleTabHover : undefined}
                        onMouseLeave={compact ? scheduleClose : undefined}
                    />
                ))}
                <div className={`add-tab-button${compact ? " compact" : ""}`}>
                    <Button
                        type="icon"
                        size="small"
                        title="New Tab"
                        onClick={handleNewTab}
                    >
                        <PlusIcon />
                    </Button>
                </div>
            </div>
            {compact && hoveredTab && (
                <div
                    ref={refs.setFloating}
                    className={`tab-extension${hoveredTabId === activeTabId ? " active" : ""}`}
                    style={{ ...floatingStyles, zIndex: 1000 }}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                    onClick={() => handleSwitchTab(hoveredTabId!)}
                >
                    <span className="tab-extension-title">
                        {hoveredTab.pageTitle || hoveredTab.url || "New Tab"}
                    </span>
                    {(hoveredTab.audible || hoveredTab.muted) && (
                        <Button
                            type="icon"
                            size="small"
                            title={hoveredTab.muted ? "Unmute Tab" : "Mute Tab"}
                            onClick={(e) => handleToggleMute(e, hoveredTabId!)}
                        >
                            {hoveredTab.muted ? <VolumeMutedIcon /> : <VolumeIcon />}
                        </Button>
                    )}
                    <Button
                        type="icon"
                        size="small"
                        title="Close Tab"
                        onClick={(e) => handleExtensionClose(e, hoveredTabId!)}
                    >
                        <CloseIcon />
                    </Button>
                </div>
            )}
        </BrowserTabsPanelRoot>
    );
}
