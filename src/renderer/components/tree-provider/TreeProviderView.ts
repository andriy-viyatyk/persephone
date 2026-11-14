import { hrefKey, sameHref } from "./href-utils";
import { createComponentModelDriver, type ComponentModelDriver } from "../../core/state/model";
import { TraitSet, traited, type Traited } from "../../core/traits/traits";
import { isTraitTypeId, TraitTypeId, type TraitDragPayload } from "../../core/traits";
import { isLocalFileProvider } from "../../content/tree-providers/tree-provider-capabilities";
import { getTraitDropAction } from "./drop-dispatch";
import {
    TreeProviderViewModel,
    type TreeProviderViewProps,
    type TreeProviderViewState,
    defaultTreeProviderViewState,
} from "./TreeProviderViewModel";
import type { TreeProviderNode } from "./tree-provider-node";
import { createTreeProviderItemIconElement, subscribeFileIconElements } from "../icons/icon-elements";
import { t } from "../../../shared/i18n/t";
import { TREE_ITEM_KEY } from "../../uikit/Tree/types";
import type { TreeProps } from "../../uikit/Tree/types";
import type { SlotContent } from "../../uikit/shared/fill-slot";
import type { SlotText } from "../../uikit/shared/slots";
import { SubtreeSwap } from "../../uikit/shared/subtree-swap";
import { TreeView } from "../../uikit/Tree/TreeView";
import { InputView } from "../../uikit/Input/InputView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "./TreeProviderView.css";

type ViewProps = TreeProviderViewProps;

type ProviderState = TreeProviderViewState;
type Arm = "tree" | "error" | "empty";

// The trait only supplies the fields TreeModel needs to flatten the provider tree. The icon
// accessor deliberately does not exist: direct DOM icons are projected by TreeView below.
const tpvNodeTraits = new TraitSet().add(TREE_ITEM_KEY, {
    value: (node: unknown) => (node as TreeProviderNode).data.href,
    label: (node: unknown) => (node as TreeProviderNode).data.title,
});

const getNodeChildren = (node: TreeProviderNode): TreeProviderNode[] | undefined => node.items;

export class TreeProviderView extends VanillaView<ViewProps> {
    private readonly driver: ComponentModelDriver<
        ProviderState,
        TreeProviderViewProps,
        TreeProviderViewModel
    >;
    private readonly iconCache = new Map<string, Element>();
    private readonly secondaryLabelCache = new Map<string, Node>();
    private selectedSet = new Set<string>();
    private readonly treeSwap: SubtreeSwap<number>;

    private treeView: TreeView<TreeProviderNode> | undefined;
    private searchPanel: HTMLDivElement | undefined;
    private searchInput: InputView | undefined;
    private searchClose: IconButtonView | undefined;
    private searchField: HTMLInputElement | undefined;
    private messagePanel: HTMLDivElement | undefined;
    private messageText: HTMLSpanElement | undefined;
    private arm: Arm | undefined;
    private previousDeepSearch: boolean | undefined;
    private lastDisplayTree: TreeProviderNode | null | undefined;
    private lastTNodes: Traited<TreeProviderNode[]> | null = null;
    private activeIndex: number | null = null;
    private iconSubscription: (() => void) | undefined;
    private inert = false;
    private renderTrailingOwner: ViewProps["renderTrailing"] | undefined;
    private cachedRenderTrailing: TreeProps<TreeProviderNode>["renderTrailing"] | undefined;

    public constructor(props: ViewProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "tree-provider-view";
        const treeHost = document.createElement("div");
        treeHost.dataset.part = "tree-host";
        treeHost.style.display = "contents";
        this.root.append(treeHost);
        this.treeSwap = new SubtreeSwap<number>(treeHost);
        this.driver = createComponentModelDriver(
            props,
            TreeProviderViewModel,
            defaultTreeProviderViewState,
        );

        // The driver is constructed here, so its cleanup is registered here as well. Children are
        // VanillaView disposes owned children before these FIFO disposers. Keep that ordering:
        // Tree and search views must release their DOM and listeners before the driver disposes
        // TreeProviderViewModel and clears its one-way reveal request.
        this.own(() => { this.inert = true; });
        this.own(() => this.treeSwap.dispose());
        this.own(() => this.driver.dispose());
        // Children release their reveal request before the model driver is disposed.
        this.own(() => this.model.setRevealRequest(undefined));
    }

    public get model(): TreeProviderViewModel {
        return this.driver.model;
    }

