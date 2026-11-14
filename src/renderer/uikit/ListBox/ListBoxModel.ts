import { isTraited, resolveTraited, Traited, TraitType } from "../../core/traits/traits";
import type { RenderGridModel, RerenderInfo, RowAlign } from "../DataGrid";
import { ContextMenuEvent } from "../../core/events/context-menu";
import { createRepaintTracker } from "../shared/repaint-tracker";
import {
    IListBoxItem,
    LIST_ITEM_KEY,
    ListBoxProps,
} from "./types";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Everything a rendered cell reads that the virtualization engine cannot detect for itself.
 *
 * - **`items`, not the resolved array.** The resolved field is a pass-through projection of
 *   `props.items`, so its identity changes exactly when `props.items` does. `selectedKey` is the
 *   opposite case: its output is a normalised primitive key, so the model compares the *output*
 *   (a new `value` object resolving to the same key is no change).
 * - **Only inputs that change cell DOM.** `rowHeight` is deliberately absent because
 *   `RenderGridModel.inputChanged()` already compares it and repaints on its own; `getContextMenu`
 *   is absent because it is read live inside the context-menu handler and affects nothing rendered
 *   — keeping it would repaint the whole list on every update for callers that pass an inline
 *   arrow. `variant`, `selectionStyle` and `checkbox` are present: each changes every row's DOM.
 * - **A caller-owned selection needs a signal.** `MultiListBox` passes a stable membership
 *   predicate and never passes `value`, so checking a row moves no key unless its changing
 *   `selectedKeys` Set arrives as `selectionSignal`; without it the box would not redraw until an
 *   unrelated input changed.
 */
const listBoxRowsRepaintKeys = ["items"] as const satisfies readonly (keyof ListBoxProps<unknown>)[];
const listBoxGlobalRepaintKeys = [
    "id", "searchText", "isSelected", "selectionSignal", "getTooltip", "variant", "selectionStyle",
    "checkbox",
] as const satisfies readonly (keyof ListBoxProps<unknown>)[];
const listBoxLocalRepaintKeys = ["activeIndex"] as const satisfies readonly (keyof ListBoxProps<unknown>)[];

interface ListBoxPropUpdateResult {
    readonly repaint: RerenderInfo | undefined;
    readonly contentChanged: boolean;
}

function runAccessor<R>(source: unknown, accessor: TraitType<R>): R {
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof TraitType<R>)[]).map((k) => [k, accessor[k](source)]),
    ) as R;
}

// =============================================================================
// Model
// =============================================================================

export class ListBoxModel<T = IListBoxItem> {
    public props: ListBoxProps<T>;

    private readonly repaintTracker = createRepaintTracker<ListBoxProps<T>>({
        rows: listBoxRowsRepaintKeys as readonly (keyof ListBoxProps<T>)[],
        global: listBoxGlobalRepaintKeys as readonly (keyof ListBoxProps<T>)[],
        local: listBoxLocalRepaintKeys as readonly (keyof ListBoxProps<T>)[],
    });

    public constructor(props: ListBoxProps<T>) {
        this.props = props;
        this.resolved = this.resolveItems(props.items);
        this.selectedKey = this.resolveSelectedKey(props.value);
    }

