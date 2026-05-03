import React, {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import styled from "@emotion/styled";
import { isTraited, Traited, TraitType } from "../../core/traits/traits";
import { Input, InputProps } from "../Input";
import { IconButton } from "../IconButton";
import { Popover } from "../Popover";
import { ListBox, IListBoxItem, LIST_ITEM_KEY } from "../ListBox";
import { ChevronDownIcon, ChevronUpIcon } from "../../theme/icons";
import { ItemsSource, useSelectItems } from "./useSelectItems";

// --- Types ---

export interface SelectProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /**
     * Item source — accepts:
     *   • `T[]` / `Traited<T[]>` — sync, ready immediately.
     *   • `Promise<...>` — eager async; Select awaits on mount.
     *   • `() => T[] | Promise<...>` — lazy; called once on first open.
     * Result is cached after first resolution. Changing the `items` reference invalidates the cache.
     */
    items: ItemsSource<T>;
    /**
     * Currently-selected item. `null` when nothing is selected.
     * Independent of `items` — Select renders the trigger label without waiting on items to load.
     *   • Plain `T` — used when `T = IListBoxItem` (item carries `.label` directly).
     *   • `Traited<T>` — used with custom `T`; Select reads the trait accessor from `value.traits`.
     */
    value?: T | Traited<T> | null;
    /** Fires when the user picks an item from the list. Emits the source `T`. */
    onChange?: (item: T) => void;
    /** Optional callback invoked when an async items loader rejects. */
    onItemsLoadError?: (error: unknown) => void;
    /** Placeholder shown when no item is selected. */
    placeholder?: string;
    /** Disabled state — input cannot be focused, popover cannot open. */
    disabled?: boolean;
    /** Read-only state — popover does not open, input is not editable, no chevron interaction. */
    readOnly?: boolean;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
    /** Filter mode for typeahead. Default: "contains". */
    filterMode?: "contains" | "startsWith" | "off";
    /** Custom filter — overrides `filterMode` when set. */
    filter?: (item: IListBoxItem, query: string) => boolean;
    /** Renders inside the popover when filtered list is empty. Default: "no results". */
    emptyMessage?: React.ReactNode;
    /** Maximum number of visible rows in the popover before scrolling. Default: 10. */
    maxVisibleItems?: number;
    /** Pixel height of each row. Forwarded to the inner ListBox. Default: 24. */
    rowHeight?: number;
    /**
     * When true, the dropdown gains a resize handle at the bottom-right corner.
     * Forwarded to the inner Popover. Useful when long item labels exceed the
     * input width and `matchAnchorWidth` truncates the list.
     */
    resizable?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        width: "100%",
        minWidth: 0,
    },
    { label: "Select" },
);

// --- Helpers ---

function runAccessor<R>(source: unknown, accessor: TraitType<R>): R {
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof TraitType<R>)[]).map((k) => [k, accessor[k](source)]),
    ) as R;
}

function defaultMatch(item: IListBoxItem, q: string, mode: "contains" | "startsWith" | "off"): boolean {
    if (mode === "off" || q === "") return true;
    const label = typeof item.label === "string" ? item.label.toLowerCase() : "";
    const query = q.toLowerCase();
    return mode === "startsWith" ? label.startsWith(query) : label.includes(query);
}

// --- Component ---

const defaultRowHeight = 24;
const defaultMaxVisibleItems = 10;

