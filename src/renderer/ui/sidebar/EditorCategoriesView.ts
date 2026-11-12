import { t } from "../../../shared/i18n/t";
import { showConfirmationDialog } from "../dialogs/ConfirmationDialog";
import { DialogButton, dialogButton } from "../dialogs/dialog-buttons";
import { settings } from "../../api/settings";
import type { AppSettingsKey } from "../../api/settings-schema";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { ui } from "../../api/ui";
import { boardRegistry } from "../../api/boards/board-registry";
import { boardDisplayText, boardMetadataKeys } from "../../api/boards/board-display-text";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { fpBasename } from "../../core/utils/file-path";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { InputView } from "../../uikit/Input/InputView";
import { EditorCategoryColumnListView, type EditorCategoryColumn } from "./EditorCategoryColumnListView";
import { editorCategories } from "../../api/editor-categories";
import { getCreatableItems, getCreatableItemLabel } from "../../api/creatable-items";
import { createCreatableItemIcon } from "./creatable-item-icon";
import "./EditorCategoriesView.css";

export interface EditorCategoriesViewProps { onRenameStart?: (categoryId: string) => void }

export class EditorCategoriesView extends VanillaView<EditorCategoriesViewProps> {
    private list: EditorCategoryColumnListView | undefined;
    private toolbar = document.createElement("div");
    private boardRoots: string[] = [];
    private renameView: InputView | undefined;

    public constructor(props: EditorCategoriesViewProps = {}) {
        super(props);
        this.root.dataset.type = "editor-categories-view";
        this.root.dataset.name = "editor-categories-panel";
    }

    protected onMount(): void {
        this.toolbar.dataset.part = "toolbar";
        const title = document.createElement("span");
        title.textContent = t("shell.editorCategories");
        this.toolbar.append(title);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.name = "editor-category-new";
        button.textContent = t("shell.editorCategoryNew");
        button.addEventListener("click", () => {
            const category = editorCategories.create("");
            this.render();
            this.beginRename(category.id, true);
        });
        this.toolbar.append(button);
        this.root.append(this.toolbar);
        const settingsKeys = ["editor-categories", "browser-profiles"] as const satisfies readonly AppSettingsKey[];
        for (const key of settingsKeys) this.own(settings.watch(key, () => this.render()));
        this.own(boardRegistry.subscribeMembership(() => this.refreshBoards()));
        void boardRegistry.load().then(this.refreshBoards, this.refreshBoards);
        this.render();
    }

    public startRename(categoryId: string): void { this.beginRename(categoryId); }

    /** Disposes the inline rename input; its heading is about to be rebuilt or was replaced. */
    private releaseRename(): void {
        if (!this.renameView) return;
        this.releaseChild(this.renameView);
        this.renameView.root.remove();
        this.renameView = undefined;
    }

