import type { MenuItem } from "../../uikit/Menu";
import type { SlotContent } from "../../uikit/shared/fill-slot";
import type { SlotText } from "../../uikit/shared/slots";
import { TraitTypeId } from "../../core/traits";
import { TreeView } from "../../uikit/Tree/TreeView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { subscribeBoardIconChanges } from "./board-icon-cache";
import { createBoardGlyphElement } from "./board-glyph-element";
import { buildRootsTree, type RootsTreeNode } from "../../components/roots-tree-build";
import { fpBasename } from "../../core/utils/file-path";
import { boardDisplayText, boardMetadataKeys, ensureBoardDisplayText, onBoardDisplayTextChanged } from "../../api/boards/board-display-text";
import { readBoardManifest } from "../../api/boards/board-manifest-io";
import { type NormalizedBoardManifest } from "../../../shared/board/board-manifest-schema";

export interface BoardsTreeViewProps {
    name?: string;
    boards: string[];
    baseRoot?: string;
    onOpenBoard: (root: string) => void;
    trailingVisible?: (root: string) => boolean;
    getBoardContextMenu?: (root: string) => MenuItem[] | undefined;
    emptyMessage?: SlotText | Node;
    renderTrailing?: (root: string) => SlotContent;
    trailingElement?: (root: string) => Node | undefined;
    getBoardDragData?: (root: string) => unknown | null;
    onBoardDragStart?: (root: string, event: DragEvent) => void;
}

export class BoardsTreeView extends VanillaView<BoardsTreeViewProps> {
    private readonly iconElements = new Map<string, Node>();
    private readonly handleChange = (node: RootsTreeNode<"board">): void => {
        // Paint the clicked row as selected, the way the Explorer file tree does. Only the
        // node's `value` is read back, so keeping the node itself is safe even after the
        // boards list is rebuilt and the stored object is no longer one of `this.nodes`.
        this.selectedNode = node;
        this.tree?.update(this.treeProps());
        if (node.kind === "board" && node.root) this.props.onOpenBoard(node.root);
    };
    private readonly handleActiveChange = (index: number | null): void => {
        this.activeIndex = index;
        this.tree?.update(this.treeProps());
    };
    private readonly getContextMenu = (node: RootsTreeNode<"board">): MenuItem[] | undefined =>
        node.kind === "board" && node.root
            ? this.props.getBoardContextMenu?.(node.root)
            : undefined;
    private readonly getIconElement = (node: RootsTreeNode<"board">): Node => {
        const cached = this.iconElements.get(node.value);
        if (cached) return cached;

        const icon = node.kind === "board"
            ? createBoardGlyphElement(node.root, 16)
            : createFolderIconElement();
        this.iconElements.set(node.value, icon);
        return icon;
    };
    private readonly renderTrailing = (node: RootsTreeNode<"board">): SlotContent | undefined =>
        node.kind === "board" && node.root
            ? this.props.renderTrailing?.(node.root)
            : undefined;
    private readonly trailingElement = (node: RootsTreeNode<"board">): Node | undefined =>
        node.kind === "board" && node.root
            ? this.props.trailingElement?.(node.root)
            : undefined;
    /** Bound once, like every other callback here: `treeProps()` is on the update path, and a
     *  fresh identity per pump is the props-pump trap the uikit rules call out. */
    private readonly getDragData = (node: RootsTreeNode<"board">): unknown | null =>
        node.kind === "board" && node.root
            ? this.props.getBoardDragData?.(node.root) ?? null
            : null;
    /** Fires for folder rows too, hence the `board` guard — only a board leaf announces a pin drag. */
    private readonly onDragStartOverride = (node: RootsTreeNode<"board">, _level: number, event: DragEvent): boolean => {
        if (node.kind === "board" && node.root) this.props.onBoardDragStart?.(node.root, event);
        return false;
    };
    private readonly getTrailingVisibility = (node: RootsTreeNode<"board">): "always" | "hover" =>
        node.kind === "board" && node.root && this.props.trailingVisible
            && !this.props.trailingVisible(node.root)
            ? "hover"
            : "always";

    private tree: TreeView<RootsTreeNode<"board">> | undefined;
    private selectedNode: RootsTreeNode<"board"> | null = null;
    private activeIndex: number | null = null;
    private readonly warmedRoots = new Set<string>();
    private readonly manifests = new Map<string, NormalizedBoardManifest>();

    public constructor(props: BoardsTreeViewProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "boards-tree";
        this.root.style.display = "contents";
        this.own(() => this.iconElements.clear());
    }

    protected onMount(): void {
        this.own(subscribeBoardIconChanges(() => {
            for (const value of this.iconElements.keys()) {
                if (value.startsWith("board:")) this.iconElements.delete(value);
            }
            this.tree?.refreshRows();
        }));
        this.own(onBoardDisplayTextChanged((_root, reason) => {
            if (reason === "invalidate") this.warmedRoots.clear();
            this.tree?.update(this.treeProps());
        }));

        const tree = this.child(new TreeView<RootsTreeNode<"board">>(this.treeProps()));
        this.tree = tree;
        this.root.append(tree.root);
        tree.mount();
    }

    protected onUpdate(): void {
        this.tree?.update(this.treeProps());
        this.tree?.refreshRows();
    }

    private treeProps() {
        return {
            name: this.props.name,
            items: this.projectNodes(),
            defaultExpandAll: true,
            // No rowHeight override: the Tree default (22) is what the Explorer file tree
            // uses, and the two panels sit side by side.
            value: this.selectedNode,
            // Explorer selection look — grey while the tree is blurred, blue + outline when
            // focused — without taking over the arrow keys.
            focusSelection: true,
            activeIndex: this.activeIndex,
            onActiveChange: this.handleActiveChange,
            onChange: this.handleChange,
            // Gated on the opt-in prop: `BoardsTreeView` also renders the explorer's Boards panel
            // and the board toolbar, and neither should become a pin drag source.
            traitTypeId: this.props.getBoardDragData ? TraitTypeId.PinnedEditor : undefined,
            getDragData: this.props.getBoardDragData ? this.getDragData : undefined,
            onDragStartOverride: this.props.getBoardDragData ? this.onDragStartOverride : undefined,
            getContextMenu: this.getContextMenu,
            getIconElement: this.getIconElement,
            renderTrailing: this.renderTrailing,
            trailingElement: this.trailingElement,
            getTrailingVisibility: this.getTrailingVisibility,
            emptyMessage: this.props.emptyMessage,
        };
    }

    private projectNodes(): RootsTreeNode<"board">[] {
        for (const root of this.props.boards) this.warmBoard(root);
        return buildRootsTree(
            this.props.boards.map(root => ({
                root,
                label: boardDisplayText(
                    root,
                    this.manifests.get(root),
                    boardMetadataKeys.name,
                    fpBasename(root),
                ),
            })),
            this.props.baseRoot,
            { leafKind: "board", leafIdPrefix: "board:" },
        );
    }

    private warmBoard(root: string): void {
        if (this.warmedRoots.has(root)) return;
        this.warmedRoots.add(root);
        void readBoardManifest(root).then((manifest) => {
            if (!manifest) return;
            this.manifests.set(root, manifest);
            return ensureBoardDisplayText(root, manifest);
        }).catch(() => {});
    }
}