function SelectInner<T = IListBoxItem>(
    props: SelectProps<T>,
    ref: React.ForwardedRef<HTMLInputElement>,
) {
    const {
        items,
        value,
        onChange,
        onItemsLoadError,
        placeholder,
        disabled,
        readOnly,
        size = "md",
        filterMode = "contains",
        filter,
        emptyMessage,
        maxVisibleItems = defaultMaxVisibleItems,
        rowHeight = defaultRowHeight,
        resizable,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        ...rest
    } = props;

    const reactId = useId();
    const selectId = `select-${reactId}`;
    const listboxId = `${selectId}-listbox`;

    const inputRef = useRef<HTMLInputElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const setInputRef = useCallback(
        (el: HTMLInputElement | null) => {
            inputRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
        },
        [ref],
    );

    const [open, setOpen] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [popoverResized, setPopoverResized] = useState(false);

    // Load items (sync immediately, async on first open).
    const { items: loadedItems, sources: loadedSources, loading: itemsLoading } =
        useSelectItems<T>(items, open, onItemsLoadError);

    // Resolve a single value to IListBoxItem. Plain T is cast (assumes T = IListBoxItem);
    // Traited<T> uses the accessor it carries.
    const resolveSingleValue = useCallback((v: T | Traited<T>): IListBoxItem => {
        if (isTraited<T>(v)) {
            const acc = v.traits.get(LIST_ITEM_KEY);
            if (acc) return runAccessor<IListBoxItem>(v.target, acc);
            return v.target as unknown as IListBoxItem;
        }
        return v as unknown as IListBoxItem;
    }, []);

    const selectedResolved = useMemo(
        () => (value != null ? resolveSingleValue(value) : null),
        [value, resolveSingleValue],
    );

    // Filter loaded items by the active search text. Build parallel filteredItems +
    // filteredSources arrays so onListChange can map IListBoxItem → source T.
    const { filteredItems, filteredSources } = useMemo(() => {
        const matchFn =
            filter ??
            ((it: IListBoxItem) => defaultMatch(it, searchText, filterMode));
        const items: IListBoxItem[] = [];
        const sources: T[] = [];
        const skipFilter = !open || filterMode === "off";
        for (let i = 0; i < loadedItems.length; i++) {
            const it = loadedItems[i];
            if (skipFilter || matchFn(it, searchText)) {
                items.push(it);
                sources.push(loadedSources[i]);
            }
        }
        return { filteredItems: items, filteredSources: sources };
    }, [loadedItems, loadedSources, open, searchText, filterMode, filter]);

    // displayText: when closed, the resolved label; when open, the live query.
    const displayText = useMemo(() => {
        if (open) return searchText;
        if (selectedResolved == null) return "";
        return typeof selectedResolved.label === "string" ? selectedResolved.label : "";
    }, [open, searchText, selectedResolved]);

    // Reset search + active + manual-resize flag when the popover closes.
    useEffect(() => {
        if (!open) {
            setSearchText("");
            setActiveIndex(null);
            setPopoverResized(false);
        }
    }, [open]);

    // Helpers ---------------------------------------------------------------

    const tryOpen = useCallback(() => {
        if (disabled || readOnly) return;
        if (!open) setOpen(true);
    }, [disabled, readOnly, open]);

    const onInputChange: InputProps["onChange"] = useCallback(
        (val: string) => {
            if (disabled || readOnly) return;
            if (!open) setOpen(true);
            setSearchText(val);
        },
        [disabled, readOnly, open],
    );

    const onInputFocus = useCallback(() => {
        tryOpen();
    }, [tryOpen]);

    const onInputClick = useCallback(() => {
        tryOpen();
    }, [tryOpen]);

    const onChevronMouseDown = useCallback((e: React.MouseEvent) => {
        // Prevent the input from losing focus when the chevron is pressed.
        e.preventDefault();
    }, []);

    const onChevronClick = useCallback(() => {
        if (disabled || readOnly) return;
        setOpen((o) => !o);
        // Keep focus on the input regardless of open/close direction.
        inputRef.current?.focus();
    }, [disabled, readOnly]);

    const commitSelection = useCallback(
        (idx: number) => {
            const source = filteredSources[idx];
            if (source === undefined) return;
            onChange?.(source);
            setOpen(false);
            setSearchText("");
            inputRef.current?.focus();
        },
        [filteredSources, onChange],
    );

    const onListChange = useCallback(
        (item: IListBoxItem) => {
            const idx = filteredItems.indexOf(item);
            if (idx < 0) return;
            commitSelection(idx);
        },
        [filteredItems, commitSelection],
    );

    const onInputKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (disabled) return;
            switch (e.key) {
                case "ArrowDown":
                case "PageDown": {
                    if (readOnly) return;
                    e.preventDefault();
                    if (!open) {
                        setOpen(true);
                        return;
                    }
                    const step = e.key === "PageDown" ? 9 : 1;
                    const cur = activeIndex ?? -1;
                    const next = Math.min(filteredItems.length - 1, cur + step);
                    if (next >= 0) setActiveIndex(next);
                    break;
                }
                case "ArrowUp":
                case "PageUp": {
                    if (readOnly) return;
                    e.preventDefault();
                    if (!open) {
                        setOpen(true);
                        return;
                    }
                    const step = e.key === "PageUp" ? 9 : 1;
                    const cur = activeIndex ?? 0;
                    const next = Math.max(0, cur - step);
                    setActiveIndex(next);
                    break;
                }
                case "Home":
                    if (open && filteredItems.length > 0) {
                        e.preventDefault();
                        setActiveIndex(0);
                    }
                    break;
                case "End":
                    if (open && filteredItems.length > 0) {
                        e.preventDefault();
                        setActiveIndex(filteredItems.length - 1);
                    }
                    break;
                case "Enter":
                    if (open && activeIndex != null && activeIndex >= 0 && activeIndex < filteredItems.length) {
                        e.preventDefault();
                        commitSelection(activeIndex);
                    } else if (!open && !readOnly) {
                        e.preventDefault();
                        setOpen(true);
                    }
                    break;
                case "Escape":
                    if (open) {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpen(false);
                    }
                    break;
            }
        },
        [disabled, readOnly, open, activeIndex, filteredItems.length, commitSelection],
    );

    return (
        <Root
            ref={rootRef}
            data-type="select"
            data-id={selectId}
            data-state={open ? "open" : "closed"}
            data-disabled={disabled || undefined}
            data-readonly={readOnly || undefined}
            {...rest}
        >
            <Input
                ref={setInputRef}
                size={size}
                value={displayText}
                onChange={onInputChange}
                placeholder={placeholder}
                disabled={disabled}
                readOnly={readOnly}
                onFocus={onInputFocus}
                onClick={onInputClick}
                onKeyDown={onInputKeyDown}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                endSlot={
                    <IconButton
                        icon={open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                        size="sm"
                        tabIndex={-1}
                        disabled={disabled || readOnly}
                        onMouseDown={onChevronMouseDown}
                        onClick={onChevronClick}
                    />
                }
            />
            <Popover
                open={open}
                onClose={() => setOpen(false)}
                elementRef={rootRef.current}
                placement="bottom-start"
                offset={[0, 2]}
                matchAnchorWidth
                resizable={resizable}
                onResize={() => setPopoverResized(true)}
                outsideClickIgnoreSelector={`[data-type="select"][data-id="${selectId}"]`}
            >
                <ListBox<IListBoxItem>
                    id={listboxId}
                    items={filteredItems}
                    value={selectedResolved ?? null}
                    activeIndex={activeIndex}
                    onActiveChange={setActiveIndex}
                    onChange={onListChange}
                    searchText={searchText}
                    rowHeight={rowHeight}
                    growToHeight={popoverResized ? undefined : maxVisibleItems * rowHeight}
                    loading={itemsLoading}
                    emptyMessage={emptyMessage ?? "no results"}
                />
            </Popover>
        </Root>
    );
}

export const Select = forwardRef(SelectInner) as <T = IListBoxItem>(
    props: SelectProps<T> & { ref?: React.Ref<HTMLInputElement> },
) => React.ReactElement | null;
