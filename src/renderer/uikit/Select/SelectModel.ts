import { TComponentModel } from "../../core/state/model";
import { isTraited, resolveTraited, resolveTraitedOne } from "../../core/traits/traits";
import { IListBoxItem, LIST_ITEM_KEY } from "../ListBox/types";
import type { InputProps } from "../Input/InputView";
import type { NativeHTMLAttributes } from "../shared/dom-props";
import type { ItemsLike, SelectOwnProps } from "./SelectProps";
import { filterParallel, matchLabel } from "../shared/list-filter";
import { nextActiveIndex } from "../shared/list-navigation";

const SELECT_NAVIGATION_OPTIONS = { wrap: false, page: 9, pageStart: "before-first", pageFallback: "none" } as const;

// =============================================================================
// Public types
// =============================================================================

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

export interface SelectProps<T = IListBoxItem>
    extends Omit<NativeHTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange">, SelectOwnProps<T> {
    "aria-label"?: string;
    "aria-labelledby"?: string;
}

// =============================================================================
// Helpers
// =============================================================================

interface ResolvedItems {
    items: IListBoxItem[];
    sources: unknown[];
}

function toResolvedItems(input: ItemsLike<unknown>): ResolvedItems {
    if (isTraited<unknown[]>(input)) {
        return {
            items: resolveTraited<IListBoxItem>(input, LIST_ITEM_KEY),
            sources: input.target as unknown[],
        };
    }
    const arr = input as unknown[];
    return {
        items: arr as unknown as IListBoxItem[],
        sources: arr,
    };
}

function isThenable(v: unknown): v is Promise<unknown> {
    return v != null && typeof (v as { then?: unknown }).then === "function";
}

/** Sync forms resolve immediately; every other form is deferred to the first open. */
function isSyncSource(source: unknown): boolean {
    return Array.isArray(source) || isTraited<unknown[]>(source);
}

/**
 * Sentinel for "no `items` reference has been applied yet", so the first prop pump counts as a
 * change. `undefined` cannot serve: it is a legal (if useless) `items` value, and the first prop
 * pump always runs once.
 */
const NO_SOURCE = Symbol("select-no-items-source");

// =============================================================================
// State
// =============================================================================

export interface SelectState {
    open: boolean;
    searchText: string;
    activeIndex: number | null;
    popoverResized: boolean;
    // Current item-source state:
    loadedItems: IListBoxItem[];
    loadedSources: unknown[];
    itemsLoading: boolean;
    itemsLoaded: boolean;
    /**
     * The last load error is reported through `props.onItemsLoadError` at the rejection site and
     * is not rendered. If the view displays it later, add it to `SelectView`'s bind selector so the
     * view updates when the error changes.
     */
    itemsError: unknown;
}

export const defaultSelectState: SelectState = {
    open: false,
    searchText: "",
    activeIndex: null,
    popoverResized: false,
    loadedItems: [],
    loadedSources: [],
    itemsLoading: false,
    itemsLoaded: false,
    itemsError: null,
};

// =============================================================================
// Model
// =============================================================================

const defaultRowHeight = 24;
const defaultMaxVisibleItems = 10;

export class SelectModel<T = IListBoxItem> extends TComponentModel<SelectState, SelectProps<T>> {
    // --- refs (DOM) ---
    inputRef: HTMLInputElement | null = null;
    rootRef: HTMLDivElement | null = null;

    setInputRef = (el: HTMLInputElement | null) => {
        this.inputRef = el;
    };
    setRootRef = (el: HTMLDivElement | null) => {
        this.rootRef = el;
    };

    // --- ids ---
    /**
     * The value is opaque and generated; the
     * *relationship* it encodes is the contract — `data-id` on the root is interpolated into the
     * popover's `outsideClickIgnoreSelector`, and `listboxId` is the `Input`'s `aria-controls` and
     * the list's `id`, which `aria-activedescendant` is derived from.
     */
    private _elementId = "";
    setElementId = (elementId: string) => {
        this._elementId = elementId;
    };
    get selectId(): string {
        return this._elementId;
    }
    get listboxId(): string {
        return `${this.selectId}-listbox`;
    }

    // --- in-flight load token (not state — invalidates async work without re-rendering) ---
    private _loadId = 0;

