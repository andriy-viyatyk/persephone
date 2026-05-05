# US-481: UIKit Menu + WithMenu

## Goal

Add two new UIKit primitives in `src/renderer/uikit/Menu/`:

1. **`Menu`** — the popup menu list itself. Renders inside a `Popover`; supports nested sub-menus, search auto-shown when items > 20, keyboard navigation (Arrow/PgUp/PgDn/Enter/Esc), icons, hotkey hints, group separators, disabled / minor variants.
2. **`WithMenu`** — declarative render-prop wrapper around `Menu`: `<WithMenu items={…}>{(setOpen) => trigger}</WithMenu>`. Manages open state, anchor element, portal rendering, and focus restore. Drop-in shape-compatible replacement for `WithPopupMenu`.

After this task, screens that need a click-to-open popup menu can use `WithMenu` from UIKit instead of `WithPopupMenu` from `components/overlay/`. The legacy stack (`PopupMenu`, `WithPopupMenu`, `Popper`, `showAppPopupMenu`) **stays in place and is unchanged** — coexistence during migration. The imperative `showMenu(x, y, items)` and the refactor of `showAppPopupMenu` are deferred to a separate task (planned: **US-482**).

## Background

### Why now

US-478 (PageTabs migration) needs UIKit-only menu primitives so that PageTabs can drop its `components/overlay/WithPopupMenu` import. US-481 is the smallest UIKit addition that unblocks US-478. Future tasks can extend it.

### Legacy stack (unchanged by this task — for reference)

- `src/renderer/components/overlay/Popper.tsx` — base portaled floating element with click-outside, flip, resize.
- `src/renderer/components/overlay/PopupMenu.tsx` — the menu list: items, sub-menus, search auto-shown when items > 20, hotkeys, icons, separators, keyboard nav. Built on `<List>` virtualization.
- `src/renderer/components/overlay/WithPopupMenu.tsx` — render-prop wrapper: `<WithPopupMenu items={…}>{(setOpen) => trigger}</WithPopupMenu>`.
- `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` — `showAppPopupMenu(x, y, items, options?)` — adds Paste/Copy/Inspect defaults; hooked into the global `Poppers` system.
- `src/renderer/api/types/events.d.ts` — canonical `MenuItem` interface (also re-exported by `PopupMenu.tsx`); used by the script API via `ContextMenuEvent.items.push(...)`.

**30 files** import legacy menu primitives — none change in this task. Migration of consumers is in **US-483** (planned sweep) and **US-482** (showAppPopupMenu refactor). PageTabs (US-478) is the first consumer to migrate.

### UIKit primitives we compose

- `Popover` (`src/renderer/uikit/Popover/Popover.tsx`) — already does positioning (anchor element OR `(x, y)` virtual element), click-outside via `outsideClickIgnoreSelector`, Escape, flip, viewport-aware max-height, auto-update. Spread `PopoverPosition` directly into `Menu`.
- `Input` (`src/renderer/uikit/Input/Input.tsx`) — search input when items > 20.
- Internal styled `<div>`s for the row, icon slot, label, hotkey, sub-menu chevron — local Emotion is fine inside UIKit (Rule 7 applies to *consumers* of UIKit, not UIKit itself).

### Type unification

The UIKit `Menu` re-exports `MenuItem` from `src/renderer/api/types/events.d.ts` — the same interface the script API exposes. Single canonical shape. The legacy `MenuItem` re-export from `components/overlay/PopupMenu.tsx` is **not** removed in this task; it stays so the 30 legacy consumers still compile.

```ts
// uikit/Menu/types.ts
export type { MenuItem } from "../../api/types/events";
```

The shape (label, onClick, disabled, icon, invisible, startGroup, hotKey, selected, id, items, minor) is preserved verbatim. **The Traited pattern (Rule 3) is NOT applied here** — `MenuItem` is already the canonical shape; consumers build the array directly. See Concern #4.

### What the new primitives look like

```tsx
// uikit/Menu/Menu.tsx
export interface MenuProps extends PopoverPosition {
    items: MenuItem[];
    open: boolean;
    /** Called after the user clicks an item OR after Escape / click-outside. itemClicked=true if a leaf item was selected. */
    onClose: (itemClicked: boolean) => void;
}
export function Menu(props: MenuProps): JSX.Element | null;

// uikit/Menu/WithMenu.tsx
export interface WithMenuProps {
    items: MenuItem[];
    placement?: Placement;          // default: "bottom-start"
    offset?: [number, number];      // default: [-4, 4]  (matches legacy WithPopupMenu)
    children: (setOpen: (anchor: Element | null) => void) => React.ReactElement;
}
export function WithMenu(props: WithMenuProps): JSX.Element;
```

### Behavior parity with legacy `PopupMenu` (must-have)

