import { t } from "../../../shared/i18n/t";
import { app } from "../../api/app";
import { boardRegistry } from "../../api/boards/board-registry";
import { settings } from "../../api/settings";
import type { AppSettingsKey } from "../../api/settings-schema";
import { uiPreferences } from "../../api/ui-preferences";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { EditorCategoryColumnListView, type EditorCategoryColumn, type EditorCategoryDragData } from "../sidebar/EditorCategoryColumnListView";
import { editorCategories } from "../../api/editor-categories";
import { getCreatableItems, getCreatableItemLabel } from "../../api/creatable-items";
import { createCreatableItemIcon } from "../sidebar/creatable-item-icon";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { fpBasename } from "../../core/utils/file-path";
import { buildRootsTree, type RootsTreeNode } from "../../components/roots-tree-build";
import { boardDisplayText, boardMetadataKeys, onBoardDisplayTextChanged } from "../../api/boards/board-display-text";
import { subscribeBoardIconChanges } from "../../editors/board/board-icon-cache";
import { pages } from "../../api/pages";
import { InputView } from "../../uikit/Input/InputView";
import { ButtonView } from "../../uikit/Button/ButtonView";
import "./EditorCategoriesPopoverView.css";

const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

export interface EditorCategoriesPopoverProps { host: HTMLElement; onClose: () => void }

export class EditorCategoriesPopoverView extends VanillaView<EditorCategoriesPopoverProps> {
    private readonly header = document.createElement("div");
    private readonly resizeHandle = document.createElement("div");
    private filterView: InputView | undefined;
    private query = "";
    private list: EditorCategoryColumnListView | undefined;
    private activeIndex = -1;
    private eligibleBoards: string[] = [];

    public constructor(props: EditorCategoriesPopoverProps) {
        super(props, props.host as HTMLDivElement);
        this.root.dataset.name = "editor-categories-popover";
        this.root.setAttribute("aria-label", t("shell.editorCategoryPopoverLabel"));
    }

    protected onMount(): void {
        this.root.dataset.name = "editor-categories-popover";
        this.applyStoredSize();
        this.header.dataset.part = "header";
        const filterView = new InputView(this.filterProps());
        this.filterView = this.child(filterView);
        filterView.mount();
        const showAll = this.child(new ButtonView({
            name: "editor-category-show-all",
            size: "sm",
            children: t("shell.editorCategoryShowAll"),
            onClick: () => { void pages.standalonePages.show("tools-hub-page", { tab: "editors" }).then((): undefined => undefined); this.props.onClose(); },
        }));
        showAll.mount();
        this.header.append(filterView.root, showAll.root);
        this.resizeHandle.dataset.part = "resize-handle";
        this.listen(this.resizeHandle, "pointerdown", this.onResizePointerDown);
        this.listen(this.root, "keydown", this.onKeyDown);
        this.root.append(this.header, this.resizeHandle);
        this.own(boardRegistry.subscribeMembership(this.refreshBoards));
        this.own(onBoardDisplayTextChanged(() => this.renderList()));
        this.own(subscribeBoardIconChanges(() => this.renderList()));
        const settingsKeys = ["editor-categories", "browser-profiles"] as const satisfies readonly AppSettingsKey[];
        for (const key of settingsKeys) this.own(settings.watch(key, () => this.renderList()));
        this.refreshBoards();
        this.renderList();
        queueMicrotask(() => filterView.inputElement.focus());
    }

    private readonly onFilterChange = (value: string): void => {
        this.query = value;
        this.filterView?.update(this.filterProps());
        this.renderList();
    };

    private filterProps(): ConstructorParameters<typeof InputView>[0] {
        return {
            name: "editor-categories-filter",
            size: "sm",
            value: this.query,
            placeholder: t("shell.editorCategoryFilterPlaceholder"),
            onChange: this.onFilterChange,
        };
    }

    /**
     * Opens at the saved size; unset means the CSS default size. The size goes through custom
     * properties because PopoverView owns the root's inline width/height and clears them on
     * every update; the stylesheet also caps both at the window size.
     */
    private applyStoredSize(): void {
        const width = uiPreferences.readNumber("editor-categories-popover-width");
        const height = uiPreferences.readNumber("editor-categories-popover-height");
        if (!width || !height || width <= 0 || height <= 0) return;
        this.setSize(Math.max(width, MIN_WIDTH), Math.max(height, MIN_HEIGHT));
    }

    private setSize(width: number, height: number): void {
        this.root.style.setProperty("--editor-categories-popover-width", `${width}px`);
        this.root.style.setProperty("--editor-categories-popover-height", `${height}px`);
    }