    private render(): void {
        this.releaseRename();
        if (this.list) this.releaseChild(this.list);
        this.list?.root.remove();
        const categories = editorCategories.categories();
        const items = getCreatableItems(settings.get("browser-profiles"));
        const itemRows = items.map((item) => ({
            ref: item.id, label: getCreatableItemLabel(item), categoryId: "", categoryItem: true,
            icon: createCreatableItemIcon(item),
        }));
        const boardRows = this.boardRoots.map((root) => ({
            ref: editorCategories.encodeRef({ kind: "board", root }), label: boardDisplayText(root, undefined, boardMetadataKeys.name, fpBasename(root)),
            categoryId: "", categoryItem: true, icon: createBoardGlyphElement(root),
        }));
        const columns: EditorCategoryColumn[] = categories.map((category) => ({
            id: category.id,
            label: category.id === "top" ? t("shell.editorCategoryTop") : category.name,
            fixed: category.id === "top",
            placeholder: category.id === "top" ? undefined : t("shell.editorCategoryDragHere"),
            rows: category.items.flatMap((ref) => {
                const item = [...itemRows, ...boardRows].find((candidate) => candidate.ref === ref);
                return item ? [{ ...item, categoryId: category.id }] : [];
            }),
        }));
        const list = new EditorCategoryColumnListView({
            columns,
            height: "calc(100% - 36px)",
            rowData: (row) => ({ kind: "category-item", categoryId: row.categoryId, ref: editorCategories.decodeRef(row.ref) }),
            onDrop: (column, row, data) => {
                if (data.kind === "category-block") {
                    if (column.id !== "top") editorCategories.move(data.categoryId, Math.max(1, columns.findIndex((item) => item.id === column.id)));
                    return;
                }
                const ref = data.ref;
                if (row) {
                    const items = editorCategories.categories().find((item) => item.id === column.id)?.items ?? [];
                    let index = items.indexOf(row.ref);
                    if (data.kind === "category-item" && data.categoryId === column.id) {
                        const sourceIndex = items.indexOf(editorCategories.encodeRef(ref));
                        if (sourceIndex >= 0 && sourceIndex < index) index--;
                    }
                    editorCategories.assign(ref, column.id, index < 0 ? items.length : index);
                } else editorCategories.assign(ref, column.id);
            },
            renderHeading: (column, heading) => this.renderHeading(column.id, heading),
            renderRowAction: (row, element) => {
                const remove = document.createElement("span");
                remove.dataset.name = "editor-category-remove";
                remove.textContent = "×";
                remove.title = t("shell.editorCategoryRemoveItem");
                remove.addEventListener("click", (event) => {
                    event.stopPropagation();
                    const ref = editorCategories.decodeRef(row.ref);
                    editorCategories.unassign(ref);
                });
                element.append(remove);
            },
            activateOnDoubleClick: true,
            onActivate: (row) => {
                if (!row.categoryItem) return;
                const ref = editorCategories.decodeRef(row.ref);
                if (ref.kind === "board") {
                    void app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(ref.root)));
                } else items.find((item) => item.id === row.ref)?.create();
            },
        });
        this.list = this.child(list);
        this.root.append(list.root);
        list.mount();
    }

    /** Every trusted board is eligible, whatever file types it declares. */
    private readonly refreshBoards = (): void => {
        this.boardRoots = boardRegistry.roots("trusted");
        this.render();
    };

    private renderHeading(categoryId: string, heading: HTMLElement): void {
        if (categoryId === "top") return;
        heading.dataset.name = "editor-category-header";
        heading.draggable = true;
        const category = editorCategories.categories().find((item) => item.id === categoryId);
        const label = document.createElement("span");
        label.textContent = category?.name ?? "";
        heading.replaceChildren(label);
        heading.addEventListener("dblclick", () => this.beginRename(categoryId), { once: true });
        const rename = document.createElement("button");
        rename.type = "button";
        rename.dataset.name = "editor-category-rename";
        rename.title = t("shell.editorCategoryRename");
        rename.textContent = "✎";
        rename.addEventListener("click", () => this.beginRename(categoryId));
        heading.append(rename);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.name = "editor-category-delete";
        remove.title = t("shell.editorCategoryDelete");
        remove.textContent = "×";
        remove.addEventListener("click", () => {
            void this.deleteCategory(categoryId, category);
        });
        heading.append(remove);
    }

    private async deleteCategory(categoryId: string, category: ReturnType<typeof editorCategories.categories>[number] | undefined): Promise<void> {
            if (category?.items.length) {
                const result = await showConfirmationDialog({
                    message: t("shell.editorCategoryDeleteConfirm", { name: category.name }),
                    buttons: [dialogButton(DialogButton.yes), dialogButton(DialogButton.cancel)],
                });
                if (result !== DialogButton.yes) return;
            }
            editorCategories.remove(categoryId);
    }

    /** `isNew`: the category was just created unnamed, so cancelling the rename deletes it. */
    private beginRename(categoryId: string, isNew = false): void {
        const category = editorCategories.categories().find((item) => item.id === categoryId);
        if (!category || categoryId === "top") return;
        const heading = this.root.querySelector<HTMLElement>(`[data-category-id="${CSS.escape(categoryId)}"] [data-part="heading"]`);
        if (!heading) return;
        this.releaseRename();
        let value = category.name;
        const inputProps = (): ConstructorParameters<typeof InputView>[0] => ({
            name: "editor-category-name",
            size: "sm",
            value,
            placeholder: t("shell.editorCategoryNamePlaceholder"),
            onChange: (next: string) => { value = next; renameView.update(inputProps()); },
        });
        const renameView = this.child(new InputView(inputProps()));
        this.renameView = renameView;
        renameView.mount();
        heading.replaceChildren(renameView.root);
        const input = renameView.inputElement;
        input.focus();
        input.select();
        let finished = false;
        const cancel = () => {
            if (finished) return;
            finished = true;
            if (isNew) editorCategories.remove(categoryId);
            this.render();
        };
        const commit = (): boolean => {
            const name = input.value.trim();
            const duplicate = editorCategories.categories().some((item) => item.id !== categoryId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
            if (!name) { ui.notify(t("shell.editorCategoryNameRequired"), "warning"); return false; }
            if (duplicate) { ui.notify(t("shell.editorCategoryNameDuplicate"), "warning"); return false; }
            finished = true;
            editorCategories.rename(categoryId, name);
            this.render();
            return true;
        };
        input.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") cancel();
            if (event.key === "Enter") commit();
        });
        // Clicking away keeps a valid name and otherwise abandons the edit.
        input.addEventListener("blur", () => {
            if (finished) return;
            if (input.value.trim() && commit()) return;
            cancel();
        });
    }
}
