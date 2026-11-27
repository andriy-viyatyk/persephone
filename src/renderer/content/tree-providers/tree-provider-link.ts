import type { ICategorySegment } from "../../api/types/io.tree";

/** Prefix for tree-category links. */
export const TREE_CATEGORY_PREFIX = "tree-category://";
const UTF8_LINK_PREFIX = "v1.";

/** Segment a `/`-separated RELATIVE category (Link, Archive). Root category is "". */
export function relativeCategorySegments(category: string): ICategorySegment[] {
    if (!category) return [];
    const parts = category.split("/").filter(Boolean);
    return parts.map((label, i) => ({
        label,
        category: parts.slice(0, i + 1).join("/"),
    }));
}

/**
 * Minimal metadata encoded in a tree-category:// link.
 * Used for routing (parser detects prefix, sets editor target) and matching
 * an already-attached provider host in the Category editor.
 */
export interface ITreeProviderLink {
    /** Provider type: "file", "archive", "link". */
    type: string;
    /** Source URL (folder path, archive path, .link.json path). */
    url: string;
    /** Category path to display in CategoryView. */
    category: string;
}

/** Encode a tree provider link as a tree-category:// URL. */
export function encodeCategoryLink(link: ITreeProviderLink): string {
    const json = JSON.stringify(link);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = UTF8_LINK_PREFIX + btoa(binary);
    return TREE_CATEGORY_PREFIX + base64;
}

/** Decode a tree-category:// URL back to an ITreeProviderLink. Returns null if invalid. */
export function decodeCategoryLink(raw: string): ITreeProviderLink | null {
    if (!raw.startsWith(TREE_CATEGORY_PREFIX)) return null;
    try {
        const payload = raw.slice(TREE_CATEGORY_PREFIX.length);
        const isUtf8 = payload.startsWith(UTF8_LINK_PREFIX);
        const binary = atob(isUtf8 ? payload.slice(UTF8_LINK_PREFIX.length) : payload);
        const json = isUtf8
            ? new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
            : binary;
        return JSON.parse(json) as ITreeProviderLink;
    } catch {
        return null;
    }
}
