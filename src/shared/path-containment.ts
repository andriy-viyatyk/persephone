import { isWindows, pathsAreCaseInsensitive } from "./platform";

export interface PathContainmentOptions { readonly allowSame?: boolean }

/** Comparison key for unresolved hrefs. Hrefs are not resolved as filesystem paths. */
export function hrefCompareKey(href: string): string {
    const separatorsNormalized = isWindows ? href.replace(/\\/g, "/") : href;
    return pathsAreCaseInsensitive ? separatorsNormalized.toLowerCase() : separatorsNormalized;
}

/** Comparison key for an already-resolved native path, without its trailing separator. */
export function resolvedPathCompareKey(resolvedPath: string): string {
    const separatorsNormalized = isWindows ? resolvedPath.replace(/\\/g, "/") : resolvedPath;
    const withoutTrailingSlash = separatorsNormalized.replace(/\/+$/, "");
    return pathsAreCaseInsensitive ? withoutTrailingSlash.toLowerCase() : withoutTrailingSlash;
}

/** Both arguments are comparison keys: absolute, "/"-separated, no trailing slash, lower-cased on Windows. */
export function isKeyInside(parentKey: string, childKey: string, options?: PathContainmentOptions): boolean {
    if (childKey === parentKey) return options?.allowSame !== false;
    return childKey.startsWith(parentKey + "/");
}
