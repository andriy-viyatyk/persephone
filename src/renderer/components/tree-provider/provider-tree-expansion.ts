import { hrefKey, sameHref } from "./href-utils";
import { findNode, type TreeProviderNode } from "./tree-provider-node";

export interface ExpansionProposal {
    changed: boolean;
    expandedHrefs: string[];
    collapsed: boolean;
}

export class ProviderTreeExpansion {
    private expansionMap = new Map<string, { href: string; expanded: boolean }>();
    private searchExpansionSnapshot: Map<string, { href: string; expanded: boolean }> | null = null;
    private deepSearchCollapsedKeys = new Set<string>();
    private expansionVersion = 0;
    private projectedTree: TreeProviderNode | null | undefined;
    private projectedVersion = -1;
    private projectedExpandedValues: Readonly<Record<string | number, boolean>> = {};

    adoptExpandedPaths(paths: string[]): void {
        for (const path of paths) {
            this.expansionMap.set(hrefKey(path), { href: path, expanded: true });
        }
    }

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

    seedTree = (tree: TreeProviderNode, rootPath: string): void => {
        // Fill missing map entries as collapsed while retaining restored or user-owned
        // values, including paths that are not present in this loaded projection. The
        // root is always true because its chevron is hidden and it cannot be collapsed.
        for (const [href, expanded] of Object.entries(this.buildAllCollapsedMap(tree))) {
            const key = hrefKey(href);
            if (!this.expansionMap.has(key)) {
                this.expansionMap.set(key, { href, expanded });
                this.expansionVersion++;
            }
        }
        const rootKey = hrefKey(rootPath);
        const rootExpansion = this.expansionMap.get(rootKey);
        if (!rootExpansion || !rootExpansion.expanded || rootExpansion.href !== rootPath) {
            this.expansionMap.set(rootKey, { href: rootPath, expanded: true });
            this.expansionVersion++;
        }
    };

    normalExpansionRecord = (): Record<string, boolean> => Object.fromEntries(
        [...this.expansionMap.values()].map(({ href, expanded }) => [href, expanded]),
    );

    private directoryHrefs = (tree: TreeProviderNode | null | undefined): string[] => {
        const hrefs: string[] = [];
        const walk = (node: TreeProviderNode) => {
            if (node.data.isDirectory) hrefs.push(node.data.href);
            for (const child of node.items ?? []) walk(child);
        };
        if (tree) walk(tree);
        return hrefs;
    };

    expandedPaths = (tree: TreeProviderNode | null | undefined, searchText: string): string[] => {
        const deep = searchText.length >= 3;
        const expanded = [...this.expansionMap.values()]
            .filter((entry) => entry.expanded
                && (!deep || !this.deepSearchCollapsedKeys.has(hrefKey(entry.href))))
            .map((entry) => entry.href);
        if (searchText.length >= 3) {
            for (const href of this.directoryHrefs(tree)) {
                if (!this.deepSearchCollapsedKeys.has(hrefKey(href))
                    && !expanded.some((item) => sameHref(item, href))) expanded.push(href);
            }
        }
        return expanded;
    };

    getDisplayExpansion = (
        tree: TreeProviderNode | null | undefined,
        searchText: string,
    ): Readonly<Record<string | number, boolean>> => {
        if (tree === this.projectedTree && this.projectedVersion === this.expansionVersion) {
            return this.projectedExpandedValues;
        }
        const deep = searchText.length >= 3;
        const expandedValues: Record<string, boolean> = {};
        const walk = (node: TreeProviderNode, isRoot: boolean) => {
            const key = hrefKey(node.data.href);
            const entry = this.expansionMap.get(key);
            // Deep search marks every row expanded unless collapsed in this search, leaves
            // included (leaf rows keep `data-state="open"`).
            expandedValues[node.data.href] = isRoot || (deep
                ? !this.deepSearchCollapsedKeys.has(key)
                : node.data.isDirectory && !!entry?.expanded);
            for (const child of node.items ?? []) walk(child, false);
        };
        if (tree) walk(tree, true);
        this.projectedTree = tree;
        this.projectedVersion = this.expansionVersion;
        this.projectedExpandedValues = expandedValues;
        return expandedValues;
    };

    invalidateProjection(): void {
        this.expansionVersion++;
    }

    collapseAll(rootPath: string, displayTree: TreeProviderNode | null, searchText: string): void {
        this.expansionMap = new Map([[hrefKey(rootPath), { href: rootPath, expanded: true }]]);
        this.expansionVersion++;
        if (searchText.length >= 3) {
            this.deepSearchCollapsedKeys = new Set(this.directoryHrefs(displayTree).map(hrefKey));
            this.searchExpansionSnapshot = new Map(this.expansionMap);
        }
    }

    getSavedExpandedPaths(): string[] {
        // Serialize the provider's normal map rather than the loaded Tree projection so
        // restored-but-unloaded expansions survive saves; deep-search overrides stay temporary.
        return [...this.expansionMap.values()]
            .filter((entry) => entry.expanded)
            .map((entry) => entry.href);
    }

