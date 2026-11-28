import type { ITreeProvider } from "../../api/types/io.tree";
import type { ClassifiedTreeWatchBatch, FolderWatchableTreeProvider } from "../../content/tree-providers/tree-provider-capabilities";
import { ProviderTreeExpansion } from "./provider-tree-expansion";
import type { TreeProviderNode } from "./tree-provider-node";
import { treeItemListPath } from "./tree-provider-path";

interface FolderWatch {
    path: string;
    dispose: () => void;
    active: boolean;
    pending: boolean;
    flushing: boolean;
    pendingBatch?: ClassifiedTreeWatchBatch;
}

/** Keeps tree-folder subscriptions aligned with the currently expanded tree projection. */
export class ProviderTreeFolderWatches {
    private provider: ITreeProvider | undefined;
    private readonly active = new Map<string, FolderWatch>();

    constructor(private readonly onChange: (batch: ClassifiedTreeWatchBatch, isCurrent: () => boolean) => Promise<void>) {}

    reconcile(
        provider: ITreeProvider,
        tree: TreeProviderNode | null,
        displayTree: TreeProviderNode | null,
        searchText: string,
        expansion: ProviderTreeExpansion,
    ): void {
        if (this.provider !== provider) {
            this.clear();
            this.provider = provider;
        }
        if (!isFolderWatchable(provider)) {
            this.clear();
            return;
        }

        const desired = new Map<string, string>();
        const rootPath = provider.rootPath;
        if (!tree) {
            desired.set(rootPath, rootPath);
        } else {
            const expanded = expansion.getDisplayExpansion(displayTree, searchText);
            const projection = displayTree ?? tree;
            const walk = (node: TreeProviderNode, isRoot: boolean): void => {
                if (!node.data.isDirectory) return;
                const href = node.data.href;
                const effectivelyExpanded = isRoot || expanded[href] === true;
                if (effectivelyExpanded) desired.set(href, treeItemListPath(provider, node.data));
                if (effectivelyExpanded) for (const child of node.items ?? []) walk(child, false);
            };
            walk(projection, true);
        }

        for (const [href, watch] of this.active) {
            if (desired.get(href) === watch.path) continue;
            watch.active = false;
            watch.dispose();
            this.active.delete(href);
        }
        for (const [href, path] of desired) {
            if (this.active.has(href)) continue;
            const watch: FolderWatch = { path, dispose: (): void => undefined, active: true, pending: false, flushing: false };
            watch.dispose = provider.watchFolder(href, path, batch => {
                if (this.active.get(href) !== watch || !watch.active) return;
                if (watch.flushing) {
                    watch.pending = true;
                    watch.pendingBatch = batch;
                    return;
                }
                watch.flushing = true;
                void this.flush(href, watch, batch);
            });
            this.active.set(href, watch);
        }
    }

    dispose(): void {
        this.clear();
        this.provider = undefined;
    }

    private async flush(href: string, watch: FolderWatch, batch: ClassifiedTreeWatchBatch): Promise<void> {
        try {
            do {
                watch.pending = false;
                if (this.active.get(href) !== watch || !watch.active) return;
                await this.onChange(batch, () => this.active.get(href) === watch && watch.active);
                batch = watch.pendingBatch ?? { relist: [{ href }] };
                watch.pendingBatch = undefined;
            } while (watch.pending && this.active.get(href) === watch && watch.active);
        } finally {
            watch.flushing = false;
        }
    }

    private clear(): void {
        for (const watch of this.active.values()) {
            watch.active = false;
            watch.dispose();
        }
        this.active.clear();
    }
}

function isFolderWatchable(provider: ITreeProvider): provider is FolderWatchableTreeProvider {
    return "watchFolder" in provider && typeof provider.watchFolder === "function";
}
