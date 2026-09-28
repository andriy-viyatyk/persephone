import { normalizeBoardRelativePath } from "./guides/mounted-source";

export const BOARD_MANIFEST_FILE = "board-manifest.json";

export function normalizeStringList(
    raw: unknown,
    options: {
        map: (entry: string) => string;
        max?: number;
        accept?: (value: string, acceptedSoFar: readonly string[]) => boolean;
    },
): string[] {
    if (!Array.isArray(raw)) return [];
    const values: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const value = options.map(entry);
        if (!value || values.includes(value)) continue;
        if (options.accept && !options.accept(value, values)) continue;
        values.push(value);
        if (options.max !== undefined && values.length >= options.max) break;
    }
    return values;
}

export function normalizePermissions(raw: unknown): string[] {
    return normalizeStringList(raw, { map: (entry) => entry.trim() });
}

export function normalizeBoardServicePath(raw: unknown): string | null {
    return normalizeBoardRelativePath(raw);
}

export const MAX_BROWSER_URL_MASK_CHARS = 512;
export const MAX_BROWSER_URL_MASKS = 64;

export function normalizeBrowserUrlMasks(raw: unknown): string[] {
    return normalizeStringList(raw, {
        map: (entry) => entry.trim().toLowerCase(),
        max: MAX_BROWSER_URL_MASKS,
        accept: (value) => value.length <= MAX_BROWSER_URL_MASK_CHARS,
    });
}