    /** Apply one complete props object and return its corresponding grid repaint consequence. */
    update(props: ListBoxProps<T>): ListBoxPropUpdateResult {
        const previousProps = this.props;
        const diff = this.repaintTracker.diff(previousProps, props);
        const previousRows = this.resolved;
        const previousActiveIndex = previousProps.activeIndex;
        const previousSelectedKey = this.selectedKey;
        const previousSelectedIndex = this.findSelectedRowIndex(
            previousRows,
            previousProps,
            previousSelectedKey,
        );
        const nextSelectedKey = this.resolveSelectedKey(props.value);
        const rowsChanged = diff?.rows ?? false;
        const globalChanged = diff?.global ?? false;

        this.props = props;
        if (rowsChanged) this.resolved = this.resolveItems(props.items);
        this.selectedKey = nextSelectedKey;

        const selectedKeyChanged = !Object.is(previousSelectedKey, this.selectedKey);
        const activeChanged = previousActiveIndex !== props.activeIndex;
        const currentSelectedIndex = this.selectedRowIndex();
        let repaint: RerenderInfo | undefined;
        if (globalChanged || rowsChanged) {
            // Items, search, renderer, tooltip, variant, selection-style, and checkbox inputs
            // change the rendered content of every ListBox row.
            repaint = { all: true };
        } else if (selectedKeyChanged || activeChanged) {
            repaint = {
                rows: [...new Set([
                    previousActiveIndex,
                    props.activeIndex,
                    previousSelectedIndex,
                    currentSelectedIndex,
                ].filter((row): row is number => row !== undefined && row !== null && row >= 0))],
            };
        }

        return { repaint, contentChanged: repaint !== undefined };
    }

    get loading(): ListBoxProps<T>["loading"] {
        return this.props.loading;
    }

    get activeIndex(): ListBoxProps<T>["activeIndex"] {
        return this.props.activeIndex;
    }

    get searchText(): ListBoxProps<T>["searchText"] {
        return this.props.searchText;
    }

    // --- refs ---
    gridRef: RenderGridModel | null = null;
    setGridRef = (ref: RenderGridModel | null) => {
        this.gridRef = ref;
    };

    // --- ids ---
    private _elementId = "";
    /** Fed by the view from `nextElementId("lb")` — replaces the former generated-ID source. */
    setElementId = (elementId: string) => {
        this._elementId = elementId;
    };
    get rootId(): string {
        return this.props.id ?? this._elementId;
    }
    itemId = (idx: number): string => {
        const { resolved } = this.resolved;
        return `${this.rootId}-item-${resolved[idx]?.value}`;
    };

    // --- derived fields ---

    /** Resolved IListBoxItem[] + parallel sources array of source `T`. */
    resolved: { resolved: IListBoxItem[]; sources: T[] } = { resolved: [], sources: [] };

    /** Selected key from `value` prop (only used when `isSelected` is not provided). */
    selectedKey: string | number | null = null;

    private resolveItems(items: ListBoxProps<T>["items"]): { resolved: IListBoxItem[]; sources: T[] } {
        if (isTraited<unknown[]>(items)) {
            const resolved = resolveTraited<IListBoxItem>(items, LIST_ITEM_KEY);
            return { resolved, sources: items.target as T[] };
        }
        const sources = items as T[];
        return { resolved: sources as unknown as IListBoxItem[], sources };
    }

    private resolveSelectedKey(value: ListBoxProps<T>["value"]): string | number | null {
        return value == null ? null : this.resolveSingleValue(value).value;
    }

    private resolveSingleValue(v: T | Traited<T>): IListBoxItem {
        if (isTraited<T>(v)) {
            const acc = v.traits.get(LIST_ITEM_KEY);
            if (acc) return runAccessor<IListBoxItem>(v.target, acc);
            return v.target as unknown as IListBoxItem;
        }
        return v as unknown as IListBoxItem;
    }

    // --- selection / interaction predicates ---

    isSelectedAt = (idx: number): boolean => {
        const { resolved, sources } = this.resolved;
        const item = resolved[idx];
        if (!item || item.section) return false;
        if (this.props.isSelected) return this.props.isSelected(sources[idx], idx);
        const key = this.selectedKey;
        if (key == null) return false;
        return item.value === key;
    };

    /** Visible row index of the current selection, or -1 when no row is selected. */
    selectedRowIndex = (): number => {
        return this.findSelectedRowIndex(this.resolved, this.props, this.selectedKey);
    };

    private findSelectedRowIndex = (
        rows: { resolved: IListBoxItem[]; sources: T[] },
        props: ListBoxProps<T>,
        selectedKey: string | number | null,
    ): number => {
        for (let index = 0; index < rows.resolved.length; index++) {
            const item = rows.resolved[index];
            if (!item || item.section) continue;
            const selected = props.isSelected
                ? props.isSelected(rows.sources[index], index)
                : selectedKey != null && item.value === selectedKey;
            if (selected) return index;
        }
        return -1;
    };

