import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, height, spacing } from "../tokens";
import { Popover, PopoverPosition } from "../Popover/Popover";
import { Input } from "../Input/Input";
import { ChevronRightIcon, CheckIcon } from "../../theme/icons";
import type { MenuItem } from "./types";

// Rule 3 (Traited<T[]>) is intentionally NOT applied to Menu. MenuItem is the
// canonical shape — there is no "native item shape" to convert from. All
// consumers (script API via ContextMenuEvent.items, app code, sub-menus) build
// MenuItem[] directly. Adding Traited<MenuItem[]> would be unused complexity.

export interface MenuProps extends PopoverPosition {
    items: MenuItem[];
    open: boolean;
    /** Called after the user clicks a leaf item OR after Escape / click-outside.
     *  itemClicked=true when a leaf item was activated (so callers can cascade close). */
    onClose: (itemClicked: boolean) => void;
}

const SEARCH_THRESHOLD = 20;
const ROW_HEIGHT = 26;
const SUB_MENU_DELAY_MS = 400;
const MAX_HEIGHT = 500;

const ListRoot = styled.div(
    {
        minWidth: 140,
        maxWidth: 800,
        padding: `${spacing.xs}px 0`,
        display: "flex",
        flexDirection: "column",
        outline: "none",
        flex: "1 1 auto",
        minHeight: 0,
        overflow: "auto",
    },
    { label: "MenuList" },
);

const SearchWrap = styled.div(
    {
        padding: `${spacing.xs}px ${spacing.sm}px ${spacing.sm}px ${spacing.sm}px`,
        flexShrink: 0,
    },
    { label: "MenuSearchWrap" },
);

const RowRoot = styled.div(
    {
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        padding: `0 ${spacing.md}px`,
        cursor: "pointer",
        userSelect: "none",
        fontSize: fontSize.base,
        color: color.text.default,
        flexShrink: 0,

        "&[data-hovered]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
            "& [data-part='hotkey']": { color: "inherit" },
            "& [data-part='submenu-chevron']": { color: "inherit" },
            "& [data-part='selected-check']": { color: "inherit" },
        },
        "&[data-disabled]": {
            color: color.text.light,
            cursor: "default",
            "& svg": { color: color.icon.disabled },
            "&[data-hovered]": {
                backgroundColor: "transparent",
                color: color.text.light,
            },
        },
        "&[data-start-group]": {
            borderTop: `1px solid ${color.border.default}`,
            marginTop: spacing.xs,
        },
        "&[data-minor]:not([data-hovered])": {
            "& [data-part='label']": { color: color.text.light },
            "& [data-part='hotkey']": { opacity: 0.6 },
        },
    },
    { label: "MenuRow" },
);

const IconSlot = styled.span(
    {
        width: height.iconMd,
        height: height.iconMd,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        "& svg": { width: height.iconMd, height: height.iconMd },
    },
    { label: "MenuIconSlot" },
);

