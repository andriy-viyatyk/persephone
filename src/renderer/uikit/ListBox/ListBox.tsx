import React, {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
} from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";
import {
    isTraited,
    resolveTraited,
    TraitKey,
    Traited,
    TraitType,
} from "../../core/traits/traits";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import {
    ElementLength,
    Percent,
    RenderCellFunc,
    RowAlign,
} from "../../components/virtualization/RenderGrid/types";
import { Spinner } from "../Spinner/Spinner";
import { ListItem } from "./ListItem";

// --- Types ---

export interface IListBoxItem {
    /** Stable identifier — what `value` / `onChange` refer to. */
    value: string | number;
    /** Display label. Strings are eligible for `searchText` highlighting. */
    label: React.ReactNode;
    /** Leading icon. */
    icon?: React.ReactNode;
    /** Disables this item without affecting siblings. */
    disabled?: boolean;
}

export const LIST_ITEM_KEY = new TraitKey<TraitType<IListBoxItem>>("listbox-item");

export interface ListItemRenderContext<T> {
    /** Resolved item shape (post-trait). */
    item: IListBoxItem;
    /** Original source item (pre-trait). Equal to `item` when `T = IListBoxItem`. */
    source: T;
    index: number;
    selected: boolean;
    active: boolean;
    /** Stable DOM id — must be set on the rendered row when callers want `aria-activedescendant`. */
    id: string;
}

export interface ListBoxRef {
    scrollToIndex: (index: number, align?: RowAlign) => void;
}

export interface ListBoxProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    items: T[] | Traited<unknown[]>;
    /**
     * Currently-selected item. `null` when nothing is selected. May reference an
     * item not present in `items` — the checkmark simply will not render then.
     *   • Plain `T` — used when `T = IListBoxItem`. Reads `.label` / `.value` / `.icon` directly.
     *   • `Traited<T>` — used with custom `T`. Reads accessor from `value.traits.get(LIST_ITEM_KEY)`.
     */
    value?: T | Traited<T> | null;
    /** Fires when the user selects an item. Emits the source `T` (matches the shape passed via `items`). */
    onChange?: (item: T) => void;
    /** Index of the currently-highlighted (active) row. Controlled. */
    activeIndex?: number | null;
    /** Fires when the active row changes — mouse hover or internal keyboard nav. */
    onActiveChange?: (index: number) => void;
    /** Plain-string label highlight passed to the default `<ListItem>`. */
    searchText?: string;
    /** Custom row renderer. Receives a context with the resolved item + flags. */
    renderItem?: (ctx: ListItemRenderContext<T>) => React.ReactNode;
    /** When true, the ListBox handles ArrowUp/ArrowDown/Home/End/Enter on its root. Default: false. */
    keyboardNav?: boolean;
    /** Spinner state — replaces item rendering with a loading row. */
    loading?: boolean;
    /** Renders when `items` is empty and not `loading`. */
    emptyMessage?: React.ReactNode;
    /** Pixel height of each row. Default: 24. */
    rowHeight?: number;
    /** When set, the list grows to fit content up to this max height. */
    growToHeight?: React.CSSProperties["height"];
    /** Top/bottom whitespace padding inside the scroll container. */
    whiteSpaceY?: number;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        outline: "none",
        "&[data-disabled]": { opacity: 0.6, pointerEvents: "none" },
    },
    { label: "ListBox" },
);

const EmptyRoot = styled.div(
    {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        flex: "1 1 auto",
        color: color.text.light,
    },
    { label: "ListBoxEmpty" },
);

// --- Component ---

const columnWidth: ElementLength = (() => "100%" as Percent) as ElementLength;
const defaultRowHeight = 24;

function runAccessor<R>(source: unknown, accessor: TraitType<R>): R {
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof TraitType<R>)[]).map((k) => [k, accessor[k](source)]),
    ) as R;
}

