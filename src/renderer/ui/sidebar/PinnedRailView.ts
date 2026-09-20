import { app } from "../../api/app";
import { ContextMenuEvent } from "../../api/events/events";
import { settings } from "../../api/settings";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { fpBasename } from "../../core/utils/file-path";
import { TraitTypeId, getTraitDragData, hasTraitDragData, setTraitDragData } from "../../core/traits";
import { createIconElement, createIconPlaceholderElement, isIconName } from "../../uikit/shared/slots";
import { fillSlot } from "../../uikit/shared/fill-slot";
import { KeyedList } from "../../uikit/shared/keyed-list";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { subscribeBoardIconChanges } from "../../editors/board/board-icon-cache";
import {
    getBundledBoardContextMenu,
    getCreatableItems,
    type CreatableItem,
} from "./tools-editors-registry";
import {
    PINNED_DRAG_SESSION_EVENT,
    endPinnedDragSession,
    startPinnedDragSession,
    type PinnedDragSessionDetail,
} from "./pinned-drag-session";
import {
    decodePin,
    encodePin,
    getPinnedStrings,
    insertPin,
    isPinnedRef,
    movePin,
    removePin,
    type PinnedRef,
} from "./pinned-items";
import "./PinnedRail.css";

// Kept at module scope intentionally: both existing PinnedRail surfaces share this drag sentinel.
let draggingPinnedIndex = -1;

export interface PinnedRailProps {
    layout: "horizontal" | "vertical";
    onClose?: () => void;
}

interface PinnedRow {
    ref: PinnedRef;
    index: number;
    item?: CreatableItem;
}

interface RowRecord {
    rowData: PinnedRow;
    iconCleanup: () => void;
    button: IconButtonView;
    listenersCleanup: () => void;
}

export class PinnedRailView extends VanillaView<PinnedRailProps> {
    private readonly scroll = document.createElement("div");
    private readonly rows = new WeakMap<HTMLDivElement, RowRecord>();
    private list: KeyedList<PinnedRow, string, HTMLDivElement> | undefined;
    private sourceSessionActive = false;
    private activeSourceRef: PinnedRef | undefined;
    private activeSourceMode: "pin" | "unpin" | undefined;
    private foreignDropIndex: number | undefined;

    public constructor(props: PinnedRailProps) {
        super(props);
    }

    protected onMount(): void {
        this.root.dataset.type = "tools-editors-pinned";
        this.root.dataset.layout = this.props.layout;

        const header = document.createElement("div");
        header.dataset.part = "section-header";
        header.textContent = "Pinned";
        this.scroll.dataset.part = "scroll";
        this.root.append(header, this.scroll);

        // Bound to the rail root, not the scroll box: the empty area below the last row, the
        // "Pinned" header, and the scroll box itself must all append. A row consumes its own
        // foreign drag with `stopPropagation()`, and `isBackgroundTarget` rejects anything that
        // did reach here from inside a row, so the two paths never both handle one event.
        this.listen(this.root, "dragenter", (event) => this.onBackgroundDragEnter(event));
        this.listen(this.root, "dragover", (event) => this.onBackgroundDragOver(event));
        this.listen(this.root, "dragleave", (event) => this.onBackgroundDragLeave(event));
        this.listen(this.root, "drop", (event) => this.onBackgroundDrop(event));
        this.listen(this.root, "dragend", () => this.clearDragFlags());

        const sessionListener = (event: Event): void => {
            this.onDragSessionEvent(event as CustomEvent<PinnedDragSessionDetail>);
        };
        document.addEventListener(PINNED_DRAG_SESSION_EVENT, sessionListener);
        this.own(() => document.removeEventListener(PINNED_DRAG_SESSION_EVENT, sessionListener));

        this.list = new KeyedList<PinnedRow, string, HTMLDivElement>(this.scroll, {
            keyOf: (row) => encodePin(row.ref),
            create: (row) => this.createRow(row),
            update: (element, row) => this.updateRow(element, row),
            remove: (element) => this.removeRow(element),
        });
        this.own(() => this.list?.dispose());
        this.own(subscribeBoardIconChanges(() => this.refresh()));
        this.own(() => {
            draggingPinnedIndex = -1;
            this.sourceSessionActive = false;
            this.activeSourceRef = undefined;
            this.activeSourceMode = undefined;
            this.clearDragFlags();
        });
        const settingsSubscription = settings.onChanged.subscribe(({ key }) => {
            if (
                key === "browser-profiles"
                || key === "pinned-editors"
                || key === "disabled-bundled-boards"
            ) this.refresh();
        });
        this.own(settingsSubscription);

        this.refresh();
    }

