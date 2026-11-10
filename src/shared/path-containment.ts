export interface PathContainmentOptions { readonly allowSame?: boolean }

/** Both arguments are comparison keys: absolute, "/"-separated, no trailing slash, lower-cased on Windows. */
export function isKeyInside(parentKey: string, childKey: string, options?: PathContainmentOptions): boolean {
    if (childKey === parentKey) return options?.allowSame !== false;
    return childKey.startsWith(parentKey + "/");
}
