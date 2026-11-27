import type {
    ProviderResult,
    ProviderTreeItem,
    ProviderTreeStat,
    TreeProviderRequest,
} from "../ipc/module-service-channels";
import { isRecord } from "./validation";

const MAX_TREE_ITEMS = 5000;
const MAX_TREE_PATH_LENGTH = 4096;
const MAX_TREE_HREF_LENGTH = 8192;

export interface TreeProviderImplementation {
    list(config: Record<string, unknown>, path: string, context: { signal: AbortSignal }): unknown | Promise<unknown>;
    stat(config: Record<string, unknown>, path: string, context: { signal: AbortSignal }): unknown | Promise<unknown>;
    mkdir?(config: Record<string, unknown>, path: string): unknown | Promise<unknown>;
    rename?(config: Record<string, unknown>, oldPath: string, newPath: string): unknown | Promise<unknown>;
    delete?(config: Record<string, unknown>, path: string): unknown | Promise<unknown>;
}

export interface TreeProviderDispatch {
    register(type: string, implementation: unknown): void;
    has(type: string): boolean;
    types(): string[];
    capabilities(type: string): { mkdir: boolean; rename: boolean; delete: boolean } | undefined;
    execute(
        request: TreeProviderRequest,
        signal: AbortSignal,
    ): Promise<ProviderResult>;
}

function isNamespacedType(type: string): boolean {
    return type.includes("/");
}

function isTreeProviderImplementation(value: unknown): value is TreeProviderImplementation {
    if (!isRecord(value) || typeof value.list !== "function" || typeof value.stat !== "function") return false;
    return ["mkdir", "rename", "delete"].every((method) => value[method] === undefined || typeof value[method] === "function");
}

export function isValidTreePath(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_TREE_PATH_LENGTH
        || !value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
    if (value === "/") return true;
    const segments = value.slice(1).split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validMetadata(value: Record<string, unknown>): boolean {
    return (value.size === undefined || (typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0))
        && (value.mtime === undefined || (typeof value.mtime === "string" && isIsoTimestamp(value.mtime)));
}

function isIsoTimestamp(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match || !Number.isFinite(Date.parse(value))) return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = month === 2 ? (leapYear ? 29 : 28)
        : [4, 6, 9, 11].includes(month) ? 30 : 31;
    return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
        && hour <= 23 && minute <= 59 && second <= 59
        && (offsetHourText === undefined || (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59));
}

function copyMetadata<T extends { size?: number; mtime?: string }>(source: Record<string, unknown>): T {
    return {
        ...(typeof source.size === "number" ? { size: source.size } : {}),
        ...(typeof source.mtime === "string" ? { mtime: source.mtime } : {}),
    } as T;
}

function copyTreeItems(value: unknown, requestedPath: string): ProviderTreeItem[] | undefined {
    if (!Array.isArray(value) || value.length > MAX_TREE_ITEMS) return undefined;
    const names = new Set<string>();
    const paths = new Set<string>();
        const hrefs = new Set<string>();
    const items: ProviderTreeItem[] = [];
    for (const item of value) {
        if (!isRecord(item)
            || typeof item.name !== "string" || item.name.length < 1 || item.name.length > 255
            || item.name === "." || item.name === ".." || /[\\/\0]/.test(item.name)
            || typeof item.path !== "string" || !isValidTreePath(item.path)
            || typeof item.href !== "string" || item.href.length === 0 || item.href.length > MAX_TREE_HREF_LENGTH
            || typeof item.isDirectory !== "boolean" || !validMetadata(item)) return undefined;
        const expectedPath = requestedPath === "/" ? `/${item.name}` : `${requestedPath}/${item.name}`;
        if (item.path !== expectedPath || names.has(item.name) || paths.has(item.path)) return undefined;
        let href: URL;
        try { href = new URL(item.href); }
        catch { return undefined; }
        const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i.exec(item.href)?.[1];
        if (!/^[a-z][a-z\d+.-]*:/i.test(item.href)
            || href.username || href.password || authority?.includes("@") || hrefs.has(href.href)) return undefined;
        names.add(item.name);
        paths.add(item.path);
        hrefs.add(href.href);
        items.push({
            name: item.name,
            path: item.path,
            href: item.href,
            isDirectory: item.isDirectory,
            ...copyMetadata<Pick<ProviderTreeItem, "size" | "mtime">>(item),
        });
    }
    return items;
}

