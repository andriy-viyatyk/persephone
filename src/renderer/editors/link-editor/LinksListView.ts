import type { ILink } from "../../api/types/io.tree";
import {
    createTreeProviderItemIconElement,
} from "../../components/icons/icon-elements";
import { TraitTypeId, setTraitDragData } from "../../core/traits";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { ListItemView } from "../../uikit/ListBox/ListItemView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import type { ElementLength, Percent, RenderGridOptions } from "../../uikit/DataGrid";
import { PooledRowHost, type PooledRowView, type RowAdapter } from "../../uikit/shared/pooled-row-host";
import { attachTooltip, type TooltipAttachment } from "../../uikit/Tooltip/attach-tooltip";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { IconName } from "../../theme/icon-registry";
import { createLinkTooltipContent } from "./LinkTooltipView";
import type { LinksListProps } from "./LinksList";
import type { ImageRoute } from "./routed-src";
import { FaviconRowTracker } from "./FaviconRowTracker";
import { t } from "../../../shared/i18n/t";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/ListBox/ListItem.css";
import "../../uikit/Panel/Panel.css";

const ROW_HEIGHT = 24;

const defaultGetId = (link: ILink): string => link.id ?? link.href;

/** The host retains each record through teardown so pooled child views remain disposable. */
interface CellParts extends PooledRowView {
    root: HTMLElement;
    mount(): HTMLElement;
    dispose(): void;
    index: number;
    rowWrapper: HTMLElement;
    rowView: ListItemView;
    actionsHost: HTMLElement;
    additionalIconHost: HTMLElement;
    additionalIcon?: IconName;
    editButton?: IconButtonView;
    editButtonRelease?: () => void;
    deleteButton?: IconButtonView;
    deleteButtonRelease?: () => void;
    tooltip: TooltipAttachment;
    link: ILink;
    selected: boolean;
    dropTarget: boolean;
    isDragging: boolean;
    searchText: string;
    dragSourceId?: string;
    onDragStartOverride?: LinksListProps["onDragStartOverride"];
    allTags?: string[];
    imageProxy?: ImageRoute | null;
    onSelect?: LinksListProps["onSelect"];
    onEdit?: LinksListProps["onEdit"];
    onDelete?: LinksListProps["onDelete"];
    onDoubleClick?: LinksListProps["onDoubleClick"];
    onContextMenu?: LinksListProps["onContextMenu"];
    onToggleTag?: LinksListProps["onToggleTag"];
    onDragEnter?: LinksListProps["onItemDragEnter"];
    onDragOver?: LinksListProps["onItemDragOver"];
    onDragLeave?: LinksListProps["onItemDragLeave"];
    onDrop?: LinksListProps["onItemDrop"];
    removeListeners: (() => void)[];
}

const columnWidth: ElementLength = (() => "100%" as Percent) as ElementLength;

function createFocusScope(): HTMLDivElement {
    const element = createPanelElement({
        name: "links-list-focus-scope",
        direction: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
    });
    element.tabIndex = 0;
    element.setAttribute("data-focus-selection", "");
    return element;
}

export class LinksListView extends VanillaView<LinksListProps> {
    private readonly rowCount = (): number => this.props.links.length;
    private readonly faviconTracker: FaviconRowTracker;
    private readonly pooledRows: PooledRowHost<"link", CellParts>;
    private subscribedLinks: ILink[] | undefined;
    private inert = false;

    private readonly adapter: RowAdapter<"link", CellParts> = {
        events: [],
        rowCount: this.rowCount,
        kindFor: (row) => this.props.links[row] ? "link" : undefined,
        create: (_kind, row) => {
            const link = this.props.links[row];
            if (!link) throw new Error(`Missing link at row ${row}.`);
            return this.createCell(link, row);
        },
        update: (record, row) => {
            const link = this.props.links[row];
            if (link) this.admitCell(record, row, link);
        },
        onRowEvent: () => undefined,
        updateWrapper: (wrapper) => this.updateCellWrapper(wrapper),
    };

    public constructor(props: LinksListProps) {
        super(props, createFocusScope());
        this.faviconTracker = new FaviconRowTracker((rows) => {
            if (!this.inert) this.pooledRows.repaint({ rows });
        });
        this.pooledRows = new PooledRowHost(this, this.root, this.adapter, {
            grid: this.gridOptions(),
        });

        // Match ListBoxView's teardown order: listeners become inert, then the grid releases its
        // pool, then overlay attachments and retained row/button views are disposed.
        this.own(() => { this.inert = true; });
        this.own(() => this.faviconTracker.dispose());
        this.own(() => this.pooledRows.dispose());
        this.own(() => this.props.onGridModel?.(null));
    }

