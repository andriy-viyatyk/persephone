import React, { useCallback, useMemo, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { gap, height, spacing } from "../tokens";
import { CheckedIcon, IndeterminateIcon, UncheckedIcon } from "../../theme/icons";
import { isTraited, traited, Traited } from "../../core/traits/traits";
import { highlight } from "../shared/highlight";
import { Input } from "../Input";
import {
    IListBoxItem,
    LIST_ITEM_KEY,
    ListBox,
    ListItemRenderContext,
} from "../ListBox";

// =============================================================================
// Types
// =============================================================================

export interface MultiListBoxProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
    /** Items to display. Plain `T[]` when `T = IListBoxItem`, or `Traited<unknown[]>` to drive a
     *  custom source shape (Rule 3). */
    items: T[] | Traited<unknown[]>;
    /** Currently-selected source items. Empty array when nothing is selected. */
    value: T[];
    /** Called whenever the selection changes — caller replaces its `value` with the array. */
    onChange: (value: T[]) => void;
    /** Disabled state — rows do not respond to clicks and the search input is read-only. */
    disabled?: boolean;
    /** Read-only state — rows do not respond to clicks. The search box stays enabled. */
    readOnly?: boolean;
    /** Show the built-in search input above the list. Default: true. */
    showSearch?: boolean;
    /** Search filter mode. Default: "contains". `"off"` disables filtering entirely. */
    filterMode?: "contains" | "startsWith" | "off";
    /** Placeholder shown inside the built-in search input. Default: "Search…". */
    searchPlaceholder?: string;
    /** Show a tri-state "Select all" row at the top of the list. Default: false. */
    selectAll?: boolean;
    /** Label rendered next to the select-all checkbox. Default: "Select all". */
    selectAllLabel?: React.ReactNode;
    /** Pixel height of each list row. Forwarded to the inner ListBox. Default: 24. */
    rowHeight?: number;
    /**
     * Maximum number of visible list rows before the inner list scrolls. Default: 10.
     * Only consulted when no `height` is set.
     */
    maxVisibleItems?: number;
    /** Renders inside the list area when no rows match the filter. Default: "no rows". */
    emptyMessage?: React.ReactNode;
    /** Fixed width — number → px, string passes through. Default: fills parent (100%). */
    width?: number | string;
    /**
     * Fixed height — number → px, string passes through. When unset, the inner list grows up
     * to `maxVisibleItems × rowHeight` plus the search row + select-all row chrome.
     */
    height?: number | string;
}

// =============================================================================
// Styled
// =============================================================================

const Root = styled.div(
    {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        width: "100%",
        backgroundColor: color.background.default,

        "&[data-disabled]": {
            opacity: 0.6,
            pointerEvents: "none",
        },
    },
    { label: "MultiListBox" },
);

const SearchRow = styled.div(
    {
        flexShrink: 0,
        padding: spacing.xs,
    },
    { label: "MultiListBoxSearchRow" },
);