| Behavior | Source of truth in legacy | New implementation |
|----------|--------------------------|---------------------|
| Min/max width | `PopupMenu.tsx` calcWidth (manual `maxLength * 8 + 32 + iconPad + hotkeyPad`) | CSS: `min-width: 140px; max-width: 800px; width: max-content;` (no JS calc) |
| Item height | 26px | `height: 26px` |
| Max menu height | 500px | `maxHeight={500}` on Popover, viewport caps further |
| Search field shown | `options.length > 20` | `items.length > 20` (hardcoded threshold per user direction) |
| Search field auto-focus | `autoFocus` on TextField | `autoFocus` on Input |
| Search filter | case-insensitive `label.toLocaleLowerCase().includes(q)` | identical |
| Keyboard — ArrowUp/Down | hover prev/next visible item, scroll into view | identical |
| Keyboard — PageUp/Down | hover by `visibleRowCount` | hover by `Math.floor(visibleHeight / 26)` |
| Keyboard — Enter | activate hovered item; if only 1 match, activate it | identical |
| Keyboard — Escape | close menu | identical (delegated to Popover) |
| Sub-menu open trigger | hover for 400ms on item with `items?.length > 0` | identical |
| Sub-menu close | hovering a different item / clicking outside / ESC on submenu | identical |
| Sub-menu placement | `right-start` (legacy `anchorType="horizontal"`) | `right-start`, flips to `left-start` on edge |
| Sub-menu click cascade | click sub-item → close all menus | identical |
| Initially highlighted | `item.selected === true` → set as initial hovered | identical |
| Initial scroll | scroll selected item to center | scroll into view (`block: "nearest"`) |
| Group separator | `startGroup === true` → 1px top border | identical (`data-start-group` attribute) |
| Disabled items | `disabled === true` → cannot click, dimmed text/icon | identical (`data-disabled` attribute) |
| Invisible items | `invisible === true` → not rendered | identical, **and** when an invisible item has `startGroup`, that startGroup transfers to the next visible sibling (legacy `prepareItems` logic) |
| Minor items | `minor === true` → dim label and hotkey color when not hovered | identical |
| Empty icon padding | items without `icon` get the same left-pad as items with icons (so labels align) | always render an icon slot of fixed width; the slot is empty if `icon` is undefined |
| Click-outside / Escape close | identical to Popover's existing handling | use Popover's behavior; sub-menus use `outsideClickIgnoreSelector='[data-type="menu"]'` |
| Focus restore | save `document.activeElement` before open; restore on close | implemented in `WithMenu` (Menu itself doesn't manage trigger focus) |
| `anchorType="horizontal"` legacy flag | switches base placement to `right-start` | not exposed on `Menu`; pass `placement="right-start"` directly |

### Behaviors NOT in scope (deferred)

- Async/function-form `items` (`ComponentOptions<T>` accepted by legacy `PopupMenu`) — no current consumer uses it. Out of scope.
- Virtualized rendering — overflow-y: auto handles ~100 items fine.
- ArrowRight / ArrowLeft to enter/exit sub-menu via keyboard — legacy menu does NOT support this either; mouse-only sub-menu navigation stays the same.
- Right-to-left layout — out of scope.
- Default Paste/Copy/Inspect items — those live in `ui/dialogs/poppers/showPopupMenu.tsx` and stay there. Task **US-482** will refactor that file to compose UIKit `showMenu` while keeping the app-specific defaults.
- Imperative `showMenu(x, y, items, options?)` — Task **US-482**.
- Migration of any consumer except via Task US-478 (PageTabs) and Task US-482 (showAppPopupMenu) — Task **US-483** (sweep) handles the rest.
- Removal of legacy `PopupMenu.tsx` / `WithPopupMenu.tsx` / `Popper.tsx` from `components/overlay/` — Task **US-483**.

## Implementation plan

### Step 1 — Folder + types

Create `src/renderer/uikit/Menu/` with:

```
uikit/Menu/
  types.ts          ← re-exports MenuItem from api/types/events.d.ts
  Menu.tsx          ← the menu list component (composes Popover)
  WithMenu.tsx      ← render-prop wrapper around Menu
  Menu.story.tsx    ← Storybook entry (covers both Menu and WithMenu)
  index.ts          ← public exports
```

#### `uikit/Menu/types.ts`

```ts
// Single source of truth for the MenuItem shape — the script API uses this
// type via ContextMenuEvent.items, and UIKit re-exports it so consumers can
// import MenuItem from "uikit" instead of "api/types/events".
export type { MenuItem } from "../../api/types/events";
```

### Step 2 — `uikit/Menu/Menu.tsx`

Component responsibilities:
- Renders a `Popover` with the standard UIKit overlay chrome.
- Inside the Popover: optional search input (when `items.length > 20`) followed by a scrollable list of menu rows.
- Each row: icon slot (fixed width, may be empty), label, hotkey hint (right-aligned, conditional), sub-menu chevron (when `item.items?.length`).
- Keyboard handler attached to the Popover's `onKeyDown` (Popover already forwards `keydown`; we add it to the root element).
- Local state: `hoveredItem`, `searchValue`, `subMenuItem`, `subMenuAnchor`.
- Sub-menu rendering: when `subMenuItem` is set, render a child `<Menu items={subMenuItem.items!} elementRef={subMenuAnchor} placement="right-start" open onClose={onSubMenuClose} />` as a sibling to the Popover's children list. The child Menu portals via its own Popover, so its DOM lives at `document.body` — clicks on it must be ignored by the parent's click-outside, achieved by the parent passing `outsideClickIgnoreSelector='[data-type="menu"]'` to its Popover.

#### Skeleton (for the implementer to flesh out)

```tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, height, radius, spacing } from "../tokens";
import { Popover, PopoverPosition } from "../Popover/Popover";
import { Input } from "../Input/Input";
import { ChevronRightIcon } from "../../theme/icons";
import type { MenuItem } from "./types";

export interface MenuProps extends PopoverPosition {
    items: MenuItem[];
    open: boolean;
    onClose: (itemClicked: boolean) => void;
}

const SEARCH_THRESHOLD = 20;
const ROW_HEIGHT = 26;
const SUB_MENU_DELAY_MS = 400;
const MAX_HEIGHT = 500;

// --- Styled ---

const ListRoot = styled.div(
    {
        minWidth: 140,
        maxWidth: 800,
        padding: `${spacing.xs}px 0`,
        display: "flex",
        flexDirection: "column",
        outline: "none",
    },
    { label: "MenuList" },
);

const SearchWrap = styled.div(
    { padding: `0 ${spacing.sm}px ${spacing.sm}px ${spacing.sm}px` },
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

        "&[data-hovered]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
            "& [data-part='hotkey']": { color: "inherit" },
            "& [data-part='submenu-chevron']": { color: "inherit" },
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
            paddingTop: 0,
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

// --- Component ---

export function Menu({ items, open, onClose, ...positionProps }: MenuProps) {
    const [search, setSearch] = useState("");
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [subMenuItem, setSubMenuItem] = useState<MenuItem | null>(null);
    const [subMenuAnchor, setSubMenuAnchor] = useState<Element | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const subTimerRef = useRef<number | null>(null);

    // 1. Filter + group-fixup pass (matches legacy prepareItems)
    const visibleItems = useMemo(() => {
        const showSearch = items.length > SEARCH_THRESHOLD;
        const q = search.toLocaleLowerCase();
        const matched = items.filter((i) => {
            if (i.invisible) return false;
            if (!showSearch || !q) return true;
            return i.label.toLocaleLowerCase().includes(q);
        });
        // If a hidden item carried startGroup, transfer it to the next visible sibling (legacy parity).
        const fixed: MenuItem[] = [];
        for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            if (matched.indexOf(it) === -1) continue;
            if (it.startGroup) {
                fixed.push(it);
            } else if (idx > 0 && items[idx - 1].invisible && items[idx - 1].startGroup) {
                fixed.push({ ...it, startGroup: true });
            } else {
                fixed.push(it);
            }
        }
        return fixed;
    }, [items, search]);

    // 2. Initial hover (selected) + reset on open change
    useEffect(() => {
        if (!open) {
            setSearch("");
            setHoveredId(null);
            setSubMenuItem(null);
            setSubMenuAnchor(null);
            return;
        }
        const initial = items.find((i) => i.selected && !i.invisible);
        if (initial) {
            setHoveredId(idOf(initial, items.indexOf(initial)));
        }
    }, [open, items]);

    // 3. Auto-focus the list root if no search shown
    const showSearch = items.length > SEARCH_THRESHOLD;
    useEffect(() => {
        if (open && !showSearch) listRef.current?.focus();
    }, [open, showSearch]);

    // 4. Sub-menu open delay
    const scheduleSubMenu = (item: MenuItem, anchor: Element) => {
        clearSubTimer();
        if (!item.items?.length) return;
        subTimerRef.current = window.setTimeout(() => {
            setSubMenuItem(item);
            setSubMenuAnchor(anchor);
        }, SUB_MENU_DELAY_MS);
    };
    const clearSubTimer = () => {
        if (subTimerRef.current !== null) {
            window.clearTimeout(subTimerRef.current);
            subTimerRef.current = null;
        }
    };
    useEffect(() => clearSubTimer, []);

    // 5. Keyboard navigation
    const onKeyDown = (e: React.KeyboardEvent) => {
        const idx = visibleItems.findIndex((i, ix) => idOf(i, ix) === hoveredId);
        const visibleRows = Math.max(1, Math.floor((listRef.current?.clientHeight ?? MAX_HEIGHT) / ROW_HEIGHT));
        const move = (n: number) => {
            const next = Math.max(0, Math.min(visibleItems.length - 1, idx + n));
            setHoveredId(idOf(visibleItems[next], next));
            // scroll into view
            const el = listRef.current?.querySelectorAll('[data-type="menu-row"]')[next] as HTMLElement | undefined;
            el?.scrollIntoView({ block: "nearest" });
        };
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp")   { e.preventDefault(); move(-1); }
        else if (e.key === "PageDown")  { e.preventDefault(); move(visibleRows); }
        else if (e.key === "PageUp")    { e.preventDefault(); move(-visibleRows); }
        else if (e.key === "Enter") {
            e.preventDefault();
            const target = idx >= 0 ? visibleItems[idx] : (visibleItems.length === 1 ? visibleItems[0] : null);
            if (target && !target.disabled) activate(target);
        }
        else if (e.key === "Escape") { e.preventDefault(); onClose(false); }
    };

    // 6. Activate (click or Enter)
    const activate = (item: MenuItem, anchor?: Element) => {
        if (item.disabled) return;
        if (item.items?.length) {
            // Click-to-open sub-menu (no delay)
            clearSubTimer();
            setSubMenuItem(item);
            setSubMenuAnchor(anchor ?? null);
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

    // 7. Render
    return (
        <>
            <Popover
                open={open}
                onClose={() => onClose(false)}
                onKeyDown={onKeyDown}
                outsideClickIgnoreSelector='[data-type="menu"]'
                maxHeight={MAX_HEIGHT}
                {...positionProps}
                data-type="menu"
            >
                <ListRoot ref={listRef} tabIndex={-1}>
                    {showSearch && (
                        <SearchWrap>
                            <Input
                                value={search}
                                onChange={setSearch}
                                placeholder="Search..."
                                autoFocus
                                onKeyDown={onKeyDown}
                            />
                        </SearchWrap>
                    )}
                    {visibleItems.map((item, ix) => {
                        const id = idOf(item, ix);
                        const isHovered = hoveredId === id;
                        const isSubAnchor = subMenuItem && idOf(subMenuItem, items.indexOf(subMenuItem)) === id;
                        return (
                            <RowRoot
                                key={id}
                                data-type="menu-row"
                                data-hovered={isHovered || isSubAnchor || undefined}
                                data-disabled={item.disabled || undefined}
                                data-start-group={(item.startGroup && ix > 0) || undefined}
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
                                <IconSlot data-part="icon">{item.icon ?? null}</IconSlot>
                                <Label data-part="label">{item.label}</Label>
                                {item.hotKey && <Hotkey data-part="hotkey">{item.hotKey}</Hotkey>}
                                {item.items?.length ? <SubMenuChevron data-part="submenu-chevron"><ChevronRightIcon /></SubMenuChevron> : null}
                            </RowRoot>
                        );
                    })}
                </ListRoot>
            </Popover>
            {subMenuItem && subMenuAnchor && (
                <Menu
                    items={subMenuItem.items!}
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

function idOf(item: MenuItem, index: number): string {
    return item.id ?? `${index}:${item.label}`;
}
```

Notes for the implementer:
- The sub-menu indicator uses `ChevronRightIcon` from `theme/icons.tsx` (per Concern #7 resolution — render a chevron for discoverability). The chevron is rendered AFTER any hotkey hint at the right edge of rows whose `item.items?.length > 0`.
- Item `id` for React keys: prefer `item.id` if provided; else `${index}:${label}` fallback. Never use `index` alone (filter changes break keys).
- `data-hovered` is set when EITHER the row is keyboard/mouse hovered OR it is the anchor for an open sub-menu (so the parent row stays highlighted while the sub-menu is open).
- Empty icon: always render an empty `IconSlot` with fixed width to keep label alignment (replaces the legacy "anyIcon ? add EmptyIcon" pattern that mutated items).

### Step 3 — `uikit/Menu/WithMenu.tsx`

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Placement } from "@floating-ui/react";
import { Menu } from "./Menu";
import type { MenuItem } from "./types";

export interface WithMenuProps {
    items: MenuItem[];
    placement?: Placement;
    /** [skidding, distance] — matches legacy WithPopupMenu default of [-4, 4]. */
    offset?: [number, number];
    children: (setOpen: (anchor: Element | null) => void) => React.ReactElement;
}

const DEFAULT_OFFSET: [number, number] = [-4, 4];

export function WithMenu({ items, placement = "bottom-start", offset = DEFAULT_OFFSET, children }: WithMenuProps) {
    const [anchor, setAnchor] = useState<Element | null>(null);
    const previousFocusRef = useRef<Element | null>(null);

    const setOpen = useCallback((target: Element | null) => {
        if (target) {
            previousFocusRef.current = document.activeElement;
        }
        setAnchor(target);
    }, []);

    const handleClose = useCallback((_itemClicked: boolean) => {
        setAnchor(null);
        if (previousFocusRef.current instanceof HTMLElement) {
            previousFocusRef.current.focus();
        }
        previousFocusRef.current = null;
    }, []);

    return (
        <>
            {children(setOpen)}
            <Menu
                items={items}
                open={Boolean(anchor)}
                elementRef={anchor}
                placement={placement}
                offset={offset}
                onClose={handleClose}
            />
        </>
    );
}
```

Note: `Menu` itself returns `null` when `open === false` (since it composes `Popover`, which returns `null` when `!open || !placeRef`). So `WithMenu` can render `<Menu />` unconditionally.

### Step 4 — `uikit/Menu/index.ts`

```ts
export { Menu } from "./Menu";
export type { MenuProps } from "./Menu";
export { WithMenu } from "./WithMenu";
export type { WithMenuProps } from "./WithMenu";
export type { MenuItem } from "./types";
```

### Step 5 — `uikit/index.ts` — add exports

In `src/renderer/uikit/index.ts`, add a new "Menus" group after the existing "Overlay" block:

```ts
// Menus
export { Menu, WithMenu } from "./Menu";
export type { MenuProps, WithMenuProps, MenuItem } from "./Menu";
```

Place it between the "Overlay" exports and the "Lists" exports for readability.

### Step 6 — `uikit/Menu/Menu.story.tsx`

One Storybook entry that demonstrates `WithMenu` opening a `Menu`. Toggleable props let the user explore all variants (small / large with search / sub-menus / hotkeys / icons / separators / disabled / minor).

```tsx
import React from "react";
import { WithMenu } from "./WithMenu";
import { Button } from "../Button/Button";
import { Panel } from "../Panel/Panel";
import { Text } from "../Text/Text";
import {
    SettingsIcon, FolderOpenIcon, SaveIcon, CopyIcon, RenameIcon, CloseIcon,
} from "../../theme/icons";
import type { MenuItem } from "./types";
import { Story } from "../../editors/storybook/storyTypes";

const SMALL_ITEMS: MenuItem[] = [
    { label: "New Page",      icon: <FolderOpenIcon />, hotKey: "Ctrl+N",       onClick: () => alert("New Page")      },
    { label: "Open File…",    icon: <FolderOpenIcon />, hotKey: "Ctrl+O",       onClick: () => alert("Open File")     },
    { label: "Save",          icon: <SaveIcon />,       hotKey: "Ctrl+S",       onClick: () => alert("Save")          },
    { label: "Save As…",      icon: <SaveIcon />,       hotKey: "Ctrl+Shift+S", onClick: () => alert("Save As")       },
    { label: "Rename",        icon: <RenameIcon />,                              onClick: () => alert("Rename"), startGroup: true },
    { label: "Copy Path",     icon: <CopyIcon />,                                onClick: () => alert("Copy Path"),    },
    { label: "Close",         icon: <CloseIcon />,      hotKey: "Ctrl+W",       onClick: () => alert("Close"), startGroup: true, minor: true },
    { label: "Close All",     icon: <CloseIcon />,                              onClick: () => alert("Close All"),    },
    { label: "Disabled item", disabled: true,                                  onClick: () => alert("Should not run") },
];

const SUBMENU_ITEMS: MenuItem[] = [
    { label: "File",          icon: <FolderOpenIcon />, items: [
        { label: "New Page",   icon: <FolderOpenIcon />, hotKey: "Ctrl+N", onClick: () => alert("New") },
        { label: "Open…",      icon: <FolderOpenIcon />, hotKey: "Ctrl+O", onClick: () => alert("Open") },
    ] },
    { label: "Edit", icon: <CopyIcon />, items: [
        { label: "Copy",  hotKey: "Ctrl+C", onClick: () => alert("Copy") },
        { label: "Paste", hotKey: "Ctrl+V", onClick: () => alert("Paste") },
    ] },
    { label: "Settings", icon: <SettingsIcon />, onClick: () => alert("Settings") },
];

const LARGE_ITEMS: MenuItem[] = Array.from({ length: 60 }).map((_, i) => ({
    label: `Item ${String(i + 1).padStart(2, "0")} — ${["Apple", "Banana", "Cherry", "Date", "Elderberry"][i % 5]}`,
    onClick: () => alert(`Item ${i + 1}`),
}));

interface DemoProps {
    variant?: "small" | "submenus" | "large-search";
    placement?: string;
    offsetX?: number;
    offsetY?: number;
}

const MenuDemo = ({ variant = "small", placement = "bottom-start", offsetX = -4, offsetY = 4 }: DemoProps) => {
    const items =
        variant === "submenus"     ? SUBMENU_ITEMS :
        variant === "large-search" ? LARGE_ITEMS   :
        SMALL_ITEMS;
    return (
        <Panel direction="column" gap="md" padding="lg" align="start">
            <Text size="sm" color="light">
                Variant: {variant}{variant === "large-search" ? "  (search appears at >20 items)" : ""}
            </Text>
            <WithMenu items={items} placement={placement as any} offset={[offsetX, offsetY]}>
                {(setOpen) => (
                    <Button onClick={(e) => setOpen(e.currentTarget)} icon={<SettingsIcon />}>
                        Open menu
                    </Button>
                )}
            </WithMenu>
        </Panel>
    );
};

const PLACEMENTS = [
    "top", "top-start", "top-end",
    "bottom", "bottom-start", "bottom-end",
    "left", "left-start", "left-end",
    "right", "right-start", "right-end",
];

export const menuStory: Story = {
    id: "menu",
    name: "Menu",
    section: "Overlay",
    component: MenuDemo as any,
    props: [
        { name: "variant",   type: "enum",   options: ["small", "submenus", "large-search"], default: "small" },
        { name: "placement", type: "enum",   options: PLACEMENTS, default: "bottom-start" },
        { name: "offsetX",   type: "number", default: -4 },
        { name: "offsetY",   type: "number", default: 4 },
    ],
};
```

### Step 7 — Register the story in `storyRegistry.ts`

Edit `src/renderer/editors/storybook/storyRegistry.ts`:

```ts
// Add after the existing Overlay imports (line ~28):
import { menuStory } from "../../uikit/Menu/Menu.story";

// Add to ALL_STORIES list, in the Overlay group:
//   ...popoverStory, tooltipStory, dialogStory, notificationStory, menuStory,
```

The story shows up under "Overlay" in the Storybook editor.

### Step 8 — Manual verification

1. Run `npm start`. Open Storybook editor.
2. Find the "Menu" story under "Overlay" section.
3. Verify each variant:
   - **small** — click "Open menu", menu opens below button. Click an item — alert fires, menu closes. Open again, hover items, ESC closes.
   - **submenus** — open menu, hover "File" → submenu appears after 400ms to the right. Hover "Edit" — File submenu closes, Edit submenu opens. Click "Copy" inside Edit submenu — alert fires, both menus close.
   - **large-search** — open menu, search field is shown at top with autofocus. Type "ana" → only "Banana" rows visible. Press Enter — top match alerts. Press Escape — closes.
4. Open the small menu, then click a different button outside the menu — menu closes (click-outside).
5. Open the submenus menu, hover "File" until submenu opens, then move mouse OUT of both menus and click far away — both menus close.
6. Keyboard: with the small menu open (no search), press ArrowDown 3 times then Enter — alerts the 4th item.
7. Keyboard: with large-search menu open (search has focus), type a query, ArrowDown moves through filtered list, Enter activates.

## Files NOT changed

- `src/renderer/api/types/events.d.ts` — re-exported FROM, not modified.
- `src/renderer/components/overlay/PopupMenu.tsx`, `WithPopupMenu.tsx`, `Popper.tsx` — legacy stack stays. Removed in US-483.
- `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx`, `Poppers.tsx` — Task US-482 refactors these.
- All 30 legacy menu consumers — Tasks US-478, US-482, US-483 migrate them.
- `src/renderer/uikit/Popover/Popover.tsx`, `Input/Input.tsx` — composed by Menu, unchanged.
- `src/renderer/uikit/CLAUDE.md` — no rule changes for this task (Rule 3 deviation is documented inline in Menu.tsx via comment, not a CLAUDE.md amendment).

## Concerns / Open questions

### #1 — Scope split *(resolved)*

**Resolution.** Confirmed by the user. Task A (this task) builds Menu + WithMenu only. Task B (US-482) adds `showMenu(x, y, items)` and refactors `showAppPopupMenu`. Task C (US-483) sweeps remaining legacy consumers and deletes `components/overlay/PopupMenu.tsx`, `WithPopupMenu.tsx`, `Popper.tsx`.

### #2 — Render-prop API *(resolved)*

**Resolution.** Confirmed by the user. `<WithMenu items={…}>{(setOpen) => trigger}</WithMenu>` — drop-in shape-compatible with `WithPopupMenu`. Reason: PageTab's language picker uses conditional logic in the click handler (e.g., `if (!isActive && ctrlKey) handleClick(); else setOpen(currentTarget)`). Auto-cloned `onClick` (the wrap-the-trigger pattern) cannot express this.

### #3 — `MenuItem` type origin *(resolved)*

**Resolution.** Confirmed by the user. UIKit `Menu/types.ts` re-exports `MenuItem` from `src/renderer/api/types/events.d.ts`. Single canonical shape. Script API (`ContextMenuEvent.items`) and UIKit consumers see the exact same type. No duplication.

### #4 — Should `Menu` accept `Traited<MenuItem[]>` per Rule 3?

UIKit Rule 3 says list/collection components accept `T[] | Traited<T[]>` so consumers can pass items in their native shape and use traits to convert. Menu is technically a list/collection component.

**Resolution.** **No** — Menu is the exception that proves the rule. `MenuItem` is already the canonical shape; consumers everywhere (PageTab, Graph, AVGrid, scripts via `ContextMenuEvent.items.push(...)`) build the array directly in this shape. There is no "native shape to convert from" — every menu site already produces `MenuItem`. Adding `Traited<MenuItem[]>` would be unused complexity.

A short comment in `Menu.tsx` documents this deviation:

```ts
// Rule 3 (Traited<T[]>) is intentionally NOT applied to Menu. MenuItem is the
// canonical shape — there is no "native item shape" to convert from. All
// consumers (script API via ContextMenuEvent.items, app code, sub-menus) build
// MenuItem[] directly. Adding Traited<MenuItem[]> would be unused complexity.
```

### #5 — Search threshold is hardcoded at 20 *(resolved by user)*

**Resolution.** Hardcode `SEARCH_THRESHOLD = 20`. No `searchThreshold?: number` prop. Per the user: "It is selected manually. If items count is less than 20 the menu is fully visible and I think the search is not needed."

### #6 — Hotkey rendering is visual only *(resolved by user)*

**Resolution.** `MenuItem.hotKey` is rendered as a right-aligned dim string in the row. **Menu does NOT bind global hotkeys** from items. Global hotkey binding (e.g., listening for Ctrl+N at the app level) is a separate system; Menu's job is only to show the hint.

### #7 — Sub-menu chevron icon *(resolved by user — render a chevron)*

Legacy menu does NOT render a chevron for items with sub-menus — discoverability suffers (no visual cue that an item opens a sub-menu until you hover for 400ms).

**Resolution (user direction).** Render a `ChevronRightIcon` (already exported from `src/renderer/theme/icons.tsx`, viewBox 16) at the right edge of any row whose item has `items?.length`. The chevron is rendered AFTER the optional hotkey hint. Visual style: dim foreground color (`color.text.light`), inherits the row's hovered/selection color when the row is hovered, sized at `height.iconSm` (12px) so it reads as an indicator rather than a primary icon.

Implementation detail in the `RowRoot` styled block — add a hover rule analogous to the existing `data-part='hotkey']` rule:

```ts
"&[data-hovered] [data-part='submenu-chevron']": { color: "inherit" },
```

And in the `SubMenuChevron` styled definition, set:

```tsx
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
```

Replace the placeholder `▶` glyph in the skeleton with `<ChevronRightIcon />` — add the import at the top of `Menu.tsx`:

```ts
import { ChevronRightIcon } from "../../theme/icons";
```

And in the row JSX:

```tsx
{item.items?.length ? <SubMenuChevron data-part="submenu-chevron"><ChevronRightIcon /></SubMenuChevron> : null}
```

### #8 — Search input keyboard event forwarding

The search Input uses `autoFocus` and is the focused element when search is shown. Keyboard events (ArrowDown/Up, Enter, Escape) need to reach the Menu's `onKeyDown` handler. The skeleton passes `onKeyDown={onKeyDown}` directly to `<Input>`.

**Sub-concern.** UIKit Input must forward `onKeyDown` to the underlying `<input>` element. Quick verification during implementation: read `src/renderer/uikit/Input/Input.tsx` and confirm `onKeyDown` is in the `...rest` spread.

**Resolution.** Verify during implementation. Input is a thin wrapper around `<input>` and almost certainly forwards `onKeyDown` via `...rest`; if not, add the prop or use `event.stopPropagation` on the search input and bubble to a parent wrapper. Either fix is local to Menu.tsx.

### #9 — Click-outside between parent and sub-menu

When a sub-menu is open as a sibling Popover, clicking inside the sub-menu must NOT trigger the parent Popover's click-outside (since sub-menu's DOM is at `document.body`, not inside the parent's tree). The plan uses `outsideClickIgnoreSelector='[data-type="menu"]'` on the parent Popover — UIKit Popover already supports this. The `data-type="menu"` is set on every Menu's Popover root.

**Resolution.** The skeleton sets `data-type="menu"` on the Popover and passes the ignore selector. Verify that Popover's `data-type` prop spread (via `{...rest}`) reaches the root element — it does, per `Popover.tsx` line 295-303.

### #10 — Focus restore in `WithMenu`

`WithMenu` saves `document.activeElement` before opening and restores it on close. Same pattern as legacy `WithPopupMenu.tsx` lines 16-31. **Does not save/restore for sub-menus** — sub-menus don't go through WithMenu, they're rendered inside Menu directly.

**Resolution.** Implemented in skeleton. Sub-menus need no focus management because the parent menu handles it once for the whole open session.

### #11 — Popover's `onKeyDown` propagation

UIKit Popover forwards `onKeyDown` to its root via `{...rest}` (line 300-303 of Popover.tsx). For the keyboard handler to actually fire, the root element must receive focus or capture keyboard. The skeleton uses `<ListRoot ref={listRef} tabIndex={-1}>` and auto-focuses it when search is hidden, ensuring keyboard events land on the Menu's `onKeyDown` (passed to Popover).

**Sub-concern.** When focus is on the search Input (top of the popover), key events fire on Input, then bubble to `ListRoot`, then bubble to `Popover` root. The `onKeyDown={onKeyDown}` on `<Input>` runs the same handler; native bubble would also reach Popover. **Risk:** double-firing.

**Resolution.** Pass `onKeyDown` ONLY to Input when search is shown (skeleton already does — Popover's `onKeyDown` still fires for clicks landing on the popover root which has no focused descendant; bubble from Input to Popover root is fine because the handler is idempotent — it reads `hoveredId` from state and calls one transition per call).

Actually, to be safe: remove `onKeyDown` from the Popover when search is shown, or call `event.stopPropagation()` from the Input handler. The implementer should test for double-fire during smoke testing and apply whichever guard is needed. *(Low-risk; visible immediately if it happens.)*

## Acceptance criteria

1. Files created at exact paths:
   - `src/renderer/uikit/Menu/types.ts`
   - `src/renderer/uikit/Menu/Menu.tsx`
   - `src/renderer/uikit/Menu/WithMenu.tsx`
   - `src/renderer/uikit/Menu/Menu.story.tsx`
   - `src/renderer/uikit/Menu/index.ts`
2. `src/renderer/uikit/index.ts` re-exports `Menu`, `WithMenu`, types `MenuProps`, `WithMenuProps`, `MenuItem`.
3. `src/renderer/editors/storybook/storyRegistry.ts` imports `menuStory` and includes it in `ALL_STORIES`.
4. `MenuItem` is re-exported from `api/types/events.d.ts` — UIKit does NOT redefine the interface.
5. `npx tsc --noEmit` reports the same baseline error count as before this task — no new TypeScript errors. *(Baseline at task start: same 41 errors per US-477 README; verify before commit.)*
6. `npm run lint` reports no new ESLint errors in `src/renderer/uikit/Menu/`.
7. Storybook smoke (visual) — open `npm start`, navigate to Storybook, find "Menu" under "Overlay" section. Each of the three variants renders correctly. Manual checks per Step 8 of the plan all pass.
8. **Legacy stack untouched.** `git diff src/renderer/components/overlay/` shows no changes after this task.
9. **Consumers untouched.** `git diff src/renderer/ui/`, `src/renderer/editors/`, `src/renderer/api/internal/` show no changes (other than `editors/storybook/storyRegistry.ts`) after this task. Existing menus still work via the legacy stack.
10. Keyboard nav: with the small-variant menu open (no search), arrow keys move highlight, Enter activates, Escape closes.
11. Keyboard nav: with the large-search-variant menu open, search input has focus on open, typing filters, ArrowDown moves through filtered list, Enter activates first or hovered match.
12. Sub-menus: hovering an item with `items?.length` for 400ms opens the sub-menu to the right. Hovering a different item closes the sub-menu and opens / does not open the new one. Clicking a sub-menu leaf item closes both the sub-menu and the parent.
13. Click-outside-everything closes the parent menu (and any open sub-menu).
14. Focus restoration: opening a menu via `WithMenu` saves the current focus; closing the menu returns focus to that element.

## Files Changed summary

| File | Change |
|------|--------|
| `src/renderer/uikit/Menu/types.ts` | **New.** Re-exports `MenuItem` from `api/types/events.d.ts`. |
| `src/renderer/uikit/Menu/Menu.tsx` | **New.** Menu component composed of `Popover` + internal list, search, sub-menus, keyboard nav. |
| `src/renderer/uikit/Menu/WithMenu.tsx` | **New.** Render-prop wrapper around `Menu` with anchor + open state + focus restore. |
| `src/renderer/uikit/Menu/Menu.story.tsx` | **New.** Storybook entry showing small / submenus / large-search variants. |
| `src/renderer/uikit/Menu/index.ts` | **New.** Public exports for Menu, WithMenu, types. |
| `src/renderer/uikit/index.ts` | **Modified.** Add Menus group with `Menu`, `WithMenu`, `MenuProps`, `WithMenuProps`, `MenuItem` exports. |
| `src/renderer/editors/storybook/storyRegistry.ts` | **Modified.** Import `menuStory` and add to `ALL_STORIES`. |
| `doc/active-work.md` | **Modified.** Add US-481 under EPIC-025 Active section, ahead of US-478 (which is blocked on US-481). Mark US-478 as blocked on US-481. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration (foundation primitive)
- Blocks: [US-478](../US-478-page-tabs-migration/README.md) — PageTabs migration consumes `WithMenu`.
- Followup tasks (planned, not yet created):
  - **US-482** — UIKit `showMenu(x, y, items)` + refactor `showAppPopupMenu` to compose it.
  - **US-483** — Sweep remaining `<WithPopupMenu>` consumers; delete `components/overlay/PopupMenu.tsx`, `WithPopupMenu.tsx`, `Popper.tsx`.
- Related precedents:
  - [US-432](../US-432-dialog-component/README.md) — Dialog primitive (similar build-then-migrate model).
  - UIKit Popover, Tooltip — composition base.
