import { applyRestProps, clearRestListeners, createRestPropsState, cssLength } from "../shared/dom-props";
import type { RestPropsState } from "../shared/dom-props";
import { createComponentModelDriver, type ComponentModelDriver } from "../../core/state/model";
import { nextElementId } from "../shared/element-id";
import { VanillaView } from "../shared/vanilla-view";
import { uikitText } from "../shared/uikit-text";
import { PooledRowHost } from "../shared/pooled-row-host";
import type { RowAdapter } from "../shared/pooled-row-host";
import { ListShellArms } from "../shared/list-shell-arms";
import type { ElementLength, Percent } from "../DataGrid";
import { TreeItemView } from "./TreeItemView";
import { SectionItemView } from "./SectionItemView";
import { defaultTreeState, TreeModel } from "./TreeModel";
import type { TreeStateChange } from "./TreeModel";
import type { ITreeItem, TreeProps, TreeRow } from "./types";
import { getTreeViewRestProps } from "./tree-view-props";
import "./Tree.css";

type Arm = "loading" | "empty" | "real";
type CellKind = "item" | "section";

const columnWidth: ElementLength = (() => "100%" as Percent) as ElementLength;
const defaultRowHeight = 22;
const defaultIndentSize = 16;

/**
 * The tree shell.
 *
 * Four things are worth knowing before editing:
 *
 * - **A state change arrives through `model.onStateApplied`, not through props.** Uncontrolled
 *   expansion and drag state live in `TreeState`; controlled expansion arrives through props, and
 *   the vanilla driver pumps both into the model. The model's `mutate()` funnel calls `refresh()` here,
 *   and `refresh` updates the root projection and only the rows named by the model — see its comment.
 * - **The three arms are three DOM states of one stable root.** `applyArm()` owns every attribute
 *   that differs between them, including the removals.
 * - **The grid host and message host stay attached to this stable root by arm.** `ListShellArms`
 *   owns message transitions, and `PooledRowHost` owns the grid lifetime and retained row views.
 */
export class TreeView<T = ITreeItem> extends VanillaView<TreeProps<T>> {
    private readonly driver: ComponentModelDriver<
        typeof defaultTreeState,
        TreeProps<T>,
        TreeModel<T>
    >;

    private readonly restPropsState: RestPropsState = createRestPropsState();
    private pooledRows: PooledRowHost<CellKind, TreeItemView | SectionItemView> | undefined;
    private arms: ListShellArms | undefined;
    private arm: Arm | undefined;
    private gridHost: HTMLDivElement | undefined;
    private messageHost: HTMLDivElement | undefined;
    private lastActiveIndex: number | null | undefined = undefined;
    private readonly focusRoot = (): void => {
        this.root.focus();
    };
    /**
     * Set before anything else is torn down, so a cell listener that fires during disposal — the
     * pooled wrappers keep their listeners by design — cannot reach a half-disposed model.
     */
    private inert = false;

    public constructor(props: TreeProps<T>) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "tree";

        this.driver = createComponentModelDriver(
            props,
            TreeModel as unknown as TreeModel<T>,
            defaultTreeState,
        );
        this.model.setElementId(nextElementId("tree"));
        // Registered before `driver.mount()`, so state writes from a mounted owner already have
        // somewhere to land.
        this.model.onStateApplied = this.refresh;

        // Registration order is load-bearing: disposal runs these FIFO, and the grid and row
        // views must go before the model driver.
        this.own(() => { this.inert = true; });
        this.own(() => { this.model.onStateApplied = null; });
        this.own(() => this.pooledRows?.dispose());
        this.own(() => this.arms?.dispose());
        this.own(() => this.model.setFocusRootRef(null));
        this.own(() => this.driver.dispose());
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    /** The live model, for owners that retain this view. */
    public get model(): TreeModel<T> {
        return this.driver.model;
    }

    /** Repaint pooled rows after an external DOM projection (for example a cached icon) changed. */
    public refreshRows(): void {
        if (this.inert || this.arm !== "real") return;
        // The shared file-icon cache and board/tool icon projections invalidate every visible
        // tree icon, while this view has no per-icon dirty-row index.
        this.pooledRows?.repaint({ all: true });
    }

    /** Reproduce the provider's former remount scroll sequence after a search boundary. */
    public resetScrollTopAndSyncActive(): void {
        if (this.arm !== "real") return;
        void this.pooledRows?.gridModel?.scrollToRow(0);
        this.syncActiveScroll(this.props.activeIndex, false);
    }

