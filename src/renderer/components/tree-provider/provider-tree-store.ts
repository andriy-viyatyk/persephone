import { SerialQueue } from "../../../shared/serial-queue";
import type { ITreeProvider } from "../../api/types/io.tree";
import { fpNormalizeForCompare } from "../../core/utils/file-path";
import {
    isIncremental,
    type ClassifiedTreeWatchBatch,
} from "../../content/tree-providers/tree-provider-capabilities";
import {
    filterTreeItems,
    findNode,
    toNode,
    updateNodeChildren,
    type TreeProviderNode,
} from "./tree-provider-node";
import { sameHref } from "./href-utils";

export type TreeLoadMode = "load-unloaded" | "relist-loaded";

export interface TreeOperation {
    provider: ITreeProvider;
    generation: number;
    isCurrent: () => boolean;
}

export interface WatchRefreshResult {
    tree: TreeProviderNode;
    shouldPublish: boolean;
}

export class ProviderTreeStore {
    /** Set by the owner's first `adoptProvider` call, before any build, load or watch. */
    private provider!: ITreeProvider;
    private generation = 0;
    private disposed = false;
    private tree: TreeProviderNode | null = null;
    private readonly watchQueue = new SerialQueue();

    constructor(
        private readonly getListPath: (node: TreeProviderNode, provider: ITreeProvider) => string,
    ) {}

    get snapshot(): TreeProviderNode | null {
        return this.tree;
    }

    isProviderActive(provider: ITreeProvider): boolean {
        return !this.disposed && this.provider === provider;
    }

    isGenerationCurrent(generation: number): boolean {
        return !this.disposed && this.generation === generation;
    }

    setSnapshot(tree: TreeProviderNode | null): void {
        this.tree = tree;
    }

    adoptProvider(provider: ITreeProvider): void {
        this.provider = provider;
        this.generation++;
    }

    dispose(): void {
        this.disposed = true;
        this.generation++;
    }

    beginBuild(): TreeOperation {
        const provider = this.provider;
        const generation = ++this.generation;
        return {
            provider,
            generation,
            isCurrent: () => !this.disposed
                && this.provider === provider
                && this.generation === generation,
        };
    }

    currentOperation(): TreeOperation {
        const provider = this.provider;
        const generation = this.generation;
        return {
            provider,
            generation,
            isCurrent: () => !this.disposed
                && this.provider === provider
                && this.generation === generation,
        };
    }

    enqueueWatch(
        provider: ITreeProvider,
        run: (operation: TreeOperation, batch?: ClassifiedTreeWatchBatch) => Promise<void>,
        batch?: ClassifiedTreeWatchBatch,
    ): void {
        void this.watchQueue.run(async () => {
            if (this.disposed || this.provider !== provider) return;
            // Batches run one at a time, so the generation is taken when this one starts: a later
            // batch is not a reason to rebuild, but an expansion load or rebuild in between is.
            const generation = ++this.generation;
            await run({
                provider,
                generation,
                isCurrent: () => !this.disposed
                    && this.provider === provider
                    && this.generation === generation,
            }, batch);
        }).catch(error => { console.warn("Tree watch refresh failed", error); });
    }

