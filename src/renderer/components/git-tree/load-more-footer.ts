/**
 * The "Load more · Load all" footer for the Git Tree grid (EPIC-030 / US-611; ported to av-grid in
 * EPIC-057 / US-1021).
 *
 * Handed to av-grid as `extraElement`, which is the one host element the grid **parents and
 * nothing else** — never inspected, cleared, restyled beyond the `avg-extra` class, or destroyed,
 * and left intact by `destroy()`. So unlike a cell, this element may safely own listeners: it is an
 * overlay, not something the cell pool recycles.
 *
 * av-grid's own stylesheet positions `.avg-extra` as a full-width band at the bottom of the
 * scrolling content, so the four positioning declarations the earlier renderer hand-wrote are gone
 * (US-1021 F5). The band is taller than the default 20px trailing slack, so the caller pairs it
 * with `whiteSpaceY`.
 */
import { t } from "../../../shared/i18n/t";

export interface LoadMoreFooter {
    /** Pass to `DataGrid`'s `extraElement`. */
    readonly element: HTMLElement;
    /** Swap between the two states: a disabled "Loading…" line, or the two links. */
    setLoading(loading: boolean): void;
    dispose(): void;
}

export interface LoadMoreFooterHandlers {
    onLoadMore(): void;
    onLoadAll(): void;
}

/** Build the footer. The caller owns it for the life of the grid and calls `dispose()` on unmount. */
export function createLoadMoreFooter(handlers: LoadMoreFooterHandlers): LoadMoreFooter {
    const element = document.createElement("div");
    element.className = "git-tree-load-more";
    element.dataset.type = "git-tree-load-more";

    // One listener on the root, dispatching by `data-action`, so `setLoading` can replace the
    // children freely without rebinding anything.
    const onClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const action = target.closest("[data-action]")?.getAttribute("data-action");
        if (action === "load-more") handlers.onLoadMore();
        else if (action === "load-all") handlers.onLoadAll();
    };
    element.addEventListener("click", onClick);

    let loading: boolean | undefined;

    const setLoading = (next: boolean): void => {
        if (loading === next) return;
        loading = next;
        const item = (label: string, action?: string): HTMLSpanElement => {
            const span = document.createElement("span");
            span.className = "git-tree-load-more-link";
            if (action) span.dataset.action = action;
            else span.dataset.disabled = "";
            span.textContent = label;
            return span;
        };
        if (next) {
            element.replaceChildren(item(t("common.loading")));
        } else {
            const separator = document.createElement("span");
            separator.className = "git-tree-load-more-sep";
            separator.textContent = "·";
            element.replaceChildren(item(t("menus.loadMore"), "load-more"), separator, item(t("menus.loadAll"), "load-all"));
        }
    };

    setLoading(false);

    return {
        element,
        setLoading,
        dispose: () => element.removeEventListener("click", onClick),
    };
}