const SelectAllRow = styled.div(
    {
        display: "inline-flex",
        alignItems: "center",
        gap: gap.md,
        flexShrink: 0,
        height: 24,
        boxSizing: "border-box",
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
        cursor: "pointer",
        color: color.text.default,
        borderBottom: `1px solid ${color.border.light}`,
        userSelect: "none",

        "&:hover": {
            backgroundColor: color.background.message,
        },

        "& [data-part='icon']": {
            display: "inline-flex",
            flexShrink: 0,
            width: height.iconMd,
            height: height.iconMd,
            color: color.text.light,
        },
        "&:hover [data-part='icon']": {
            color: color.text.default,
        },
        "& [data-part='icon'] svg": {
            width: height.iconMd,
            height: height.iconMd,
        },

        "& [data-part='label']": {
            flex: "1 1 auto",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
    },
    { label: "MultiListBoxSelectAllRow" },
);

const ItemRow = styled.div(
    {
        display: "inline-flex",
        width: "100%",
        boxSizing: "border-box",
        alignItems: "center",
        gap: gap.md,
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
        cursor: "pointer",
        color: color.text.default,
        overflow: "hidden",

        "&[data-disabled]": { opacity: 0.4, pointerEvents: "none" },
        "&[data-active]": { backgroundColor: color.background.message },

        "& [data-part='check']": {
            display: "inline-flex",
            flexShrink: 0,
            width: height.iconMd,
            height: height.iconMd,
            color: color.text.light,
        },
        "&:hover [data-part='check'], &[data-active] [data-part='check']": {
            color: color.text.default,
        },
        "&[data-checked] [data-part='check']": {
            color: color.text.default,
        },
        "& [data-part='check'] svg": {
            width: height.iconMd,
            height: height.iconMd,
        },

        "& > svg": {
            width: height.iconMd,
            height: height.iconMd,
            flexShrink: 0,
        },

        "& [data-part='label']": {
            flex: "1 1 auto",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
    },
    { label: "MultiListBoxItemRow" },
);

const ListWrapper = styled.div(
    {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
    },
    { label: "MultiListBoxListWrapper" },
);

// =============================================================================
// Helpers
// =============================================================================

const defaultRowHeight = 24;
const defaultMaxVisibleItems = 10;

function defaultMatch(item: IListBoxItem, q: string, mode: "contains" | "startsWith" | "off"): boolean {
    if (mode === "off" || q === "") return true;
    const label = typeof item.label === "string" ? item.label.toLowerCase() : "";
    const query = q.toLowerCase();
    return mode === "startsWith" ? label.startsWith(query) : label.includes(query);
}

interface Resolved<T> {
    resolved: IListBoxItem[];
    sources: T[];
    extractValue: (v: T) => string | number;
}

function resolveItems<T>(items: T[] | Traited<unknown[]>): Resolved<T> {
    if (isTraited<unknown[]>(items)) {
        const accessor = items.traits.get(LIST_ITEM_KEY);
        const sources = items.target as T[];
        if (accessor) {
            const resolved: IListBoxItem[] = sources.map((v) => ({
                value: accessor.value(v) as string | number,
                label: accessor.label(v),
                icon: accessor.icon ? accessor.icon(v) : undefined,
                disabled: accessor.disabled ? Boolean(accessor.disabled(v)) : undefined,
            }));
            return {
                resolved,
                sources,
                extractValue: (v: T) => accessor.value(v) as string | number,
            };
        }
        // No accessor — fall through to the plain path treating sources as IListBoxItem.
        return {
            resolved: sources as unknown as IListBoxItem[],
            sources,
            extractValue: (v: T) => (v as unknown as IListBoxItem).value,
        };
    }
    return {
        resolved: items as unknown as IListBoxItem[],
        sources: items,
        extractValue: (v: T) => (v as unknown as IListBoxItem).value,
    };
}

// =============================================================================
// Component
// =============================================================================

export function MultiListBox<T = IListBoxItem>(props: MultiListBoxProps<T>) {
    const {
        name,
        items,
        value,
        onChange,
        disabled,
        readOnly,
        showSearch = true,
        filterMode = "contains",
        searchPlaceholder = "Search…",
        selectAll = false,
        selectAllLabel = "Select all",
        rowHeight = defaultRowHeight,
        maxVisibleItems = defaultMaxVisibleItems,
        emptyMessage,
        width,
        height: heightProp,
        ...rest
    } = props;

    const [searchText, setSearchText] = useState("");
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    const { resolved, sources, extractValue } = useMemo(() => resolveItems<T>(items), [items]);

    const selectedKeySet = useMemo(() => {
        const s = new Set<string | number>();
        for (const v of value) s.add(extractValue(v));
        return s;
    }, [value, extractValue]);

    const { filteredSources, filteredItems } = useMemo(() => {
        const fs: T[] = [];
        const fi: IListBoxItem[] = [];
        for (let i = 0; i < resolved.length; i++) {
            if (filterMode === "off" || defaultMatch(resolved[i], searchText, filterMode)) {
                fs.push(sources[i]);
                fi.push(resolved[i]);
            }
        }
        return { filteredSources: fs, filteredItems: fi };
    }, [resolved, sources, searchText, filterMode]);

    // Preserve the Traited wrapper so the inner ListBox resolves T → IListBoxItem
    // through the same accessor the caller supplied. Falls through to a plain array
    // when the caller passed one.
    const listBoxItems: T[] | Traited<unknown[]> = useMemo(
        () => (isTraited<unknown[]>(items) ? traited(filteredSources, items.traits) : filteredSources),
        [items, filteredSources],
    );

    // Tri-state for select-all: count selected among the currently-visible (filtered) rows.
    const visibleSelectedCount = useMemo(() => {
        let n = 0;
        for (const it of filteredItems) {
            if (selectedKeySet.has(it.value)) n++;
        }
        return n;
    }, [filteredItems, selectedKeySet]);
    const allVisibleSelected =
        filteredItems.length > 0 && visibleSelectedCount === filteredItems.length;
    const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

    const handleToggle = useCallback(
        (source: T) => {
            if (disabled || readOnly) return;
            const key = extractValue(source);
            if (selectedKeySet.has(key)) {
                onChange(value.filter((v) => extractValue(v) !== key));
            } else {
                onChange([...value, source]);
            }
        },
        [disabled, readOnly, extractValue, selectedKeySet, value, onChange],
    );

    const handleSelectAllToggle = useCallback(() => {
        if (disabled || readOnly) return;
        const visibleKeys = new Set<string | number>();
        for (const it of filteredItems) visibleKeys.add(it.value);
        if (allVisibleSelected) {
            // Deselect every currently-visible item, preserve out-of-filter selections.
            onChange(value.filter((v) => !visibleKeys.has(extractValue(v))));
        } else {
            // Select every currently-visible item not already selected.
            const next = value.slice();
            for (let i = 0; i < filteredItems.length; i++) {
                const it = filteredItems[i];
                if (!selectedKeySet.has(it.value)) next.push(filteredSources[i]);
            }
            onChange(next);
        }
    }, [
        disabled,
        readOnly,
        filteredItems,
        filteredSources,
        allVisibleSelected,
        selectedKeySet,
        value,
        onChange,
        extractValue,
    ]);

    const renderRow = useCallback(
        (ctx: ListItemRenderContext<T>) => {
            const checked = selectedKeySet.has(ctx.item.value);
            const itemDisabled = ctx.item.disabled;
            const labelNode =
                typeof ctx.item.label === "string" && searchText
                    ? highlight(ctx.item.label, searchText)
                    : ctx.item.label;
            return (
                <ItemRow
                    id={ctx.id}
                    data-type="multi-list-item"
                    data-checked={checked || undefined}
                    data-active={ctx.active || undefined}
                    data-disabled={itemDisabled || undefined}
                    role="option"
                    aria-selected={checked ? "true" : "false"}
                    aria-disabled={itemDisabled ? "true" : undefined}
                >
                    <span data-part="check">
                        {checked ? <CheckedIcon /> : <UncheckedIcon />}
                    </span>
                    {ctx.item.icon}
                    <span data-part="label">{labelNode}</span>
                </ItemRow>
            );
        },
        [selectedKeySet, searchText],
    );

    // ListBox.isSelected drives the `selected` flag in ListItemRenderContext.
    const isRowSelected = useCallback(
        (source: T) => selectedKeySet.has(extractValue(source)),
        [selectedKeySet, extractValue],
    );

    const rootStyle: React.CSSProperties = {};
    if (width !== undefined) rootStyle.width = width;
    if (heightProp !== undefined) rootStyle.height = heightProp;

    const listGrow = heightProp === undefined ? maxVisibleItems * rowHeight : undefined;

    return (
        <Root
            data-type="multilistbox"
            data-name={name}
            data-disabled={disabled || undefined}
            data-readonly={readOnly || undefined}
            style={Object.keys(rootStyle).length > 0 ? rootStyle : undefined}
            {...rest}
        >
            {showSearch && (
                <SearchRow>
                    <Input
                        name="multilistbox-search"
                        size="sm"
                        value={searchText}
                        onChange={setSearchText}
                        placeholder={searchPlaceholder}
                        disabled={disabled}
                        tone={searchText ? "accent" : "default"}
                    />
                </SearchRow>
            )}
            {selectAll && (
                <SelectAllRow
                    data-type="multilistbox-select-all"
                    data-checked={
                        allVisibleSelected
                            ? "true"
                            : someVisibleSelected
                            ? "mixed"
                            : "false"
                    }
                    role="checkbox"
                    aria-checked={
                        allVisibleSelected ? "true" : someVisibleSelected ? "mixed" : "false"
                    }
                    onClick={handleSelectAllToggle}
                >
                    <span data-part="icon">
                        {allVisibleSelected ? (
                            <CheckedIcon />
                        ) : someVisibleSelected ? (
                            <IndeterminateIcon />
                        ) : (
                            <UncheckedIcon />
                        )}
                    </span>
                    <span data-part="label">{selectAllLabel}</span>
                </SelectAllRow>
            )}
            <ListWrapper>
                <ListBox<T>
                    items={listBoxItems}
                    isSelected={isRowSelected}
                    onChange={handleToggle}
                    activeIndex={activeIndex}
                    onActiveChange={setActiveIndex}
                    renderItem={renderRow}
                    rowHeight={rowHeight}
                    growToHeight={listGrow}
                    searchText={searchText}
                    keyboardNav
                    emptyMessage={emptyMessage ?? "no rows"}
                />
            </ListWrapper>
        </Root>
    );
}