    protected onMount(): void {
        this.model.setFocusRootRef(this.focusRoot);
        this.messageHost = document.createElement("div");
        this.messageHost.dataset.part = "message";

        this.gridHost = document.createElement("div");
        this.gridHost.dataset.part = "grid";
        this.gridHost.style.display = "contents";

        this.pooledRows = new PooledRowHost(
            this,
            this.gridHost,
            this.rowAdapter(),
            {
                grid: this.gridProps(this.props),
                onGridModel: (model) => this.model.setGridRef(model),
            },
        );
        this.arms = new ListShellArms(this, {
            root: this.root,
            messageHost: this.messageHost,
            enterRealArm: () => this.pooledRows?.enter(),
            leaveRealArm: () => this.pooledRows?.leave(),
        });

        // `contextmenu` is on all three arms; `keydown` and `mouseleave` were on the real arm
        // only, so they are gated. A listener is not in a DOM snapshot, so permanence is free.
        this.listen(this.root, "contextmenu", (event) => this.model.onRootContextMenu(event));
        this.listen(this.root, "keydown", (event) => {
            if (this.arm !== "real") return;
            this.model.onKeyDown(event);
        });
        this.listen(this.root, "mouseleave", () => {
            if (this.arm !== "real") return;
            this.model.onRootMouseLeave();
        });

        this.applyArm(this.props);
        applyRestProps(this.root, getTreeViewRestProps(this.props), this.restPropsState);

        // The driver is mounted after the grid arm exists, so owners can use `view.model` once
        // this child has mounted.
        this.driver.mount();

        this.syncActiveScroll(this.props.activeIndex, false);
    }

    protected onUpdate(props: TreeProps<T>): void {
        this.driver.update(props);
        this.applyArm(props);
        const update = this.model.takePropUpdateResult();
        const contentChanged = update?.contentChanged ?? false;
        if (update?.repaint?.all) {
            // Any global cell input can change every Tree row's rendered content.
            this.pooledRows?.repaint({ all: true });
        } else if (update?.repaint) {
            this.pooledRows?.repaint(update.repaint);
        }
        if (props.activeIndex !== this.lastActiveIndex) {
            this.syncActiveScroll(props.activeIndex, contentChanged);
        }
    }

    /**
     * The consequence of a state write, registered as `model.onStateApplied`.
     *
     * The root attributes still need a state-derived refresh: `aria-activedescendant` reads
     * `rows.length` for its bounds check *and* `rows.value[i].value` for the id itself, so a
     * `collapseAll()` with a high `activeIndex` has to remove the attribute, and an in-range
     * collapse has to rewrite it. The model supplies the current dirty rows for the grid repaint.
     *
     * Three things it deliberately does not do:
     * - it does not call `applyRestProps`, which removes and re-adds every `on*` listener on every
     *   call. Rest props cannot have changed on a state write, and reinstalling the root's listeners
     *   during a drag is a hazard rather than mere churn;
     * - it does not evaluate the arm work unless the arm actually changed (see below);
     * - it does not update prop baselines. The tracker compares only caller props; derived rows
     *   from a state mutation are handled here and do not need to prime the next prop comparison.
     */
    private refresh = (change: TreeStateChange): void => {
        if (this.inert) return;
        // Insurance for a branch that is unreachable today: `rows.push` is unconditional per source
        // and only the recursion is gated on expansion, so `rows.length === 0` iff `props.items` is
        // empty, and no state write can flip the arm. The proof dies the day `searchText` filters
        // instead of highlighting, and this costs one plain-field read.
        if (this.armFor(this.props) !== this.arm) {
            this.applyArm(this.props);
            return;
        }
        this.applyActiveDescendant(this.props);
        this.pooledRows?.repaint({ rows: change.rows });
    };

    // -----------------------------------------------------------------------
    // Arms
    // -----------------------------------------------------------------------

    private armFor(props: TreeProps<T>): Arm {
        if (props.loading) return "loading";
        return this.model.rows.length === 0 ? "empty" : "real";
    }

