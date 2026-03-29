/** Prefix for tree-category links. */
export const TREE_CATEGORY_PREFIX = "tree-category://";

/**
 * Minimal metadata encoded in a tree-category:// link.
 * Used for routing (parser detects prefix, sets editor target)
 * and fallback provider creation (if NavigationData has no provider).
 */
export interface ITreeProviderLink {
    /** Provider type: "file", "zip", "link". */
    type: string;
    /** Source URL (folder path, archive path, .link.json path). */
    url: string;
    /** Category path to display in CategoryView. */
    category: string;
}

/** Encode a tree provider link as a tree-category:// URL. */
export function encodeCategoryLink(link: ITreeProviderLink): string {
    const json = JSON.stringify(link);
    const base64 = btoa(json);
    return TREE_CATEGORY_PREFIX + base64;
}

/** Decode a tree-category:// URL back to an ITreeProviderLink. Returns null if invalid. */
export function decodeCategoryLink(raw: string): ITreeProviderLink | null {
    if (!raw.startsWith(TREE_CATEGORY_PREFIX)) return null;
    try {
        const base64 = raw.slice(TREE_CATEGORY_PREFIX.length);
        const json = atob(base64);
        return JSON.parse(json) as ITreeProviderLink;
    } catch {
        return null;
    }
}
