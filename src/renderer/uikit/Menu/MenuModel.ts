import React from "react";
import { TComponentModel } from "../../core/state/model";
import { PopoverPosition } from "../Popover/Popover";
import type { MenuItem } from "./types";

// =============================================================================
// Constants
// =============================================================================

export const SEARCH_THRESHOLD = 20;
export const ROW_HEIGHT = 26;
export const SUB_MENU_DELAY_MS = 400;
export const MAX_HEIGHT = 500;

// =============================================================================
// Props
// =============================================================================

export interface MenuProps extends PopoverPosition {
    items: MenuItem[];
    open: boolean;
    /** Called after the user clicks a leaf item OR after Escape / click-outside.
     *  itemClicked=true when a leaf item was activated (so callers can cascade close). */
    onClose: (itemClicked: boolean) => void;
}

// =============================================================================
// Derived row record
// =============================================================================

export interface PreparedItem {
    item: MenuItem;
    id: string;
    startGroup: boolean;
}

function idOf(item: MenuItem, index: number): string {
    return item.id ?? `${index}:${item.label}`;
}

// =============================================================================
// State
// =============================================================================

export interface MenuState {
    search: string;
    hoveredId: string | null;
    subMenuItem: MenuItem | null;
    subMenuAnchor: Element | null;
}

export const defaultMenuState: MenuState = {
    search: "",
    hoveredId: null,
    subMenuItem: null,
    subMenuAnchor: null,
};

// =============================================================================
// Model
// =============================================================================

export class MenuModel extends TComponentModel<MenuState, MenuProps> {
    // --- refs (DOM) ---
    listRef: HTMLDivElement | null = null;
    searchInputRef: HTMLInputElement | null = null;

    setListRef = (el: HTMLDivElement | null) => {
        this.listRef = el;
    };
    setSearchInputRef = (el: HTMLInputElement | null) => {
        this.searchInputRef = el;
    };

    // --- internal timer (not state — flipping it must not re-render) ---
    private subTimerId: number | null = null;

    // --- computed ---

    get showSearch(): boolean {
        return this.props.items.length > SEARCH_THRESHOLD;
    }

    hasAnyIcon = this.memo<boolean>(
        () => this.props.items.some((i) => Boolean(i.icon)),
        () => [this.props.items],
    );

    /** Filter + group-fixup (legacy parity: when an invisible item carried startGroup,
     *  transfer it to the next visible sibling). */
    prepared = this.memo<PreparedItem[]>(
        () => {
            const items = this.props.items;
            const search = this.state.get().search;
            const showSearch = this.showSearch;
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
        },
        () => [this.props.items, this.state.get().search],
    );

    // --- timer helpers ---

    private clearSubTimer = () => {
        if (this.subTimerId !== null) {
            window.clearTimeout(this.subTimerId);
            this.subTimerId = null;
        }
    };

    private scheduleSubMenu = (item: MenuItem, anchor: Element) => {
        this.clearSubTimer();
        if (!item.items?.length) return;
        this.subTimerId = window.setTimeout(() => {
            this.subTimerId = null;
            this.state.update((s) => {
                s.subMenuItem = item;
                s.subMenuAnchor = anchor;
            });
        }, SUB_MENU_DELAY_MS);
    };

    // --- handlers ---

    private activate = (item: MenuItem, anchor: Element) => {
        if (item.disabled) return;
        if (item.items?.length) {
            // Click-to-open sub-menu (no delay).
            this.clearSubTimer();
            this.state.update((s) => {
                s.subMenuItem = item;
                s.subMenuAnchor = anchor;
            });
            return;
        }
        item.onClick?.();
        this.props.onClose(true);
    };

    onSubMenuClose = (itemClicked: boolean) => {
        this.clearSubTimer();
        this.state.update((s) => {
            s.subMenuItem = null;
            s.subMenuAnchor = null;
        });
        if (itemClicked) this.props.onClose(true);
    };

