import { TComponentModel } from "../../core/state/model";
import type { ITreeProvider, ITreeProviderItem, ILink } from "../../api/types/io.tree";
import type { TreeItem, TreeViewRef } from "../TreeView";
import type { MenuItem } from "../overlay/PopupMenu";
import { ContextMenuEvent } from "../../api/events/events";
import { app } from "../../api/app";
import { ui } from "../../api/ui";
import { fpDirname } from "../../core/utils/file-path";
import {
    CopyIcon,
    DeleteIcon,
    NewFileIcon,
    NewFolderIcon,
    RenameIcon,
} from "../../theme/icons";

// =============================================================================
// Types
// =============================================================================

/** Internal tree node wrapping ITreeProviderItem for TreeView rendering. */
export interface TreeProviderNode extends TreeItem<TreeProviderNode> {
    data: ITreeProviderItem;
    /** undefined = not loaded (lazy), [] = empty directory */
    items?: TreeProviderNode[];
}

export interface TreeProviderViewSavedState {
    expandedPaths: string[];
    selectedHref?: string;
}

export interface TreeProviderViewProps {
    provider: ITreeProvider;
    /** Show leaf items in tree (true) or directories only (false). Default: true */
    showLinks?: boolean;
    onItemClick?: (item: ITreeProviderItem) => void;
    onItemDoubleClick?: (item: ITreeProviderItem) => void;
    onFolderDoubleClick?: (item: ITreeProviderItem) => void;
    /** Called after generic + event channel menu items are added. Parent can add/modify items. */
    onContextMenu?: (event: import("../../api/events/events").ContextMenuEvent<ITreeProviderItem>) => void;
    selectedHref?: string;
    initialState?: TreeProviderViewSavedState;
    onStateChange?: (state: TreeProviderViewSavedState) => void;
    refreshKey?: string | number;
}

export interface TreeProviderViewState {
    tree: TreeProviderNode | null;
    displayTree: TreeProviderNode | null;
    searchText: string;
    searchVisible: boolean;
    treeViewKey: number;
    error: string | null;
}

export const defaultTreeProviderViewState: TreeProviderViewState = {
    tree: null,
    displayTree: null,
    searchText: "",
    searchVisible: false,
    treeViewKey: 0,
    error: null,
};

// =============================================================================
// Model
// =============================================================================

export class TreeProviderViewModel extends TComponentModel<
    TreeProviderViewState,
    TreeProviderViewProps
