import type { MenuItem } from "../../uikit/Menu";
import type { SlotContent } from "../../uikit/shared/fill-slot";
import type { SlotText } from "../../uikit/shared/slots";
import { TreeView } from "../../uikit/Tree/TreeView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { subscribeBoardIconChanges } from "./board-icon-cache";
import { createBoardGlyphElement } from "./board-glyph-element";
import { buildBoardsTree, type BoardTreeNode } from "./boards-tree-build";

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
}

export class BoardsTreeView extends VanillaView<BoardsTreeViewProps> {
    private readonly iconElements = new Map<string, Node>();
    private readonly handleChange = (node: BoardTreeNode): void => {
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
    private readonly getContextMenu = (node: BoardTreeNode): MenuItem[] | undefined =>
        node.kind === "board" && node.root
            ? this.props.getBoardContextMenu?.(node.root)
            : undefined;
    private readonly getIconElement = (node: BoardTreeNode): Node => {
        const cached = this.iconElements.get(node.value);
        if (cached) return cached;

        const icon = node.kind === "board"
            ? createBoardGlyphElement(node.root, 16)
            : createFolderIconElement();
        this.iconElements.set(node.value, icon);
        return icon;
    };
    private readonly renderTrailing = (node: BoardTreeNode): SlotContent | undefined =>
        node.kind === "board" && node.root
            ? this.props.renderTrailing?.(node.root)
            : undefined;
    private readonly trailingElement = (node: BoardTreeNode): Node | undefined =>
        node.kind === "board" && node.root
            ? this.props.trailingElement?.(node.root)
            : undefined;
    private readonly getTrailingVisibility = (node: BoardTreeNode): "always" | "hover" =>
        node.kind === "board" && node.root && this.props.trailingVisible
            && !this.props.trailingVisible(node.root)
            ? "hover"
            : "always";

    private tree: TreeView<BoardTreeNode> | undefined;
    private selectedNode: BoardTreeNode | null = null;
    private activeIndex: number | null = null;
    private nodes: BoardTreeNode[] = [];
    private nodesBoards: string[] | undefined;
    private nodesBaseRoot: string | undefined;

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

        const tree = this.child(new TreeView<BoardTreeNode>(this.treeProps()));
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
            getContextMenu: this.getContextMenu,
            getIconElement: this.getIconElement,
            renderTrailing: this.renderTrailing,
            trailingElement: this.trailingElement,
            getTrailingVisibility: this.getTrailingVisibility,
            emptyMessage: this.props.emptyMessage,
        };
    }

    private projectNodes(): BoardTreeNode[] {
        if (this.nodesBoards === this.props.boards && this.nodesBaseRoot === this.props.baseRoot) {
            return this.nodes;
        }
        this.nodesBoards = this.props.boards;
        this.nodesBaseRoot = this.props.baseRoot;
        this.nodes = buildBoardsTree(this.props.boards, this.props.baseRoot);
        return this.nodes;
    }
}