    protected onMount(): void {
        this.listen(this.root, "keydown", (event) => {
            if (this.arm !== "tree") return;
            this.onRootKeyDown(event);
        });
        this.listen(this.root, "contextmenu", (event) => {
            if (this.arm !== "tree") return;
            this.model.onBackgroundContextMenu(event);
        });

        this.driver.mount();
        this.iconSubscription = subscribeFileIconElements(() => {
            if (this.inert) return;
            this.iconCache.clear();
            this.treeView?.refreshRows();
        });
        this.own(() => this.iconSubscription?.());

        this.bind(
            this.model.state,
            (state) => ({
                displayTree: state.displayTree,
                error: state.error,
                searchText: state.searchText,
                searchVisible: state.searchVisible,
                expandedValues: state.expandedValues,
                selectedValues: state.selectedValues,
            }),
            this.applyState,
        );
    }

    protected onUpdate(props: ViewProps): void {
        this.driver.update(props);
        this.applyState(this.model.state.get());
    }

    private readonly applyState = (state: ProviderState): void => {
        this.syncSelection(state.selectedValues);

        const tNodes = this.tNodesFor(state.displayTree);
        if (state.error) {
            this.leaveTreeArm();
            this.removeSearch();
            this.showMessage("error", state.error);
            return;
        }
        if (!tNodes) {
            this.leaveTreeArm();
            this.removeSearch();
            this.showMessage("empty", t("mneme.noContent"));
            return;
        }

        this.removeMessage();
        const deepSearch = state.searchText.length >= 3;
        const crossedSearchBoundary = this.previousDeepSearch !== undefined
            && this.previousDeepSearch !== deepSearch;
        if (!this.treeView) {
            this.enterTreeArm(tNodes, state);
        } else {
            this.treeView.update(this.treeProps(tNodes, state));
        }
        if (crossedSearchBoundary && this.treeView) {
            this.treeView.model.keyboard.setAnchor(null);
            this.treeView.resetScrollTopAndSyncActive();
        }
        this.previousDeepSearch = deepSearch;
        this.arm = "tree";
        this.updateSearch(state);
    };

    private tNodesFor(displayTree: TreeProviderNode | null): Traited<TreeProviderNode[]> | null {
        if (displayTree === this.lastDisplayTree) return this.lastTNodes;
        this.lastDisplayTree = displayTree;
        this.lastTNodes = displayTree
            ? traited<TreeProviderNode[]>([displayTree], tpvNodeTraits)
            : null;
        return this.lastTNodes;
    }

    private enterTreeArm(tNodes: Traited<TreeProviderNode[]>, state: ProviderState): void {
        let created: TreeView<TreeProviderNode> | undefined;
        this.treeSwap.set(0, () => {
            created = new TreeView<TreeProviderNode>(this.treeProps(tNodes, state));
            return created;
        });
        if (!created) return;
        this.treeView = created;
        created.mount();
        this.model.setRevealRequest((href) => created?.model.revealItem(href) ?? Promise.resolve());
    }

    private leaveTreeArm(): void {
        if (!this.treeView) return;
        try {
            this.treeSwap.clear();
        } finally {
            this.treeView = undefined;
            this.model.setRevealRequest(undefined);
        }
    }

    private showMessage(kind: "error" | "empty", value: string): void {
        if (!this.messagePanel) {
            this.messagePanel = createPanelElement({
                name: kind === "error" ? "tree-provider-error" : "tree-provider-empty",
                direction: "row",
            });
            this.root.append(this.messagePanel);
        }
        const messageClass = kind === "error" ? "tree-provider-error" : "tree-provider-empty";
        this.messagePanel.classList.remove("tree-provider-error", "tree-provider-empty");
        this.messagePanel.classList.add(messageClass);
        this.messagePanel.dataset.name = messageClass;
        if (!this.messageText) {
            this.messageText = createTextElement(value, {
                variant: "default",
                size: "sm",
                color: kind === "error" ? "error" : "light",
            });
            this.messagePanel.append(this.messageText);
        }
        this.messageText.dataset.color = kind === "error" ? "error" : "light";
        this.messageText.textContent = value;
        this.arm = kind;
    }

    private removeMessage(): void {
        this.messagePanel?.remove();
        this.messagePanel = undefined;
        this.messageText = undefined;
    }

    private ensureSearch(): void {
        if (this.searchInput) return;

        this.searchPanel = createPanelElement({
            name: "tree-provider-search",
            direction: "row",
            borderTop: true,
        });
        this.searchPanel.classList.add("tree-provider-search");

        this.searchClose = this.child(new IconButtonView({
            name: "tree-provider-search-close",
            size: "sm",
            title: t("menus.closeSearch"),
            icon: "close",
            onClick: this.onSearchClose,
        }));
        this.searchClose.mount();

        this.searchInput = this.child(new InputView({
            name: "tree-provider-search-input",
            size: "sm",
            value: "",
            placeholder: t("menus.searchPlaceholder"),
            onChange: this.model.setSearchText,
            onKeyDown: this.onSearchKeyDown,
            onBlur: this.onSearchBlur,
        }));
        this.searchInput.mount();
        this.searchField = this.searchInput.inputElement;
        this.searchPanel.append(this.searchInput.root);
        this.root.append(this.searchPanel);
    }