> {
    treeViewRef: TreeViewRef | null = null;
    savedExpandMap: Record<string, boolean> | null = null;
    initialExpandMap: Record<string, boolean> | undefined = undefined;
    private watchSubscription?: { unsubscribe: () => void };

    setProps = () => {
        if (this.isFirstUse) {
            if (this.props.initialState?.expandedPaths?.length) {
                const map: Record<string, boolean> = {};
                for (const p of this.props.initialState.expandedPaths) {
                    map[p] = true;
                }
                this.initialExpandMap = map;
            }
            this.initializeTree();
            this.subscribeWatch();
        } else if (this.oldProps?.provider !== this.props.provider) {
            this.subscribeWatch();
            this.buildTree();
        }
    };

    private subscribeWatch = () => {
        this.watchSubscription?.unsubscribe();
        this.watchSubscription = undefined;
        const provider = this.props.provider as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (typeof provider.watch === "function") {
            this.watchSubscription = provider.watch(() => this.buildTree());
        }
    };

    dispose = () => {
        this.watchSubscription?.unsubscribe();
        this.watchSubscription = undefined;
    };

    private initializeTree = async () => {
        await this.buildTree();

        // Pre-load children for restored expanded paths
        if (this.props.initialState?.expandedPaths?.length) {
            await this.loadChildrenForPaths(this.props.initialState.expandedPaths);
        }

        // Build collapsed map to prevent TreeView's level < 2 auto-expand.
        // Without this, TreeView auto-expands level 0-1 nodes even though
        // children haven't been loaded yet (lazy loading).
        const tree = this.state.get().tree;
        if (tree) {
            const collapsedMap = this.buildAllCollapsedMap(tree);
            this.initialExpandMap = { ...collapsedMap, ...this.initialExpandMap };
        }

        this.state.update((s) => { s.treeViewKey++; });
    };

    private buildAllCollapsedMap = (tree: TreeProviderNode): Record<string, boolean> => {
        const map: Record<string, boolean> = {};
        const walk = (node: TreeProviderNode, isRoot: boolean) => {
            if (node.data.isDirectory) {
                map[node.data.href] = isRoot;
            }
            if (node.items) {
                for (const child of node.items) {
                    walk(child, false);
                }
            }
        };
        walk(tree, true);
        return map;
    };

    setTreeViewRef = (ref: TreeViewRef | null) => {
        this.treeViewRef = ref;
    };

    // ── Tree building ────────────────────────────────────────────────────

    buildTree = async () => {
        const { provider } = this.props;

        // Capture expanded paths before rebuild (for refresh)
        const expandMap = this.treeViewRef?.getExpandMap() ?? {};
        const expandedPaths = Object.entries(expandMap)
            .filter(([, expanded]) => expanded)
            .map(([id]) => id);

        try {
            const items = filterTreeItems(await provider.list(provider.rootPath));
            const rootNode: TreeProviderNode = {
                data: {
                    title: provider.displayName,
                    href: provider.rootPath,
                    category: "",
                    tags: [],
                    isDirectory: true,
                },
                items: items.map(toNode),
            };

            const { searchText } = this.state.get();
            const displayTree = this.computeDisplayTree(rootNode, searchText);

            this.state.update((s) => {
                s.tree = rootNode;
                s.displayTree = displayTree;
                s.error = null;
            });

            // Reload children for previously expanded paths
            if (expandedPaths.length) {
                await this.loadChildrenForPaths(expandedPaths);
            }
        } catch (err: any) {
            this.state.update((s) => {
                s.tree = null;
                s.displayTree = null;
                s.error = err.message || "Failed to list directory";
            });
        }
    };

    // ── Lazy loading ─────────────────────────────────────────────────────

    private loadChildrenIfNeeded = async (href: string) => {
        const { tree } = this.state.get();
        if (!tree) return;

        const node = findNode(tree, href);
        if (!node || !node.data.isDirectory || node.items !== undefined) return;

        // Determine the path to list: for root node use rootPath,
        // otherwise use the category path that the provider expects
        const listPath = this.getListPath(node);

        try {
            const items = filterTreeItems(await this.props.provider.list(listPath));
            const newTree = updateNodeChildren(tree, href, items.map(toNode));
            const { searchText } = this.state.get();
            const displayTree = this.computeDisplayTree(newTree, searchText);

            this.state.update((s) => {
                s.tree = newTree;
                s.displayTree = displayTree;
            });
        } catch {
            // Mark as loaded but empty on error
            const newTree = updateNodeChildren(tree, href, []);
            this.state.update((s) => {
                s.tree = newTree;
                s.displayTree = this.computeDisplayTree(newTree, s.searchText);
            });
        }
    };

    private loadChildrenForPaths = async (paths: string[]) => {
        let { tree } = this.state.get();
        if (!tree) return;

        const sorted = [...paths].sort((a, b) => a.length - b.length);
        let changed = false;

        for (const href of sorted) {
            const node = findNode(tree, href);
            if (node && node.data.isDirectory && node.items === undefined) {
                const listPath = this.getListPath(node);
                try {
                    const items = filterTreeItems(await this.props.provider.list(listPath));
                    tree = updateNodeChildren(tree, href, items.map(toNode));
                    changed = true;
                } catch {
                    tree = updateNodeChildren(tree, href, []);
                    changed = true;
                }
            }
        }

        if (changed) {
            const { searchText } = this.state.get();
            const displayTree = this.computeDisplayTree(tree, searchText);
            this.state.update((s) => {
                s.tree = tree;
                s.displayTree = displayTree;
            });
        }
    };

    /** Get the path to pass to provider.list() for a given node. */
    private getListPath = (node: TreeProviderNode): string => {
        const { provider } = this.props;
        // For FileTreeProvider: href is the absolute path, use it directly
        // For ZipTreeProvider: href is "archive.zip!inner/path", we need inner path
        // The category of children = the directory path the provider understands
        // For root node, category is "" and we use provider.rootPath
        if (node.data.href === provider.rootPath) {
            return provider.rootPath;
        }
        // For child directories, build the inner path from category + name
        const category = node.data.category;
        return category
            ? category + "/" + node.data.title
            : node.data.title;
    };

    // ── State persistence ────────────────────────────────────────────────

    getState = (): TreeProviderViewSavedState => {
        const expandMap = this.treeViewRef?.getExpandMap() ?? {};
        const expandedPaths = Object.entries(expandMap)
            .filter(([, expanded]) => expanded)
            .map(([id]) => id);
        return {
            expandedPaths,
            selectedHref: this.props.selectedHref,
        };
    };

    onExpandChange = (id: string, expanded: boolean) => {
        if (expanded) {
            this.loadChildrenIfNeeded(id);
        }
        this.props.onStateChange?.(this.getState());
    };

    // ── Search ───────────────────────────────────────────────────────────

    showSearch = () => {
        this.state.update((s) => { s.searchVisible = true; });
    };

    hideSearch = () => {
        const wasDeep = this.state.get().searchText.length >= 3;

        if (wasDeep) {
            this.initialExpandMap = this.savedExpandMap ?? undefined;
            this.savedExpandMap = null;
        }

        this.state.update((s) => {
            s.searchText = "";
            s.searchVisible = false;
            s.displayTree = this.computeDisplayTree(s.tree, "");
            if (wasDeep) {
                s.treeViewKey++;
            }
        });
    };

    setSearchText = (text: string) => {
        const { searchText: prevText, tree } = this.state.get();
        const wasDeep = prevText.length >= 3;
        const isDeep = text.length >= 3;

        let keyDelta = 0;
        if (wasDeep !== isDeep) {
            keyDelta = 1;
            if (isDeep) {
                this.savedExpandMap = this.treeViewRef?.getExpandMap() ?? {};
                this.initialExpandMap = undefined;
            } else {
                this.initialExpandMap = this.savedExpandMap ?? undefined;
                this.savedExpandMap = null;
            }
        }

        const displayTree = this.computeDisplayTree(tree, text);
        this.state.update((s) => {
            s.searchText = text;
            s.displayTree = displayTree;
            s.treeViewKey += keyDelta;
        });
    };

    private computeDisplayTree = (
        tree: TreeProviderNode | null,
        searchText: string,
    ): TreeProviderNode | null => {
        if (!tree) return null;

        let result = tree;

        // Apply showLinks filter
        if (this.props.showLinks === false) {
            result = filterDirectoriesOnly(result);
        }

        // Apply search filter
        if (searchText) {
            const words = searchText.toLowerCase().split(" ").filter(Boolean);
            if (words.length > 0) {
                if (searchText.length >= 3) {
                    result = filterTreeDeep(result, words);
                } else {
                    const expandedPaths = this.getExpandedPaths();
                    result = filterTreeShallow(result, words, expandedPaths);
                }
            }
        }

        return result;
    };

    private getExpandedPaths = (): Set<string> => {
        const map = this.treeViewRef?.getExpandMap() ?? {};
        return new Set(
            Object.entries(map)
                .filter(([, expanded]) => expanded)
                .map(([id]) => id),
        );
    };

    // ── Reveal item ───────────────────────────────────────────────────────

    /**
     * Expand ancestors, load children if needed, and scroll to make an item visible.
     * Uses provider.rootPath and path-based ancestor computation (works for FileTreeProvider).
     */
    revealItem = async (href: string) => {
        const { provider } = this.props;
        const { tree } = this.state.get();
        if (!tree) return;

        // Compute ancestor directory paths from href to rootPath.
        const rootLower = provider.rootPath.toLowerCase();
        const ancestors: string[] = [];
        let current = href;
        while (true) {
            const parent = fpDirname(current);
            if (parent === current || parent.toLowerCase() === rootLower) break;
            ancestors.unshift(parent);
            current = parent;
        }

        // Load children for all ancestor paths (no-op for already loaded)
        const allPaths = [provider.rootPath, ...ancestors];
        await this.loadChildrenForPaths(allPaths);

        // Wait for React to re-render TreeView with the new children data
        await new Promise((r) => setTimeout(r, 0));

        // Expand all ancestors in TreeView
        for (const p of allPaths) {
            this.treeViewRef?.expandItem(p);
        }

        // Wait for TreeView to re-render expanded rows, then scroll
        await new Promise((r) => setTimeout(r, 0));
        this.treeViewRef?.scrollToItem(href);
    };

    // ── Click handlers ───────────────────────────────────────────────────

    onItemClick = (node: TreeProviderNode) => {
        if (node.data.isDirectory) {
            this.treeViewRef?.toggleItem(node.data.href);
        }
        // Fire onItemClick for all items (files and folders).
        // Parent decides whether to navigate based on selection state.
        this.props.onItemClick?.(node.data);
    };

    onItemDoubleClick = (node: TreeProviderNode) => {
        if (node.data.isDirectory) {
            this.props.onFolderDoubleClick?.(node.data);
        } else {
            this.props.onItemDoubleClick?.(node.data);
        }
    };

    // ── Context menus ────────────────────────────────────────────────────

    onItemContextMenu = (node: TreeProviderNode, e: React.MouseEvent) => {
        const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "tree-provider-item");
        ctxEvent.target = node.data;

        // Layer 1: Generic items (Copy Path, Rename, Delete)
        const items = node.data.isDirectory
            ? this.getFolderMenuItems(node)
            : this.getFileMenuItems(node);
        ctxEvent.items.push(...items);

        // Layer 2: Event channel — type-specific items added by registered handlers
        // Layer 3: Parent callback — final additions/modifications
        // Set contextMenuPromise so GlobalEventService waits for async handlers
        // before showing the popup menu.
        const promise = (async () => {
            const result = await app.events.linkContextMenu.sendAsync(
                ctxEvent as ContextMenuEvent<ITreeProviderItem>,
            );
            this.props.onContextMenu?.(ctxEvent as ContextMenuEvent<ITreeProviderItem>);
            return result;
        })();
        e.nativeEvent.contextMenuPromise = promise;
    };

    onBackgroundContextMenu = (e: React.MouseEvent) => {
        const ctxEvent = e.nativeEvent.contextMenuEvent;
        const isFolder = ctxEvent?.target && (ctxEvent.target as any).isDirectory; // eslint-disable-line @typescript-eslint/no-explicit-any
        const { provider } = this.props;

        if (provider.writable && provider.mkdir && !isFolder) {
            const bgEvent = ContextMenuEvent.fromNativeEvent(e, "tree-provider-background");
            bgEvent.items.push(
                {
                    label: "New File...",
                    icon: <NewFileIcon />,
                    onClick: () => this.createNewFile(provider.rootPath),
                },
                {
                    label: "New Folder...",
                    icon: <NewFolderIcon />,
                    onClick: () => this.createNewFolder(provider.rootPath),
                },
            );
        }
    };

    private getFileMenuItems = (node: TreeProviderNode): MenuItem[] => {
        const { provider } = this.props;
        const items: MenuItem[] = [];

        items.push({
            label: "Copy Path",
            icon: <CopyIcon />,
            onClick: () => navigator.clipboard.writeText(node.data.href),
        });

        if (provider.writable) {
            if (provider.rename) {
                items.push({
                    startGroup: true,
                    label: "Rename...",
                    icon: <RenameIcon />,
                    onClick: () => this.renameItem(node),
                });
            }
            if (provider.deleteItem) {
                items.push({
                    label: "Delete",
                    icon: <DeleteIcon />,
                    onClick: () => this.deleteItemAction(node),
                });
            }
        }

        return items;
    };

    private getFolderMenuItems = (node: TreeProviderNode): MenuItem[] => {
        const { provider } = this.props;
        const isRoot = node.data.href === provider.rootPath;
        const items: MenuItem[] = [];

        if (provider.writable && provider.mkdir) {
            items.push(
                {
                    label: "New File...",
                    icon: <NewFileIcon />,
                    onClick: () => this.createNewFile(this.getListPath(node)),
                },
                {
                    label: "New Folder...",
                    icon: <NewFolderIcon />,
                    onClick: () => this.createNewFolder(this.getListPath(node)),
                },
            );
        }

        items.push({
            startGroup: items.length > 0,
            label: "Copy Path",
            icon: <CopyIcon />,
            onClick: () => navigator.clipboard.writeText(node.data.href),
        });

        if (provider.writable && !isRoot) {
            if (provider.rename) {
                items.push({
                    startGroup: true,
                    label: "Rename...",
                    icon: <RenameIcon />,
                    onClick: () => this.renameItem(node),
                });
            }
            if (provider.deleteItem) {
                items.push({
                    label: "Delete",
                    icon: <DeleteIcon />,
                    onClick: () => this.deleteItemAction(node),
                });
            }
        }

        return items;
    };

    // ── File operations ──────────────────────────────────────────────────

    private createNewFile = async (dirPath: string) => {
        const { provider } = this.props;
        if (!provider.addItem) return;

        const inputResult = await ui.input("Enter file name:", {
            title: "New File",
            buttons: ["Create", "Cancel"],
        });
        if (inputResult?.button !== "Create" || !inputResult.value.trim()) return;

        const name = inputResult.value.trim();
        const href = provider.resolveLink(
            dirPath ? dirPath + "/" + name : name,
        );

        try {
            await provider.addItem({ href, title: name, category: dirPath, tags: [], isDirectory: false });
        } catch (err: any) {
            ui.notify(err.message || "Failed to create file.", "warning");
            return;
        }
        await this.buildTree();
    };

    private createNewFolder = async (dirPath: string) => {
        const { provider } = this.props;
        if (!provider.mkdir) return;

        const inputResult = await ui.input("Enter folder name:", {
            title: "New Folder",
            buttons: ["Create", "Cancel"],
        });
        if (inputResult?.button !== "Create" || !inputResult.value.trim()) return;

        const name = inputResult.value.trim();
        const folderPath = dirPath ? dirPath + "/" + name : name;

        try {
            await provider.mkdir(folderPath);
        } catch (err: any) {
            ui.notify(err.message || "Failed to create folder.", "warning");
            return;
        }
        await this.buildTree();
    };

    private renameItem = async (node: TreeProviderNode) => {
        const { provider } = this.props;
        if (!provider.rename) return;

        const inputResult = await ui.input("Enter new name:", {
            title: `Rename ${node.data.isDirectory ? "Folder" : "File"}`,
            value: node.data.title,
            buttons: ["Rename", "Cancel"],
            selectAll: true,
        });
        if (inputResult?.button !== "Rename" || !inputResult.value.trim()) return;

        const newName = inputResult.value.trim();
        const category = node.data.category;
        const newPath = category ? category + "/" + newName : newName;

        try {
            await provider.rename(
                this.getListPath(node),
                newPath,
            );
        } catch (err: any) {
            ui.notify(err.message || "Failed to rename.", "warning");
            return;
        }
        await this.buildTree();
    };

    private deleteItemAction = async (node: TreeProviderNode) => {
        const { provider } = this.props;
        if (!provider.deleteItem) return;

        const bt = await ui.confirm(
            `Are you sure you want to delete "${node.data.title}"?`,
            { title: "Delete Confirmation", buttons: ["Delete", "Cancel"] },
        );
        if (bt !== "Delete") return;

        try {
            await provider.deleteItem(node.data.href);
        } catch (err: any) {
            ui.notify(err.message || "Failed to delete.", "warning");
            return;
        }
        await this.buildTree();
    };

    // ── Drag-drop ────────────────────────────────────────────────────────

    moveItems = async (sourceItems: ILink[], targetNode: TreeProviderNode) => {
        const { provider } = this.props;

        const targetDir = targetNode.data.isDirectory
            ? targetNode
            : findParent(this.state.get().tree, targetNode.data.href);
        if (!targetDir) return;

        const targetPath = this.getListPath(targetDir);

        if (provider.moveToCategory) {
            // Link provider path: moveToCategory (no confirmation needed)
            await provider.moveToCategory(sourceItems.map(i => i.href), targetPath);
        } else if (provider.rename && sourceItems.length === 1) {
            // File provider path: rename (with confirmation)
            const source = sourceItems[0];
            const newPath = targetPath
                ? targetPath + "/" + source.title
                : source.title;

            const bt = await ui.confirm(
                `Move "${source.title}" to "${targetDir.data.title}/"?`,
                { title: "Move", buttons: ["Move", "Cancel"] },
            );
            if (bt !== "Move") return;

            try {
                await provider.rename(source.href, newPath);
            } catch (err: any) {
                ui.notify(err.message || "Failed to move.", "warning");
                return;
            }
        } else {
            return;
        }

        await this.buildTree();
    };
}

