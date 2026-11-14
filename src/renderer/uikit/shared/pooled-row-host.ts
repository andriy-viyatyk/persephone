import { RenderGrid } from "../DataGrid";
import type {
    RenderCellFunc,
    RenderCellParams,
    RenderGridModel,
    RenderGridOptions,
    RerenderInfo,
} from "../DataGrid";
import { applyCellStyle } from "./cell-style";
import { fillSlot } from "./fill-slot";
import type { IOwnedView } from "./vanilla-view";

export interface PooledRowView extends IOwnedView {
    mount(): HTMLElement;
}

export type RowHostEventType =
    | "click" | "dblclick" | "mouseenter" | "contextmenu"
    | "dragstart" | "dragend" | "dragenter" | "dragover" | "dragleave" | "drop";

export interface RowAdapter<
    K extends string,
    V extends PooledRowView = PooledRowView,
> {
    readonly events: readonly RowHostEventType[];
    rowCount(): number;
    kindFor(row: number, col: number): K | undefined;
    create(kind: K, row: number, col: number, wrapper: HTMLElement): V;
    update(view: V, row: number, col: number): void;
    onRowEvent(type: RowHostEventType, row: number, col: number, event: Event): void;
    updateWrapper?(wrapper: HTMLElement, row: number, col: number): void;
}

export interface PooledRowHostOptions {
    grid: Omit<RenderGridOptions, "rowCount" | "renderCell" | "keepCellsAttached">;
    hostParent?: HTMLElement;
    hostBefore?: Node | null;
    onGridModel?(model: RenderGridModel | null): void;
}

/**
 * Per-wrapper state survives ordinary pool release. The current row and column are refreshed on
 * every render so listeners installed once can resolve the coordinates of a recycled cell.
 */
/**
 * Per-wrapper state for a pooled cell.
 *
 * The pool deliberately does **not** reset a released element — its children, classes, attributes
 * and listeners all survive — so this map is how a recycled wrapper is recognised on its way back
 * in. `row` is rewritten on every render and read by the listeners installed once at creation,
 * which is why the row index never has to appear as a `data-*` attribute (the DOM contract has none).
 */
interface CellRecord<K extends string, V extends PooledRowView> {
    row: number;
    col: number;
    kind?: K;
    view?: V;
    slotCleanup?: () => void;
    removeListeners: (() => void)[];
}

