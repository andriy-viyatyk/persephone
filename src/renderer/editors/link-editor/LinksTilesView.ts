import type { ILink } from "../../api/types/io.tree";
import { getFaviconPathSync, getHostname } from "../../components/icons/favicon-cache";
import { TraitTypeId, setTraitDragData } from "../../core/traits";
import { isArchivePath } from "../../core/utils/file-path";
import color from "../../theme/color";
import type { IconName } from "../../theme/icon-registry";
import type { ElementLength, GridModelCapability, Percent, RenderGridOptions, RenderSizeOptional } from "../../uikit/DataGrid";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { createPanelElement, applyPanelAttributes, resolvePanelAttributes } from "../../uikit/Panel/panel-style";
import { PooledRowHost, type PooledRowView, type RowAdapter } from "../../uikit/shared/pooled-row-host";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { LinkViewMode } from "./linkTypes";
import type { LinksTilesProps } from "./LinksTiles";
import { FaviconRowTracker } from "./FaviconRowTracker";
import { getPipeImageSrcSync, resolvePipeImageSrc } from "./pipe-image-src";
import { resolveRoutedSrc, type ImageRoute } from "./routed-src";
import { t } from "../../../shared/i18n/t";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Panel/Panel.css";

interface TileDimensions {
    cellWidth: number;
    cellHeight: number;
    imageHeight: number;
}

