import { agentMayAccessBrowserPage, privateBrowserRefusal } from "./agent-access";
import type { BrowserEditor } from "./BrowserEditor";
import type { IAiMember, IAiVisionDescriptor, IAiVisible } from "ai-vision";

export type StorageArea = "local" | "session";

const MEMBERS: readonly IAiMember[] = [
    { name: "clear", kind: "method", signature: "clear(options?: { prefix?: string; area?: 'local' | 'session' }): Promise<void>", summary: "Clear the selected storage area, optionally removing only keys with a matching prefix." },
    { name: "set", kind: "method", signature: "set(key: string, value: string, options?: { area?: 'local' | 'session' }): Promise<void>", summary: "Set a string key and value in local or session storage." },
];

export class BrowserStorageFacade implements IAiVisible {
    constructor(private readonly model: BrowserEditor) {}

    get aiVision(): IAiVisionDescriptor {
        return { kind: "BrowserStorage", summary: "Page-scoped local and session storage helpers.", members: MEMBERS, help: "Use clear({ prefix?, area? }) or set(key, value, { area? }); area defaults to local. Values are Web Storage strings.", summarize: () => ({ kind: "BrowserStorage" }) };
    }

    async clear(options: { prefix?: string; area?: StorageArea } = {}): Promise<void> {
        const { area, prefix } = validateOptions(options);
        this.requireAccess();
        const expression = prefix === undefined
            ? `window.${area}Storage.clear()`
            : `(() => { const store = window.${area}Storage; for (const key of Object.keys(store)) if (key.startsWith(${JSON.stringify(prefix)})) store.removeItem(key); })()`;
        try { await this.model.target.cdp().evaluate(expression); }
        catch { throw new Error("Could not update browser storage."); }
    }

    async set(key: string, value: string, options: { area?: StorageArea } = {}): Promise<void> {
        if (typeof key !== "string" || typeof value !== "string") throw new TypeError("storage.set(key, value) requires string keys and values.");
        const { area } = validateOptions(options);
        this.requireAccess();
        try { await this.model.target.cdp().evaluate(`window.${area}Storage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`); }
        catch { throw new Error("Could not update browser storage."); }
    }

    private requireAccess(): void {
        const state = this.model.state.get();
        if (!agentMayAccessBrowserPage(state)) throw new Error(privateBrowserRefusal(state));
    }
}

function validateOptions(value: unknown): { area: StorageArea; prefix?: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Storage options must be an object.");
    const options = value as Record<string, unknown>;
    if (options.area !== undefined && options.area !== "local" && options.area !== "session") throw new TypeError("Storage area must be local or session.");
    if (options.prefix !== undefined && typeof options.prefix !== "string") throw new TypeError("Storage prefix must be a string.");
    return { area: (options.area as StorageArea | undefined) ?? "local", ...(options.prefix !== undefined ? { prefix: options.prefix as string } : {}) };
}