    /**
     * The `items` reference the load cache currently reflects. Owned by the loader rather than
     * derived from a previous-props snapshot, which cannot tell "never pumped" from "pumped
     * undefined". See `setProps`.
     */
    private appliedItemsSource: unknown = NO_SOURCE;
    private appliedValue: SelectProps<T>["value"] | undefined = undefined;
    private appliedFilterMode: SelectProps<T>["filterMode"] | undefined = undefined;
    private appliedFilter: SelectProps<T>["filter"] | undefined = undefined;
    private hasAppliedProps = false;

    /**
     * One-shot flag set by `commitSelection` so the focus call we issue right after
     * closing doesn't bounce back through `onInputFocus` → `tryOpen` → re-open.
     * The model's `state.get()` reads live state, so we need an explicit guard.
     */
    private _suppressFocusOpen = false;

    // --- derived ---

    selectedResolved: IListBoxItem | null = null;

    /** Filter loaded items by the active search text. Build parallel filteredItems +
     *  filteredSources arrays so onListChange can map IListBoxItem → source T. */
    filtered: { filteredItems: IListBoxItem[]; filteredSources: T[] } = {
        filteredItems: [],
        filteredSources: [],
    };

    private deriveFiltered(
        loadedItems: IListBoxItem[],
        loadedSources: unknown[],
        open: boolean,
        searchText: string,
    ): { filteredItems: IListBoxItem[]; filteredSources: T[] } {
        const filterMode = this.props.filterMode ?? "contains";
        const customFilter = this.props.filter;
        const skipFilter = !open || filterMode === "off";
        const filtered = filterParallel(loadedItems, loadedSources as T[], (item) =>
            skipFilter || (customFilter
                ? customFilter(item, searchText)
                : matchLabel(item, searchText, filterMode)),
        );
        return { filteredItems: filtered.items, filteredSources: filtered.sources };
    }

    private deriveDisplayText(open: boolean, searchText: string): string {
        if (open) return searchText;
        const sel = this.selectedResolved;
        if (sel == null) return "";
        return typeof sel.label === "string" ? sel.label : "";
    }

    private deriveForState(
        open: boolean,
        searchText: string,
        loadedItems = this.state.get().loadedItems,
        loadedSources = this.state.get().loadedSources,
    ): void {
        this.filtered = this.deriveFiltered(loadedItems, loadedSources, open, searchText);
        this.displayText = this.deriveDisplayText(open, searchText);
    }

    /**
     * Trigger label when closed; live query when open.
     *
     * **Invariant: while `open`, this returns `searchText` verbatim.** It is the `Input`'s `value`,
     * and `InputView.applyProps` writes `field.value` only when the pushed string differs from the
     * DOM. Because the echo happens synchronously inside the `input` event dispatch, an unmodified
     * query means no write at all — no caret move, no collapsed selection. The moment anything
     * normalises the query here (`trim()`, case folding, a length cap) that guard starts failing and
     * the caret jumps to the end whenever the user edits mid-string. If a transform ever becomes
     * necessary, the selection has to be preserved in `InputView`, not worked around here.
     */
    displayText = "";

    // --- open/close transitions ---

    /*
     * `open` has nine writers, and three of the four effects this model used to register were
     * consequences of it moving. They are now inline, and the two funnels below are the only places
     * that write it: `grep "s.open = "` inside this folder must return exactly these two hits.
     *
     * The mutators take an immer *draft* and never call `state.update` themselves, so a caller that
     * must produce ONE write can compose them. That matters: two writes push the child tree twice,
     * and the first push would tear the popover down while `activeIndex` and `popoverResized` were
     * still stale — the exact split the deleted `queueMicrotask` created, and the reason its guards
     * had to be re-checked inside it.
     */

    private openInto(s: SelectState, seedIndex: number): void {
        s.open = true;
        if (s.activeIndex == null && seedIndex >= 0) s.activeIndex = seedIndex;
    }

    /** A close is the only thing that resets the query. */
    private closeInto(s: SelectState): void {
        s.open = false;
        s.searchText = "";
        s.activeIndex = null;
        s.popoverResized = false;
    }

    private openPopover = () => {
        if (this.props.disabled || this.props.readOnly) return;
        // Also the focus-bounce guard: `open` is assigned to `currentState` before listeners run,
        // so a nested `onInputFocus` -> `openPopover` from a synchronous focus event writes nothing
        // and, critically, does not re-run the load or the seed.
        if (this.state.get().open) return;
        const current = this.state.get();
        const seedIndex = this.seedIndex(current.loadedItems, current.searchText);
        this.deriveForState(true, current.searchText);
        this.state.update((s) => this.openInto(s, seedIndex));
        this.startLoadIfNeeded();
    };