    applyProposal(
        proposed: Readonly<Record<string | number, boolean>>,
        currentProjection: Readonly<Record<string | number, boolean>>,
        searchText: string,
    ): ExpansionProposal {
        // Tree submits only loaded-row keys. Apply their differences to the canonical map so
        // restored-but-unloaded entries remain owned and unchanged; deep search records only
        // temporary collapsed keys and never overwrites the normal expansion snapshot.
        const expandedHrefs: string[] = [];
        let collapsed = false;
        const deep = searchText.length >= 3;
        let changed = false;
        for (const [rawHref, next] of Object.entries(proposed)) {
            const key = hrefKey(rawHref);
            const current = !!currentProjection[rawHref];
            if (current === next) continue;
            changed = true;
            if (deep) {
                if (next) this.deepSearchCollapsedKeys.delete(key);
                else {
                    this.deepSearchCollapsedKeys.add(key);
                    collapsed = true;
                }
                if (next) expandedHrefs.push(rawHref);
            } else {
                const previous = this.expansionMap.get(key);
                this.expansionMap.set(key, { href: previous?.href ?? rawHref, expanded: next });
                if (next) expandedHrefs.push(previous?.href ?? rawHref);
                else collapsed = true;
            }
        }
        return { changed, expandedHrefs, collapsed };
    }

    /** Resolve current visibility from the provider-owned normal map or the active deep-search
     *  collapsed-key set. The root remains open in both projections. */
    visibleHrefs = (tree: TreeProviderNode | null, searchText: string): Set<string> => {
        const out = new Set<string>();
        if (!tree) return out;
        const expansion = this.expansionMap;
        /** Every href currently rendered as a row: walk from the root, descending into a
         *  directory only when it is effectively expanded. The root is always expanded (it is
         *  chevron-less and `canCollapse` blocks collapsing it). */
        const walk = (node: TreeProviderNode, isRoot: boolean) => {
            out.add(hrefKey(node.data.href));
            if (!node.data.isDirectory || !node.items) return;
            const isExpanded = searchText.length >= 3
                ? !this.deepSearchCollapsedKeys.has(hrefKey(node.data.href))
                : !!expansion.get(hrefKey(node.data.href))?.expanded;
            if (!isRoot && !isExpanded) return;
            for (const child of node.items) walk(child, false);
        };
        walk(tree, true);
        return out;
    };

    enterSearchBoundary(isDeep: boolean): void {
        if (isDeep) {
            // Snapshot the complete canonical map; deep-search expand/collapse gestures are
            // temporary, and newly appearing directories expand unless explicitly collapsed.
            this.searchExpansionSnapshot = new Map(this.expansionMap);
            this.deepSearchCollapsedKeys.clear();
        } else {
            // Deep search edits a temporary projection. Restore the exact normal-map snapshot
            // before rebuilding the shallow display tree.
            this.expansionMap = this.searchExpansionSnapshot ?? this.expansionMap;
            this.searchExpansionSnapshot = null;
            this.deepSearchCollapsedKeys.clear();
        }
        this.expansionVersion++;
    }

    openPaths(hrefs: string[]): boolean {
        let changed = false;
        for (const href of hrefs) {
            const key = hrefKey(href);
            if (this.expansionMap.get(key)?.expanded) continue;
            const previous = this.expansionMap.get(key);
            this.expansionMap.set(key, { href: previous?.href ?? href, expanded: true });
            changed = true;
        }
        return changed;
    }

    expandPath(href: string, deep: boolean): boolean {
        const key = hrefKey(href);
        if (deep) {
            if (!this.deepSearchCollapsedKeys.delete(key)) return false;
            return true;
        }
        const previous = this.expansionMap.get(key);
        if (previous?.expanded) return false;
        this.expansionMap.set(key, { href: previous?.href ?? href, expanded: true });
        return true;
    }

    collapsePath(href: string, tree: TreeProviderNode | null, deep: boolean): boolean {
        const key = hrefKey(href);
        if (deep ? this.deepSearchCollapsedKeys.has(key) : !this.expansionMap.get(key)?.expanded) return false;
        const descendants: string[] = [];
        const node = findNode(tree, href);
        const walk = (current: TreeProviderNode | undefined) => {
            if (!current) return;
            descendants.push(current.data.href);
            for (const child of current.items ?? []) walk(child);
        };
        for (const child of node?.items ?? []) walk(child);
        if (deep) {
            this.deepSearchCollapsedKeys.add(key);
            for (const childHref of descendants) this.deepSearchCollapsedKeys.add(hrefKey(childHref));
            return true;
        }
        const previous = this.expansionMap.get(key);
        this.expansionMap.set(key, { href: previous?.href ?? href, expanded: false });
        for (const childHref of descendants) {
            const childKey = hrefKey(childHref);
            const child = this.expansionMap.get(childKey);
            this.expansionMap.set(childKey, { href: child?.href ?? childHref, expanded: false });
        }
        return true;
    }
}
