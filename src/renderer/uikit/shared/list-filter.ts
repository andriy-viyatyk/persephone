import type { IListBoxItem } from "../ListBox/types";

/** Match one list label using the shared UIKit filtering rules. */
export function matchLabel(
    item: IListBoxItem,
    query: string,
    mode: "contains" | "startsWith" | "off",
): boolean {
    if (mode === "off" || query === "") return true;
    const label = typeof item.label === "string" ? item.label.toLowerCase() : "";
    const normalizedQuery = query.toLowerCase();
    return mode === "startsWith" ? label.startsWith(normalizedQuery) : label.includes(normalizedQuery);
}

/** Filter parallel item/source arrays in item order using one predicate result for each pair. */
export function filterParallel<TItem, TSource>(
    items: TItem[],
    sources: TSource[],
    predicate: (item: TItem, index: number) => boolean,
): { items: TItem[]; sources: TSource[] } {
    const filteredItems: TItem[] = [];
    const filteredSources: TSource[] = [];
    for (let index = 0; index < items.length; index++) {
        if (!predicate(items[index], index)) continue;
        filteredItems.push(items[index]);
        filteredSources.push(sources[index]);
    }
    return { items: filteredItems, sources: filteredSources };
}
