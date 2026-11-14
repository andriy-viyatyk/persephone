import type { Traited } from "../../core/traits/traits";
import type { IListBoxItem } from "../ListBox/types";
import type { SlotText } from "../shared/slots";

export type ItemsLike<T> = T[] | Traited<T[]>;

export type ItemsSource<T> =
    | ItemsLike<T>
    | Promise<ItemsLike<T>>
    | (() => ItemsLike<T> | Promise<ItemsLike<T>>);

export interface SelectOwnProps<T = IListBoxItem> {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
    /**
     * Item source — accepts:
     *   • `T[]` / `Traited<T[]>` — sync, ready immediately.
     *   • `Promise<...>` — async; awaited on the first open, not on mount.
     *   • `() => T[] | Promise<...>` — lazy; invoked on the first open.
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
    emptyMessage?: SlotText;
    /**
     * Fires when the user presses Escape while the popover is open. Select also
     * closes the popover (without firing `onChange`) — the callback exists for
     * cancel-style flows where the caller needs to react to the cancel beyond
     * the implicit close (e.g. inline cell edit needs to also abandon the
     * pending text and exit edit mode).
     */
    onEscape?: () => void;
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
    /** Fixed width — number → px, string passes through. Default: fills parent (100%). Written to
     *  the Select root's inline style; the inner Input then fills it. */
    width?: number | string;
    /** Minimum width — number → px, string passes through. Written to the Select root. */
    minWidth?: number | string;
    /** Maximum width — number → px, string passes through. Written to the Select root. */
    maxWidth?: number | string;
}
