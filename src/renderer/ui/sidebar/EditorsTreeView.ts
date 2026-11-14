import { t } from "../../../shared/i18n/t";
import { app } from "../../api/app";
import { boardRegistry } from "../../api/boards/board-registry";
import { boardLifecycle } from "../../api/boards/board-lifecycle";
import { ui } from "../../api/ui";
import { listBoardUpdates, runBoardUpdate } from "../../api/boards/board-updates";
import { publishedBoards } from "../../api/boards/published-boards";
import { settings } from "../../api/settings";
import type { AppSettingsKey } from "../../api/settings-schema";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { buildRootsTree, type RootsTreeNode } from "../../components/roots-tree-build";
import { boardDisplayText, boardMetadataKeys, onBoardDisplayTextChanged } from "../../api/boards/board-display-text";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { createBoardShortcut } from "../../editors/board/board-shortcut";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { fpBasename, fpDirname } from "../../core/utils/file-path";
import { BoardRoot } from "../../../shared/board/board-root";
import { toClipboard } from "../../core/utils/utils";
import { TraitTypeId, getTraitDragData, hasTraitDragData } from "../../core/traits";
import { TreeView } from "../../uikit/Tree/TreeView";
import type { TreeProps } from "../../uikit/Tree/types";
import { createIconElement } from "../../uikit/shared/slots";
import type { MenuItem } from "../../uikit/Menu";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { editorCategories, type CategoryRef } from "../../api/editor-categories";
import { getCreatableItemLabel, getCreatableItems, getDisabledBundledBoardItems, type CreatableItem } from "../../api/creatable-items";
import { createCreatableItemIcon } from "./creatable-item-icon";
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
    | RootsTreeNode<"board">;

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
        this.pushProps();
        this.tree = this.child(new TreeView<EditorTreeNode>(this.lastProps));
        this.root.append(this.tree.root);
        this.tree.mount();
        this.own(boardRegistry.subscribeMembership(this.refresh));
        this.own(publishedBoards.subscribeCatalog(this.refresh));
        const settingsKeys = ["browser-profiles", "editor-categories"] as const satisfies readonly AppSettingsKey[];
        for (const key of settingsKeys) this.own(settings.watch(key, this.refresh));
        this.own(onBoardDisplayTextChanged(() => this.refresh()));
        void boardRegistry.load().then(this.refresh, this.refresh);
        this.refresh();
    }

    protected onUpdate(): void { this.refresh(); }

    private readonly refresh = (): void => {
        if (!this.tree) return;
        this.pushProps();
    };

    /** Rebuilds the rows; hover changes reuse the last props instead (see handleActiveChange). */
    private pushProps(): void {
        const props = this.treeProps();
        this.lastProps = {
            ...props,
            repaintSignal: this.trailingProjectionKey(props.items),
        };
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

    private readonly getChildren = (node: EditorTreeNode): EditorTreeNode[] | undefined =>
        "items" in node ? node.items as EditorTreeNode[] : undefined;

    private readonly handleTreeChange = (node: EditorTreeNode): void => this.open(node);

    private readonly getIconElement = (node: EditorTreeNode): Node | undefined => node.kind === "builtin"
        ? createCreatableItemIcon(node.item)
        : node.kind === "board" ? createBoardGlyphElement(node.root, 16) : node.kind === "folder" ? createFolderIconElement() : undefined;

    private readonly getContextMenu = (node: EditorTreeNode): MenuItem[] | undefined => this.contextMenu(node);

    private readonly renderTrailing = (node: EditorTreeNode): Node | undefined => {
        const ref = this.refFor(node);
        const category = ref && editorCategories.categoryOf(ref);
        const boardRoot = node.kind === "board" ? node.root : undefined;
        const update = boardRoot
            ? listBoardUpdates().find((candidate) => BoardRoot.from(candidate.root).equals(boardRoot))
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
    };

    private readonly getDragData = (node: EditorTreeNode): unknown | null => {
        const ref = this.refFor(node);
        return ref ? { kind: "source", ref } : null;
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
        editorCategories.unassign(payload.data.ref);
    };

    private treeProps(): TreeProps<EditorTreeNode> & { items: EditorTreeNode[] } {
        const builtins: BuiltinEditorNode[] = [
            ...getCreatableItems(settings.get("browser-profiles")).map((item) => ({
                kind: "builtin" as const, value: item.id, label: getCreatableItemLabel(item), item,
            })),
            ...getDisabledBundledBoardItems().map((item) => ({
                kind: "builtin" as const, value: `disabled:${item.id}`, label: getCreatableItemLabel(item), item, disabled: true,
            })),
        ];
        const nodes = buildRootsTree(
            boardRegistry.roots("trusted").map(root => ({
                root,
                label: boardDisplayText(root, undefined, boardMetadataKeys.name, fpBasename(root)),
            })),
            undefined,
            { leafKind: "board", leafIdPrefix: "board:" },
        );
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
            getChildren: this.getChildren,
            defaultExpandAll: true,
            keyboardNav: true,
            activeIndex: this.activeIndex,
            onActiveChange: this.handleActiveChange,
            onChange: this.handleTreeChange,
            getIconElement: this.getIconElement,
            getContextMenu: this.getContextMenu,
            renderTrailing: this.renderTrailing,
            traitTypeId: TraitTypeId.PinnedEditor,
            getDragData: this.getDragData,
            acceptsDrop: false,
        };
    }

    private trailingProjectionKey(items: EditorTreeNode[]): string {
        const updates = listBoardUpdates();
        const project = (nodes: EditorTreeNode[]): unknown[] => nodes.map((node) => {
            const ref = this.refFor(node);
            const category = ref && editorCategories.categoryOf(ref);
            const boardRoot = node.kind === "board" ? node.root : undefined;
            const update = boardRoot
                ? updates.find((candidate) => BoardRoot.from(candidate.root).equals(boardRoot))
                : undefined;
            return {
                category: category
                    ? [category.id, category.id === "top" ? t("shell.editorCategoryTop") : category.name]
                    : null,
                update: update
                    ? [update.latestVersion, t("shell.update"), t("shell.updateBoard", { version: update.latestVersion })]
                    : null,
                children: "items" in node ? project(node.items as EditorTreeNode[]) : undefined,
            };
        });
        return JSON.stringify(project(items));
    }

    private refFor(node: EditorTreeNode): CategoryRef | undefined {
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
            const categories = editorCategories.categories();
            const assigned = editorCategories.categoryOf(ref);
            items.unshift({
                label: t("shell.editorCategoryAddTo"),
                startGroup: true,
                items: [
                    ...categories.map((category) => ({
                        label: category.id === "top" ? t("shell.editorCategoryTop") : category.name,
                        selected: assigned?.id === category.id,
                        onClick: () => editorCategories.assign(ref, category.id),
                    })),
                    ...(this.props.onNewCategory ? [{
                        label: t("shell.editorCategoryNewAndAssign"),
                        startGroup: true,
                        onClick: () => {
                            const category = editorCategories.create("");
                            editorCategories.assign(ref, category.id);
                            this.props.onNewCategory?.(category.id);
                        },
                    }] : []),
                    ...(assigned ? [{ label: t("shell.editorCategoryRemoveItem"), onClick: () => editorCategories.unassign(ref), startGroup: true }] : []),
                ],
            });
        }
        return items.length ? items : undefined;
    }

    private boardContextItems(root: string): MenuItem[] {
        const update = listBoardUpdates().find((item) => BoardRoot.from(item.root).equals(root));
        const items: MenuItem[] = [];
        if (update) items.push({ label: t("shell.updateBoard", { version: update.latestVersion }), onClick: () => { void runBoardUpdate(update).then(this.refresh); } });
        items.push({ label: t("shell.copyBoardPath"), onClick: () => toClipboard(root) });
        items.push({ label: t("shell.openBoardFolder"), onClick: () => { void app.pages.openPath(root); } });
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
                void boardLifecycle.unregister(root).then((removed) => {
                    if (removed) void ui.notify(t("shell.removedFromTrustedBoards"), "info");
                });
            },
        });
        return items;
    }
}

function isEditorCategoryDragData(value: unknown): value is { kind: "source" | "category-item"; ref: CategoryRef } {
    if (!value || typeof value !== "object") return false;
    const data = value as { kind?: unknown; ref?: unknown };
    return (data.kind === "source" || data.kind === "category-item") && editorCategories.isRef(data.ref);
}

function matches(label: string, query: string): boolean {
    return label.toLocaleLowerCase().includes(query);
}

function getBundledBoardContextMenu(item: CreatableItem): MenuItem[] | undefined {
    if (!item.bundledBoardId) return undefined;
    if (item.enable) {
        return [{
            label: t("shell.enable"),
            icon: createIconElement("check", { width: 14, height: 14 }),
            onClick: item.enable,
        }];
    }
    if (!item.disable) return undefined;
    return [{
        label: t("shell.disable"),
        icon: createIconElement("remove", { width: 14, height: 14 }),
        onClick: item.disable,
    }];
}

/** Keeps matching board leaves and every folder on the path to one; a matching folder keeps all of its boards. */
function filterBoardNodes(nodes: RootsTreeNode<"board">[], query: string): RootsTreeNode<"board">[] {
    const result: RootsTreeNode<"board">[] = [];
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