/**
 * Owns the RenderGrid wrapper pool and the row views mounted into those wrappers. The adapter
 * continues to own native-value decisions: only view roots are filled here, while item slots stay
 * with their views. Adapters must check a DOM node's current host parent before reusing cached icon
 * or trailing nodes; node identity alone cannot prove it is still attached to the correct host.
 *
 * An adapter may adopt the selected wrapper as its view root. `VanillaView` accepts an existing
 * element as its root, and its ownership marker tracks view instances rather than DOM elements, so
 * a wrapper can be adopted by one view for its lifetime and safely reused after that view is
 * disposed. For an adopted root, this host skips `fillSlot` and never detaches the root individually;
 * it still disposes the view on leave, and the view must not remove its root. No slot cleanup applies.
 *
 * The optional host parent and anchor keep nested grids in a caller-selected location. Leaving both
 * unset preserves the owner-root placement used by ListBox and Tree with no behavioral change from
 * either new host option.
 *
 * Retained roots belong to pooled wrappers, not row identities. This host forces
 * `keepCellsAttached: true`, keeps every created view in a Set through the complete real-arm
 * lifetime, and disposes views only on a kind change or final leave. Grid release callbacks mean
 * active-set/pool bookkeeping, never destruction. The stable cell renderer preserves the grid's
 * render callback identity across option updates; `RenderGridModel.inputChanged()` compares that
 * function by identity, and a fresh callback would repaint every visible cell. Adapters that own keyed child subtrees must key
 * them to the current row or cell identity so state cannot bleed across recycled rows.
 *
 * #### Native slots inside a virtualized row
 *
 * `ListBox` and `ListItem` use native `SlotContent` values: text, numbers, DOM nodes, or arrays of
 * those values. **`icon` is also native** — an icon is a registry name or a DOM node and never a
 * `IconName | Node`, so an icon is a registry name or a DOM node and never a framework element. The
 * av-grid's `RenderGrid` cell contract is `HTMLElement` and receives only DOM. Four guard rails keep
 * slot ownership safe:
 *
 * - Decide **per slot**, not per row: an `IconName` becomes a DOM `svg` with no root; only a genuine
 *   native value goes through `fillSlot`. Never route strings through `fillSlot` for uniformity.
 * - A DOM icon node is **single-use**: appending it to a second host moves it and blanks the first.
 *   Build it at the point of use — never cache, memoise, hoist to module scope, or share one node.
 *   `tsc`, lint and the build are all blind to this, and the symptom is an icon disappearing somewhere
 *   other than the code being changed (this has occurred four times, once per caching mechanism).
 *   The fifth was different and is worth naming, because "never cache" alone did not prevent it.
 *   `TreeProviderViewImpl.iconCache` legitimately memoises one node per **href**, so no two rows ever
 *   want the same node at the same time — yet pooling still moved it: a cell that takes over a row
 *   steals the node out of the previous cell's host, and if that cell is later re-pointed at the same
 *   row it sees `directIconElement === iconElement` and skips the refill forever. **A cached node is
 *   only safe behind a guard that checks the host, not identity** — `node.parentNode === host` —
 *   because the host is the source of truth and identity is only a hint about it. `TreeItemView.setIcon`
 *   and `setTrailing` both check it.
 * - Roots are retained **per pooled element**, never per row. Pass `keepCellsAttached: true` when a
 *   cell owns state such as a nested scroller, iframe, or editor; ordinary eviction then hides the
 *   pooled element in place and preserves its subtree. The option is off by default because it
 *   trades DOM nodes for state. `ListBoxView` and `TreeView` set it explicitly, and `Autocomplete`
 *   inherits the ListBox setting; other consumers with retained child views must make the same
 *   opt-in. A settled scroll must create zero roots.
 * - `onCellAttached` means that a cell entered the active set. `onCellReleased` means that it left
 *   the active set and entered the pool, **not** that it was detached from the DOM: with
 *   `keepCellsAttached`, the element remains hidden in the document, and only pool overflow detaches
 *   it. Use these callbacks for bookkeeping such as measurement mappings, not slot cleanup.
 * - Never run a slot cleanup on eviction or on `onCellReleased` — only when a pooled wrapper changes
 *   kind and at final view disposal. Track created elements in a real `Set`, because an
 *   unmounted-but-undisposed root keeps its subscriptions alive on a detached tree.
 * - Key the caller's subtree by the cell key, so a recycled element remounts it rather than letting
 *   one row's state bleed into another's.
 */
export class PooledRowHost<K extends string, V extends PooledRowView> {
    private readonly cells = new WeakMap<HTMLElement, CellRecord<K, V>>();
    private readonly records = new Set<CellRecord<K, V>>();
    /**
     * Every item/section view created during the current real-arm lifetime, including views held
     * by pooled wrappers. CellPool is bounded at maxSize = 2000: recycled wrappers keep their
     * view, while only a pool-full discard detaches a wrapper without removing its view from this
     * set. ListBox never approaches that bound in practice, and teardown disposes the set
     * wholesale after the grid.
     */
    private readonly rowViews = new Set<V>();
    /**
     * **`renderCell` is a bound field, not a closure.** `RenderGridModel.inputChanged()` compares it
     * by identity, so a per-update closure would make the engine repaint every visible cell on every
     * update. Keeping the callback stable lets the engine detect real input changes.
     *
     * `renderCell` is a bound field, not a closure. `RenderGridModel.inputChanged()` compares it
     * by identity, so a per-update closure would make the engine repaint every visible cell on every
     * update — which would repaint every visible cell on every update, and what the repaint gate exists to stop.
     */
    private readonly renderCell: RenderCellFunc = (params) => this.render(params);
    // A thunk, so a pure row-count change is detected by the engine's own `inputChanged()`
    // and needs no slot in the repaint signature.
    private readonly rowCount = (): number => this.adapter.rowCount();
    private gridOptions: PooledRowHostOptions["grid"];
    private grid: RenderGrid | null = null;
    private entered = false;

    public constructor(
        private readonly owner: IOwnedView,
        private readonly host: HTMLElement,
        private readonly adapter: RowAdapter<K, V>,
        private readonly options: PooledRowHostOptions,
    ) {
        this.gridOptions = options.grid;
    }

    public get gridModel(): RenderGridModel | null {
        return this.grid?.model ?? null;
    }

    public enter(): void {
        if (this.grid) return;
        const parent = this.options.hostParent ?? this.owner.root;
        if (this.host !== parent && this.host.parentElement !== parent) {
            parent.insertBefore(this.host, this.options.hostBefore ?? null);
        }
        const grid = new RenderGrid(this.host, {
            ...this.gridOptions,
            rowCount: this.rowCount,
            renderCell: this.renderCell,
            keepCellsAttached: true,
        });
        this.grid = grid;
        this.entered = true;
        this.options.onGridModel?.(grid.model);
    }