    /**
     * Bring the DOM to the arm `props` implies, then write every root attribute.
     *
     * Every per-arm attribute is written in both directions. The prior implementation expressed the arms as three
     * different elements, so an attribute it simply omitted in one arm has to be *removed* here —
     * and `root.tabIndex = -1` is not the same as no `tabindex` at all.
     */
    private applyArm(props: TreeProps<T>): void {
        const arms = this.arms;
        if (!arms) return;

        if (this.armFor(props) === "real") this.pooledRows?.setOptions(this.gridProps(props));
        const arm = arms.apply({
            loading: props.loading ?? false,
            empty: this.model.rows.length === 0,
            emptyMessage: props.emptyMessage ?? uikitText("noItems"),
        });
        this.arm = arm;

        const root = this.root;
        const focusAware = (props.keyboardNav ?? false) || (props.focusSelection ?? false);

        setOrRemove(root, "id", this.model.rootId);
        setOrRemove(root, "data-name", props.name);
        // Unlike ListBox, these two are on all three arms of the former tree renderer.
        toggle(root, "data-keyboard-nav", props.keyboardNav ?? false);
        toggle(root, "data-focus-selection", focusAware);
        toggle(root, "data-loading", arm === "loading");
        toggle(root, "data-empty", arm === "empty");

        if (arm === "real") {
            toggle(root, "data-multi-select", props.multiSelect ?? false);
            root.setAttribute("role", "tree");
            setOrRemove(root, "aria-multiselectable", props.multiSelect ? "true" : undefined);
            root.tabIndex = focusAware ? 0 : -1;
            this.applyActiveDescendant(props);
        } else {
            root.removeAttribute("data-multi-select");
            root.removeAttribute("role");
            root.removeAttribute("aria-multiselectable");
            root.removeAttribute("tabindex");
            root.removeAttribute("aria-activedescendant");
        }

    }

    /**
     * The one writer of `aria-activedescendant`, called from `applyArm`'s real arm and from
     * `refresh`. Both the bounds check and the id are derived from `rows`, so this cannot be folded
     * into the props path.
     */
    private applyActiveDescendant(props: TreeProps<T>): void {
        if (this.arm !== "real") return;
        const rowCount = this.model.rows.length;
        const activeIndex = props.activeIndex;
        const activeId =
            activeIndex != null && activeIndex >= 0 && activeIndex < rowCount
                ? this.model.itemId(activeIndex)
                : undefined;
        setOrRemove(this.root, "aria-activedescendant", activeId);
    }

    private gridProps(props: TreeProps<T>) {
        return {
            columnCount: 1,
            columnWidth,
            rowHeight: props.rowHeight ?? defaultRowHeight,
            overscanRow: 2,
            fitToWidth: true,
            // `TreeProps.growToHeight` is a CSS height, so it may be a bare number; the engine's
            // prop is a string, and the old style writer would have added the unit itself.
            growToHeight: cssLength(props.growToHeight),
            whiteSpaceY: props.whiteSpaceY,
        };
    }

    // -----------------------------------------------------------------------
    // Cells
    // -----------------------------------------------------------------------

    private rowAdapter(): RowAdapter<CellKind, TreeItemView | SectionItemView> {
        return {
            events: [
                "click", "dblclick", "mouseenter", "contextmenu",
                "dragstart", "dragend", "dragenter", "dragover", "dragleave", "drop",
            ],
            rowCount: () => this.model.rows.length,
            kindFor: (row) => {
                const item = this.model.rows[row];
                return item ? item.item.section ? "section" : "item" : undefined;
            },
            create: (kind, row) => {
                const item = this.model.rows[row] as TreeRow<T>;
                const id = this.model.itemId(row);
                if (kind === "section") return new SectionItemView(this.sectionProps(item, id));
                return new TreeItemView(this.itemProps(item, id, row));
            },
            update: (view, row) => {
                const item = this.model.rows[row];
                const id = this.model.itemId(row);
                if (item.item.section) view.update(this.sectionProps(item, id) as never);
                else view.update(this.itemProps(item, id, row) as never);
            },
            updateWrapper: (wrapper, row) => {
                // The prior renderer omitted the attribute when dragging was disabled. Use the IDL property, not
                // `setAttribute`: `draggable` is an enumerated attribute whose only valid keywords are
                // "true" and "false", and "" falls back to "auto", i.e. not draggable.
                wrapper.draggable = this.model.isDndEnabled && this.model.canDragRow(row);
            },
            /**
             * The drag gates are inside the handlers because a pooled wrapper outlives the row that decided
             * whether it could drag. A gated no-op is behaviourally identical to having no handler: for
             * `dragenter`/`dragover`, "no handler" and "a handler that does not `preventDefault`" both mean "drop not allowed".
             */
            onRowEvent: (type, row, _col, event) => {
                if (type === "click") this.model.onItemClick(row, event as MouseEvent);
                else if (type === "dblclick") this.model.onItemDoubleClick(row);
                else if (type === "mouseenter") this.model.onItemMouseEnter(row);
                else if (type === "contextmenu") this.model.onItemContextMenu(event as MouseEvent, row);
                else if (type === "dragstart") {
                    if (this.model.isDndEnabled && this.model.canDragRow(row)) {
                        this.model.onDragStart(event as DragEvent, row);
                    }
                } else if (type === "dragend") {
                    if (this.model.isDndEnabled && this.model.canDragRow(row)) this.model.onDragEnd();
                } else if (type === "dragenter") {
                    if (this.model.isDndEnabled && this.model.canDropRow(row)) {
                        this.model.onDragEnter(event as DragEvent, row);
                    }
                } else if (type === "dragover") {
                    if (this.model.isDndEnabled && this.model.canDropRow(row)) {
                        this.model.onDragOver(event as DragEvent, row);
                    }
                } else if (type === "dragleave") {
                    if (this.model.isDndEnabled && this.model.canDropRow(row)) {
                        this.model.onDragLeave(event as DragEvent, row);
                    }
                } else if (type === "drop") {
                    if (this.model.isDndEnabled && this.model.canDropRow(row)) {
                        this.model.onDrop(event as DragEvent, row);
                    }
                }
            },
        };
    }

