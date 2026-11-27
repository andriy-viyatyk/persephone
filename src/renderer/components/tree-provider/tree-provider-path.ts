import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { fpBasename, fpDirname, fpNormalizeForCompare } from "../../core/utils/file-path";
import { isLocalFileProvider } from "../../content/tree-providers/tree-provider-capabilities";
import { joinTreeChild } from "./tree-path";
import { sameHref } from "./href-utils";

/** Parent path for a navigable provider root. Non-local provider paths use `/`. */
export function treeParentPath(provider: ITreeProvider, path: string): string {
    if (isLocalFileProvider(provider)) return fpDirname(path);
    if (path === "/") return path;
    if (/^[A-Za-z]:[\\/]*$/.test(path) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]*$/.test(path)) return path;
    const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (separator === 2 && /^[A-Za-z]:/.test(path)) return path.slice(0, 3);
    if (separator <= 0) return path.startsWith("\\") ? "\\" : "/";
    return path.slice(0, separator);
}

/** Display name for a provider path's final segment. */
export function treePathBasename(provider: ITreeProvider, path: string): string {
    if (isLocalFileProvider(provider)) return fpBasename(path);
    return path.split(/[\\/]/).filter(Boolean).pop() ?? "/";
}

/** Directory path expected by provider.list() for a folder item. */
export function treeItemListPath(provider: ITreeProvider, item: ITreeProviderItem): string {
    if (sameHref(item.href, provider.rootPath)) return provider.rootPath;
    return joinTreeChild(item.category, item.title);
}

/** Resolve a provider path to the corresponding href for scripting navigation. */
export function treePathHref(provider: ITreeProvider, path: string): string {
    if (sameTreePath(provider, path, provider.rootPath)) return provider.rootPath;
    return provider.resolveLink(path);
}

/** Provider path equality; file paths keep their platform semantics. */
export function sameTreePath(provider: ITreeProvider, left: string, right: string): boolean {
    if (!isLocalFileProvider(provider)) return left === right;
    return fpNormalizeForCompare(left) === fpNormalizeForCompare(right);
}

/** Local absolute hrefs for the ancestor folders between an item and the tree root. */
export function localTreeAncestorPaths(rootPath: string, href: string): string[] {
    const ancestors: string[] = [];
    let current = href;
    let parent = fpDirname(current);
    while (parent !== current && fpNormalizeForCompare(parent) !== fpNormalizeForCompare(rootPath)) {
        ancestors.unshift(parent);
        current = parent;
        parent = fpDirname(current);
    }
    return [rootPath, ...ancestors];
}
