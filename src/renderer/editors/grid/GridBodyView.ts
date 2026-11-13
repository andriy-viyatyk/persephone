import { errMessage } from "../../../shared/utils";
import {
    DataGridView,
    type DataGridInstance,
    type DataGridProps,
} from "../../uikit/DataGrid";
import {
    createPanelElement,
    type PanelStyleProps,
} from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { isFocusInSidebar } from "../../core/utils/focus-utils";
import { showGridContextMenu } from "../../ui/dialogs/poppers/grid-context-menu";
import type { GridEditor, GridEditorState, GridQueueEvent } from "./GridEditor";
import { getRowKey } from "./utils/grid-utils";

export interface GridBodyViewProps {
    model: GridEditor;
}

interface GridProjection {
    columns: GridEditorState["columns"];
    search: GridEditorState["search"];
    error: GridEditorState["error"];
}

interface GridSnapshot {
    state: GridEditorState;
    rows: readonly any[];
}

function rootPanelProps(): PanelStyleProps {
    return {
        name: "grid-editor-root",
        direction: "column",
        flex: true,
        position: "relative",
        height: 200,
    };
}

function selectGridProjection(state: GridEditorState): GridProjection {
    return {
        columns: state.columns,
        search: state.search,
        error: state.error,
    };
}

function readGridSnapshot(model: GridEditor): GridSnapshot {
    const state = model.state.get();
    return { state, rows: model.rowsForGrid() };
}

function gridProps(props: GridBodyViewProps, onGrid: DataGridProps["onGrid"]): DataGridProps<any> {
    const { model } = props;
    const { state, rows } = readGridSnapshot(model);

    return {
        name: `grid-editor-${model.editorId}`,
        columns: state.columns,
        rows,
        getRowKey,
        rowNoun: "row",
        // Pass `state.search` verbatim: an empty string means "no search", not an absent option.
        // `invalidatePushed()` retains the key set, so a cleared search remains representable.
        searchString: state.search,
        // Only filters naming a live column reach av-grid — it validates the option loudly and
        // takes the whole grid down over a filter whose column is gone. Persisted filters outlive
        // their columns routinely: toggling the CSV header row renames every column, and 
        // renamed header-free CSV's columns once and for all. Pruned here rather than in state, so
        // a filter whose column comes back is still there when it does.
        filters: state.filters.filter((f) =>
            state.columns.some((c) => String(c.key) === f.columnKey),
        ),
        filterBar: true,
        editable: true,
        canAddRows: true,
        canDeleteRows: true,
        canAddColumns: true,
        canDeleteColumns: true,
        newRow: model.newRow,
        newColumn: model.newColumn,
        onGrid,
        onEdit: model.onEdit,
        onAddRows: model.onAddRows,
        onDeleteRows: model.onDeleteRows,
        onDeleteColumns: model.onDeleteColumns,
        onColumnsChange: model.onColumnsChange,
        onFocusChange: model.onFocusChange,
        onFiltersChange: model.onFiltersChange,
        onSortChange: model.onSortChange,
        onVisibleRowsChange: model.onVisibleRowsChange,
        onGetOptions: model.onGetOptions,
        onGridContextMenu: showGridContextMenu,
    };
}

export class GridBodyView extends VanillaView<GridBodyViewProps> {
    private model: GridEditor;
    private contentPanel!: HTMLDivElement;
    private errorPanel!: HTMLDivElement;
    private errorText!: HTMLSpanElement;
    private dataGridView!: DataGridView<any>;
    private modelSubscription: (() => void) | undefined;
    private queueSubscription: (() => void) | undefined;
    private liveGrid: DataGridInstance<any> | null = null;

    private readonly onGrid = (grid: DataGridInstance<any> | null): void => {
        if (!grid) {
            this.releaseGridHandles();
            return;
        }

        if (!this.model.contentHost) {
            this.liveGrid = null;
            this.model.setGrid(null);
            return;
        }

        this.publishGrid(grid);
    };

    private readonly handleQueue = (event: GridQueueEvent): void => {
        const grid = this.liveGrid;
        if (!grid) return;

        switch (event.type) {
            case "focus":
                grid.focus();
                break;
            case "focusCell":
                grid.focusCell(event.row, event.col, true);
                break;
        }
    };

    public constructor(props: GridBodyViewProps) {
        super(props, createPanelElement(rootPanelProps()));

        this.model = props.model;
    }