const TILE_DIMENSIONS: Record<Exclude<LinkViewMode, "list">, TileDimensions> = {
    "tiles-landscape":     { cellWidth: 252, cellHeight: 192, imageHeight: 144 },
    "tiles-landscape-big": { cellWidth: 372, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait":      { cellWidth: 168, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait-big":  { cellWidth: 252, cellHeight: 408, imageHeight: 336 },
};

const defaultGetId = (link: ILink): string => link.id ?? link.href;
const columnWidth: ElementLength = (() => "100%" as Percent) as ElementLength;

interface CellRecord extends PooledRowView {
    root: HTMLDivElement;
    mount(): HTMLElement;
    dispose(): void;
    tileRoot: HTMLDivElement;
    panel: HTMLDivElement;
    imageHost: HTMLDivElement;
    titleElement: HTMLSpanElement;
    additionalIconHost: HTMLSpanElement;
    actionsHost: HTMLDivElement;
    overlayHost: HTMLDivElement;
    primaryImage: HTMLImageElement;
    index: number;
    link?: ILink;
    selected: boolean;
    dropTarget: boolean;
    isDragging: boolean;
    failedSrc?: string;
    imageSource: string | null;
    imageProxy?: ImageRoute | null;
    dragSourceId?: string;
    additionalIcon?: IconName;
    onDragStartOverride?: LinksTilesProps["onDragStartOverride"];
    onSelect?: LinksTilesProps["onSelect"];
    onEdit?: LinksTilesProps["onEdit"];
    onDelete?: LinksTilesProps["onDelete"];
    onDoubleClick?: LinksTilesProps["onDoubleClick"];
    onContextMenu?: LinksTilesProps["onContextMenu"];
    onDragEnter?: LinksTilesProps["onItemDragEnter"];
    onDragOver?: LinksTilesProps["onItemDragOver"];
    onDragLeave?: LinksTilesProps["onItemDragLeave"];
    onDrop?: LinksTilesProps["onItemDrop"];
    editButton?: IconButtonView;
    deleteButton?: IconButtonView;
    removeListeners: (() => void)[];
}

export class LinksTilesView extends VanillaView<LinksTilesProps> {
    private readonly imageRows = new Map<string, number[]>();
    private readonly pooledRows: PooledRowHost<"tile", CellRecord>;
    private columnCountValue = 1;
    private width: number | undefined;
    private subscribedLinks: ILink[] | undefined;
    private previousViewMode: LinksTilesProps["viewMode"];
    private readonly faviconTracker: FaviconRowTracker;
    private imageGeneration = 0;
    private inert = false;
    private gridModel: GridModelCapability | null = null;

    private readonly rowCount = (): number => {
        return this.props.links.length > 0
            ? Math.ceil(this.props.links.length / this.columnCountValue)
            : 0;
    };

    private readonly columnCount = (): number => this.columnCountValue;

    private readonly adapter: RowAdapter<"tile", CellRecord> = {
        events: [],
        rowCount: this.rowCount,
        kindFor: () => "tile",
        create: (_kind, row, col) => this.createCell(row, col),
        update: (record, row, col) => this.updateCell(record, row, col),
        onRowEvent: () => undefined,
        updateWrapper: (wrapper) => this.writeCellGeometry(wrapper),
    };

    private readonly onGridResize = (size: RenderSizeOptional): void => {
        if (this.inert) return;
        const nextWidth = size.width;
        const dimensions = TILE_DIMENSIONS[this.props.viewMode];
        const nextColumnCount = nextWidth
            ? Math.max(1, Math.floor(nextWidth / dimensions.cellWidth))
            : 1;
        const widthChanged = this.width !== nextWidth;
        const columnsChanged = this.columnCountValue !== nextColumnCount;
        this.width = nextWidth;
        this.columnCountValue = nextColumnCount;
        if (columnsChanged) this.rebuildAsyncRows(this.props.links);
        if (widthChanged || columnsChanged) {
            // Width and column-count changes invalidate tile geometry and can change the
            // link-to-row mapping, so every current tile row needs repainting.
            this.pooledRows.repaint({ all: true });
        }
    };

    public constructor(props: LinksTilesProps) {
        const root = document.createElement("div");
        root.style.display = "contents";
        super(props, root);
        this.faviconTracker = new FaviconRowTracker((rows) => {
            if (!this.inert) this.pooledRows.repaint({ rows });
        });
        this.pooledRows = new PooledRowHost(this, this.root, this.adapter, {
            grid: this.gridOptions(),
            onGridModel: (model) => {
                this.gridModel = model;
                this.props.onGridModel?.(model);
            },
        });
        this.previousViewMode = props.viewMode;
        this.own(() => { this.inert = true; });
        this.own(() => this.faviconTracker.dispose());
        this.own(() => this.disposeAsyncSubscriptions());
        this.own(() => this.pooledRows.dispose());
    }

    private gridOptions(): Omit<RenderGridOptions, "rowCount" | "renderCell" | "keepCellsAttached"> {
        const dimensions = TILE_DIMENSIONS[this.props.viewMode];
        return {
            columnCount: this.columnCount,
            rowHeight: dimensions.cellHeight,
            columnWidth,
            fitToWidth: true,
            onResize: this.onGridResize,
        };
    }

    protected onMount(): void {
        this.pooledRows.enter();
        this.rebuildAsyncRows(this.props.links);
    }

    protected onUpdate(props: LinksTilesProps): void {
        const linksChanged = props.links !== this.subscribedLinks;
        const viewModeChanged = props.viewMode !== this.previousViewMode;
        if (linksChanged || viewModeChanged) this.rebuildAsyncRows(props.links);
        this.previousViewMode = props.viewMode;
        this.pooledRows.setOptions(this.gridOptions());
        if (linksChanged) {
            this.pooledRows.repaint({
                rows: Array.from({ length: this.rowCount() }, (_, row) => row),
            });
        }
        if (linksChanged || viewModeChanged) void this.pooledRows.gridModel?.scrollToRow(0);
    }

    private rebuildAsyncRows(links: ILink[]): void {
        this.disposeAsyncSubscriptions();
        this.subscribedLinks = links;
        this.imageGeneration++;
        this.imageRows.clear();

        for (let index = 0; index < links.length; index++) {
            const row = Math.floor(index / this.columnCountValue);
            const link = links[index];
            if (link.imgSrc && isArchivePath(link.imgSrc)) {
                this.addRow(this.imageRows, link.imgSrc, row);
            }
        }
        this.faviconTracker.track(links, (index) => Math.floor(index / this.columnCountValue));
    }

    private addRow(map: Map<string, number[]>, key: string, row: number): void {
        const rows = map.get(key);
        if (rows) {
            if (rows[rows.length - 1] !== row) rows.push(row);
        } else map.set(key, [row]);
    }

    private disposeAsyncSubscriptions(): void {
        this.imageGeneration++;
        this.imageRows.clear();
    }

    private repaintImage(source: string, generation: number): void {
        if (this.inert || generation !== this.imageGeneration) return;
        const rows = this.imageRows.get(source);
        if (rows?.length) this.pooledRows.repaint({ rows: [...rows] });
    }

    private ensureImageResolution(source: string): void {
        const generation = this.imageGeneration;
        void resolvePipeImageSrc(source).then(() => this.repaintImage(source, generation));
    }

    private createCell(row: number, col: number): CellRecord {
        const tileRoot = document.createElement("div");
        tileRoot.style.width = "100%";
        tileRoot.style.height = "100%";
        tileRoot.style.display = "flex";
        tileRoot.style.cursor = "default";

        const imageHost = document.createElement("div");
        imageHost.style.display = "flex";
        imageHost.style.alignItems = "center";
        imageHost.style.justifyContent = "center";
        imageHost.style.overflow = "hidden";

        const titleHost = document.createElement("div");
        titleHost.style.flex = "1";
        titleHost.style.display = "flex";
        titleHost.style.alignItems = "center";
        titleHost.style.padding = "4px 4px 4px 8px";
        titleHost.style.fontSize = "12px";
        titleHost.style.color = color.text.default;
        titleHost.style.overflow = "hidden";

        const titleElement = document.createElement("span");
        titleElement.style.flex = "1";
        titleElement.style.overflow = "hidden";
        titleElement.style.display = "-webkit-box";
        titleElement.style.webkitLineClamp = "2";
        titleElement.style.webkitBoxOrient = "vertical";
        titleElement.style.textOverflow = "ellipsis";
        titleElement.style.minWidth = "0";
        titleElement.style.wordBreak = "break-word";
        titleHost.append(titleElement);

        const additionalIconHost = document.createElement("span");
        additionalIconHost.style.position = "absolute";
        additionalIconHost.style.top = "4px";
        additionalIconHost.style.left = "4px";
        additionalIconHost.style.display = "flex";
        additionalIconHost.style.alignItems = "center";
        additionalIconHost.style.justifyContent = "center";
        additionalIconHost.style.padding = "2px";
        additionalIconHost.style.backgroundColor = color.background.overlay;
        additionalIconHost.style.border = `1px solid ${color.border.default}`;
        additionalIconHost.style.borderRadius = "6px";
        additionalIconHost.style.opacity = "0.8";
        additionalIconHost.style.pointerEvents = "none";

        const actionsHost = createPanelElement({
            name: "link-tile-actions",
            position: "absolute",
            top: 4,
            right: 4,
            gap: "xs",
        });

        const overlayHost = document.createElement("div");
        overlayHost.style.position = "absolute";
        overlayHost.style.inset = "0";
        overlayHost.style.pointerEvents = "none";

        const panel = createPanelElement({
            name: "link-tile",
            revealChildrenOnHover: true,
            direction: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
            rounded: "lg",
            border: true,
            borderColor: "subtle",
        }, [imageHost, titleHost, additionalIconHost, actionsHost, overlayHost]);
        tileRoot.append(panel);
        const primaryImage = document.createElement("img");
        primaryImage.loading = "lazy";
        primaryImage.style.maxWidth = "calc(100% - 8px)";
        primaryImage.style.maxHeight = "calc(100% - 8px)";
        primaryImage.style.objectFit = "contain";
        primaryImage.style.margin = "4px";

        const record: CellRecord = {
            root: tileRoot,
            mount: () => tileRoot,
            dispose: () => {
                record.removeListeners.forEach((remove) => remove());
                record.editButton?.dispose();
                record.deleteButton?.dispose();
            },
            tileRoot,
            panel,
            imageHost,
            titleElement,
            additionalIconHost,
            actionsHost,
            overlayHost,
            primaryImage,
            index: 0,
            selected: false,
            dropTarget: false,
            isDragging: false,
            imageSource: null,
            removeListeners: [],
        };
        this.listenRecord(record, primaryImage, "error", () => {
            if (!record.imageSource) return;
            record.failedSrc = record.imageSource;
            this.pooledRows.repaint({ rows: [record.index] });
        });
        this.installCellListeners(record);
        this.updateCell(record, row, col);
        return record;
    }

    private updateCell(record: CellRecord, row: number, col: number): void {
        const index = row * this.columnCountValue + col;
        const link = this.props.links[index];
        if (link) this.admitCell(record, row, col, link);
        else this.admitEmptyCell(record, row, col);
    }

    private admitEmptyCell(record: CellRecord, row: number, col: number): void {
        record.index = row * this.columnCountValue + col;
        record.link = undefined;
        record.selected = false;
        record.dropTarget = false;
        record.isDragging = false;
        record.imageSource = null;
        record.failedSrc = undefined;
        record.tileRoot.style.display = "none";
        record.tileRoot.draggable = false;
        record.tileRoot.title = "";
        record.tileRoot.style.opacity = "";
        this.clearOptionalHosts(record);
    }

    private admitCell(record: CellRecord, row: number, col: number, link: ILink): void {
        const props = this.props;
        const getId = props.getId ?? defaultGetId;
        const dimensions = TILE_DIMENSIONS[props.viewMode];
        const selected = props.selectedIds
            ? props.selectedIds.has(getId(link))
            : getId(link) === props.selectedId;
        const dropTarget = !!props.dropTargetId && getId(link) === props.dropTargetId;
        const imageSource = this.imageSource(link.imgSrc, props.imageProxy);

        // This is intentionally a total write. previous is the same coordinate, not the same item.
        record.index = row * this.columnCountValue + col;
        record.link = link;
        record.selected = selected;
        record.dropTarget = dropTarget;
        record.isDragging = false;
        record.imageProxy = props.imageProxy;
        record.dragSourceId = props.dragSourceId;
        record.additionalIcon = props.getAdditionalIcon?.(link);
        record.onDragStartOverride = props.onDragStartOverride;
        record.onSelect = props.onSelect;
        record.onEdit = props.onEdit;
        record.onDelete = props.onDelete;
        record.onDoubleClick = props.onDoubleClick;
        record.onContextMenu = props.onContextMenu;
        record.onDragEnter = props.onItemDragEnter;
        record.onDragOver = props.onItemDragOver;
        record.onDragLeave = props.onItemDragLeave;
        record.onDrop = props.onItemDrop;
        if (record.imageSource !== imageSource) record.failedSrc = undefined;
        record.imageSource = imageSource;

        record.tileRoot.style.display = "flex";
        record.tileRoot.draggable = !!record.dragSourceId;
        record.tileRoot.title = link.href || link.title;
        record.tileRoot.style.opacity = record.isDragging ? "0.4" : "";
        record.imageHost.style.height = `${dimensions.imageHeight}px`;
        record.titleElement.textContent = link.title || t("links.untitled");
        this.syncPanelState(record);
        this.syncImage(record, link);
        this.syncAdditionalIcon(record);
        this.syncActionButton(record, "edit", !!record.onEdit);
        this.syncActionButton(record, "delete", !!record.onDelete);
        this.syncOverlay(record);
    }

    private writeCellGeometry(wrapper: HTMLElement): void {
        wrapper.style.boxSizing = "border-box";
        wrapper.style.padding = "4px";
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "stretch";
    }

    private listenRecord<T extends keyof HTMLElementEventMap>(
        record: CellRecord,
        target: EventTarget,
        type: T,
        listener: (event: HTMLElementEventMap[T]) => void,
    ): void {
        target.addEventListener(type, listener as EventListener);
        record.removeListeners.push(() => target.removeEventListener(type, listener as EventListener));
    }

    private syncPanelState(record: CellRecord): void {
        applyPanelAttributes(record.panel, resolvePanelAttributes({
            name: "link-tile",
            revealChildrenOnHover: true,
            direction: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
            rounded: "lg",
            border: true,
            borderColor: record.selected ? "active" : "subtle",
        }));
    }

    private syncImage(record: CellRecord, link: ILink): void {
        const rawSource = link.imgSrc;
        const archive = !!rawSource && isArchivePath(rawSource);
        const pipedSource = getPipeImageSrcSync(rawSource);
        if (archive && !pipedSource && rawSource) this.ensureImageResolution(rawSource);
        const source = resolveRoutedSrc(
            pipedSource ?? (archive ? undefined : rawSource),
            record.imageProxy,
        );
        record.imageSource = source;
        const showImage = !!source && source !== record.failedSrc;
        record.imageHost.style.color = showImage ? "" : color.text.light;
        record.imageHost.style.fontSize = showImage ? "" : "12px";
        if (showImage && source) {
            if (record.primaryImage.getAttribute("src") !== source) record.primaryImage.src = source;
            record.primaryImage.alt = link.title;
            record.imageHost.replaceChildren(record.primaryImage);
            return;
        }

        const faviconPath = getFaviconPathSync(getHostname(link.href));
        if (faviconPath) {
            const favicon = document.createElement("img");
            favicon.src = `file://${faviconPath}`;
            favicon.alt = "";
            record.imageHost.replaceChildren(favicon);
        } else {
            record.imageHost.replaceChildren(createIconElement("globe", { width: 32, height: 32 }));
            const fallback = record.imageHost.lastElementChild;
            if (fallback) fallback.setAttribute("style", "opacity: 0.3");
        }
    }

    private syncAdditionalIcon(record: CellRecord): void {
        record.additionalIconHost.replaceChildren();
        if (record.additionalIcon) {
            record.additionalIconHost.append(createIconElement(record.additionalIcon, { width: 14, height: 14 }));
        }
    }

    private syncActionButton(record: CellRecord, kind: "edit" | "delete", enabled: boolean): void {
        const key = kind === "edit" ? "editButton" : "deleteButton";
        const existing = record[key];
        if (!enabled) {
            existing?.root.remove();
            return;
        }
        const button = existing ?? this.createActionButton(record, kind);
        if (button.root.parentElement !== record.actionsHost) record.actionsHost.append(button.root);
    }

    private createActionButton(record: CellRecord, kind: "edit" | "delete"): IconButtonView {
        const button = new IconButtonView({
            name: kind === "edit" ? "link-tile-edit" : "link-tile-delete",
            size: "sm",
            title: kind === "edit" ? t("links.edit") : t("menus.delete"),
            icon: kind === "edit" ? "rename" : "delete",
            hideUntilParentHover: true,
        });
        button.mount();
        if (kind === "edit") record.editButton = button;
        else record.deleteButton = button;
        this.listenRecord(record, button.root, "click", (event) => {
            if (!record.link) return;
            event.stopPropagation();
            record.onSelect?.(record.link);
            if (kind === "edit") record.onEdit?.(record.link);
            else record.onDelete?.(record.link, event.ctrlKey);
        });
        return button;
    }

    private syncOverlay(record: CellRecord): void {
        record.overlayHost.style.display = record.selected || record.dropTarget ? "block" : "none";
        record.overlayHost.style.backgroundColor = color.background.selection;
        record.overlayHost.style.opacity = record.dropTarget ? "0.5" : "0.3";
        if (record.dropTarget) {
            record.overlayHost.style.outline = `2px solid ${color.border.active}`;
            record.overlayHost.style.outlineOffset = "-2px";
        } else {
            record.overlayHost.style.outline = "";
            record.overlayHost.style.outlineOffset = "";
        }
    }

    private clearOptionalHosts(record: CellRecord): void {
        record.imageHost.replaceChildren();
        record.titleElement.textContent = "";
        record.additionalIcon = undefined;
        record.additionalIconHost.replaceChildren();
        record.actionsHost.replaceChildren();
        record.overlayHost.style.display = "none";
    }

    private imageSource(src: string | undefined, proxy: ImageRoute | null | undefined): string | null {
        if (!src || isArchivePath(src)) return null;
        return resolveRoutedSrc(src, proxy);
    }

    private installCellListeners(record: CellRecord): void {
        const tile = record.tileRoot;
        this.listenRecord(record, tile, "click", (event) => {
            if (!record.link) return;
            record.onSelect?.(record.link, event);
        });
        this.listenRecord(record, tile, "dblclick", () => {
            if (!record.link) return;
            if (record.onDoubleClick) record.onDoubleClick(record.link);
            else record.onEdit?.(record.link);
        });
        this.listenRecord(record, tile, "contextmenu", (event) => {
            if (!record.link) return;
            record.onContextMenu?.(event, record.link);
        });
        this.listenRecord(record, tile, "dragstart", (event) => {
            if (!record.link) return;
            const current = record;
            if (!current.dragSourceId) {
                event.preventDefault();
                return;
            }
            event.stopPropagation();
            const dragOverride = current.onDragStartOverride;
            if (dragOverride?.(
                current.link,
                event,
            )) return;
            if (!event.dataTransfer) return;
            setTraitDragData(event.dataTransfer, TraitTypeId.ILink, {
                items: [current.link],
                sourceId: current.dragSourceId,
            });
            current.isDragging = true;
            current.tileRoot.style.opacity = "0.4";
        });
        this.listenRecord(record, tile, "dragend", () => {
            const current = record;
            current.isDragging = false;
            current.tileRoot.style.opacity = "";
        });
        this.listenRecord(record, tile, "dragenter", (event) => this.forwardDrag(record, "onDragEnter", event as DragEvent));
        this.listenRecord(record, tile, "dragover", (event) => this.forwardDrag(record, "onDragOver", event as DragEvent));
        this.listenRecord(record, tile, "dragleave", (event) => this.forwardDrag(record, "onDragLeave", event as DragEvent));
        this.listenRecord(record, tile, "drop", (event) => this.forwardDrag(record, "onDrop", event as DragEvent));
    }

    private forwardDrag(
        record: CellRecord,
        callback: "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop",
        event: DragEvent,
    ): void {
        if (!record.link) return;
        record[callback]?.(record.link, event);
    }
}