    private gridOptions(): Omit<RenderGridOptions, "rowCount" | "renderCell" | "keepCellsAttached"> {
        return {
            columnCount: 1,
            rowHeight: ROW_HEIGHT,
            columnWidth,
            fitToWidth: true,
        };
    }

    protected onMount(): void {
        this.pooledRows.enter();
        this.props.onGridModel?.(this.pooledRows.gridModel);
        this.faviconTracker.track(this.props.links, (index) => index);
        this.subscribedLinks = this.props.links;
    }

    protected onUpdate(props: LinksListProps): void {
        if (props.links !== this.subscribedLinks) {
            this.faviconTracker.track(props.links, (index) => index);
            this.subscribedLinks = props.links;
        }

        // Keep the host's geometry options current without changing its stable renderer.
        this.pooledRows.setOptions(this.gridOptions());

        // All prop-driven row state is read from this.props. Mark current coordinates dirty.
        this.pooledRows.repaint({ rows: props.links.map((_link, index) => index) });
    }

    private createCell(link: ILink, index: number): CellParts {
        const actionsHost = document.createElement("span");
        actionsHost.style.display = "flex";
        actionsHost.style.gap = "2px";
        actionsHost.style.alignItems = "center";
        actionsHost.style.flexShrink = "0";

        const additionalIconHost = document.createElement("span");
        additionalIconHost.style.display = "flex";
        additionalIconHost.style.alignItems = "center";
        additionalIconHost.style.flexShrink = "0";
        actionsHost.append(additionalIconHost);

        const rowView = new ListItemView({
            name: "link-row",
            variant: "browse",
            selectionStyle: "focus",
            showSelectionIcon: false,
            selected: false,
            dropActive: false,
            searchText: "",
            iconElement: createTreeProviderItemIconElement(link),
            label: link.title || t("links.untitled"),
            trailingElement: actionsHost,
            drag: { draggable: false },
        });
        rowView.mount();
        const rowWrapper = document.createElement("div");
        rowWrapper.style.flex = "1 1 0%";
        rowWrapper.style.minWidth = "0";
        rowWrapper.style.display = "flex";

        const rowPanel = createPanelElement({
            name: "link-row-wrapper",
            revealChildrenOnHover: true,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            position: "relative",
        }, [rowView.root]);
        rowWrapper.append(rowPanel);
        const tooltip = attachTooltip(rowView.root, {
            content: this.tooltipContent(link),
            delayShow: 1200,
        });

        const record: CellParts = {
            root: rowWrapper,
            mount: () => rowWrapper,
            dispose: () => {
                record.removeListeners.forEach((remove) => remove());
                record.tooltip.dispose();
                record.editButton?.dispose();
                record.deleteButton?.dispose();
                record.rowView.dispose();
            },
            index,
            rowWrapper,
            rowView,
            actionsHost,
            additionalIconHost,
            tooltip,
            link,
            selected: false,
            dropTarget: false,
            isDragging: false,
            searchText: "",
            removeListeners: [],
        };
        this.installCellListeners(record);
        this.admitCell(record, index, link);
        return record;
    }

    private admitCell(record: CellParts, row: number, link: ILink): void {
        const props = this.props;
        const getId = props.getId ?? defaultGetId;
        const selected = props.selectedIds
            ? props.selectedIds.has(getId(link))
            : getId(link) === props.selectedId;
        const dropTarget = !!props.dropTargetId && getId(link) === props.dropTargetId;

        // This is intentionally a total write. `previous` identifies a coordinate, not an item;
        // after a scroll every one of these values may belong to the previous occupant.
        record.index = row;
        record.link = link;
        record.selected = selected;
        record.dropTarget = dropTarget;
        record.isDragging = false;
        record.searchText = props.searchText ?? "";
        record.dragSourceId = props.dragSourceId;
        record.onDragStartOverride = props.onDragStartOverride;
        record.allTags = props.allTags;
        record.imageProxy = props.imageProxy;
        record.onSelect = props.onSelect;
        record.onEdit = props.onEdit;
        record.onDelete = props.onDelete;
        record.onDoubleClick = props.onDoubleClick;
        record.onContextMenu = props.onContextMenu;
        record.onToggleTag = props.onToggleTag;
        record.onDragEnter = props.onItemDragEnter;
        record.onDragOver = props.onItemDragOver;
        record.onDragLeave = props.onItemDragLeave;
        record.onDrop = props.onItemDrop;

        record.rowWrapper.style.opacity = "";

        record.rowView.root.style.fontWeight = link.isDirectory ? "500" : "";
        record.rowView.update({
            name: "link-row",
            variant: "browse",
            selectionStyle: "focus",
            showSelectionIcon: false,
            selected,
            dropActive: dropTarget,
            searchText: record.searchText,
            iconElement: createTreeProviderItemIconElement(link),
            label: link.title || t("links.untitled"),
            trailingElement: record.actionsHost,
            drag: { draggable: !!record.dragSourceId },
        });

        record.additionalIcon = props.getAdditionalIcon?.(link);
        record.additionalIconHost.replaceChildren();
        if (record.additionalIcon) {
            record.additionalIconHost.append(
                createIconElement(record.additionalIcon, { width: 16, height: 16 }),
            );
        }
        this.syncActionButton(record, "edit", !!record.onEdit);
        this.syncActionButton(record, "delete", !!record.onDelete);
        record.tooltip.update({
            content: this.tooltipContent(link, record),
            delayShow: 1200,
        });
    }