    private closePopover = () => {
        // Makes a double close a no-op rather than a second full dispatch — Escape racing the
        // popover's own document keydown handler, or an outside click racing a chevron click.
        if (!this.state.get().open) return;
        this.deriveForState(false, "");
        this.state.update((s) => this.closeInto(s));
    };

    /**
     * Index of the selected item in the list the `ListBox` will actually receive, or -1.
     *
     * `activeIndex` is in **filtered** index space everywhere else (`commitSelection` reads `filteredSources[idx]`; the keyboard arms bound
     * on `filteredItems.length`). The two spaces coincide only while the query is empty, and they
     * diverge on a reachable path: with a value selected and the popover closed, typing one
     * character opens and filters in the same write, so the old seed indexed the unfiltered array
     * and highlighted the wrong row. Walking the filtered order makes the result a valid index by
     * construction.
     *
     * Both the item array and the search text are **parameters**, not reads of `this.state`: the
     * load path calls this with the items it is about to commit, which are not in state yet, and the
     * keystroke path calls it with the query it is about to commit. Reading either from state gives
     * the pre-write value — silently -1 on the load path, where the whole point is to seed the
     * highlight for rows that have just arrived.
     */
    private seedIndex(items: IListBoxItem[], searchText: string): number {
        if (items.length === 0) return -1;
        const sel = this.selectedResolved;
        if (!sel) return -1;
        const filterMode = this.props.filterMode ?? "contains";
        const customFilter = this.props.filter;
        // `open` is true at every call site, so `filtered`'s `!open` arm cannot apply here.
        const skipFilter = filterMode === "off";
        let visible = 0;
        for (const it of items) {
            if (!skipFilter && !(customFilter
                ? customFilter(it, searchText)
                : matchLabel(it, searchText, filterMode))) continue;
            if (it.value === sel.value) return visible;
            visible++;
        }
        return -1;
    }

    // --- handlers ---

    onInputChange: InputProps["onChange"] = (val: string) => {
        if (this.props.disabled || this.props.readOnly) return;
        const wasOpen = this.state.get().open;
        // The seed belongs to the open *transition* only. While already open, `activeIndex` keeps
        // whatever keyboard nav or hover put there — which is what the effect's deps did too.
        const seedIndex = wasOpen ? -1 : this.seedIndex(this.state.get().loadedItems, val);
        this.deriveForState(true, val);
        this.state.update((s) => {
            if (!s.open) this.openInto(s, seedIndex);
            s.searchText = val;
        });
        if (!wasOpen) this.startLoadIfNeeded();
    };

    onInputFocus = () => {
        if (this._suppressFocusOpen) {
            this._suppressFocusOpen = false;
            return;
        }
        this.openPopover();
    };

    onInputClick = () => {
        this.openPopover();
    };

    onChevronMouseDown = (e: MouseEvent) => {
        // Prevent the input from losing focus when the chevron is pressed.
        e.preventDefault();
    };

    onChevronClick = () => {
        if (this.props.disabled || this.props.readOnly) return;
        if (this.state.get().open) this.closePopover();
        else this.openPopover();
        // Keep focus on the input regardless of open/close direction.
        this.inputRef?.focus();
    };

    onPopoverClose = () => {
        this.closePopover();
    };

    onPopoverResize = () => {
        this.state.update((s) => {
            s.popoverResized = true;
        });
    };

    onActiveIndexChange = (i: number) => {
        this.state.update((s) => {
            s.activeIndex = i;
        });
    };

    private commitSelection = (idx: number) => {
        const { filteredSources } = this.filtered;
        const source = filteredSources[idx];
        if (source === undefined) return;
        this.props.onChange?.(source);
        // Set before the write, and now load-bearing for a second reason: the popover subtree is
        // detached *inside* `closePopover`'s synchronous dispatch.
        // If focus was inside the popover it is on `<body>` by the time `focus()`
        // runs, so `focus()` becomes a real focus change and `onInputFocus` fires synchronously.
        this._suppressFocusOpen = true;
        // `closeInto` resets `open` and `searchText` along with the other close state.
        this.closePopover();
        this.inputRef?.focus();
        // Clear the suppression flag after the focus event has had a chance to fire
        // (microtask runs after current sync work, including any synchronous focus event).
        queueMicrotask(() => {
            this._suppressFocusOpen = false;
        });
    };

