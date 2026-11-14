import { TComponentModel } from "../../core/state/model";
import { isTraited, traited, Traited } from "../../core/traits/traits";
import { LIST_ITEM_KEY, type IListBoxItem } from "../ListBox/types";
import type { MultiListBoxProps } from "./MultiListBoxView";
import { filterParallel, matchLabel } from "../shared/list-filter";

export interface MultiListBoxState {
    searchText: string;
    activeIndex: number | null;
}

export const defaultMultiListBoxState: MultiListBoxState = {
    searchText: "",
    activeIndex: null,
};

interface ResolvedItems<T> {
    resolved: IListBoxItem[];
    sources: T[];
    extractValue: (value: T) => string | number;
}

function resolveItems<T>(items: T[] | Traited<unknown[]>): ResolvedItems<T> {
    if (isTraited<unknown[]>(items)) {
        const accessor = items.traits.get(LIST_ITEM_KEY);
        const sources = items.target as T[];
        if (accessor) {
            return {
                resolved: sources.map((value) => ({
                    value: accessor.value(value) as string | number,
                    label: accessor.label(value),
                    icon: accessor.icon?.(value),
                    disabled: accessor.disabled ? Boolean(accessor.disabled(value)) : undefined,
                })),
                sources,
                extractValue: (value) => accessor.value(value) as string | number,
            };
        }
        return {
            resolved: sources as unknown as IListBoxItem[],
            sources,
            extractValue: (value) => (value as unknown as IListBoxItem).value,
        };
    }
    return {
        resolved: items as unknown as IListBoxItem[],
        sources: items,
        extractValue: (value) => (value as unknown as IListBoxItem).value,
    };
}

/** Controlled multi-select list state, filtering and selection operations. */
export class MultiListBoxModel<T = IListBoxItem> extends TComponentModel<
    MultiListBoxState,
    MultiListBoxProps<T>
> {
    private appliedItems: MultiListBoxProps<T>["items"] | undefined = undefined;
    private appliedValue: MultiListBoxProps<T>["value"] | undefined = undefined;
    private appliedFilterMode: MultiListBoxProps<T>["filterMode"] | undefined = undefined;
    private hasAppliedProps = false;

    resolvedItems: ResolvedItems<T> = {
        resolved: [],
        sources: [],
        extractValue: (value) => (value as unknown as IListBoxItem).value,
    };
    selectedKeys = new Set<string | number>();
    filtered: { sources: T[]; items: IListBoxItem[] } = { sources: [], items: [] };
    listBoxItems: T[] | Traited<unknown[]> = [];
    visibleSelectedCount = 0;

    setProps = (): void => {
        const itemsChanged = !this.hasAppliedProps || this.appliedItems !== this.props.items;
        const valueChanged = !this.hasAppliedProps || this.appliedValue !== this.props.value;
        const filterChanged = !this.hasAppliedProps || this.appliedFilterMode !== this.props.filterMode;

        if (itemsChanged) this.resolvedItems = resolveItems(this.props.items);
        if (itemsChanged || valueChanged) {
            this.selectedKeys = new Set(this.props.value.map(this.resolvedItems.extractValue));
        }
        if (itemsChanged || filterChanged) {
            this.filtered = this.deriveFiltered(this.state.get().searchText);
            this.listBoxItems = this.deriveListBoxItems();
        }
        if (itemsChanged || valueChanged || filterChanged) {
            this.visibleSelectedCount = this.deriveVisibleSelectedCount();
        }

        this.appliedItems = this.props.items;
        this.appliedValue = this.props.value;
        this.appliedFilterMode = this.props.filterMode;
        this.hasAppliedProps = true;
    };

    private deriveFiltered(searchText: string): { sources: T[]; items: IListBoxItem[] } {
        const { resolved, sources } = this.resolvedItems;
        const mode = this.props.filterMode ?? "contains";
        const filtered = filterParallel(resolved, sources, (item) => matchLabel(item, searchText, mode));
        return { sources: filtered.sources, items: filtered.items };
    }

    private deriveListBoxItems(): T[] | Traited<unknown[]> {
        const items = this.props.items;
        return isTraited<unknown[]>(items)
            ? traited(this.filtered.sources, items.traits)
            : this.filtered.sources;
    }

    private deriveVisibleSelectedCount(): number {
        return this.filtered.items.filter((item) => this.selectedKeys.has(item.value)).length;
    }

    get allVisibleSelected(): boolean {
        return this.filtered.items.length > 0
            && this.visibleSelectedCount === this.filtered.items.length;
    }

    get someVisibleSelected(): boolean {
        return this.visibleSelectedCount > 0 && !this.allVisibleSelected;
    }

    setSearchText = (searchText: string) => {
        this.filtered = this.deriveFiltered(searchText);
        this.listBoxItems = this.deriveListBoxItems();
        this.visibleSelectedCount = this.deriveVisibleSelectedCount();
        this.state.update((state) => { state.searchText = searchText; });
    };

    setActiveIndex = (activeIndex: number | null) => {
        this.state.update((state) => { state.activeIndex = activeIndex; });
    };

    /**
     * The row-selected predicate handed to `ListBox`.
     *
     * `ListBox` repaints its cells when the explicit `selectedKeys` signal moves. The predicate
     * itself remains stable because it reads the current plain fields. The inner list does not
     * receive `value`, so the explicit `selectedKeys` signal carries parent-owned selection changes
     * and triggers the repaint.
     */
    isSelected = this.isSelectedForSource.bind(this);

    private isSelectedForSource(source: T): boolean {
        return this.selectedKeys.has(this.resolvedItems.extractValue(source));
    }

    toggle = (source: T) => {
        if (this.props.disabled || this.props.readOnly) return;
        const { extractValue } = this.resolvedItems;
        const key = extractValue(source);
        this.props.onChange(
            this.selectedKeys.has(key)
                ? this.props.value.filter((value) => extractValue(value) !== key)
                : [...this.props.value, source],
        );
    };

    toggleSelectAll = () => {
        if (this.props.disabled || this.props.readOnly) return;
        const { items, sources } = this.filtered;
        const { extractValue } = this.resolvedItems;
        const visibleKeys = new Set(items.map((item) => item.value));
        if (this.allVisibleSelected) {
            this.props.onChange(this.props.value.filter((value) => !visibleKeys.has(extractValue(value))));
            return;
        }
        const next = this.props.value.slice();
        items.forEach((item, index) => {
            if (!this.selectedKeys.has(item.value)) next.push(sources[index]);
        });
        this.props.onChange(next);
    };
}
