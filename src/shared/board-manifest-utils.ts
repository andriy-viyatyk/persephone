import { normalizeBoardRelativePath } from "./guides/mounted-source";

export const BOARD_MANIFEST_FILE = "board-manifest.json";

export const PLATFORM_SERVICE_INTERFACE_IDS = new Set(["agent.session", "speech.transcribe", "text.translate"]);
export const MAX_SERVICE_INTERFACE_DECLARATIONS = 32;
export const MAX_SERVICE_INTERFACE_ID_LENGTH = 160;
export const MAX_SERVICE_INTERFACE_TITLE_LENGTH = 120;

export interface BoardServiceInterfaceDeclaration { id: string; version: number; title?: string }
export interface BoardServiceUseDeclaration { id: string; version: number }

function validServiceInterfaceId(id: string): boolean {
    if (id.length > MAX_SERVICE_INTERFACE_ID_LENGTH || /\s/.test(id)) return false;
    if (PLATFORM_SERVICE_INTERFACE_IDS.has(id)) return true;
    const parts = id.split("/");
    return parts.length === 2 && parts.every((part) => part.length > 0 && !/\s/.test(part));
}

export function normalizeServiceInterfaces(raw: unknown, issue?: (name: string, reason: string) => void): BoardServiceInterfaceDeclaration[] {
    return normalizeServiceDeclarations(raw, true, issue) as BoardServiceInterfaceDeclaration[];
}

export function normalizeServiceUses(raw: unknown, issue?: (name: string, reason: string) => void): BoardServiceUseDeclaration[] {
    return normalizeServiceDeclarations(raw, false, issue) as BoardServiceUseDeclaration[];
}

function normalizeServiceDeclarations(raw: unknown, provider: boolean, issue?: (name: string, reason: string) => void): Array<BoardServiceInterfaceDeclaration | BoardServiceUseDeclaration> {
    if (!Array.isArray(raw)) return [];
    const result: Array<BoardServiceInterfaceDeclaration | BoardServiceUseDeclaration> = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const candidate = entry as Record<string, unknown>;
        const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
        const version = candidate.version;
        if (!id || !validServiceInterfaceId(id)) {
            issue?.(id || "service interface", "id must be a reserved platform id or author/name with two non-empty whitespace-free segments");
            continue;
        }
        if (typeof version !== "number" || !Number.isSafeInteger(version) || version <= 0) {
            issue?.(id, "version must be a positive safe integer");
            continue;
        }
        let title: string | undefined;
        if (provider && candidate.title !== undefined) {
            if (typeof candidate.title !== "string" || candidate.title.trim().length > MAX_SERVICE_INTERFACE_TITLE_LENGTH) {
                issue?.(id, "title must be a string of at most 120 characters");
                continue;
            }
            title = candidate.title.trim() || undefined;
        }
        const key = `${id}\u0000${version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(provider ? { id, version, ...(title ? { title } : {}) } : { id, version });
        if (result.length >= MAX_SERVICE_INTERFACE_DECLARATIONS) break;
    }
    return result.sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version);
}

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
