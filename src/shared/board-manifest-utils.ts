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

export interface BoardPermissionFlags {
    execute: boolean;
    service: boolean;
    fileSystem: false | "board" | "full";
    openExternal: boolean;
    appScripting: boolean;
    network: false | "internet" | "full";
    clipboardRead: boolean;
    camera: boolean;
    microphone: boolean;
    geolocation: boolean;
    notifications: boolean;
    themes: boolean;
}

export type NormalizedBoardPermissions =
    | { kind: "flags"; flags: BoardPermissionFlags }
    | { kind: "legacy"; service: boolean };

export function normalizePermissions(raw: unknown): NormalizedBoardPermissions {
    if (Array.isArray(raw)) {
        return { kind: "legacy", service: raw.some((entry) => typeof entry === "string" && entry.trim() === "service") };
    }
    if (!raw || typeof raw !== "object") return { kind: "legacy", service: false };

    const source = raw as Record<string, unknown>;
    const fileSystem = source.fileSystem;
    const network = source.network;
    return {
        kind: "flags",
        flags: {
            execute: source.execute === true,
            service: source.service === true,
            fileSystem: fileSystem === "board" || fileSystem === "full" ? fileSystem : false,
            openExternal: source.openExternal === true,
            appScripting: source.appScripting === true,
            network: network === "internet" || network === "full" ? network : false,
            clipboardRead: source.clipboardRead === true,
            camera: source.camera === true,
            microphone: source.microphone === true,
            geolocation: source.geolocation === true,
            notifications: source.notifications === true,
            themes: source.themes === true,
        },
    };
}

export function boardPermissionAllows(permissions: NormalizedBoardPermissions, flag: keyof BoardPermissionFlags): boolean {
    if (permissions.kind === "legacy") return flag !== "service" || permissions.service;
    const value = permissions.flags[flag];
    return value === true || value === "full" || value === "board" || value === "internet";
}

export function boardPermissionError(flag: string): Error {
    return new Error(`permission-denied: "${flag}" is not enabled in board-manifest.json`);
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
