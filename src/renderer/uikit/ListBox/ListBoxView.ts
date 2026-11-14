import { applyRestProps, clearRestListeners, createRestPropsState, cssLength, setOrRemoveAttr, toggleAttr, splitProps, type CompleteKeys, RestPropsState } from "../shared/dom-props";
import { nextElementId } from "../shared/element-id";
import { VanillaView } from "../shared/vanilla-view";
import { PooledRowHost } from "../shared/pooled-row-host";
import type { RowAdapter } from "../shared/pooled-row-host";
import { ListShellArms } from "../shared/list-shell-arms";
import type { ElementLength, Percent } from "../DataGrid";
import { ListItemView } from "./ListItemView";
import { SectionItemView } from "./SectionItemView";
import { ListBoxModel } from "./ListBoxModel";
import type { IListBoxItem, ListBoxProps, ListBoxOwnProps } from "./types";
import "./ListBox.css";

type CellKind = "item" | "section";

export interface ListBoxLayout {
    rowHeight?: ElementLength;
    growToHeight?: string;
    growToWidth?: string;
    height?: string;
    fitToWidth?: boolean;
    whiteSpaceY?: number;
}

const columnWidth: ElementLength = (() => "100%" as Percent) as ElementLength;
const defaultRowHeight = 24;

const LISTBOX_OWN_KEYS = ["name", "items", "value", "onChange", "onItemDoubleClick", "isSelected", "selectionSignal", "activeIndex", "onActiveChange", "searchText", "getTooltip", "getContextMenu", "onContextMenu", "keyboardNav", "loading", "emptyMessage", "rowHeight", "growToHeight", "whiteSpaceY", "variant", "selectionStyle", "checkbox"] as const satisfies readonly (keyof ListBoxOwnProps)[];
const checkedOwnKeys: CompleteKeys<ListBoxOwnProps, typeof LISTBOX_OWN_KEYS> = LISTBOX_OWN_KEYS;
const LISTBOX_LEGACY_KEYS = ["id"] as const satisfies readonly (keyof ListBoxProps)[];



/**
 * The list shell.
 *
 * This view owns ListBox-specific row props, root attributes, ARIA projection, and repaint
 * application. The shared collaborators own pooled wrappers and message-arm transitions.
 */
export class ListBoxView<T = IListBoxItem> extends VanillaView<ListBoxProps<T>> {
    private readonly listModel: ListBoxModel<T>;

    private readonly restPropsState: RestPropsState = createRestPropsState();
    private pooledRows: PooledRowHost<CellKind, ListItemView | SectionItemView> | undefined;
    private arms: ListShellArms | undefined;
    private gridHost: HTMLDivElement | undefined;
    private messageHost: HTMLDivElement | undefined;
    private layout: ListBoxLayout = {};
    private emptyMessage: ListBoxProps<T>["emptyMessage"];
    private lastActiveIndex: number | null | undefined = undefined;

    public constructor(props: ListBoxProps<T>) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "list-box";

        this.listModel = new ListBoxModel(props);
        this.model.setElementId(nextElementId("lb"));