    /**
     * Walk forward (`dir=1`) or backward (`dir=-1`) from `start` until a non-section,
     * non-disabled item is found. Returns -1 when no candidate exists in that direction.
     */
    findNextSelectable = (start: number, dir: 1 | -1): number => {
        const { resolved } = this.resolved;
        let i = start;
        while (i >= 0 && i < resolved.length) {
            const it = resolved[i];
            if (it && !it.section && !it.disabled) return i;
            i += dir;
        }
        return -1;
    };

    // --- handlers ---

    onItemClick = (idx: number) => {
        const { resolved, sources } = this.resolved;
        const item = resolved[idx];
        if (!item || item.disabled || item.section) return;
        this.props.onChange?.(sources[idx]);
    };

    onItemDoubleClick = (idx: number) => {
        const { resolved, sources } = this.resolved;
        const item = resolved[idx];
        if (!item || item.disabled || item.section) return;
        this.props.onItemDoubleClick?.(sources[idx], idx);
    };

    onItemMouseEnter = (idx: number) => {
        const { resolved } = this.resolved;
        const item = resolved[idx];
        if (!item || item.disabled || item.section) return;
        if (idx !== this.activeIndex) this.props.onActiveChange?.(idx);
    };

    onItemContextMenu = (e: MouseEvent, idx: number) => {
        const { resolved, sources } = this.resolved;
        const item = resolved[idx];
        if (!item || item.section) return;
        const items = this.props.getContextMenu?.(sources[idx], idx);
        if (!items || items.length === 0) return;
        const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "generic");
        ctxEvent.items.push(...items);
    };

    /**
     * Container-level context-menu handler. Skipped when a row already populated
     * `ContextMenuEvent.items` — the row's menu wins.
     */
    onRootContextMenu = (e: MouseEvent) => {
        if (e.contextMenuEvent?.items.length) return;
        this.props.onContextMenu?.(e);
    };

    onKeyDown = (e: KeyboardEvent) => {
        if (!this.props.keyboardNav) return;
        const { resolved } = this.resolved;
        const n = resolved.length;
        if (n === 0) return;
        const cur = this.activeIndex ?? -1;
        const apply = (target: number) => {
            if (target < 0) return;
            this.props.onActiveChange?.(target);
            this.gridRef?.scrollToRow(target);
        };
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                apply(this.findNextSelectable(Math.min(n - 1, cur + 1), 1));
                break;
            case "ArrowUp":
                e.preventDefault();
                apply(this.findNextSelectable(Math.max(0, cur - 1), -1));
                break;
            case "Home":
                e.preventDefault();
                apply(this.findNextSelectable(0, 1));
                break;
            case "End":
                e.preventDefault();
                apply(this.findNextSelectable(n - 1, -1));
                break;
            case "PageDown": {
                e.preventDefault();
                const page = Math.max(1, this.gridRef?.visibleRowCount ?? 1);
                const start = (cur < 0 ? 0 : cur) + page;
                const target = this.findNextSelectable(Math.min(n - 1, start), 1);
                apply(target >= 0 ? target : this.findNextSelectable(n - 1, -1));
                break;
            }
            case "PageUp": {
                e.preventDefault();
                const page = Math.max(1, this.gridRef?.visibleRowCount ?? 1);
                const start = (cur < 0 ? 0 : cur) - page;
                const target = this.findNextSelectable(Math.max(0, start), -1);
                apply(target >= 0 ? target : this.findNextSelectable(0, 1));
                break;
            }
            case "Enter":
                if (cur >= 0) {
                    e.preventDefault();
                    this.onItemClick(cur);
                }
                break;
        }
    };

    // --- imperative ref API ---

    scrollToIndex = (i: number, align?: RowAlign) => {
        this.gridRef?.scrollToRow(i, align);
    };

}