    async buildTree(
        expandedHrefs: string[],
        rootLabel: string | undefined,
        operation: TreeOperation,
    ): Promise<TreeProviderNode | null> {
        const { provider } = operation;
        const items = filterTreeItems(await provider.list(provider.rootPath));
        if (!operation.isCurrent()) return null;
        const rootTree: TreeProviderNode = {
            data: {
                // The root node's href is the provider's rootPath verbatim. Some
                // providers (e.g. Mneme) emit a scheme-qualified href for child
                // nodes while keeping rootPath scheme-less — leave this as-is: the
                // root is expand-only (never navigated or stored as a link) and all
                // equality checks compare against rootPath, so the asymmetry is
                // intentional, not a bug to "fix".
                title: rootLabel ?? provider.displayName,
                href: provider.rootPath,
                category: "",
                tags: [],
                isDirectory: true,
            },
            items: items.map(toNode),
        };

        // Refresh children for every expanded directory INLINE, before publishing the
        // new tree. Doing this atomically avoids an intermediate render where the tree
        // is shrunk to root-only entries (all child folders' `items` momentarily
        // undefined). That shrink would force the native RenderGrid model through its
        // over-large-offset clamp in the grid model, wiping the user's scroll
        // position on every FS watch tick — exactly what an AI agent
        // editing files in the project folder triggers repeatedly.
        //
        // Sorted by length so parent paths are populated before child paths — needed
        // for findNode/updateNodeChildren to locate the deeper expanded entries.
        // Sequential await is fine: FileTreeProvider.watch is debounced 500ms, and the
        // OLD tree remains visible the entire time (no intermediate state.update).
        const refreshed = await this.loadChildren(
            rootTree,
            expandedHrefs.filter(href => !sameHref(href, provider.rootPath)),
            "load-unloaded",
            operation.isCurrent,
        );
        return refreshed;
    }

    async refreshWatchBatch(
        original: TreeProviderNode,
        batch: ClassifiedTreeWatchBatch | undefined,
        isCurrent: () => boolean,
    ): Promise<WatchRefreshResult | null> {
        if (!batch || "rebuild" in batch || !isIncremental(this.provider)) return null;

        const normalize = fpNormalizeForCompare;
        const findByWatchPath = (tree: TreeProviderNode, path: string): TreeProviderNode | null =>
            findNode(tree, path, (href, target) => normalize(href) === target);
        const parents = new Map<string, TreeProviderNode>();
        for (const target of batch.relist) {
            if (
                target.changedPaths
                && !target.changedPaths.some(path => findByWatchPath(original, normalize(path))?.data.isDirectory)
            ) continue;
            const key = normalize(target.href);
            const node = findByWatchPath(original, key);
            if (node?.items) parents.set(key, node);
        }

        const tree = await this.loadChildren(
            original,
            [...parents.values()].map(parent => parent.data.href),
            "relist-loaded",
            isCurrent,
        );
        return tree ? { tree, shouldPublish: parents.size > 0 } : null;
    }

    async loadChildren(
        tree: TreeProviderNode,
        hrefs: string[],
        mode: TreeLoadMode,
        isCurrent: () => boolean,
    ): Promise<TreeProviderNode | null> {
        const provider = this.provider;
        let next = tree;
        const sorted = [...hrefs].sort((a, b) => a.length - b.length);

        for (const href of sorted) {
            if (!isCurrent() && mode === "relist-loaded") return null;
            const node = findNode(next, href);
            if (!node || !node.data.isDirectory) continue;
            if (mode === "load-unloaded" && node.items !== undefined) continue;
            if (mode === "relist-loaded" && node.items === undefined) continue;

            try {
                const items = mode === "load-unloaded"
                    ? await provider.list(this.getListPath(node, provider))
                    : isIncremental(provider)
                        ? await provider.listIncremental(node.data.href)
                        : [];
                const current = isCurrent();
                if (!current && (mode === "relist-loaded" || sorted.length === 1)) return null;
                const filteredItems = filterTreeItems(items);
                const children = filteredItems.map(item => {
                    const old = mode === "relist-loaded"
                        ? node.items?.find(child =>
                            fpNormalizeForCompare(child.data.href) === fpNormalizeForCompare(item.href),
                        )
                        : undefined;
                    if (mode === "relist-loaded" && old && old.data.isDirectory !== item.isDirectory) {
                        throw new Error("Directory type changed");
                    }
                    return {
                        data: item,
                        items: mode === "relist-loaded" && item.isDirectory ? old?.items : undefined,
                    };
                });
                next = updateNodeChildren(next, node.data.href, children);
            } catch (error) {
                const current = isCurrent();
                if (!current && (mode === "relist-loaded" || sorted.length === 1)) return null;
                if (mode === "relist-loaded") throw error;
                next = updateNodeChildren(next, node.data.href, []);
            }
        }

        return isCurrent() ? next : null;
    }
}