        // Registration order is load-bearing: the pooled host and arms must dispose before their
        // DOM listeners are cleared. The helpers are assigned in onMount().
        this.own(() => this.pooledRows?.dispose());
        this.own(() => this.arms?.dispose());
        this.own(() => clearRestListeners(this.root, this.restPropsState));
    }

    /** The live model, for owners that retain this view. */
    public get model(): ListBoxModel<T> {
        return this.listModel;
    }

    protected onMount(): void {
        this.messageHost = document.createElement("div");
        this.messageHost.dataset.part = "message";

        this.gridHost = document.createElement("div");
        this.gridHost.dataset.part = "grid";
        this.gridHost.style.display = "contents";

        this.layout = this.layoutProps(this.props);
        this.emptyMessage = this.props.emptyMessage;

        this.pooledRows = new PooledRowHost(
            this,
            this.gridHost,
            this.rowAdapter(),
            {
                grid: { ...this.gridProps(), ...this.layout },
                onGridModel: (model) => this.model.setGridRef(model),
            },
        );
        this.arms = new ListShellArms(this, {
            root: this.root,
            messageHost: this.messageHost,
            enterRealArm: () => this.pooledRows?.enter(),
            leaveRealArm: () => this.pooledRows?.leave(),
        });

        // Both listeners are permanent. `contextmenu` is on all three arms; `keydown` is on
        // the real arm only, but it is gated below and a listener is not in a DOM snapshot.
        this.listen(this.root, "contextmenu", (event) => this.model.onRootContextMenu(event));
        this.listen(this.root, "keydown", (event) => {
            if (!this.pooledRows?.gridModel) return;
            this.model.onKeyDown(event);
        });

        this.applyRootProps(this.props);
        applyRestProps(this.root, this.restProps(this.props), this.restPropsState);

        this.syncActiveScroll(this.model.activeIndex, false);
    }

    protected onUpdate(props: ListBoxProps<T>): void {
        const { repaint, contentChanged } = this.model.update(props);
        this.layout = this.layoutProps(props);
        this.emptyMessage = props.emptyMessage;
        this.applyRootProps(props);
        if (repaint) this.pooledRows?.repaint(repaint);
        if (this.model.activeIndex !== this.lastActiveIndex) {
            this.syncActiveScroll(this.model.activeIndex, contentChanged);
        }
    }

    // -----------------------------------------------------------------------
    // Root projection
    // -----------------------------------------------------------------------

    /**
     * Let the shell transition its message and grid hosts, then write every root attribute.
     *
     * Every per-arm attribute is written in both directions. An attribute omitted in one arm has to be *removed* here —
     * and `root.tabIndex = -1` is not the same as no `tabindex` at all.
     */
    private applyRootProps(props: ListBoxProps<T>): void {
        const arm = this.arms?.apply({
            loading: this.model.loading,
            empty: this.model.resolved.resolved.length === 0,
            emptyMessage: this.emptyMessage,
        });
        if (!arm) return;
        if (arm === "real") this.pooledRows?.setOptions(this.layout);

        const root = this.root;
        setOrRemoveAttr(root, "id", this.model.rootId);
        setOrRemoveAttr(root, "data-name", props.name);
        toggleAttr(root, "data-loading", arm === "loading");
        toggleAttr(root, "data-empty", arm === "empty");

        if (arm === "real") {
            const resolvedCount = this.model.resolved.resolved.length;
            const activeIndex = this.model.activeIndex;
            const activeId =
                activeIndex != null && activeIndex >= 0 && activeIndex < resolvedCount
                    ? this.model.itemId(activeIndex)
                    : undefined;
            const focusAware = (props.keyboardNav ?? false) || props.selectionStyle === "focus";

            root.setAttribute("role", "listbox");
            root.tabIndex = focusAware ? 0 : -1;
            toggleAttr(root, "data-focus-selection", props.selectionStyle === "focus");
            setOrRemoveAttr(root, "aria-activedescendant", activeId);
        } else {
            root.removeAttribute("role");
            root.removeAttribute("tabindex");
            root.removeAttribute("data-focus-selection");
            root.removeAttribute("aria-activedescendant");
        }

    }
    private gridProps() {
        return {
            columnCount: 1,
            columnWidth,
            overscanRow: 2,
            fitToWidth: true,
        };
    }

    private layoutProps(props: ListBoxProps<T>): ListBoxLayout {
        return {
            rowHeight: props.rowHeight ?? defaultRowHeight,
            // `growToHeight` accepts a bare number at the ListBox boundary. `Select` passes
            // `maxVisibleItems * rowHeight` and `UrlSuggestionsDropdown` passes 400; normalize
            // them here because the grid option is a CSS string and DOM assignment adds no unit.
            growToHeight: cssLength(props.growToHeight),
            fitToWidth: true,
            whiteSpaceY: props.whiteSpaceY,
        };
    }

    // -----------------------------------------------------------------------
    private rowAdapter(): RowAdapter<CellKind, ListItemView | SectionItemView> {
        return {
            events: ["click", "dblclick", "mouseenter", "contextmenu"],
            rowCount: () => this.model.resolved.resolved.length,
            kindFor: (row) => {
                const item = this.model.resolved.resolved[row];
                return item ? item.section ? "section" : "item" : undefined;
            },
            create: (kind, row) => {
                const { resolved, sources } = this.model.resolved;
                const item = resolved[row];
                const id = this.model.itemId(row);
                if (kind === "section") return new SectionItemView({ id, label: item.label });
                return new ListItemView(this.itemProps(item, id, row, sources));
            },
            update: (view, row) => {
                const { resolved, sources } = this.model.resolved;
                const item = resolved[row];
                const id = this.model.itemId(row);
                if (item.section) view.update({ id, label: item.label } as never);
                else view.update(this.itemProps(item, id, row, sources) as never);
            },
            onRowEvent: (type, row, _col, event) => {
                if (type === "click") this.model.onItemClick(row);
                else if (type === "dblclick") this.model.onItemDoubleClick(row);
                else if (type === "mouseenter") this.model.onItemMouseEnter(row);
                else if (type === "contextmenu") this.model.onItemContextMenu(event as MouseEvent, row);
            },
        };
    }

    private itemProps(
        item: IListBoxItem,
        id: string,
        index: number,
        sources: T[],
    ) {
        return {
            id,
            icon: item.icon,
            iconElement: item.iconElement,
            rowClass: item.rowClass,
            label: item.label,
            trailing: item.trailing,
            trailingElement: item.trailingElement,
            trailingVisibility: item.trailingVisibility,
            drag: item.drag,
            searchText: this.model.searchText,
            selected: this.model.isSelectedAt(index),
            active: index === this.model.activeIndex,
            disabled: item.disabled,
            tooltip: this.props.getTooltip?.(sources[index], index),
            variant: this.props.variant,
            selectionStyle: this.props.selectionStyle,
            checkbox: this.props.checkbox,
        };
    }

    // -----------------------------------------------------------------------
    // Active row
    // -----------------------------------------------------------------------

    private syncActiveScroll(activeIndex: number | null | undefined, afterPaint: boolean): void {
        // Keep the scroll baseline at its existing call site for either immediate or after-paint scrolling.
        this.lastActiveIndex = activeIndex;
        this.pooledRows?.syncActiveScroll(activeIndex, afterPaint);
    }

    // -----------------------------------------------------------------------

    private restProps(props: ListBoxProps<T>): Record<string, unknown> {
        const rest = splitProps(props, [...checkedOwnKeys, ...LISTBOX_LEGACY_KEYS] as const);
        return rest as Record<string, unknown>;
    }
}