    private sectionProps(row: TreeRow<T>, id: string) {
        return {
            id,
            level: row.level,
            label: row.item.label,
            name: this.props.getName?.(row.source, row.level),
            indentSize: this.props.indentSize ?? defaultIndentSize,
        };
    }

    private itemProps(row: TreeRow<T>, id: string, index: number) {
        return {
            id,
            level: row.level,
            expanded: row.expanded,
            // From the consumer's POV, "hasChildren" means "row is expandable (chevron should
            // render)". A lazy row whose children have not loaded yet still belongs in this set.
            hasChildren: row.hasChildren || row.lazyChildren,
            icon: row.item.icon,
            iconElement: this.props.getIconElement?.(row.source, row.level),
            label: row.item.label,
            searchText: this.props.searchText,
            selected: this.model.isSelectedAt(index),
            active: index === this.props.activeIndex,
            dragging: this.model.isDraggingAt(index),
            dropActive: this.model.isDropTargetAt(index),
            disabled: row.item.disabled,
            tooltip: this.props.getTooltip?.(row.source, row.level),
            name: this.props.getName?.(row.source, row.level),
            secondaryLabel: this.props.getSecondaryLabel?.(row.source, row.level),
            indentSize: this.props.indentSize ?? defaultIndentSize,
            hideChevron: this.props.getHideChevron?.(row.source, row.level),
            trailingVisibility: this.props.getTrailingVisibility?.(row.source, row.level),
            trailing: this.props.renderTrailing?.(row.source, row.level),
            trailingElement: this.props.trailingElement?.(row.source, row.level),
            onContextMenu: this.props.onItemContextMenu
                ? (event: MouseEvent) => {
                    this.props.onItemContextMenu?.(row.source, row.level, event);
                }
                : undefined,
            // A fresh closure per render is fine here — it is a row *prop*, not the engine's
            // `renderCell`, and `update()` re-supplies it with the current index on every render, so
            // a recycled row never calls the previous row's handler.
            onChevronClick: (event: MouseEvent) => {
                this.model.onChevronClick(event, index);
            },
        };
    }

    // -----------------------------------------------------------------------
    // Active row
    // -----------------------------------------------------------------------

    /**
     * The engine queues the request itself when it has no usable size yet and flushes it on its
     * first real measurement, which is what the previous `setTimeout(0)` was approximating
     * without being able to test the actual condition.
     *
     * `afterPaint` is set when the row set changed in the same update: `scrollTop` clamps to the
     * scrollable extent, and the extent is written inside the *next* paint, so scrolling now would
     * clamp against the old one. When nothing about the rows changed, scroll immediately — one frame
     * matters to keyboard navigation.
     */
    private syncActiveScroll(activeIndex: number | null | undefined, afterPaint: boolean): void {
        this.lastActiveIndex = activeIndex;
        if (activeIndex == null || activeIndex < 0) return;
        this.pooledRows?.syncActiveScroll(activeIndex, afterPaint);
    }

    // -----------------------------------------------------------------------

}

function setOrRemove(root: HTMLElement, attribute: string, value: string | undefined): void {
    if (value === undefined) root.removeAttribute(attribute);
    else root.setAttribute(attribute, value);
}

function toggle(root: HTMLElement, attribute: string, on: boolean): void {
    if (on) root.setAttribute(attribute, "");
    else root.removeAttribute(attribute);
}
