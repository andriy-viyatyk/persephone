import { useEffect, useState } from "react";
import { isTraited, resolveTraited, Traited } from "../../core/traits/traits";
import { IListBoxItem, LIST_ITEM_KEY } from "../ListBox";

type ItemsLike<T> = T[] | Traited<T[]>;

export type ItemsSource<T> =
    | ItemsLike<T>
    | Promise<ItemsLike<T>>
    | (() => ItemsLike<T> | Promise<ItemsLike<T>>);

export interface SelectItemsResult<T> {
    /** Trait-resolved IListBoxItem array. `[]` while loading or before first open of an async source. */
    items: IListBoxItem[];
    /** Parallel array of source `T` values — same length / index as `items`. */
    sources: T[];
    /** True while a Promise is in flight. */
    loading: boolean;
    /** Last load error (if any). Cleared on next load attempt. */
    error: unknown;
}

interface Resolved<T> {
    items: IListBoxItem[];
    sources: T[];
}

function toResolved<T>(input: ItemsLike<T>): Resolved<T> {
    if (isTraited<unknown[]>(input)) {
        return {
            items: resolveTraited<IListBoxItem>(input, LIST_ITEM_KEY),
            sources: input.target as T[],
        };
    }
    const arr = input as T[];
    return {
        items: arr as unknown as IListBoxItem[],
        sources: arr,
    };
}

function isThenable(v: unknown): v is Promise<unknown> {
    return v != null && typeof (v as { then?: unknown }).then === "function";
}

const EMPTY: Resolved<unknown> = { items: [], sources: [] };

/**
 * Loads `items` from a sync array, a sync `Traited`, a `Promise`, a function
 * returning either, or a function returning a `Promise`. Sync forms resolve
 * immediately. Function/Promise forms defer until `open` first becomes true,
 * then run once and cache the result. Changing the `source` reference
 * invalidates the cache.
 */
export function useSelectItems<T>(
    source: ItemsSource<T>,
    open: boolean,
    onError?: (e: unknown) => void,
): SelectItemsResult<T> {
    const [resolved, setResolved] = useState<Resolved<T>>(EMPTY as Resolved<T>);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        setLoaded(false);
        setResolved(EMPTY as Resolved<T>);
        setError(null);
    }, [source]);

    useEffect(() => {
        if (Array.isArray(source) || isTraited<unknown[]>(source)) {
            setResolved(toResolved<T>(source as ItemsLike<T>));
            setLoaded(true);
            return;
        }

        if (loaded) return;
        if (!open) return;

        let live = true;
        setLoading(true);
        setError(null);

        const invoked: ItemsLike<T> | Promise<ItemsLike<T>> =
            typeof source === "function"
                ? (source as () => ItemsLike<T> | Promise<ItemsLike<T>>)()
                : (source as Promise<ItemsLike<T>>);

        if (isThenable(invoked)) {
            (invoked as Promise<ItemsLike<T>>)
                .then((res) => {
                    if (!live) return;
                    setResolved(toResolved<T>(res));
                    setLoaded(true);
                    setLoading(false);
                })
                .catch((e) => {
                    if (!live) return;
                    setError(e);
                    setLoading(false);
                    onError?.(e);
                });
        } else {
            setResolved(toResolved<T>(invoked as ItemsLike<T>));
            setLoaded(true);
            setLoading(false);
        }

        return () => {
            live = false;
        };
    }, [source, open, loaded, onError]);

    return {
        items: resolved.items,
        sources: resolved.sources,
        loading,
        error,
    };
}
