import { t } from "../../../shared/i18n/t";
import { app } from "../../api/app";
import { boardTrust } from "../../api/board-trust";
import { ui } from "../../api/ui";
import { listBoardUpdates, runBoardUpdate } from "../../api/board-updates";
import { publishedBoards } from "../../api/published-boards";
import { settings } from "../../api/settings";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { buildBoardsTree, type BoardTreeNode } from "../../editors/board/boards-tree-build";
import { boardDisplayText, boardMetadataKeys, onBoardDisplayTextChanged } from "../../editors/board/board-display-text";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { createBoardShortcut } from "../../editors/board/board-shortcut";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { fpDirname, fpNormalizeForCompare } from "../../core/utils/file-path";
import { toClipboard } from "../../core/utils/utils";
import { TraitTypeId, getTraitDragData, hasTraitDragData } from "../../core/traits";
import { TreeView } from "../../uikit/Tree/TreeView";
import type { MenuItem } from "../../uikit/Menu";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createEditorCategory, getCategoryForRef, getEditorCategories, isPinnedRef, moveEditorToCategory, removeCategoryMembership, type PinnedRef } from "./pinned-items";
import { getCreatableItemLabel, getCreatableItems, getDisabledBundledBoardItems, getBundledBoardContextMenu, type CreatableItem } from "./tools-editors-registry";
import "./EditorsTreeView.css";

interface BuiltinEditorNode {
    kind: "builtin";
    value: string;
    label: string;
    item: CreatableItem;
    disabled?: boolean;
}

type EditorTreeNode =
    | { kind: "builtin-root"; value: "builtin-root"; label: string; items: BuiltinEditorNode[] }
    | BuiltinEditorNode
    | BoardTreeNode;

export interface EditorsTreeViewProps { onClose?: () => void; onNewCategory?: (categoryId: string) => void }

export class EditorsTreeView extends VanillaView<EditorsTreeViewProps> {
    private tree: TreeView<EditorTreeNode> | undefined;
    private activeIndex: number | null = null;
    private filterText = "";
    private lastProps: ReturnType<EditorsTreeView["treeProps"]> | undefined;

    public constructor(props: EditorsTreeViewProps = {}) {
        super(props);
        this.root.dataset.type = "editors-tree-view";
        this.root.dataset.name = "editors-tree";
    }

    protected onMount(): void {
        this.listen(this.root, "dragenter", this.handleUncategorizeDrag);
        this.listen(this.root, "dragover", this.handleUncategorizeDrag);
        this.listen(this.root, "drop", this.handleUncategorizeDrop);
        this.lastProps = this.treeProps();
        this.tree = this.child(new TreeView<EditorTreeNode>(this.lastProps));
        this.root.append(this.tree.root);
        this.tree.mount();
        this.own(boardTrust.subscribePaths(this.refresh));
        this.own(publishedBoards.subscribeCatalog(this.refresh));
        this.own(settings.onChanged.subscribe(({ key }) => {
            if (key === "browser-profiles" || key === "disabled-bundled-boards" || key === "editor-categories") this.refresh();
        }));
        this.own(onBoardDisplayTextChanged(() => this.refresh()));
        void boardTrust.load().then(this.refresh, this.refresh);
        this.refresh();
    }

    protected onUpdate(): void { this.refresh(); }

    private readonly refresh = (): void => {
        if (!this.tree) return;
        this.pushProps();
    };

    /** Rebuilds the rows; hover changes reuse the last props instead (see handleActiveChange). */
    private pushProps(): void {
        this.lastProps = this.treeProps();
        this.tree?.update(this.lastProps);
    }

    /** Shows only editors and boards whose name contains `text`, with the folders that hold them. */
    public setFilter(text: string): void {
        if (text === this.filterText) return;
        this.filterText = text;
        this.activeIndex = null;
        this.pushProps();
    }

    /** Hover highlight, as in the Explorer tree: the Tree reports the row under the mouse. */
    private readonly handleActiveChange = (index: number | null): void => {
        this.activeIndex = index;
        if (this.lastProps) this.tree?.update({ ...this.lastProps, activeIndex: index });
    };