    onSearchChange = (v: string) => {
        this.state.update((s) => {
            s.search = v;
        });
    };

    onPopoverClose = () => {
        this.props.onClose(false);
    };

    onRowMouseEnter = (e: React.MouseEvent<HTMLDivElement>, id: string, item: MenuItem) => {
        if (item.disabled) return;
        const anchor = e.currentTarget;
        this.state.update((s) => {
            s.hoveredId = id;
            if (s.subMenuItem !== item) {
                s.subMenuItem = null;
                s.subMenuAnchor = null;
            }
        });
        this.scheduleSubMenu(item, anchor);
    };

    onRowMouseLeave = () => {
        this.clearSubTimer();
    };

    onRowClick = (e: React.MouseEvent<HTMLDivElement>, item: MenuItem) => {
        this.activate(item, e.currentTarget);
    };

    onKeyDown = (e: React.KeyboardEvent) => {
        const prepared = this.prepared.value;
        const hoveredId = this.state.get().hoveredId;
        const idx = prepared.findIndex((p) => p.id === hoveredId);
        const visibleRows = Math.max(
            1,
            Math.floor((this.listRef?.clientHeight ?? MAX_HEIGHT) / ROW_HEIGHT),
        );
        const move = (n: number) => {
            if (prepared.length === 0) return;
            const start = idx >= 0 ? idx : -1;
            const next = Math.max(0, Math.min(prepared.length - 1, start + n));
            this.state.update((s) => {
                s.hoveredId = prepared[next].id;
            });
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
            const target = idx >= 0
                ? prepared[idx].item
                : prepared.length === 1
                    ? prepared[0].item
                    : null;
            if (target && !target.disabled) {
                e.preventDefault();
                // For Enter we have no row anchor — fall back to list root for sub-menu placement.
                this.activate(target, this.listRef ?? document.body);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            this.props.onClose(false);
        }
    };

    // --- lifecycle ---

    init() {
        // Reset state on open transition + initialize hovered to selected item.
        this.effect(
            () => {
                if (!this.props.open) {
                    this.state.update((s) => {
                        s.search = "";
                        s.hoveredId = null;
                        s.subMenuItem = null;
                        s.subMenuAnchor = null;
                    });
                    this.clearSubTimer();
                    return;
                }
                const items = this.props.items;
                const initial = items.find((i) => i.selected && !i.invisible);
                if (initial) {
                    this.state.update((s) => {
                        s.hoveredId = idOf(initial, items.indexOf(initial));
                    });
                }
            },
            () => [this.props.open, this.props.items],
        );

        // Auto-focus the appropriate element on open so keyboard nav / typing work.
        // Deferred via queueMicrotask: model effects run inside setPropsInternal during
        // the render phase — at that point the conditionally-mounted search input ref
        // is still null. The microtask runs after React commits and ref callbacks fire.
        this.effect(
            () => {
                if (!this.props.open) return;
                queueMicrotask(() => {
                    if (!this.isLive || !this.props.open) return;
                    if (this.showSearch) this.searchInputRef?.focus();
                    else this.listRef?.focus();
                });
            },
            () => [this.props.open, this.showSearch],
        );

        // Scroll the hovered row into view when hoveredId changes (via keyboard or
        // initial selection on open). Deferred via queueMicrotask so the listRef is
        // attached after first-open commit before we query DOM.
        this.effect(
            () => {
                const hoveredId = this.state.get().hoveredId;
                if (!hoveredId) return;
                queueMicrotask(() => {
                    if (!this.isLive || !this.listRef) return;
                    const el = this.listRef.querySelector(
                        `[data-type="menu-row"][data-id="${CSS.escape(hoveredId)}"]`,
                    ) as HTMLElement | null;
                    el?.scrollIntoView({ block: "nearest" });
                });
            },
            () => [this.state.get().hoveredId],
        );
    }

    dispose() {
        this.clearSubTimer();
    }
}