    public leave(): void {
        this.entered = false;
        if (this.grid) this.options.onGridModel?.(null);
        this.grid?.destroy();
        this.grid = null;
        if (this.host !== this.owner.root) this.host.remove();

        // The pool is gone with the engine, so nothing may hold a recycled wrapper any more.
        for (const record of this.records) {
            this.releaseSlot(record);
            record.removeListeners.forEach((removeListener) => removeListener());
        }
        for (const view of this.rowViews) view.dispose();
        this.records.clear();
        this.rowViews.clear();
        this.host.replaceChildren();
    }

    public setOptions(options: Partial<PooledRowHostOptions["grid"]>): void {
        this.gridOptions = { ...this.gridOptions, ...options };
        this.grid?.setOptions({
            ...options,
            rowCount: this.rowCount,
            renderCell: this.renderCell,
            keepCellsAttached: true,
        });
    }

    public repaint(info: RerenderInfo): void {
        this.grid?.model.update(info);
    }

    /**
     * One unconditional call. The engine queues the request itself when it has no usable size yet
     * and flushes it on its first real measurement, which is what the previous `setTimeout(0)` was
     * approximating without being able to test the actual condition.
     *
     * `afterPaint` is set when the item set changed in the same update. `scrollTop` clamps to the
     * scrollable extent, and the extent is written inside the *next* paint — so a list that grew
     * and moved `activeIndex` past the old extent in one update would otherwise scroll short, with
     * nothing re-issuing it. Mount is already safe (the grid is unmeasured, so the engine's pending
     * slot catches it); a live update was not. When the rows did not change, scroll immediately —
     * one frame is visible in keyboard navigation.
     */
    public syncActiveScroll(index: number | null | undefined, afterPaint: boolean): void {
        if (index == null || index < 0 || !this.grid) return;
        if (afterPaint) this.grid.model.scrollToRowAfterPaint(index);
        else void this.grid.model.scrollToRow(index);
    }

    public dispose(): void {
        this.leave();
    }

    private render(params: RenderCellParams): HTMLElement | undefined {
        const kind = this.adapter.kindFor(params.row, params.col);
        if (kind === undefined) return undefined;

        let wrapper = params.previous ?? params.recycle?.();
        let record = wrapper ? this.cells.get(wrapper) : undefined;
        if (!wrapper) wrapper = document.createElement("div");
        if (!record) {
            record = { row: params.row, col: params.col, removeListeners: [] };
            this.cells.set(wrapper, record);
            this.records.add(record);
            this.installListeners(wrapper, record);
        }
        record.row = params.row;
        record.col = params.col;
        applyCellStyle(wrapper, params.style, params.row, params.col, params.renderInfo.input.columnCount);

        /** Tear down whatever the wrapper held, for a kind change only — never on eviction. */
        if (record.kind !== kind || !record.view) {
            this.releaseSlot(record);
            if (record.view) {
                this.rowViews.delete(record.view);
                record.view.dispose();
            }
            const view = this.adapter.create(kind, params.row, params.col, wrapper);
            view.mount();
            this.rowViews.add(view);
            record.kind = kind;
            record.view = view;
            if (view.root !== wrapper) record.slotCleanup = fillSlot(wrapper, view.root);
        } else {
            this.adapter.update(record.view, params.row, params.col);
        }
        this.adapter.updateWrapper?.(wrapper, params.row, params.col);
        return wrapper;
    }

    private installListeners(wrapper: HTMLElement, record: CellRecord<K, V>): void {
        /**
         * Installed once per wrapper, never per render — a released element keeps its listeners, so
         * re-adding them on recycle would stack an unbounded set on every pooled cell.
         */
        for (const type of this.adapter.events) {
            const listener: EventListener = (event) => {
                // A retained wrapper may still dispatch while the host is leaving its real arm.
                if (!this.entered) return;
                const current = this.cells.get(wrapper);
                if (current) this.adapter.onRowEvent(type, current.row, current.col, event);
            };
            wrapper.addEventListener(type, listener);
            record.removeListeners.push(() => wrapper.removeEventListener(type, listener));
        }
    }

    private releaseSlot(record: CellRecord<K, V>): void {
        record.slotCleanup?.();
        record.slotCleanup = undefined;
    }
}
