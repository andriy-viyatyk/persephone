import { normalizeBoardRelativePath } from "./guides/mounted-source";

export const BOARD_MANIFEST_FILE = "board-manifest.json";

export function normalizePermissions(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const permissions: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const permission = entry.trim();
        if (permission && !permissions.includes(permission)) permissions.push(permission);
    }
    return permissions;
}

export function normalizeBoardServicePath(raw: unknown): string | null {
    return normalizeBoardRelativePath(raw);
}

export const MAX_BROWSER_URL_MASK_CHARS = 512;
export const MAX_BROWSER_URL_MASKS = 64;

export function normalizeBrowserUrlMasks(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const masks: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const mask = entry.trim().toLowerCase();
        if (!mask || mask.length > MAX_BROWSER_URL_MASK_CHARS || masks.includes(mask)) continue;
        masks.push(mask);
        if (masks.length >= MAX_BROWSER_URL_MASKS) break;
    }
    return masks;
}