// =============================================================================
// Pure utility functions
// =============================================================================

/** Filter out ".." parent navigation entries (used by FileTreeProvider for flat views, not trees). */
function filterTreeItems(items: ITreeProviderItem[]): ITreeProviderItem[] {
    return items.filter((item) => item.title !== "..");
}

function toNode(item: ITreeProviderItem): TreeProviderNode {
    return {
        data: item,
        items: item.isDirectory ? undefined : undefined,
        // directories: items = undefined (lazy), files: no items needed
    };
}

function findNode(tree: TreeProviderNode, href: string): TreeProviderNode | null {
    if (tree.data.href === href) return tree;
    if (tree.items) {
        for (const child of tree.items) {
            const found = findNode(child, href);
            if (found) return found;
        }
    }
    return null;
}

function findParent(tree: TreeProviderNode | null, href: string): TreeProviderNode | null {
    if (!tree || !tree.items) return null;
    for (const child of tree.items) {
        if (child.data.href === href) return tree;
        const found = findParent(child, href);
        if (found) return found;
    }
    return null;
}

function updateNodeChildren(
    node: TreeProviderNode,
    href: string,
    children: TreeProviderNode[],
): TreeProviderNode {
    if (node.data.href === href) {
        return { ...node, items: children };
    }
    if (node.items) {
        return {
            ...node,
            items: node.items.map(child => updateNodeChildren(child, href, children)),
        };
    }
    return node;
}

