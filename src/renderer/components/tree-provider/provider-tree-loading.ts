import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { hrefKey } from "./href-utils";
import { findNode, updateNodeChildren, type TreeProviderNode } from "./tree-provider-node";
import { ProviderTreeStore } from "./provider-tree-store";

export interface ProviderTreeLoadingCallbacks {
    getTree(): TreeProviderNode | null;
    canLoad(): boolean;
    onStatusChange(loadingHrefs: string[], loadErrors: Record<string, string>): void;
    onLoaded(tree: TreeProviderNode): void;
    onStale(href: string): void;
}

/** Owns per-folder lazy-load requests and rejects results from collapsed or replaced folders. */
export class ProviderTreeLoading {
    private readonly versions = new Map<string, number>();
    private readonly pending = new Set<string>();
    private readonly loadingHrefs: string[] = [];
    private readonly loadErrors: Record<string, string> = {};
    private batchVersion = 0;

    constructor(
        private readonly store: ProviderTreeStore,
        private readonly callbacks: ProviderTreeLoadingCallbacks,
    ) {}

    async load(href: string, force = false): Promise<void> {
        if (!this.callbacks.canLoad()) return;
        const tree = this.callbacks.getTree();
        const node = findNode(tree, href);
        if (!tree || !node || !node.data.isDirectory || (node.items !== undefined && !force)) return;
        const key = hrefKey(href);
        if (this.pending.has(key)) return;
        this.pending.add(key);
        const version = (this.versions.get(key) ?? 0) + 1;
        this.versions.set(key, version);
        this.markLoading(href);
        const operation = this.store.currentOperation();
        try {
            const loaded = await this.store.loadChildren(
                tree,
                [href],
                "load-unloaded",
                () => operation.isCurrent() && this.versions.get(key) === version,
                force,
            );
            if (!loaded) {
                if (this.versions.get(key) === version && this.store.isProviderActive(operation.provider)
                    && !this.store.isGenerationCurrent(operation.generation)) this.markStale(href);
                return;
            }
            const loadedNode = findNode(loaded, href);
            const latest = this.callbacks.getTree();
            if (!loadedNode || !latest || this.versions.get(key) !== version) {
                if (this.versions.get(key) === version) this.markStale(href);
                return;
            }
            this.markLoaded(href);
            this.callbacks.onLoaded(updateNodeChildren(latest, href, loadedNode.items ?? []));
        } catch (error) {
            if (operation.isCurrent() && this.versions.get(key) === version) {
                this.markError(href, errMessage(error, t("menus.failedToLoadItems")));
            } else if (this.versions.get(key) === version) {
                this.markStale(href);
            }
        } finally {
            if (this.versions.get(key) === version) this.pending.delete(key);
        }
    }

    async loadMany(hrefs: string[], force = false): Promise<void> {
        const batchVersion = this.batchVersion;
        for (const href of [...hrefs].sort((left, right) => left.length - right.length)) {
            if (batchVersion !== this.batchVersion) return;
            await this.load(href, force);
        }
    }

    invalidate(href: string): void {
        const key = hrefKey(href);
        this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
        this.pending.delete(key);
        this.removeLoading(href);
    }

    invalidateAll(): void {
        this.batchVersion++;
        this.pending.clear();
        this.loadingHrefs.splice(0);
        for (const key of Object.keys(this.loadErrors)) delete this.loadErrors[key];
        this.publishStatus();
        for (const key of this.versions.keys()) {
            this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
        }
    }

    private markLoading(href: string): void {
        const key = hrefKey(href);
        this.loadingHrefs.splice(0, this.loadingHrefs.length,
            ...this.loadingHrefs.filter(value => hrefKey(value) !== key), href);
        delete this.loadErrors[key];
        this.publishStatus();
    }

    private markError(href: string, message: string): void {
        const key = hrefKey(href);
        this.removeLoading(href);
        this.loadErrors[key] = message;
        this.publishStatus();
    }

    private markLoaded(href: string): void {
        const key = hrefKey(href);
        this.removeLoading(href);
        delete this.loadErrors[key];
        this.publishStatus();
    }

    private markStale(href: string): void {
        this.removeLoading(href);
        this.publishStatus();
        this.callbacks.onStale(href);
    }

    private removeLoading(href: string): void {
        const key = hrefKey(href);
        const index = this.loadingHrefs.findIndex(value => hrefKey(value) === key);
        if (index >= 0) this.loadingHrefs.splice(index, 1);
    }

    private publishStatus(): void {
        this.callbacks.onStatusChange([...this.loadingHrefs], { ...this.loadErrors });
    }
}