    private readonly handleUncategorizeDrag = (event: Event): void => {
        const dragEvent = event as DragEvent;
        const dataTransfer = dragEvent.dataTransfer;
        if (!hasTraitDragData(dataTransfer)) return;
        const payload = getTraitDragData(dataTransfer);
        if (payload?.typeId !== TraitTypeId.PinnedEditor || !isEditorCategoryDragData(payload.data)) return;
        dragEvent.preventDefault();
        dataTransfer.dropEffect = "move";
    };

    private readonly handleUncategorizeDrop = (event: Event): void => {
        const dragEvent = event as DragEvent;
        const payload = dragEvent.dataTransfer && getTraitDragData(dragEvent.dataTransfer);
        if (payload?.typeId !== TraitTypeId.PinnedEditor || !isEditorCategoryDragData(payload.data)) return;
        dragEvent.preventDefault();
        dragEvent.stopPropagation();
        removeCategoryMembership(payload.data.ref);
    };

    private treeProps() {
        const builtins: BuiltinEditorNode[] = [
            ...getCreatableItems(settings.get("browser-profiles")).map((item) => ({
                kind: "builtin" as const, value: item.id, label: getCreatableItemLabel(item), item,
            })),
            ...getDisabledBundledBoardItems().map((item) => ({
                kind: "builtin" as const, value: `disabled:${item.id}`, label: getCreatableItemLabel(item), item, disabled: true,
            })),
        ];
        const nodes = buildBoardsTree(boardTrust.listPaths(), undefined, (root, fallback) =>
            boardDisplayText(root, undefined, boardMetadataKeys.name, fallback));
        const query = this.filterText.trim().toLocaleLowerCase();
        const matchingBuiltins = query ? builtins.filter((node) => matches(node.label, query)) : builtins;
        const matchingBoards = query ? filterBoardNodes(nodes, query) : nodes;
        const items: EditorTreeNode[] = [
            ...(matchingBuiltins.length || !query
                ? [{ kind: "builtin-root" as const, value: "builtin-root" as const, label: t("shell.editorCategoryBuiltinRoot"), items: matchingBuiltins }]
                : []),
            ...matchingBoards,
        ];
        return {
            name: "editors-tree",
            items,
            searchText: query || undefined,
            getChildren: (node: EditorTreeNode) => "items" in node ? node.items as EditorTreeNode[] : undefined,
            defaultExpandAll: true,
            keyboardNav: true,
            activeIndex: this.activeIndex,
            onActiveChange: this.handleActiveChange,
            onChange: (node: EditorTreeNode) => this.open(node),
            getIconElement: (node: EditorTreeNode) => node.kind === "builtin"
                ? node.item.icon instanceof Node ? node.item.icon.cloneNode(true) : undefined
                : node.kind === "board" ? createBoardGlyphElement(node.root, 16) : node.kind === "folder" ? createFolderIconElement() : undefined,
            getContextMenu: (node: EditorTreeNode) => this.contextMenu(node),
            renderTrailing: (node: EditorTreeNode) => {
                const ref = this.refFor(node);
                const category = ref && getCategoryForRef(ref);
                const boardRoot = node.kind === "board" ? node.root : undefined;
                const update = boardRoot
                    ? listBoardUpdates().find((candidate) => fpNormalizeForCompare(candidate.root) === fpNormalizeForCompare(boardRoot))
                    : undefined;
                if (!category && !update) return undefined;
                const text = document.createElement("span");
                text.dataset.part = "row-trailing";
                if (category) {
                    const chip = document.createElement("span");
                    chip.dataset.part = "category-label";
                    chip.textContent = category.id === "top" ? t("shell.editorCategoryTop") : category.name;
                    text.append(chip);
                }
                if (update) {
                    const updateButton = document.createElement("button");
                    updateButton.type = "button";
                    updateButton.dataset.name = "editor-tree-board-update";
                    updateButton.textContent = t("shell.update");
                    updateButton.title = t("shell.updateBoard", { version: update.latestVersion });
                    updateButton.addEventListener("click", (event) => {
                        event.stopPropagation();
                        void runBoardUpdate(update).then(this.refresh);
                    });
                    text.append(updateButton);
                }
                return text;
            },
            traitTypeId: TraitTypeId.PinnedEditor,
            getDragData: (node: EditorTreeNode) => {
                const ref = this.refFor(node);
                return ref ? { kind: "source", ref } : null;
            },
            acceptsDrop: false,
        };
    }