function copyTreeStat(value: unknown): ProviderTreeStat | undefined {
    if (!isRecord(value) || typeof value.exists !== "boolean" || typeof value.isDirectory !== "boolean"
        || !validMetadata(value) || (!value.exists && value.isDirectory)) return undefined;
    return {
        exists: value.exists,
        isDirectory: value.isDirectory,
        ...copyMetadata<Pick<ProviderTreeStat, "size" | "mtime">>(value),
    };
}

function resultFailure(message: string): Extract<ProviderResult, { ok: false }> {
    return { kind: "provider-result", ok: false, error: { kind: "provider-error", code: "provider-invalid-result", message } };
}

export function createTreeProviderDispatch(dependencies: {
    announceCapabilities(): void;
}): TreeProviderDispatch {
    const providers = new Map<string, TreeProviderImplementation>();

    function register(type: string, implementation: unknown): void {
        if (typeof type !== "string" || type.trim() !== type || !isNamespacedType(type)) {
            throw new Error("provider-registration-invalid-type");
        }
        if (!isTreeProviderImplementation(implementation)) {
            throw new Error(`provider-registration-invalid-implementation:${type}`);
        }
        if (providers.has(type)) throw new Error(`provider-registration-duplicate:${type}`);
        providers.set(type, implementation);
        dependencies.announceCapabilities();
    }

    async function execute(request: TreeProviderRequest, signal: AbortSignal): Promise<ProviderResult> {
        const implementation = providers.get(request.type);
        if (!implementation) {
            return { kind: "provider-result", ok: false, error: { kind: "provider-error", code: "provider-not-registered", message: `Tree provider "${request.type}" is not registered.` } };
        }
        if (request.operation === "treeList") {
            const value = await Promise.resolve(implementation.list(request.config, request.path, { signal }));
            if (!isRecord(value) || typeof value.truncated !== "boolean") return resultFailure("list() returned malformed results.");
            const items = copyTreeItems(value.items, request.path);
            if (!items) return resultFailure("list() returned malformed or oversized items.");
            return { kind: "provider-result", operation: "treeList", ok: true, items, truncated: value.truncated };
        }
        if (request.operation === "treeStat") {
            const stat = copyTreeStat(await Promise.resolve(implementation.stat(request.config, request.path, { signal })));
            if (!stat) return resultFailure("stat() returned malformed metadata.");
            return { kind: "provider-result", operation: "treeStat", ok: true, stat };
        }
        if (request.operation === "treeMkdir") {
            if (!implementation.mkdir) return { kind: "provider-result", ok: false, error: { kind: "provider-error", code: "provider-read-only", message: `Tree provider "${request.type}" does not support mkdir().` } };
            await Promise.resolve(implementation.mkdir(request.config, request.path));
            return { kind: "provider-result", operation: "treeMkdir", ok: true };
        }
        if (request.operation === "treeRename") {
            if (!implementation.rename) return { kind: "provider-result", ok: false, error: { kind: "provider-error", code: "provider-read-only", message: `Tree provider "${request.type}" does not support rename().` } };
            await Promise.resolve(implementation.rename(request.config, request.path, request.newPath!));
            return { kind: "provider-result", operation: "treeRename", ok: true };
        }
        if (!implementation.delete) return { kind: "provider-result", ok: false, error: { kind: "provider-error", code: "provider-read-only", message: `Tree provider "${request.type}" does not support delete().` } };
        await Promise.resolve(implementation.delete(request.config, request.path));
        return { kind: "provider-result", operation: "treeDelete", ok: true };
    }

    return {
        register,
        has: (type): boolean => providers.has(type),
        types: (): string[] => [...providers.keys()],
        capabilities(type): { mkdir: boolean; rename: boolean; delete: boolean } | undefined {
            const provider = providers.get(type);
            return provider ? {
                mkdir: typeof provider.mkdir === "function",
                rename: typeof provider.rename === "function",
                delete: typeof provider.delete === "function",
            } : undefined;
        },
        execute,
    };
}
