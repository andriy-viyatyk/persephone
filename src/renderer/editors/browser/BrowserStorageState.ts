import type { BrowserCookie } from "../../../ipc/browser-ipc";
import { BROWSER_TEST_POWER_REFUSAL, agentMayUseBrowserTestPower } from "./agent-access";
import type { BrowserEditor } from "./BrowserEditor";

export interface StorageOriginState {
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
    sessionStorage: Array<{ name: string; value: string }>;
}
export interface StorageState { cookies: BrowserCookie[]; origins: StorageOriginState[]; }

export class BrowserStorageState {
    constructor(private readonly model: BrowserEditor) {}

    async capture(tabId?: string): Promise<StorageState> {
        this.requireTestPower();
        const tab = this.model.findTab(tabId ?? this.model.state.get().activeTabId);
        if (!tab) throw new Error("No active browser tab.");
        const url = tab.url;
        let origin: string | undefined;
        try {
            const parsed = new URL(url);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") origin = parsed.origin;
        } catch { /* opaque/non-HTTP document */ }
        if (!origin) return { cookies: [], origins: [] };
        await this.model.target.ensureReady(tab.id);
        const session = this.model.target.cdp(tab.id);
        const cookies = await session.getStorageStateCookies([url]);
        let stored: Record<string, unknown> | null;
        try { stored = await session.evaluate(`(() => ({ origin: location.origin, localStorage: Object.keys(localStorage).map(name => ({ name, value: localStorage.getItem(name) ?? "" })), sessionStorage: Object.keys(sessionStorage).map(name => ({ name, value: sessionStorage.getItem(name) ?? "" })) }))()`); }
        catch { throw new Error("Could not capture current-origin Web Storage."); }
        if (!stored || stored.origin !== origin) return { cookies, origins: [] };
        return { cookies, origins: [{ origin, localStorage: normalizeEntries(stored.localStorage), sessionStorage: normalizeEntries(stored.sessionStorage) }] };
    }

    async applyForTestRun(value: unknown): Promise<string> {
        this.requireTestPower();
        const state = validateStorageState(value);
        const tab = this.model.activeTab;
        if (!tab) throw new Error("No active browser tab.");
        // A page just created by ctx.openBrowser has no guest WebContents until its tab loads.
        await this.model.target.ensureReady(tab.id);
        const session = this.model.target.cdp(tab.id);
        await session.setStorageStateCookies(state.cookies);
        const payload = JSON.stringify(state.origins.map(({ origin, localStorage, sessionStorage }) => ({ origin, localStorage, sessionStorage })));
        const source = `(() => { const states = ${payload}; const state = states.find(item => item.origin === location.origin); if (!state) return; for (const [area, entries] of [[localStorage, state.localStorage], [sessionStorage, state.sessionStorage]]) { for (const entry of entries) area.setItem(entry.name, entry.value); } })();`;
        return session.addInitScript(source);
    }

    private requireTestPower(): void {
        if (!agentMayUseBrowserTestPower(this.model.state.get())) throw new Error(BROWSER_TEST_POWER_REFUSAL);
    }
}

export function validateStorageState(value: unknown): StorageState {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Storage state must be an object with cookies and origins arrays.");
    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate.cookies) || !Array.isArray(candidate.origins)) throw new TypeError("Storage state must be an object with cookies and origins arrays.");
    const cookies = candidate.cookies.map((cookie) => {
        if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) throw new TypeError("Invalid cookie record.");
        const item = cookie as Record<string, unknown>;
        if (typeof item.name !== "string" || typeof item.value !== "string") throw new TypeError("Cookie records require string name and value fields.");
        return item as unknown as BrowserCookie;
    });
    const origins = candidate.origins.map((origin) => {
        if (!origin || typeof origin !== "object" || Array.isArray(origin)) throw new TypeError("Invalid origin storage record.");
        const item = origin as Record<string, unknown>;
        if (typeof item.origin !== "string") throw new TypeError("Origin storage records require an origin string.");
        let parsedOrigin: URL;
        try { parsedOrigin = new URL(item.origin); } catch { throw new TypeError("Origin storage record has an invalid origin."); }
        if ((parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") || parsedOrigin.origin !== item.origin) throw new TypeError("Origin storage record has an invalid origin.");
        return { origin: item.origin, localStorage: normalizeEntries(item.localStorage), sessionStorage: normalizeEntries(item.sessionStorage) };
    });
    return { cookies, origins };
}

function normalizeEntries(value: unknown): Array<{ name: string; value: string }> {
    if (!Array.isArray(value)) throw new TypeError("Storage entries must be arrays.");
    return value.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Invalid storage entry.");
        const item = entry as Record<string, unknown>;
        if (typeof item.name !== "string" || typeof item.value !== "string") throw new TypeError("Storage entries require string name and value fields.");
        return { name: item.name, value: item.value };
    });
}
