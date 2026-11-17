import { fs } from "../../api/fs";
import { fpIsAbsolute } from "../../core/utils/file-path";
import { matchTemporarySiteExtensionHost, parseTemporarySiteExtensionHost } from "../../../shared/temporary-site-extension";

export interface TemporarySiteExtensionOptions {
    host: string;
    name?: string;
    scriptPath?: string;
    source?: string;
    params?: Record<string, unknown>;
}

export interface TemporarySiteExtensionEntry {
    readonly host: string;
    readonly hostname: string;
    readonly explicitPort?: number;
    readonly key: string;
    readonly name?: string;
    readonly scriptPath?: string;
    readonly inline: boolean;
    readonly source?: string;
    readonly params: Record<string, unknown>;
    readonly serializedParams: string;
    readonly revision: number;
}

export interface TemporarySiteExtensionListItem {
    host: string;
    name?: string;
    scriptPath?: string;
    inline: boolean;
    injectedTabs: string[];
    /** Tabs whose last injection attempt failed, with the reason (for example an unreadable scriptPath). */
    failedTabs: Array<{ tabId: string; error: string }>;
}

export class TemporarySiteExtensions {
    private readonly entries = new Map<string, TemporarySiteExtensionEntry>();
    private readonly outcomes = new Map<string, Map<string, { status: "pending" | "injected" | "deferred" | "error"; error?: string }>>();
    private revision = 0;

    async attach(options: TemporarySiteExtensionOptions): Promise<{ entry: TemporarySiteExtensionEntry; previous?: TemporarySiteExtensionEntry }> {
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Options must be an object.");
        const authority = parseTemporarySiteExtensionHost(options.host);
        if (options.name !== undefined && (typeof options.name !== "string" || options.name.length > 256)) {
            throw new Error("Name must be a string of at most 256 characters.");
        }
        const hasPath = options.scriptPath !== undefined;
        const hasSource = options.source !== undefined;
        if (hasPath === hasSource) throw new Error("Provide exactly one of scriptPath or source.");
        let scriptPath: string | undefined;
        let source: string | undefined;
        if (hasPath) {
            if (typeof options.scriptPath !== "string" || !options.scriptPath || options.scriptPath.length > 4096) {
                throw new Error("scriptPath must be a non-empty absolute file path of at most 4096 characters.");
            }
            if (!fpIsAbsolute(options.scriptPath)) throw new Error("scriptPath must be an absolute file path.");
            scriptPath = options.scriptPath;
            try { await fs.read(scriptPath); }
            catch { throw new Error("scriptPath could not be read; the temporary extension was not attached."); }
        } else {
            if (typeof options.source !== "string") throw new Error("source must be a string.");
            source = options.source;
            if (new TextEncoder().encode(source).byteLength > 1024 * 1024) throw new Error("source must be at most 1 MiB of UTF-8 text.");
        }
        const params = cloneParams(options.params);
        const serializedParams = JSON.stringify(params);
        if (new TextEncoder().encode(serializedParams).byteLength > 16 * 1024) throw new Error("params must be at most 16 KiB of JSON.");
        const entry: TemporarySiteExtensionEntry = {
            ...authority,
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(scriptPath === undefined ? {} : { scriptPath }),
            inline: source !== undefined,
            ...(source === undefined ? {} : { source }),
            params,
            serializedParams,
            revision: ++this.revision,
        };
        const previous = this.entries.get(entry.key);
        this.entries.set(entry.key, entry);
        this.outcomes.delete(entry.key);
        return { entry, previous };
    }

    remove(host: string): TemporarySiteExtensionEntry | undefined {
        const authority = parseTemporarySiteExtensionHost(host);
        const entry = this.entries.get(authority.key);
        if (!entry) return undefined;
        this.entries.delete(authority.key);
        this.outcomes.delete(authority.key);
        return entry;
    }

    get(key: string): TemporarySiteExtensionEntry | undefined { return this.entries.get(key); }

    match(url: URL): TemporarySiteExtensionEntry | undefined {
        return matchTemporarySiteExtensionHost(url, this.entries.values())?.entry;
    }

    list(): TemporarySiteExtensionListItem[] {
        return [...this.entries.values()].map((entry) => ({
            host: entry.host,
            ...(entry.name === undefined ? {} : { name: entry.name }),
            ...(entry.scriptPath === undefined ? {} : { scriptPath: entry.scriptPath }),
            inline: entry.inline,
            injectedTabs: [...(this.outcomes.get(entry.key) ?? [])]
                .filter(([, outcome]) => outcome.status === "injected").map(([tabId]) => tabId),
            failedTabs: [...(this.outcomes.get(entry.key) ?? [])]
                .filter(([, outcome]) => outcome.status === "error")
                .map(([tabId, outcome]) => ({ tabId, error: outcome.error ?? "Injection failed." })),
        }));
    }

    record(entry: TemporarySiteExtensionEntry, tabId: string, outcome: { status: "pending" | "injected" | "deferred" | "error"; error?: string }): void {
        if (!this.isCurrent(entry)) return;
        let targets = this.outcomes.get(entry.key);
        if (!targets) { targets = new Map(); this.outcomes.set(entry.key, targets); }
        targets.set(tabId, outcome);
    }

    isCurrent(entry: TemporarySiteExtensionEntry): boolean { return this.entries.get(entry.key)?.revision === entry.revision; }

    forgetTab(tabId: string): void {
        for (const targets of this.outcomes.values()) targets.delete(tabId);
    }

    clear(): void {
        this.entries.clear();
        this.outcomes.clear();
    }

}

function cloneParams(value: unknown): Record<string, unknown> {
    if (value === undefined) return {};
    const seen = new Set<object>();
    const visit = (item: unknown, depth: number): unknown => {
        if (depth > 32) throw new Error("params must not exceed 32 levels of nesting.");
        if (item === null || typeof item === "string" || typeof item === "boolean") return item;
        if (typeof item === "number") {
            if (!Number.isFinite(item)) throw new Error("params numbers must be finite.");
            return item;
        }
        if (typeof item !== "object") throw new Error("params must contain only JSON-safe values.");
        if (seen.has(item)) throw new Error("params must not contain cycles.");
        seen.add(item);
        let result: unknown;
        if (Array.isArray(item)) {
            const keys = Reflect.ownKeys(item);
            if (keys.some((key) => typeof key === "symbol") || keys.length !== item.length + 1
                || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= item.length))) {
                throw new Error("params arrays must contain only indexed JSON values.");
            }
            const parts: unknown[] = [];
            for (let index = 0; index < item.length; index++) {
                if (!Object.prototype.hasOwnProperty.call(item, index)) throw new Error("params arrays must not contain missing values.");
                parts.push(visit(item[index], depth + 1));
            }
            result = parts;
        }
        else {
            const prototype = Object.getPrototypeOf(item);
            if (prototype !== Object.prototype && prototype !== null) throw new Error("params must contain only plain JSON objects.");
            const keys = Reflect.ownKeys(item);
            if (keys.some((key) => typeof key === "symbol")) throw new Error("params must not contain symbol keys.");
            result = Object.fromEntries(keys.map((key) => {
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
                    throw new Error("params must contain only enumerable data properties.");
                }
                return [key as string, visit(descriptor.value, depth + 1)];
            }));
        }
        seen.delete(item);
        return result;
    };
    const cloned = visit(value, 0);
    if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) throw new Error("params must be a JSON object.");
    return cloned as Record<string, unknown>;
}
