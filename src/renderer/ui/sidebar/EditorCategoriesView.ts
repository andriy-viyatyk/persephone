import { t } from "../../../shared/i18n/t";
import { showConfirmationDialog } from "../dialogs/ConfirmationDialog";
import { DialogButton, dialogButton } from "../dialogs/dialog-buttons";
import { settings } from "../../api/settings";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { ui } from "../../api/ui";
import { boardTrust } from "../../api/board-trust";
import { boardDisplayText, boardMetadataKeys } from "../../editors/board/board-display-text";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { fpBasename } from "../../core/utils/file-path";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { InputView } from "../../uikit/Input/InputView";
import { EditorCategoryColumnListView, type EditorCategoryColumn } from "./EditorCategoryColumnListView";
import { createEditorCategory, deleteEditorCategory, encodePin, getEditorCategories, moveCategory, moveCategoryItem, moveEditorToCategory, removeCategoryMembership, renameEditorCategory } from "./pinned-items";
import { getCreatableItems, getCreatableItemLabel } from "./tools-editors-registry";
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
            const category = createEditorCategory("");
            this.render();
            this.beginRename(category.id, true);
        });
        this.toolbar.append(button);
        this.root.append(this.toolbar);
        this.own(settings.onChanged.subscribe(({ key }) => { if (key === "editor-categories" || key === "browser-profiles") this.render(); }));
        this.own(boardTrust.subscribePaths(() => this.refreshBoards()));
        void boardTrust.load().then(this.refreshBoards, this.refreshBoards);
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
        const categories = getEditorCategories();
        const items = getCreatableItems(settings.get("browser-profiles"));
        const itemRows = items.map((item) => ({
            ref: item.id, label: getCreatableItemLabel(item), categoryId: "", categoryItem: true,
            icon: item.icon instanceof Node ? item.icon : undefined,
        }));
        const boardRows = this.boardRoots.map((root) => ({
            ref: `board:${root}`, label: boardDisplayText(root, undefined, boardMetadataKeys.name, fpBasename(root)),
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
            rowData: (row) => ({ kind: "category-item", categoryId: row.categoryId, ref: row.ref.startsWith("board:") ? { kind: "board", root: row.ref.slice(6) } : { kind: "editor", id: row.ref } }),
            onDrop: (column, row, data) => {
                if (data.kind === "category-block") {
                    if (column.id !== "top") moveCategory(data.categoryId, Math.max(1, columns.findIndex((item) => item.id === column.id)));
                    return;
                }
                const ref = data.ref;
                if (row) {
                    const items = getEditorCategories().find((item) => item.id === column.id)?.items ?? [];
                    let index = items.indexOf(row.ref);
                    if (data.kind === "category-item" && data.categoryId === column.id) {
                        const sourceIndex = items.indexOf(encodePin(ref));
                        if (sourceIndex >= 0 && sourceIndex < index) index--;
                    }
                    moveCategoryItem(ref, column.id, index < 0 ? items.length : index);
                } else moveEditorToCategory(ref, column.id);
            },
            renderHeading: (column, heading) => this.renderHeading(column.id, heading),
            renderRowAction: (row, element) => {
                const remove = document.createElement("span");
                remove.dataset.name = "editor-category-remove";
                remove.textContent = "×";
                remove.title = t("shell.editorCategoryRemoveItem");
                remove.addEventListener("click", (event) => {
                    event.stopPropagation();
                    const ref = row.ref.startsWith("board:")
                        ? { kind: "board" as const, root: row.ref.slice(6) }
                        : { kind: "editor" as const, id: row.ref };
                    removeCategoryMembership(ref);
                });
                element.append(remove);
            },
            activateOnDoubleClick: true,
            onActivate: (row) => {
                if (!row.categoryItem) return;
                if (row.ref.startsWith("board:")) {
                    void app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(row.ref.slice(6))));
                } else items.find((item) => item.id === row.ref)?.create();
            },
        });
        this.list = this.child(list);
        this.root.append(list.root);
        list.mount();
    }

    /** Every trusted board is eligible, whatever file types it declares. */
    private readonly refreshBoards = (): void => {
        this.boardRoots = boardTrust.listPaths();
        this.render();
    };

    private renderHeading(categoryId: string, heading: HTMLElement): void {
        if (categoryId === "top") return;
        heading.dataset.name = "editor-category-header";
        heading.draggable = true;
        const category = getEditorCategories().find((item) => item.id === categoryId);
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

    private async deleteCategory(categoryId: string, category: ReturnType<typeof getEditorCategories>[number] | undefined): Promise<void> {
            if (category?.items.length) {
                const result = await showConfirmationDialog({
                    message: t("shell.editorCategoryDeleteConfirm", { name: category.name }),
                    buttons: [dialogButton(DialogButton.yes), dialogButton(DialogButton.cancel)],
                });
                if (result !== DialogButton.yes) return;
            }
            deleteEditorCategory(categoryId);
    }

    /** `isNew`: the category was just created unnamed, so cancelling the rename deletes it. */
    private beginRename(categoryId: string, isNew = false): void {
        const category = getEditorCategories().find((item) => item.id === categoryId);
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
            if (isNew) deleteEditorCategory(categoryId);
            this.render();
        };
        const commit = (): boolean => {
            const name = input.value.trim();
            const duplicate = getEditorCategories().some((item) => item.id !== categoryId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
            if (!name) { ui.notify(t("shell.editorCategoryNameRequired"), "warning"); return false; }
            if (duplicate) { ui.notify(t("shell.editorCategoryNameDuplicate"), "warning"); return false; }
            finished = true;
            renameEditorCategory(categoryId, name);
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