    protected onUpdate(props: PinnedRailProps): void {
        this.root.dataset.layout = props.layout;
        this.refresh();
    }

    private refresh(): void {
        const editorById = new Map<string, CreatableItem>();
        for (const item of getCreatableItems(settings.get("browser-profiles"))) {
            editorById.set(item.id, item);
        }

        const storedPins = getPinnedStrings();
        const rows = storedPins.map((stored, index) => {
            const ref = decodePin(stored);
            return {
                ref,
                index,
                item: ref.kind === "editor" ? editorById.get(ref.id) : undefined,
            } satisfies PinnedRow;
        }).filter((row) => row.ref.kind === "board" || row.item !== undefined);

        this.root.hidden = storedPins.length === 0 && !this.sourceSessionActive;
        this.list?.update(rows);
    }

    private createRow(rowData: PinnedRow): HTMLDivElement {
        const row = document.createElement("div");
        const iconHost = document.createElement("span");
        const label = document.createElement("span");
        const buttonHost = document.createElement("span");
        iconHost.className = "item-icon";
        label.className = "item-label";
        buttonHost.className = "pin-button-wrapper";
        row.append(iconHost, label, buttonHost);

        const button = new IconButtonView({
            size: "sm",
            icon: "pin-filled",
            title: "Unpin",
            onClick: (event) => {
                event.stopPropagation();
                removePin(this.rows.get(row)?.rowData.ref ?? rowData.ref);
            },
        });
        button.mount();
        buttonHost.append(button.root);

        const record: RowRecord = {
            rowData,
            iconCleanup: () => undefined,
            button,
            listenersCleanup: () => undefined,
        };
        this.rows.set(row, record);
        const releases: Array<() => void> = [];
        const registerListener = <K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void): void => {
            releases.push(this.listen(row, type, listener));
        };
        registerListener("click", () => this.activate(record.rowData.ref));
        registerListener("contextmenu", (event) => {
            const current = this.rows.get(row)?.rowData;
            const menu = current?.ref.kind === "editor" && current.item
                ? getBundledBoardContextMenu(current.item)
                : undefined;
            if (!menu) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const contextEvent = ContextMenuEvent.fromNativeEvent(event, "generic");
            contextEvent.items.push(...menu);
        });
        registerListener("dragstart", (event) => this.onDragStart(row, event));
        registerListener("dragend", () => this.onDragEnd());
        registerListener("dragenter", (event) => this.onDragEnter(row, event));
        registerListener("dragover", (event) => this.onDragOver(row, event));
        registerListener("dragleave", (event) => this.onDragLeave(row, event));
        registerListener("drop", (event) => this.onDrop(row, event));
        record.listenersCleanup = () => releases.forEach((release) => release());
        return row;
    }

    private updateRow(row: HTMLDivElement, rowData: PinnedRow): void {
        const record = this.rows.get(row);
        if (!record) return;
        record.rowData = rowData;
        const editor = rowData.item;
        const rowClass = rowData.ref.kind === "board" ? "tools-board-row" : "tools-editor-row";
        row.classList.toggle("tools-board-row", rowData.ref.kind === "board");
        row.classList.toggle("tools-editor-row", rowData.ref.kind === "editor");
        row.dataset.type = rowClass;
        row.setAttribute("draggable", "true");
        if (rowData.ref.kind === "board") {
            row.querySelector<HTMLElement>(".item-label")!.textContent = fpBasename(rowData.ref.root);
            record.iconCleanup = fillSlot(
                row.querySelector<HTMLElement>(".item-icon")!,
                createBoardGlyphElement(rowData.ref.root),
            );
        } else if (editor) {
            row.querySelector<HTMLElement>(".item-label")!.textContent = editor.label;
            record.iconCleanup = fillSlot(
                row.querySelector<HTMLElement>(".item-icon")!,
                typeof editor.icon === "string"
                    ? (isIconName(editor.icon) ? createIconElement(editor.icon) : createIconPlaceholderElement())
                    : editor.icon ?? null,
            );
        }
    }

    private removeRow(row: HTMLDivElement): void {
        const record = this.rows.get(row);
        if (!record) return;
        record.listenersCleanup();
        record.iconCleanup();
        record.button.dispose();
        record.button.root.remove();
        this.rows.delete(row);
    }

    private activate(ref: PinnedRef): void {
        if (ref.kind === "board") {
            void app.events.openRawLink.sendAsync(
                createLinkData(encodePersephoneBoardLink(ref.root)),
            );
        } else {
            const item = getCreatableItems(settings.get("browser-profiles")).find((candidate) =>
                candidate.id === ref.id,
            );
            item?.create();
        }
        this.props.onClose?.();
    }

    private onDragStart(row: HTMLDivElement, event: DragEvent): void {
        event.stopPropagation();
        const record = this.rows.get(row);
        if (!record) return;
        draggingPinnedIndex = record.rowData.index;
        const ref = record.rowData.ref;
        startPinnedDragSession(ref, "unpin");
        setTraitDragData(event.dataTransfer, TraitTypeId.PinnedEditor, {
            kind: "reorder",
            index: record.rowData.index,
            ref,
        });
        row.setAttribute("data-dragging", "");
    }

    private onDragEnd(): void {
        draggingPinnedIndex = -1;
        endPinnedDragSession();
        this.clearDragFlags();
    }

    private onDragEnter(row: HTMLDivElement, event: DragEvent): void {
        const record = this.rows.get(row);
        if (!record) return;
        if (this.isForeignSourceDrag(event)) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            this.setForeignDropTarget(row, record.rowData.index);
            return;
        }
        if (!hasTraitDragData(event.dataTransfer) ||
            draggingPinnedIndex < 0 || draggingPinnedIndex === record.rowData.index) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        row.setAttribute("data-drag-over", "");
    }

    private onDragOver(row: HTMLDivElement, event: DragEvent): void {
        const record = this.rows.get(row);
        if (!record) return;
        if (this.isForeignSourceDrag(event)) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            this.setForeignDropTarget(row, record.rowData.index);
            return;
        }
        if (!hasTraitDragData(event.dataTransfer) ||
            draggingPinnedIndex < 0 || draggingPinnedIndex === record.rowData.index) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        // Read the hover index BEFORE moving. `movePin` persists synchronously, which re-runs
        // `refresh()` and replaces `record.rowData` with this row's post-move data — so reading
        // the index afterwards yields the hovered item's new index instead of the position the
        // dragged item was just moved to. The previous renderer captured `index` during rendering
        // closure, which is why it could read it either side of the move.
        const hoverIndex = record.rowData.index;
        movePin(draggingPinnedIndex, hoverIndex);
        draggingPinnedIndex = hoverIndex;
    }

    private onDragLeave(row: HTMLDivElement, event: DragEvent): void {
        if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
        this.setDragOver(row, false);
        const record = this.rows.get(row);
        if (record?.rowData.index === this.foreignDropIndex) this.foreignDropIndex = undefined;
    }

    private onDrop(row: HTMLDivElement, event: DragEvent): void {
        const record = this.rows.get(row);
        if (this.isForeignSourceDrag(event)) {
            event.preventDefault();
            event.stopPropagation();
            this.finishForeignDrop(event, record?.rowData.index ?? this.foreignDropIndex);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.clearDragFlags();
    }

    /** True when the event landed on the rail itself rather than on one of its pinned rows. */
    private isBackgroundTarget(event: DragEvent): boolean {
        const target = event.target;
        if (!(target instanceof Element)) return false;
        return target.closest(".tools-editor-row, .tools-board-row") === null;
    }

    private onBackgroundDragEnter(event: DragEvent): void {
        if (!this.isBackgroundTarget(event) || !this.isForeignSourceDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        this.setBackgroundDropTarget();
    }

    private onBackgroundDragOver(event: DragEvent): void {
        if (!this.isBackgroundTarget(event) || !this.isForeignSourceDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        this.setBackgroundDropTarget();
    }

    private onBackgroundDragLeave(event: DragEvent): void {
        if (event.relatedTarget instanceof Node && this.root.contains(event.relatedTarget)) return;
        this.clearDragFlags();
    }

    private onBackgroundDrop(event: DragEvent): void {
        if (!this.isBackgroundTarget(event) || !this.isForeignSourceDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        this.finishForeignDrop(event, getPinnedStrings().length);
    }

    private onDragSessionEvent(event: CustomEvent<PinnedDragSessionDetail>): void {
        const ref = event.detail?.ref;
        this.sourceSessionActive = ref !== null && event.detail.mode === "pin";
        this.activeSourceRef = ref ?? undefined;
        this.activeSourceMode = ref === null ? undefined : event.detail.mode;
        if (!this.sourceSessionActive) this.clearDragFlags();
        this.refresh();
    }

    private isForeignSourceDrag(event: DragEvent): boolean {
        return this.sourceSessionActive
            && this.activeSourceMode === "pin"
            && this.activeSourceRef !== undefined
            && hasTraitDragData(event.dataTransfer);
    }

    private finishForeignDrop(event: DragEvent, dropIndex: number | undefined): void {
        const payload = getTraitDragData(event.dataTransfer);
        this.clearDragFlags();
        endPinnedDragSession();
        const ref = getSourceRef(payload);
        if (!ref || dropIndex === undefined || !Number.isInteger(dropIndex) || dropIndex < 0) return;
        insertPin(ref, dropIndex);
    }

    private setForeignDropTarget(row: HTMLDivElement, index: number): void {
        this.clearDropIndicators();
        this.foreignDropIndex = index;
        row.setAttribute("data-drag-over", "");
    }

    private setBackgroundDropTarget(): void {
        this.clearDropIndicators();
        this.foreignDropIndex = getPinnedStrings().length;
        // "Append" reads as a line under the last row, not as the row indicator's top border.
        // With no rows at all there is nothing to underline, so the empty scroll box carries it.
        const lastRow = this.scroll.lastElementChild;
        if (lastRow) lastRow.setAttribute("data-drag-over-end", "");
        else this.scroll.setAttribute("data-drag-over", "");
    }

    private setDragOver(row: HTMLDivElement, active: boolean): void {
        if (active) row.setAttribute("data-drag-over", "");
        else row.removeAttribute("data-drag-over");
    }

    private clearDragFlags(): void {
        this.scroll.querySelectorAll<HTMLElement>("[data-dragging]").forEach((row) => {
            row.removeAttribute("data-dragging");
        });
        this.clearDropIndicators();
        this.foreignDropIndex = undefined;
    }

    private clearDropIndicators(): void {
        this.scroll.querySelectorAll<HTMLElement>("[data-drag-over], [data-drag-over-end]").forEach((row) => {
            row.removeAttribute("data-drag-over");
            row.removeAttribute("data-drag-over-end");
        });
        this.scroll.removeAttribute("data-drag-over");
    }
}

function getSourceRef(payload: ReturnType<typeof getTraitDragData>): PinnedRef | undefined {
    if (!payload || payload.typeId !== TraitTypeId.PinnedEditor) return undefined;
    if (!isSourceData(payload.data)) return undefined;
    return isPinnedRef(payload.data.ref) ? payload.data.ref : undefined;
}

function isSourceData(value: unknown): value is { kind: "source"; ref: unknown } {
    if (!value || typeof value !== "object") return false;
    return (value as { kind?: unknown }).kind === "source"
        && "ref" in value;
}
