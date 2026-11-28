import type { ITreeProvider } from "../../api/types/io.tree";
import { isWatchable, type ClassifiedTreeWatchBatch } from "../../content/tree-providers/tree-provider-capabilities";
import type { ProviderTreeExpansion } from "./provider-tree-expansion";
import type { ProviderTreeStore, TreeOperation } from "./provider-tree-store";
import type { TreeProviderNode } from "./tree-provider-node";
import { computeDisplayTree, getExpandedPaths } from "./tree-search-filter";

interface ProviderTreeWatchOptions {
    getProvider: () => ITreeProvider;
    getSearchText: () => string;
    getShowLinks: () => boolean;
    getExpansion: () => ProviderTreeExpansion;
    rebuild: () => Promise<void>;
    publish: (tree: TreeProviderNode, displayTree: TreeProviderNode, expandedValues: Readonly<Record<string | number, boolean>>) => void;
}

/** Owns provider-level watch wiring and serial refreshes for one tree view. */
export class ProviderTreeWatchController {
    private watchSubscription?: () => void;

    constructor(private readonly store: ProviderTreeStore, private readonly options: ProviderTreeWatchOptions) {}

    subscribe(provider: ITreeProvider): void {
        this.watchSubscription?.();
        this.watchSubscription = undefined;
        if (isWatchable(provider)) this.watchSubscription = provider.watch(batch => { void this.queue(batch); });
    }

    queue(batch?: ClassifiedTreeWatchBatch, isWatchCurrent: () => boolean = () => true): Promise<void> {
        const provider = this.options.getProvider();
        return this.store.enqueueWatch(provider, async (operation: TreeOperation, currentBatch) => {
            if (!isWatchCurrent()) return;
            const original = this.store.snapshot;
            if (!original) {
                await this.options.rebuild();
                return;
            }
            try {
                const result = await this.store.refreshWatchBatch(
                    original,
                    currentBatch,
                    () => operation.isCurrent() && this.store.snapshot === original && isWatchCurrent(),
                );
                if (!isWatchCurrent()) return;
                if (!result) {
                    await this.options.rebuild();
                    return;
                }
                if (!result.shouldPublish) return;
                const tree = result.tree;
                const expansion = this.options.getExpansion();
                const displayTree = computeDisplayTree(
                    tree,
                    this.options.getSearchText(),
                    this.options.getShowLinks(),
                    getExpandedPaths(expansion.normalExpansionRecord()),
                );
                if (!displayTree) return;
                const expandedValues = expansion.getDisplayExpansion(displayTree, this.options.getSearchText());
                this.store.setSnapshot(tree);
                this.options.publish(tree, displayTree, expandedValues);
            } catch {
                await this.options.rebuild();
            }
        }, batch);
    }

    dispose(): void {
        this.watchSubscription?.();
        this.watchSubscription = undefined;
    }
}