    private removeSearch(): void {
        this.searchPanel?.remove();
        this.searchInput?.dispose();
        this.searchClose?.dispose();
        this.searchPanel = undefined;
        this.searchInput = undefined;
        this.searchClose = undefined;
        this.searchField = undefined;
    }

    private updateSearch(state: ProviderState): void {
        if (!state.searchVisible) {
            this.removeSearch();
            return;
        }
        this.ensureSearch();
        this.searchInput?.update({
            name: "tree-provider-search-input",
            size: "sm",
            value: state.searchText,
            placeholder: t("menus.searchPlaceholder"),
            onChange: this.model.setSearchText,
            onKeyDown: this.onSearchKeyDown,
            onBlur: this.onSearchBlur,
            endSlot: state.searchText ? this.searchClose?.root : undefined,
        });
    }

    private treeProps(
        tNodes: Traited<TreeProviderNode[]>,
        state: ProviderState,
    ): TreeProps<TreeProviderNode> {
        const provider = this.props.provider;
        const writable = provider.writable;
        const osDragEnabled = isLocalFileProvider(provider);

        return {
            name: "tree-provider",
            items: tNodes,
            getChildren: getNodeChildren,
            isSelected: this.isSelected,
            multiSelect: this.props.multiSelect,
            onSelectionChange: this.onSelectionChange,
            keyboardNav: true,
            canCollapse: this.canCollapse,
            collapseDescendants: true,
            activeIndex: this.activeIndex,
            onActiveChange: this.onActiveChange,
            onChange: this.model.onItemClick,
            onItemDoubleClick: this.model.onItemDoubleClick,
            searchText: state.searchText,
            expanded: state.expandedValues,
            onExpandedChange: this.model.onExpandedChange,
            getHasChildren: this.getHasChildren,
            getTooltip: this.getTooltip,
            getSecondaryLabel: this.getSecondaryLabel,
            getIconElement: this.getIconElement,
            getHideChevron: this.getHideChevron,
            renderTrailing: this.getTreeRenderTrailing(),
            onItemContextMenu: this.onItemContextMenu,
            traitTypeId: writable
                ? (provider.dragTraitTypeId && isTraitTypeId(provider.dragTraitTypeId)
                    ? provider.dragTraitTypeId
                    : TraitTypeId.ILink)
                : undefined,
            getDragData: writable ? this.getDragData : undefined,
            acceptsDrop: writable,
            acceptsFileDrop: writable && !!provider.importFiles,
            canTraitDrop: writable ? this.canTraitDrop : undefined,
            onTraitDrop: writable ? this.onTraitDrop : undefined,
            onDragStartOverride: osDragEnabled ? this.onOsDragStart : undefined,
        };
    }

    private readonly getHasChildren = (node: TreeProviderNode): boolean => {
        if (!node.data.isDirectory) return false;
        const { hasSubDirectories, hasItems } = node.data;
        if (hasSubDirectories === undefined && hasItems === undefined) return true;
        return this.props.showLinks !== false
            ? !!(hasSubDirectories || hasItems)
            : !!hasSubDirectories;
    };

    private readonly getHideChevron = (_node: TreeProviderNode, level: number): boolean => level === 0;

    private getTreeRenderTrailing(): TreeProps<TreeProviderNode>["renderTrailing"] {
        const owner = this.props.renderTrailing;
        if (!owner) {
            this.renderTrailingOwner = undefined;
            this.cachedRenderTrailing = undefined;
            return undefined;
        }
        if (owner !== this.renderTrailingOwner) {
            this.renderTrailingOwner = owner;
            this.cachedRenderTrailing = (node) => owner(node.data);
        }
        return this.cachedRenderTrailing;
    }

    private isSelected = (node: TreeProviderNode): boolean =>
        this.selectedSet.has(hrefKey(node.data.href));

    /**
     * Give Tree a new `isSelected` whenever the selection actually changes. The provider expresses
     * selection only through that predicate and passes no `value` prop, so `selectedKey` stays null.
     * Rebuilding `selectedSet` in place would leave Tree with no prop signal that the newly selected
     * row needs painting and the previous one clearing.
     *
     * Predicate identity is a global repaint key. Swapping it with the set is a truthful signal;
     * the real comparison below avoids repainting the full viewport for unrelated state updates.
     */
    private syncSelection(selectedValues: readonly string[]): void {
        const next = new Set<string>();
        for (const href of selectedValues) next.add(hrefKey(href));
        if (next.size === this.selectedSet.size) {
            let same = true;
            for (const href of next) {
                if (!this.selectedSet.has(href)) { same = false; break; }
            }
            if (same) return;
        }
        this.selectedSet = next;
        this.isSelected = (node: TreeProviderNode): boolean =>
            this.selectedSet.has(hrefKey(node.data.href));
    }