    private updateCellWrapper(wrapper: HTMLElement): void {
        wrapper.style.boxSizing = "border-box";
        wrapper.style.padding = "0 4px";
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "stretch";
    }

    private listenRecord<T extends keyof HTMLElementEventMap>(
        record: CellParts,
        target: EventTarget,
        type: T,
        listener: (event: HTMLElementEventMap[T]) => void,
    ): () => void {
        target.addEventListener(type, listener as EventListener);
        const remove = () => target.removeEventListener(type, listener as EventListener);
        record.removeListeners.push(remove);
        return remove;
    }

    private tooltipContent(link: ILink, record?: CellParts): Node {
        return createLinkTooltipContent({
            link,
            allTags: record?.allTags ?? this.props.allTags,
            onToggleTag: record?.onToggleTag ?? this.props.onToggleTag,
            imageProxy: record?.imageProxy ?? this.props.imageProxy,
        });
    }

    private syncActionButton(
        record: CellParts,
        kind: "edit" | "delete",
        enabled: boolean,
    ): void {
        const key = kind === "edit" ? "editButton" : "deleteButton";
        const releaseKey = kind === "edit" ? "editButtonRelease" : "deleteButtonRelease";
        const existing = record[key];
        if (!enabled) {
            if (existing) {
                record[releaseKey]?.();
                record[releaseKey] = undefined;
                existing.root.remove();
                existing.dispose();
                record[key] = undefined;
            }
            return;
        }
        if (existing) return;

        const button = new IconButtonView({
            name: kind === "edit" ? "link-row-edit" : "link-row-delete",
            size: "sm",
            title: kind === "edit" ? t("links.edit") : t("menus.delete"),
            icon: createIconElement(kind === "edit" ? "rename" : "delete"),
            hideUntilParentHover: true,
        });
        button.mount();
        record.actionsHost.append(button.root);
        record[key] = button;
        record[releaseKey] = this.listenRecord(record, button.root, "click", (event) => {
            const click = event as MouseEvent;
            click.stopPropagation();
            record.onSelect?.(record.link);
            if (kind === "edit") record.onEdit?.(record.link);
            else record.onDelete?.(record.link, click.ctrlKey);
        });
    }

    private installCellListeners(record: CellParts): void {
        const row = record.rowView.root;
        this.listenRecord(record, row, "click", (event) => {
            record.onSelect?.(record.link, event);
        });
        this.listenRecord(record, row, "dblclick", () => {
            if (record.onDoubleClick) record.onDoubleClick(record.link);
            else record.onEdit?.(record.link);
        });
        this.listenRecord(record, row, "contextmenu", (event) => {
            record.onContextMenu?.(event, record.link);
        });
        this.listenRecord(record, row, "dragstart", (event) => {
            const current = record;
            if (!current.dragSourceId) {
                event.preventDefault();
                return;
            }
            event.stopPropagation();
            if (current.onDragStartOverride?.(
                current.link,
                event,
            )) return;
            if (!event.dataTransfer) return;
            setTraitDragData(event.dataTransfer, TraitTypeId.ILink, {
                items: [current.link],
                sourceId: current.dragSourceId,
            });
            current.isDragging = true;
            current.rowWrapper.style.opacity = "0.4";
        });
        this.listenRecord(record, row, "dragend", () => {
            const current = record;
            current.isDragging = false;
            current.rowWrapper.style.opacity = "";
        });
        this.listenRecord(record, row, "dragenter", (event) => this.forwardDrag(record, "onDragEnter", event as DragEvent));
        this.listenRecord(record, row, "dragover", (event) => this.forwardDrag(record, "onDragOver", event as DragEvent));
        this.listenRecord(record, row, "dragleave", (event) => this.forwardDrag(record, "onDragLeave", event as DragEvent));
        this.listenRecord(record, row, "drop", (event) => this.forwardDrag(record, "onDrop", event as DragEvent));
    }

    private forwardDrag(
        record: CellParts,
        callback: "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop",
        event: DragEvent,
    ): void {
        record[callback]?.(record.link, event);
    }
}