    onListChange = (item: IListBoxItem) => {
        const { filteredItems } = this.filtered;
        const idx = filteredItems.indexOf(item);
        if (idx < 0) return;
        this.commitSelection(idx);
    };

    onInputKeyDown = (e: KeyboardEvent) => {
        const { disabled, readOnly } = this.props;
        if (disabled) return;
        const { open, activeIndex } = this.state.get();
        const { filteredItems } = this.filtered;
        switch (e.key) {
            case "ArrowDown":
            case "PageDown": {
                if (readOnly) return;
                e.preventDefault();
                if (!open) {
                    this.openPopover();
                    return;
                }
                const next = nextActiveIndex(e.key, activeIndex, filteredItems.length, SELECT_NAVIGATION_OPTIONS);
                if (next !== undefined) {
                    this.state.update((s) => { s.activeIndex = next; });
                }
                break;
            }
            case "ArrowUp":
            case "PageUp": {
                if (readOnly) return;
                e.preventDefault();
                if (!open) {
                    this.openPopover();
                    return;
                }
                const next = nextActiveIndex(e.key, activeIndex, filteredItems.length, SELECT_NAVIGATION_OPTIONS);
                if (next !== undefined) {
                    this.state.update((s) => { s.activeIndex = next; });
                }
                break;
            }
            case "Home":
                if (open && filteredItems.length > 0) {
                    e.preventDefault();
                    this.state.update((s) => {
                        s.activeIndex = 0;
                    });
                }
                break;
            case "End":
                if (open && filteredItems.length > 0) {
                    e.preventDefault();
                    this.state.update((s) => {
                        s.activeIndex = filteredItems.length - 1;
                    });
                }
                break;
            case "Enter":
                if (open && activeIndex != null && activeIndex >= 0 && activeIndex < filteredItems.length) {
                    e.preventDefault();
                    this.commitSelection(activeIndex);
                } else if (!open && !readOnly) {
                    e.preventDefault();
                    this.openPopover();
                }
                break;
            case "Escape":
                if (open) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closePopover();
                    this.props.onEscape?.();
                }
                break;
        }
    };

    // --- items loading ---

    private startLoad() {
        const source = this.props.items;
        // Sync forms — set immediately, no async at all.
        if (isSyncSource(source)) {
            const r = toResolvedItems(source as ItemsLike<unknown>);
            this.commitLoaded(r);
            return;
        }
        // Async forms — start a Promise and tag it with a load id so a stale resolution
        // can detect it has been superseded.
        this._loadId += 1;
        const myLoadId = this._loadId;
        this.state.update((s) => {
            s.itemsLoading = true;
            s.itemsError = null;
        });
        const invoked: ItemsLike<unknown> | Promise<ItemsLike<unknown>> =
            typeof source === "function"
                ? (source as () => ItemsLike<unknown> | Promise<ItemsLike<unknown>>)()
                : (source as Promise<ItemsLike<unknown>>);

        if (isThenable(invoked)) {
            (invoked as Promise<ItemsLike<unknown>>)
                .then((res) => {
                    if (!this.isLive || myLoadId !== this._loadId) return;
                    this.commitLoaded(toResolvedItems(res));
                })
                .catch((e) => {
                    if (!this.isLive || myLoadId !== this._loadId) return;
                    this.state.update((s) => {
                        s.itemsError = e;
                        s.itemsLoading = false;
                    });
                    this.props.onItemsLoadError?.(e);
                });
        } else {
            this.commitLoaded(toResolvedItems(invoked as ItemsLike<unknown>));
        }
    }

    /**
     * The only place `itemsLoaded` becomes true, and therefore the second of the two triggers the
     * `activeIndex` seed used to get from its effect's `[open, itemsLoaded]` deps. It is how an
     * async source gets its highlight once the rows arrive.
     *
     * The seed is deliberately in the **same** `state.update` as the row set. One write means
     * `ListBoxView` sees a moved `repaintSignature()` and a moved `activeIndex` in one push, so it
     * chooses `scrollToRowAfterPaint` — the correct entry point when the row set just changed
     * (uikit/CLAUDE.md Rule 9). Split into two writes, the second push reports no content change and
     * picks `scrollToRow`, which silently scrolls short once the grid is already measured.
     *
     * The guards are read from the draft: a promise settles at an arbitrary later time, so the
     * popover may have closed, reopened, or the highlight may already have been moved.
     */
    private commitLoaded(r: ResolvedItems): void {
        const current = this.state.get();
        const seedIndex = current.open
            ? this.seedIndex(r.items, current.searchText)
            : -1;
        this.deriveForState(current.open, current.searchText, r.items, r.sources);
        this.state.update((s) => {
            s.loadedItems = r.items;
            s.loadedSources = r.sources;
            s.itemsLoaded = true;
            s.itemsLoading = false;
            s.itemsError = null;
            if (s.open && s.activeIndex == null && seedIndex >= 0) s.activeIndex = seedIndex;
        });
    }

    // --- forwarded API for the View — convenience getters ---
    get rowHeight(): number {
        return this.props.rowHeight ?? defaultRowHeight;
    }
    get maxVisibleItems(): number {
        return this.props.maxVisibleItems ?? defaultMaxVisibleItems;
    }

    // --- lifecycle ---

    /*
     * `createComponentModelDriver` owns prop updates. `setProps` resets item state when the source
     * identity changes; sync items load during that reset, while async items load on open. `closeInto`
     * resets close state, and `openInto` seeds the active index. These transitions write state at
     * their mutation sites. The remaining `queueMicrotask` clears `_suppressFocusOpen` after the
     * synchronous focus event.
     */

    /**
     * Runs on every prop pump — including the first, which happens inside
     * `createComponentModelDriver(...)`, i.e. inside the view's constructor. That is safe by
     * construction rather than by discipline: `open` is state and defaults to false, so the async arm
     * cannot fire before mount and no promise is ever started from a constructor. The sync arm writes
     * state that has no subscribers yet, and the view's `bind` applies immediately at `onMount`, so
     * the first render already has its items.
     */
    setProps = (): void => {
        const itemsChanged = !Object.is(this.props.items, this.appliedItemsSource);
        const valueChanged = !this.hasAppliedProps || this.appliedValue !== this.props.value;
        const filterChanged = !this.hasAppliedProps
            || this.appliedFilterMode !== this.props.filterMode
            || this.appliedFilter !== this.props.filter;

        if (valueChanged) this.selectedResolved = this.props.value == null
            ? null
            : resolveTraitedOne<IListBoxItem>(this.props.value, LIST_ITEM_KEY);
        if (valueChanged || filterChanged || itemsChanged) {
            const state = this.state.get();
            this.deriveForState(state.open, state.searchText);
        }

        this.appliedValue = this.props.value;
        this.appliedFilterMode = this.props.filterMode;
        this.appliedFilter = this.props.filter;
        this.hasAppliedProps = true;
        if (itemsChanged) {
            this.appliedItemsSource = this.props.items;
            this.resetItemsCache();
        }
    };

    /**
     * Invalidate the cache for a new `items` reference, and load immediately if the new source can.
     *
     * `_loadId` is bumped **before** any state write, so a listener running inside the dispatch
     * cannot observe a stale token and an in-flight promise from the previous source is already
     * superseded when it settles.
     *
     * For a sync source this is **one** write: `commitLoaded`
     * already writes all five fields, so a separate clear is redundant. That matters —
     * callers can rebuild their `items` array on every render, so this path runs on every pump. It
     * cannot loop: a state write does not pump
     * props in a vanilla driver, so reset -> load -> bind -> sync never re-enters `setProps`.
     */
    private resetItemsCache(): void {
        this._loadId += 1;
        if (isSyncSource(this.props.items)) {
            this.startLoad();
            return;
        }
        const current = this.state.get();
        this.deriveForState(current.open, current.searchText, [], []);
        this.state.update((s) => {
            s.loadedItems = [];
            s.loadedSources = [];
            s.itemsLoaded = false;
            s.itemsError = null;
        });
        if (this.state.get().open) this.startLoad();
    }

    /**
     * The async arm's trigger, called from the two open transitions. Sync sources never reach it:
     * `resetItemsCache` has already loaded them, and only an `items` change can un-load them.
     *
     * Deliberately **not** guarded on `itemsLoading`. Today's effect re-invoked the loader on every
     * open while `itemsLoaded` was false, and `_loadId` invalidation dropped the superseded result;
     * guarding here would silently change that to once-per-source. Defensible for a loader doing
     * HTTP, but it is a semantic change and belongs in its own task.
     */
    private startLoadIfNeeded(): void {
        if (this.state.get().itemsLoaded) return;
        if (isSyncSource(this.props.items)) return;
        this.startLoad();
    }

    dispose() {
        // Invalidate any in-flight Promise so its resolution is dropped.
        this._loadId += 1;
    }
}