    protected onMount(): void {
        this.model = this.props.model;
        // `minHeight: 0` is load-bearing, not defensive. A flex item defaults to
        // `min-height: auto`, so it cannot shrink below its content — and av-grid writes its own
        // measured height into the subtree, which makes that content floor whatever the grid was
        // last sized at. Opening the script panel then shrinks this panel's *container* while the
        // panel itself stays at its old height, overflowing downward and painting over the script
        // panel: the splitter ends up under the grid's scroll element and cannot be grabbed at all
        // (`elementFromPoint` on it returns `render-grid-scroll`). Monaco and Markdown bodies have
        // no such internal height, which is why the symptom was grid-only.
        const contentPanel = createPanelElement({ direction: "column", flex: true, minHeight: 0 });
        const errorText = createTextElement("", { color: "warning", preWrap: true });
        const errorPanel = createPanelElement(
            { flex: true, justify: "center", align: "center", padding: "xxl" },
            [errorText],
        );
        this.contentPanel = contentPanel;
        this.errorPanel = errorPanel;
        this.errorText = errorText;
        this.root.append(contentPanel, errorPanel);
        this.dataGridView = this.child(new DataGridView(gridProps(this.props, this.onGrid)));
        this.contentPanel.append(this.dataGridView.root);
        this.dataGridView.mount();
        this.setHostVisibility(!!this.model.contentHost);

        if (!this.model.contentHost) {
            this.setHostVisibility(false);
        } else {
            this.subscribeToModel();
            this.focusIfAllowed();
        }

        this.own(() => this.unsubscribeFromModel());
    }

    protected onUpdate(props: GridBodyViewProps): void {
        const previousModel = this.model;
        const previousHasHost = !!previousModel.contentHost;
        const modelChanged = previousModel !== props.model;
        const hasHost = !!props.model.contentHost;

        if (modelChanged) {
            this.unsubscribeFromModel();
            this.releaseGridHandles();
            this.model = props.model;
        }

        this.updateDataGrid(props);

        if (!hasHost) {
            if (previousHasHost || modelChanged || this.modelSubscription || this.queueSubscription) {
                this.unsubscribeFromModel();
                this.releaseGridHandles();
            }
            this.setHostVisibility(false);
        } else {
            if (previousHasHost === false || modelChanged) {
                this.publishExistingGrid();
                this.subscribeToModel();
            } else {
                this.applyProjection(selectGridProjection(this.model.state.get()));
            }
        }

    }

    protected onDispose(): void {
        this.model.setGrid(null);
    }

    private subscribeToModel(): void {
        if (!this.model.contentHost || this.modelSubscription || this.queueSubscription) return;

        this.applyProjection(selectGridProjection(this.model.state.get()));
        this.modelSubscription = this.ownSubscription(this.model.state.subscribe(
            (projection) => this.applyProjection(projection),
            selectGridProjection,
        ));
        this.queueSubscription = this.ownSubscription(this.model.queue.subscribe(this.handleQueue));
    }

    private unsubscribeFromModel(): void {
        this.modelSubscription?.();
        this.modelSubscription = undefined;
        this.queueSubscription?.();
        this.queueSubscription = undefined;
    }

    private applyProjection(projection: GridProjection): void {
        // `TOneState.update` dispatches synchronously, so a throw here would abort the dispatch for
        // every later subscriber, and inside a virtualized cell it would abort the whole grid paint.
        // The third-party grid throws on a columns/rows mismatch, so contain it and show the message
        // where the editor already shows its errors.
        try {
            this.updateDataGrid(this.props);
        } catch (error) {
            const message = errMessage(error, "The grid failed to render");
            this.errorText.textContent = message;
            this.setHidden(this.root, false);
            this.setHidden(this.contentPanel, true);
            this.setHidden(this.errorPanel, false);
            console.error("Grid body failed to apply its projection", error);
            return;
        }

        if (!this.model.contentHost) {
            this.setHostVisibility(false);
            return;
        }

        if (this.errorText.textContent !== projection.error) {
            this.errorText.textContent = projection.error ?? "";
        }
        const hasError = !!projection.error;
        this.setHidden(this.root, false);
        this.setHidden(this.contentPanel, hasError);
        this.setHidden(this.errorPanel, !hasError);
    }

    /** The embedded body may be re-pointed without changing its GridEditor identity. */
    private updateDataGrid(props: GridBodyViewProps): void {
        this.dataGridView.invalidatePushed();
        this.dataGridView.update(gridProps(props, this.onGrid));
    }

    private publishExistingGrid(): void {
        const grid = this.dataGridView.grid;
        if (!grid || !this.model.contentHost) return;
        this.liveGrid = grid;
        this.publishGrid(grid);
    }

    private publishGrid(grid: DataGridInstance<any>): void {
        this.liveGrid = grid;
        this.model.setGrid(grid);
    }

    private releaseGridHandles(): void {
        this.liveGrid = null;
        this.model.setGrid(null);
    }

    private setHostVisibility(visible: boolean): void {
        if (!visible) {
            this.setHidden(this.root, true);
            this.setHidden(this.contentPanel, true);
            this.setHidden(this.errorPanel, true);
        }
    }

    private setHidden(element: HTMLElement, hidden: boolean): void {
        if (element.hidden !== hidden) element.hidden = hidden;
    }

    private focusIfAllowed(): void {
        if (!isFocusInSidebar()) {
            this.liveGrid?.focus();
        }
    }
}

/** Visible-row label for the footer record-count. */
export function getVisibleRowsLabel(model: GridEditor): string {
    const { rowCount, displayedRowCount } = model.state.get();
    const visible = displayedRowCount ?? rowCount;
    return visible === rowCount ? `${rowCount} rows` : `${visible} of ${rowCount} rows`;
}