    private readonly onResizePointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const handle = this.resizeHandle;
        const start = this.root.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        let width = start.width;
        let height = start.height;
        handle.setPointerCapture(event.pointerId);
        const onMove = (move: PointerEvent): void => {
            width = Math.min(Math.max(start.width + move.clientX - startX, MIN_WIDTH), window.innerWidth - start.left - 8);
            height = Math.min(Math.max(start.height + move.clientY - startY, MIN_HEIGHT), window.innerHeight - start.top - 8);
            this.setSize(width, height);
        };
        const onEnd = (): void => {
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("lostpointercapture", onEnd);
            uiPreferences.write("editor-categories-popover-width", Math.round(width));
            uiPreferences.write("editor-categories-popover-height", Math.round(height));
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("lostpointercapture", onEnd);
    };

    protected onDispose(): void { this.list?.dispose(); }

    /** Every trusted board is eligible, whatever file types it declares. */
    private readonly refreshBoards = (): void => {
        this.eligibleBoards = boardRegistry.roots("trusted");
        this.renderList();
    };

    private renderList(): void {
        if (this.list) this.releaseChild(this.list);
        this.list?.root.remove();
        const eligible = getCreatableItems(settings.get("browser-profiles")).map((item) => ({
            ref: item.id, label: getCreatableItemLabel(item), icon: createCreatableItemIcon(item),
            create: item.create,
        }));
        const sortedRoots: string[] = [];
        const visitBoardNodes = (nodes: RootsTreeNode<"board">[]): void => {
            for (const node of nodes) {
                if (node.kind === "board" && node.root) sortedRoots.push(node.root);
                else if (node.items) visitBoardNodes(node.items);
            }
        };
        visitBoardNodes(buildRootsTree(
            this.eligibleBoards.map(root => ({ root, label: fpBasename(root) })),
            undefined,
            { leafKind: "board", leafIdPrefix: "board:" },
        ));
        const boardRows = sortedRoots.map((root) => ({
            ref: editorCategories.encodeRef({ kind: "board", root }),
            label: boardDisplayText(root, undefined, boardMetadataKeys.name, fpBasename(root)),
            icon: createBoardGlyphElement(root),
            create: () => { void app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(root))); },
        }));
        const allRows = [...eligible, ...boardRows];
        const membership = new Set(editorCategories.categories().flatMap((category) => category.items));
        const query = this.query.trim().toLocaleLowerCase();
        const columns: EditorCategoryColumn[] = editorCategories.categories().map((category) => ({
            id: category.id,
            label: category.id === "top" ? t("shell.editorCategoryTop") : category.name,
            rows: category.items.flatMap((ref) => {
                const row = allRows.find((candidate) => candidate.ref === ref);
                return row && (!query || row.label.toLocaleLowerCase().includes(query))
                    ? [{ ref, label: row.label, icon: row.icon, categoryId: category.id, categoryItem: true }]
                    : [];
            }),
        })).filter((column) => column.id === "top" || column.rows.length > 0);
        const other = allRows.filter((row) => !membership.has(row.ref) && (!query || row.label.toLocaleLowerCase().includes(query)));
        columns.push({ id: "other", label: t("shell.editorCategoryOther"), rows: other.map((row) => ({ ref: row.ref, label: row.label, icon: row.icon, categoryId: "other", categoryItem: false })) });
        const list = new EditorCategoryColumnListView({
            columns,
            height: "auto",
            draggable: false,
            droppable: false,
            rowData: (row): EditorCategoryDragData => row.categoryItem
                ? { kind: "category-item", categoryId: row.categoryId, ref: editorCategories.decodeRef(row.ref) }
                : { kind: "source", ref: editorCategories.decodeRef(row.ref) },
            onDrop: () => {},
            onActivate: (row) => {
                const item = allRows.find((candidate) => candidate.ref === row.ref);
                item?.create();
                this.props.onClose();
            },
            rowDataName: "editor-category-popover-item",
        });
        list.root.dataset.name = "editor-category-column-list";
        this.list = this.child(list);
        this.root.insertBefore(list.root, this.resizeHandle);
        list.mount();
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") { event.preventDefault(); this.props.onClose(); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const rows = Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-part=row]"));
            if (!rows.length) return;
            event.preventDefault();
            this.activeIndex = this.activeIndex < 0
                ? event.key === "ArrowDown" ? 0 : rows.length - 1
                : (this.activeIndex + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
            rows[this.activeIndex].focus();
            rows.forEach((row, index) => row.toggleAttribute("data-active", index === this.activeIndex));
        } else if (event.key === "Enter") {
            const active = this.root.querySelector<HTMLButtonElement>("[data-part=row][data-active]")
                ?? this.root.querySelector<HTMLButtonElement>("[data-part=row]");
            if (active) { event.preventDefault(); active.click(); }
        }
    };
}