    private readonly onSelectionChange = (nodes: TreeProviderNode[]): void => {
        this.model.setSelection(nodes.map((node) => node.data.href));
    };

    /**
     * Hover highlight. The Tree paints the hovered row through `[data-active]` and reports the row
     * under the pointer here, so storing the index is only half the job: it has to reach the Tree as
     * a prop. Selection follows `model.setSelection`, which changes model state and runs `applyState`.
     *
     * `tNodesFor` is identity-cached and `activeIndex` is a local repaint input, so this updates
     * only the previous and current active rows. Stored callbacks keep unrelated prop pumps stable.
     */
    private readonly onActiveChange = (index: number | null): void => {
        if (this.activeIndex === index) return;
        this.activeIndex = index;
        if (this.arm !== "tree" || !this.treeView) return;
        const state = this.model.state.get();
        const tNodes = this.tNodesFor(state.displayTree);
        if (tNodes) this.treeView.update(this.treeProps(tNodes, state));
    };

    private readonly getTooltip = (node: TreeProviderNode): SlotText =>
        this.props.getTooltip?.(node.data) ?? node.data.href;

    private readonly getSecondaryLabel = (
        node: TreeProviderNode,
        level: number,
    ): SlotContent => {
        const getSecondaryLabel = this.props.getSecondaryLabel;
        if (!getSecondaryLabel) return undefined;
        const cached = this.secondaryLabelCache.get(node.data.href);
        if (cached) return cached;
        const content = getSecondaryLabel(node.data, level);
        if (content instanceof Node && !(content instanceof DocumentFragment)) {
            this.secondaryLabelCache.set(node.data.href, content);
        }
        return content;
    };

    private readonly canCollapse = (node: TreeProviderNode): boolean =>
        !sameHref(node.data.href, this.props.provider.rootPath);

    private readonly getIconElement = (node: TreeProviderNode): Node => {
        const href = node.data.href;
        const cached = this.iconCache.get(href);
        if (cached) return cached;
        const element = createTreeProviderItemIconElement(node.data);
        this.iconCache.set(href, element);
        return element;
    };

    private readonly getDragData = (node: TreeProviderNode): unknown | null => {
        const provider = this.props.provider;
        if (sameHref(node.data.href, provider.rootPath)) return null;
        const items = this.model.dragItemsFor(node);
        return items.length ? { items, sourceId: provider.sourceUrl } : null;
    };

    private readonly onOsDragStart = (
        node: TreeProviderNode,
        _level: number,
        event: DragEvent,
    ): boolean => this.model.handleOsDragStart(node, event);

    private readonly canTraitDrop = (
        node: TreeProviderNode,
        payload: TraitDragPayload,
    ): boolean => this.props.provider.writable
        && !!getTraitDropAction(this.props.provider, node.data.href, payload);

    private readonly onTraitDrop = (node: TreeProviderNode, payload: TraitDragPayload): void => {
        const action = getTraitDropAction(this.props.provider, node.data.href, payload);
        if (!action) return;
        if (action.kind === "move") {
            void this.model.moveItems(action.items, node);
        } else if (action.kind === "import-links") {
            void this.model.importLinksTo(action.items, node);
        } else if (isLocalFileProvider(this.props.provider)) {
            void this.model.dropOsFilesInto(action.files, node);
        } else {
            void this.model.importFiles(action.files, node);
        }
    };

    private readonly onItemContextMenu = (
        node: TreeProviderNode,
        _level: number,
        event: MouseEvent,
    ): void => this.model.onItemContextMenu(node, event);

    private readonly onRootKeyDown = (event: KeyboardEvent): void => {
        if (this.model.onTreeKeyDown(event)) return;
        if (event.ctrlKey && event.key === "f") {
            event.preventDefault();
            event.stopPropagation();
            this.model.showSearch();
            this.searchField?.focus();
        }
        if (event.key === "Escape" && this.model.state.get().searchVisible) {
            event.preventDefault();
            event.stopPropagation();
            this.model.hideSearch();
            this.treeView?.model.focusRoot();
        }
    };

    private readonly onSearchKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        this.model.hideSearch();
        this.treeView?.model.focusRoot();
    };

    private readonly onSearchBlur = (): void => {
        if (!this.model.state.get().searchText) this.model.hideSearch();
    };

    private readonly onSearchClose = (): void => {
        this.model.hideSearch();
        this.treeView?.model.focusRoot();
    };
}