function ListBoxInner<T = IListBoxItem>(
    {
        items,
        value,
        onChange,
        activeIndex,
        onActiveChange,
        searchText,
        renderItem,
        keyboardNav = false,
        loading,
        emptyMessage,
        rowHeight = defaultRowHeight,
        growToHeight,
        whiteSpaceY,
        id: idProp,
        ...rest
    }: ListBoxProps<T>,
    ref: React.ForwardedRef<ListBoxRef>,
) {
    const reactId = useId();
    const rootId = idProp ?? `lb-${reactId}`;
    const gridRef = useRef<RenderGridModel | null>(null);

    // Resolve traited input → IListBoxItem[] + parallel array of source `T`.
    const { resolved, sources } = useMemo(() => {
        if (isTraited<unknown[]>(items)) {
            const r = resolveTraited<IListBoxItem>(items, LIST_ITEM_KEY);
            return { resolved: r, sources: items.target as T[] };
        }
        const arr = items as T[];
        return { resolved: arr as unknown as IListBoxItem[], sources: arr };
    }, [items]);

    // Resolve a single value (plain T or Traited<T>) to IListBoxItem.
    // Decoupled from items resolution — Traited<T> values carry their own accessor.
    const resolveSingleValue = useCallback((v: T | Traited<T>): IListBoxItem => {
        if (isTraited<T>(v)) {
            const acc = v.traits.get(LIST_ITEM_KEY);
            if (acc) return runAccessor<IListBoxItem>(v.target, acc);
            return v.target as unknown as IListBoxItem;
        }
        return v as unknown as IListBoxItem;
    }, []);

    const selectedKey = useMemo(
        () => (value != null ? resolveSingleValue(value).value : null),
        [value, resolveSingleValue],
    );

    // Force RenderGrid re-render when display inputs change.
    useEffect(() => {
        gridRef.current?.update({ all: true });
    }, [resolved, selectedKey, activeIndex, searchText, renderItem, rowHeight]);

    // Keep the active row visible whenever activeIndex changes — covers external
    // drivers (Select keyboard handler, etc.) that update activeIndex without
    // going through ListBox's own keyboardNav path.
    useEffect(() => {
        if (activeIndex != null && activeIndex >= 0) {
            gridRef.current?.scrollToRow(activeIndex);
        }
    }, [activeIndex]);

    useImperativeHandle(
        ref,
        () => ({
            scrollToIndex: (i, align) => {
                gridRef.current?.scrollToRow(i, align);
            },
        }),
        [],
    );

    const itemId = useCallback(
        (idx: number) => `${rootId}-item-${resolved[idx].value}`,
        [rootId, resolved],
    );

    const onItemClick = useCallback(
        (idx: number) => {
            const item = resolved[idx];
            if (!item || item.disabled) return;
            onChange?.(sources[idx]);
        },
        [resolved, sources, onChange],
    );

    const onItemMouseEnter = useCallback(
        (idx: number) => {
            const item = resolved[idx];
            if (!item || item.disabled) return;
            if (idx !== activeIndex) onActiveChange?.(idx);
        },
        [resolved, activeIndex, onActiveChange],
    );

    const renderCell = useCallback<RenderCellFunc>(
        ({ row: idx, key, style }) => {
            const item = resolved[idx];
            if (!item) return null;
            const selected = selectedKey != null && item.value === selectedKey;
            const active = idx === activeIndex;
            const id = itemId(idx);

            const content = renderItem
                ? renderItem({ item, source: sources[idx], index: idx, selected, active, id })
                : (
                    <ListItem
                        id={id}
                        icon={item.icon}
                        label={item.label}
                        searchText={searchText}
                        selected={selected}
                        active={active}
                        disabled={item.disabled}
                    />
                );

            return (
                <div
                    key={key}
                    style={style}
                    onClick={() => onItemClick(idx)}
                    onMouseEnter={() => onItemMouseEnter(idx)}
                >
                    {content}
                </div>
            );
        },
        [
            resolved,
            sources,
            selectedKey,
            activeIndex,
            searchText,
            renderItem,
            itemId,
            onItemClick,
            onItemMouseEnter,
        ],
    );

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (!keyboardNav) return;
            const n = resolved.length;
            if (n === 0) return;
            const cur = activeIndex ?? -1;
            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault();
                    const next = Math.min(n - 1, cur + 1);
                    onActiveChange?.(next);
                    gridRef.current?.scrollToRow(next);
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    const next = Math.max(0, cur - 1);
                    onActiveChange?.(next);
                    gridRef.current?.scrollToRow(next);
                    break;
                }
                case "PageDown": {
                    e.preventDefault();
                    const page = Math.max(1, gridRef.current?.visibleRowCount ?? 1);
                    const next = Math.min(n - 1, (cur < 0 ? 0 : cur) + page);
                    onActiveChange?.(next);
                    gridRef.current?.scrollToRow(next);
                    break;
                }
                case "PageUp": {
                    e.preventDefault();
                    const page = Math.max(1, gridRef.current?.visibleRowCount ?? 1);
                    const next = Math.max(0, (cur < 0 ? 0 : cur) - page);
                    onActiveChange?.(next);
                    gridRef.current?.scrollToRow(next);
                    break;
                }
                case "Home": {
                    e.preventDefault();
                    onActiveChange?.(0);
                    gridRef.current?.scrollToRow(0);
                    break;
                }
                case "End": {
                    e.preventDefault();
                    onActiveChange?.(n - 1);
                    gridRef.current?.scrollToRow(n - 1);
                    break;
                }
                case "Enter": {
                    if (cur >= 0) {
                        e.preventDefault();
                        onItemClick(cur);
                    }
                    break;
                }
            }
        },
        [keyboardNav, resolved.length, activeIndex, onActiveChange, onItemClick],
    );

    if (loading) {
        return (
            <Root id={rootId} data-type="list-box" data-loading="" {...rest}>
                <EmptyRoot>
                    <Spinner size={16} /> loading…
                </EmptyRoot>
            </Root>
        );
    }

    if (resolved.length === 0) {
        return (
            <Root id={rootId} data-type="list-box" data-empty="" {...rest}>
                <EmptyRoot>{emptyMessage ?? "no rows"}</EmptyRoot>
            </Root>
        );
    }

    const activeId =
        activeIndex != null && activeIndex >= 0 && activeIndex < resolved.length
            ? itemId(activeIndex)
            : undefined;

    return (
        <Root
            id={rootId}
            data-type="list-box"
            role="listbox"
            tabIndex={keyboardNav ? 0 : -1}
            aria-activedescendant={activeId}
            onKeyDown={onKeyDown}
            {...rest}
        >
            <RenderGrid
                ref={gridRef}
                columnCount={1}
                rowCount={resolved.length}
                columnWidth={columnWidth}
                rowHeight={rowHeight}
                renderCell={renderCell}
                overscanRow={2}
                fitToWidth
                growToHeight={growToHeight}
                whiteSpaceY={whiteSpaceY}
            />
        </Root>
    );
}

export const ListBox = forwardRef(ListBoxInner) as <T = IListBoxItem>(
    props: ListBoxProps<T> & { ref?: React.Ref<ListBoxRef> },
) => React.ReactElement | null;
