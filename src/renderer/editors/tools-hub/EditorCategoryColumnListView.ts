import { VanillaView } from "../../uikit/shared/vanilla-view";
import { TraitTypeId, getTraitDragData, hasTraitDragData, setTraitDragData } from "../../core/traits";
import { editorCategories, type CategoryRef } from "../../api/editor-categories";
import "./EditorCategoryColumnListView.css";

export type EditorCategoryDragData =
    | { kind: "source"; ref: CategoryRef }
    | { kind: "category-item"; categoryId: string; ref: CategoryRef }
    | { kind: "category-block"; categoryId: string };

export interface EditorCategoryColumnRow {
    ref: string;
    label: string;
    icon?: Node;
    categoryId: string;
    categoryItem: boolean;
    trailing?: string;
}

export interface EditorCategoryColumn {
    id: string;
    label: string;
    rows: EditorCategoryColumnRow[];
    placeholder?: string;
    fixed?: boolean;
}

export interface EditorCategoryColumnListProps {
    columns: EditorCategoryColumn[];
    height?: string;
    rowData: (row: EditorCategoryColumnRow) => EditorCategoryDragData;
    onDrop: (column: EditorCategoryColumn, row: EditorCategoryColumnRow | undefined, data: EditorCategoryDragData) => void;
    onActivate?: (row: EditorCategoryColumnRow) => void;
    renderHeading?: (column: EditorCategoryColumn, heading: HTMLElement) => void;
    renderRowAction?: (row: EditorCategoryColumnRow, element: HTMLElement) => void;
    rowDataName?: string;
    activateOnDoubleClick?: boolean;
    draggable?: boolean;
    droppable?: boolean;
}

export class EditorCategoryColumnListView extends VanillaView<EditorCategoryColumnListProps> {
    public constructor(props: EditorCategoryColumnListProps) {
        super(props);
        this.root.dataset.type = "editor-category-column-list";
        this.root.dataset.name = "editor-category-column-list";
    }

    protected onMount(): void {
        // Non-passive so preventDefault() can stop the page from scrolling instead.
        this.listen(this.root, "wheel", this.onWheel, { passive: false });
        this.render();
    }

    /** The list wraps into columns, so the vertical wheel scrolls it horizontally. */
    private readonly onWheel = (event: WheelEvent): void => {
        const list = this.root;
        // Nothing to scroll: leave the event alone rather than swallowing it.
        if (list.scrollWidth <= list.clientWidth) return;
        // deltaX too: a trackpad or tilt wheel sends the horizontal axis directly.
        const delta = event.deltaY + event.deltaX;
        if (delta === 0) return;
        event.preventDefault();
        list.scrollLeft += delta;
    };
    protected onUpdate(): void { this.render(); }

    private render(): void {
        this.root.replaceChildren();
        this.root.style.height = this.props.height ?? "100%";
        for (const column of this.props.columns) {
            const group = document.createElement("section");
            group.dataset.part = "column";
            group.dataset.categoryId = column.id;
            group.dataset.name = "editor-category-block";
            const heading = document.createElement("header");
            heading.dataset.part = "heading";
            heading.dataset.name = "editor-category-header";
            heading.textContent = column.label;
            this.props.renderHeading?.(column, heading);
            if (this.props.draggable !== false) heading.addEventListener("dragstart", (event) => {
                if (!event.dataTransfer || column.fixed) { event.preventDefault(); return; }
                setTraitDragData(event.dataTransfer, TraitTypeId.PinnedEditor, { kind: "category-block", categoryId: column.id } satisfies EditorCategoryDragData);
            });
            if (this.props.droppable !== false) {
                heading.addEventListener("dragover", (event) => this.allowDrop(event));
                heading.addEventListener("drop", (event) => this.handleDrop(event, column));
            }
            group.append(heading);
            for (const row of column.rows) group.append(this.createRow(row));
            if (!column.rows.length && column.placeholder) {
                const placeholder = document.createElement("div");
                placeholder.dataset.part = "placeholder";
                placeholder.textContent = column.placeholder;
                group.append(placeholder);
            }
            if (this.props.droppable !== false) {
                group.addEventListener("dragover", (event) => this.allowDrop(event));
                group.addEventListener("drop", (event) => this.handleDrop(event, column));
            }
            this.root.append(group);
        }
    }

    private createRow(row: EditorCategoryColumnRow): HTMLElement {
        const element = document.createElement("button");
        element.type = "button";
        element.dataset.part = "row";
        element.dataset.name = this.props.rowDataName ?? "editor-category-item";
        element.dataset.itemRef = row.ref;
        element.draggable = this.props.draggable !== false;
        if (row.icon) element.append(row.icon.cloneNode(true));
        const label = document.createElement("span");
        label.dataset.part = "row-label";
        label.textContent = row.label;
        element.append(label);
        if (row.trailing) {
            const trailing = document.createElement("span");
            trailing.dataset.part = "row-trailing";
            trailing.textContent = row.trailing;
            element.append(trailing);
        }
        this.props.renderRowAction?.(row, element);
        element.addEventListener(this.props.activateOnDoubleClick ? "dblclick" : "click", () => this.props.onActivate?.(row));
        if (this.props.draggable !== false) element.addEventListener("dragstart", (event) => {
            if (event.dataTransfer) setTraitDragData(event.dataTransfer, TraitTypeId.PinnedEditor, this.props.rowData(row));
        });
        if (this.props.droppable !== false) {
            element.addEventListener("dragover", (event) => this.allowDrop(event));
            element.addEventListener("drop", (event) => this.handleDrop(event, {
                id: row.categoryId, label: "", rows: [],
            }, row));
        }
        return element;
    }

    private allowDrop(event: DragEvent): void {
        if (!event.dataTransfer || !hasTraitDragData(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }

    private handleDrop(event: DragEvent, column: EditorCategoryColumn, row?: EditorCategoryColumnRow): void {
        const payload = event.dataTransfer && getTraitDragData(event.dataTransfer);
        if (!payload || payload.typeId !== TraitTypeId.PinnedEditor) return;
        if (!isEditorCategoryDragData(payload.data)) return;
        const data = payload.data;
        if (data.kind !== "category-block" && "ref" in data) {
            event.preventDefault();
            event.stopPropagation();
            this.props.onDrop(column, row, data);
        } else if (data.kind === "category-block") {
            event.preventDefault();
            event.stopPropagation();
            this.props.onDrop(column, row, data);
        }
    }
}

function isEditorCategoryDragData(value: unknown): value is EditorCategoryDragData {
    if (!value || typeof value !== "object") return false;
    const data = value as { kind?: unknown; ref?: unknown; categoryId?: unknown };
    if (data.kind === "source") return editorCategories.isRef(data.ref);
    if (data.kind === "category-item") return typeof data.categoryId === "string" && editorCategories.isRef(data.ref);
    return data.kind === "category-block" && typeof data.categoryId === "string";
}