const Label = styled.span(
    {
        flex: "1 1 auto",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    { label: "MenuLabel" },
);

const Hotkey = styled.span(
    {
        marginLeft: spacing.xl,
        color: color.text.light,
        fontSize: fontSize.sm,
        flexShrink: 0,
    },
    { label: "MenuHotkey" },
);

const SubMenuChevron = styled.span(
    {
        flexShrink: 0,
        marginLeft: spacing.sm,
        color: color.text.light,
        display: "inline-flex",
        alignItems: "center",
        "& svg": { width: height.iconSm, height: height.iconSm },
    },
    { label: "MenuSubMenuChevron" },
);

const SelectedCheck = styled.span(
    {
        flexShrink: 0,
        marginLeft: spacing.sm,
        color: color.text.light,
        display: "inline-flex",
        alignItems: "center",
        "& svg": { width: height.iconMd, height: height.iconMd },
    },
    { label: "MenuSelectedCheck" },
);

function idOf(item: MenuItem, index: number): string {
    return item.id ?? `${index}:${item.label}`;
}

interface PreparedItem {
    item: MenuItem;
    id: string;
    startGroup: boolean;
}

export function Menu({ items, open, onClose, ...positionProps }: MenuProps) {
    const [search, setSearch] = useState("");
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [subMenuItem, setSubMenuItem] = useState<MenuItem | null>(null);
    const [subMenuAnchor, setSubMenuAnchor] = useState<Element | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const subTimerRef = useRef<number | null>(null);

    const showSearch = items.length > SEARCH_THRESHOLD;
    const hasAnyIcon = useMemo(() => items.some((i) => Boolean(i.icon)), [items]);

    // Filter + group-fixup (legacy parity: when an invisible item carried startGroup,
    // transfer it to the next visible sibling).
    const prepared = useMemo<PreparedItem[]>(() => {
        const q = search.toLocaleLowerCase();
        const out: PreparedItem[] = [];
        let pendingStartGroup = false;
        items.forEach((item, idx) => {
            if (item.invisible) {
                if (item.startGroup) pendingStartGroup = true;
                return;
            }
            const matchesSearch = !showSearch || !q || item.label.toLocaleLowerCase().includes(q);
            if (!matchesSearch) {
                if (item.startGroup) pendingStartGroup = true;
                return;
            }
            out.push({
                item,
                id: idOf(item, idx),
                startGroup: (item.startGroup || pendingStartGroup) && out.length > 0,
            });
            pendingStartGroup = false;
        });
        return out;
    }, [items, search, showSearch]);

    const clearSubTimer = () => {
        if (subTimerRef.current !== null) {
            window.clearTimeout(subTimerRef.current);
            subTimerRef.current = null;
        }
    };

    const scheduleSubMenu = (item: MenuItem, anchor: Element) => {
        clearSubTimer();
        if (!item.items?.length) return;
        subTimerRef.current = window.setTimeout(() => {
            subTimerRef.current = null;
            setSubMenuItem(item);
            setSubMenuAnchor(anchor);
        }, SUB_MENU_DELAY_MS);
    };

    // Reset state on open transition + initialize hovered to selected item.
    useEffect(() => {
        if (!open) {
            setSearch("");
            setHoveredId(null);
            setSubMenuItem(null);
            setSubMenuAnchor(null);
            clearSubTimer();
            return;
        }
        const initial = items.find((i) => i.selected && !i.invisible);
        if (initial) {
            setHoveredId(idOf(initial, items.indexOf(initial)));
        }
    }, [open, items]);

    // Clear timer on unmount.
    useEffect(() => clearSubTimer, []);

    // Auto-focus the appropriate element on open so keyboard nav / typing work.
    // Without this, the portaled input doesn't reliably take focus via React's
    // `autoFocus` attribute and the user gets a focus-within wrapper but no
    // active input to type into.
    useEffect(() => {
        if (!open) return;
        if (showSearch) searchInputRef.current?.focus();
        else listRef.current?.focus();
    }, [open, showSearch]);

    // Scroll the hovered row into view when hoveredId changes via keyboard.
    useEffect(() => {
        if (!hoveredId || !listRef.current) return;
        const el = listRef.current.querySelector(
            `[data-type="menu-row"][data-id="${CSS.escape(hoveredId)}"]`,
        ) as HTMLElement | null;
        el?.scrollIntoView({ block: "nearest" });
    }, [hoveredId]);

    const activate = (item: MenuItem, anchor: Element) => {
        if (item.disabled) return;
        if (item.items?.length) {
            // Click-to-open sub-menu (no delay).
            clearSubTimer();
            setSubMenuItem(item);
            setSubMenuAnchor(anchor);
            return;
        }
        item.onClick?.();
        onClose(true);
    };

    const onSubMenuClose = (itemClicked: boolean) => {
        clearSubTimer();
        setSubMenuItem(null);
        setSubMenuAnchor(null);
        if (itemClicked) onClose(true);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const idx = prepared.findIndex((p) => p.id === hoveredId);
        const visibleRows = Math.max(
            1,
            Math.floor((listRef.current?.clientHeight ?? MAX_HEIGHT) / ROW_HEIGHT),
        );
        const move = (n: number) => {
            if (prepared.length === 0) return;
            const start = idx >= 0 ? idx : -1;
            const next = Math.max(0, Math.min(prepared.length - 1, start + n));
            setHoveredId(prepared[next].id);
        };
        if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
        } else if (e.key === "PageDown") {
            e.preventDefault();
            move(visibleRows);
        } else if (e.key === "PageUp") {
            e.preventDefault();
            move(-visibleRows);
        } else if (e.key === "Enter") {
            const target = idx >= 0 ? prepared[idx].item : prepared.length === 1 ? prepared[0].item : null;
            if (target && !target.disabled) {
                e.preventDefault();
                // For Enter we have no row anchor — fall back to list root for sub-menu placement.
                activate(target, listRef.current ?? document.body);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose(false);
        }
    };

    return (
        <>
            <Popover
                {...positionProps}
                open={open}
                onClose={() => onClose(false)}
                onKeyDown={showSearch ? undefined : onKeyDown}
                outsideClickIgnoreSelector='[data-type="menu"]'
                maxHeight={MAX_HEIGHT}
                scroll={false}
                data-type="menu"
            >
                {showSearch && (
                    <SearchWrap>
                        <Input
                            ref={searchInputRef}
                            value={search}
                            onChange={setSearch}
                            placeholder="Search..."
                            onKeyDown={onKeyDown}
                        />
                    </SearchWrap>
                )}
                <ListRoot ref={listRef} tabIndex={-1} className="scroll-container">
                    {prepared.map(({ item, id, startGroup }) => {
                        const isHovered = hoveredId === id;
                        const isSubAnchor = subMenuItem !== null && subMenuItem === item;
                        return (
                            <RowRoot
                                key={id}
                                data-type="menu-row"
                                data-id={id}
                                data-hovered={isHovered || isSubAnchor || undefined}
                                data-disabled={item.disabled || undefined}
                                data-start-group={startGroup || undefined}
                                data-minor={item.minor || undefined}
                                onMouseEnter={(e) => {
                                    if (item.disabled) return;
                                    setHoveredId(id);
                                    if (subMenuItem !== item) {
                                        setSubMenuItem(null);
                                        setSubMenuAnchor(null);
                                    }
                                    scheduleSubMenu(item, e.currentTarget);
                                }}
                                onMouseLeave={clearSubTimer}
                                onClick={(e) => activate(item, e.currentTarget)}
                            >
                                {hasAnyIcon && <IconSlot data-part="icon">{item.icon ?? null}</IconSlot>}
                                <Label data-part="label">{item.label}</Label>
                                {item.hotKey && <Hotkey data-part="hotkey">{item.hotKey}</Hotkey>}
                                {item.selected && !item.items?.length ? (
                                    <SelectedCheck data-part="selected-check">
                                        <CheckIcon />
                                    </SelectedCheck>
                                ) : null}
                                {item.items?.length ? (
                                    <SubMenuChevron data-part="submenu-chevron">
                                        <ChevronRightIcon />
                                    </SubMenuChevron>
                                ) : null}
                            </RowRoot>
                        );
                    })}
                </ListRoot>
            </Popover>
            {subMenuItem && subMenuAnchor && (
                <Menu
                    items={subMenuItem.items ?? []}
                    open
                    elementRef={subMenuAnchor}
                    placement="right-start"
                    offset={[0, 2]}
                    onClose={onSubMenuClose}
                />
            )}
        </>
    );
}
