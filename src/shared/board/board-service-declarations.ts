import { PLATFORM_AUDIO_CAPABILITY_ID, PLATFORM_SERVICE_INTERFACE_IDS } from "../capability-constants";
import { MAX_CAPABILITY_DECLARATIONS, MAX_CAPABILITY_ID_LENGTH, MAX_CAPABILITY_TITLE_LENGTH } from "../capability-limits";
import { normalizeBoardRelativePath } from "../guides/mounted-source";
import { normalizeStringList } from "./normalize-string-list";

export const MAX_SERVICE_INTERFACE_DECLARATIONS = MAX_CAPABILITY_DECLARATIONS;
export const MAX_SERVICE_INTERFACE_ID_LENGTH = MAX_CAPABILITY_ID_LENGTH;
export const MAX_SERVICE_INTERFACE_TITLE_LENGTH = MAX_CAPABILITY_TITLE_LENGTH;

export interface BoardServiceInterfaceDeclaration { id: string; version: number; title?: string; openTypes?: string[] }
export interface BoardServiceUseDeclaration { id: string; version: number }

function validServiceInterfaceId(id: string, provider: boolean): boolean {
    if (id.length > MAX_SERVICE_INTERFACE_ID_LENGTH || /\s/.test(id)) return false;
    if (id === PLATFORM_AUDIO_CAPABILITY_ID) return !provider;
    if (PLATFORM_SERVICE_INTERFACE_IDS.has(id)) return true;
    if (!provider && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id)) return true;
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
        if (!id || !validServiceInterfaceId(id, provider)) {
            issue?.(id || "service interface", provider
                ? "id must be a reserved platform id or author/name with two non-empty whitespace-free segments"
                : "id must be audio, a dot-separated capability id or author/name with two non-empty whitespace-free segments");
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
        const openTypes = provider ? normalizeStringList(candidate.openTypes, { map: (value) => value }) : [];
        result.push(provider ? { id, version, ...(title ? { title } : {}), ...(openTypes.length ? { openTypes } : {}) } : { id, version });
        if (result.length >= MAX_SERVICE_INTERFACE_DECLARATIONS) break;
    }
    return result.sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version);
}
export function normalizeBoardServicePath(raw: unknown): string | null {
    return normalizeBoardRelativePath(raw);
}