    private refFor(node: EditorTreeNode): PinnedRef | undefined {
        if (node.kind === "builtin" && !node.disabled) return { kind: "editor", id: node.item.id };
        // Every trusted board can join a category, file-associated ones included: they all open
        // without a file from this page, so they can from the + popover too.
        if (node.kind === "board" && node.root) return { kind: "board", root: node.root };
        return undefined;
    }

    private open(node: EditorTreeNode): void {
        if (node.kind === "builtin") {
            if (node.disabled) return;
            node.item.create();
        } else if (node.kind === "board" && node.root) {
            void app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(node.root), { explorerRoot: fpDirname(node.root) }));
        }
        this.props.onClose?.();
    }

    private contextMenu(node: EditorTreeNode): MenuItem[] | undefined {
        const ref = this.refFor(node);
        const items: MenuItem[] = node.kind === "builtin"
            ? [...(getBundledBoardContextMenu(node.item) ?? [])]
            : node.kind === "board" && node.root ? this.boardContextItems(node.root) : [];
        if (ref) {
            const categories = getEditorCategories();
            const assigned = getCategoryForRef(ref);
            items.unshift({
                label: t("shell.editorCategoryAddTo"),
                startGroup: true,
                items: [
                    ...categories.map((category) => ({
                        label: category.id === "top" ? t("shell.editorCategoryTop") : category.name,
                        selected: assigned?.id === category.id,
                        onClick: () => moveEditorToCategory(ref, category.id),
                    })),
                    ...(this.props.onNewCategory ? [{
                        label: t("shell.editorCategoryNewAndAssign"),
                        startGroup: true,
                        onClick: () => {
                            const category = createEditorCategory("");
                            moveEditorToCategory(ref, category.id);
                            this.props.onNewCategory?.(category.id);
                        },
                    }] : []),
                    ...(assigned ? [{ label: t("shell.editorCategoryRemoveItem"), onClick: () => removeCategoryMembership(ref), startGroup: true }] : []),
                ],
            });
        }
        return items.length ? items : undefined;
    }

    private boardContextItems(root: string): MenuItem[] {
        const update = listBoardUpdates().find((item) => fpNormalizeForCompare(item.root) === fpNormalizeForCompare(root));
        const items: MenuItem[] = [];
        if (update) items.push({ label: t("shell.updateBoard", { version: update.latestVersion }), onClick: () => { void runBoardUpdate(update).then(this.refresh); } });
        items.push({ label: t("shell.copyBoardPath"), onClick: () => toClipboard(root) });
        items.push({ label: t("shell.openBoardFolder"), onClick: () => { void app.pages.openFile(root); } });
        items.push({
            id: "create-board-shortcut",
            label: t("shell.createBoardShortcut"),
            onClick: () => { void createBoardShortcut(root); },
            startGroup: true,
        });
        items.push({
            label: t("common.remove"),
            startGroup: true,
            onClick: () => {
                void boardTrust.untrust(root);
                removeCategoryMembership({ kind: "board", root });
                ui.notify(t("shell.removedFromTrustedBoards"), "info");
            },
        });
        return items;
    }
}

function isEditorCategoryDragData(value: unknown): value is { kind: "source" | "category-item"; ref: PinnedRef } {
    if (!value || typeof value !== "object") return false;
    const data = value as { kind?: unknown; ref?: unknown };
    return (data.kind === "source" || data.kind === "category-item") && isPinnedRef(data.ref);
}

function matches(label: string, query: string): boolean {
    return label.toLocaleLowerCase().includes(query);
}

/** Keeps matching board leaves and every folder on the path to one; a matching folder keeps all of its boards. */
function filterBoardNodes(nodes: BoardTreeNode[], query: string): BoardTreeNode[] {
    const result: BoardTreeNode[] = [];
    for (const node of nodes) {
        if (node.kind === "board") {
            if (matches(node.label, query)) result.push(node);
        } else if (matches(node.label, query)) {
            result.push(node);
        } else {
            const items = filterBoardNodes(node.items ?? [], query);
            if (items.length) result.push({ ...node, items });
        }
    }
    return result;
}