// ── Tree filters ─────────────────────────────────────────────────────────

function filterDirectoriesOnly(node: TreeProviderNode): TreeProviderNode {
    return {
        ...node,
        items: node.items
            ?.filter(child => child.data.isDirectory)
            .map(filterDirectoriesOnly),
    };
}

function filterTreeDeep(
    node: TreeProviderNode,
    words: string[],
): TreeProviderNode {
    return {
        ...node,
        items: filterChildrenDeep(node.items, words),
    };
}

function filterChildrenDeep(
    items: TreeProviderNode[] | undefined,
    words: string[],
): TreeProviderNode[] {
    if (!items) return [];
    const result: TreeProviderNode[] = [];
    for (const item of items) {
        if (item.data.isDirectory) {
            const filteredChildren = filterChildrenDeep(item.items, words);
            if (filteredChildren.length > 0) {
                result.push({ ...item, items: filteredChildren });
            }
        } else {
            const nameLower = item.data.title.toLowerCase();
            if (words.every(w => nameLower.includes(w))) {
                result.push(item);
            }
        }
    }
    return result;
}

function filterTreeShallow(
    node: TreeProviderNode,
    words: string[],
    expandedPaths: Set<string>,
): TreeProviderNode {
    return {
        ...node,
        items: filterChildrenShallow(node.items, words, expandedPaths),
    };
}

function filterChildrenShallow(
    items: TreeProviderNode[] | undefined,
    words: string[],
    expandedPaths: Set<string>,
): TreeProviderNode[] {
    if (!items) return [];
    const result: TreeProviderNode[] = [];
    for (const item of items) {
        if (item.data.isDirectory) {
            if (expandedPaths.has(item.data.href)) {
                result.push({
                    ...item,
                    items: filterChildrenShallow(item.items, words, expandedPaths),
                });
            } else {
                result.push(item);
            }
        } else {
            const nameLower = item.data.title.toLowerCase();
            if (words.every(w => nameLower.includes(w))) {
                result.push(item);
            }
        }
    }
    return result;
}
