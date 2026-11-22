import type { WebContents } from "electron";
import type { BrowserCookie } from "../../ipc/browser-ipc";
import type { CdpTarget } from "./CdpTarget";

export interface StorageCookieTarget { webContents: WebContents; cdp: CdpTarget; }

export async function getCookies(target: StorageCookieTarget, urls: string[]): Promise<BrowserCookie[]> {
    if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string")) throw new TypeError("Cookie URLs must be strings.");
    let result: { cookies?: unknown };
    try { result = await target.webContents.debugger.sendCommand("Network.getCookies", { urls }) as { cookies?: unknown }; }
    catch { throw new Error("Could not read browser cookies for the current URL."); }
    if (!Array.isArray(result?.cookies)) throw new Error("CDP did not return browser cookies.");
    return result.cookies.map((cookie) => validateCookie(cookie, false));
}

export async function setCookies(target: StorageCookieTarget, cookies: BrowserCookie[]): Promise<void> {
    if (!Array.isArray(cookies)) throw new TypeError("Storage state cookies must be an array.");
    const normalized = cookies.map((cookie) => {
        const record = validateCookie(cookie, true) as BrowserCookie & { size?: number; session?: boolean; partitionKeyOpaque?: boolean };
        if (record.partitionKeyOpaque) throw new TypeError("Opaque partitioned cookies cannot be applied.");
        const { size: _size, session, partitionKeyOpaque: _opaque, expires, ...param } = record;
        return session ? param : { ...param, ...(expires !== undefined ? { expires } : {}) };
    });
    try { await target.webContents.debugger.sendCommand("Network.setCookies", { cookies: normalized }); }
    catch { throw new Error("Could not apply browser storage cookies."); }
}

function validateCookie(value: unknown, requireLocator: boolean): BrowserCookie {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid cookie record.");
    const cookie = value as Record<string, unknown>;
    if (typeof cookie.name !== "string" || typeof cookie.value !== "string") throw new TypeError("Cookie records require string name and value fields.");
    if (requireLocator && typeof cookie.url !== "string" && typeof cookie.domain !== "string") throw new TypeError("Cookie records require a URL or domain.");
    const allowed = ["name", "value", "url", "domain", "path", "expires", "httpOnly", "secure", "sameSite", "priority", "sameParty", "sourceScheme", "sourcePort", "size", "session", "partitionKey", "partitionKeyOpaque"];
    if (Object.keys(cookie).some((key) => !allowed.includes(key))) throw new TypeError("Cookie record has unsupported fields.");
    for (const key of ["url", "domain", "path"] as const) if (cookie[key] !== undefined && typeof cookie[key] !== "string") throw new TypeError("Cookie URL, domain and path fields must be strings.");
    for (const key of ["httpOnly", "secure", "sameParty"] as const) if (cookie[key] !== undefined && typeof cookie[key] !== "boolean") throw new TypeError("Cookie flags must be boolean.");
    if (cookie.expires !== undefined && (typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires))) throw new TypeError("Cookie expiry must be a finite number.");
    if (cookie.sourcePort !== undefined && (typeof cookie.sourcePort !== "number" || !Number.isInteger(cookie.sourcePort))) throw new TypeError("Cookie source port must be an integer.");
    if (cookie.size !== undefined && (typeof cookie.size !== "number" || !Number.isFinite(cookie.size))) throw new TypeError("Cookie size must be a finite number.");
    if (cookie.session !== undefined && typeof cookie.session !== "boolean") throw new TypeError("Cookie session flag must be boolean.");
    if (cookie.partitionKeyOpaque !== undefined && typeof cookie.partitionKeyOpaque !== "boolean") throw new TypeError("Cookie partition flag must be boolean.");
    if (cookie.partitionKey !== undefined) {
        const partition = cookie.partitionKey;
        if (!partition || typeof partition !== "object" || !("topLevelSite" in partition) || typeof partition.topLevelSite !== "string"
            || ("hasCrossSiteAncestor" in partition && typeof partition.hasCrossSiteAncestor !== "boolean")) throw new TypeError("Invalid cookie partition key.");
    }
    if (cookie.sameSite !== undefined && !["Strict", "Lax", "None"].includes(String(cookie.sameSite))) throw new TypeError("Invalid cookie sameSite value.");
    if (cookie.priority !== undefined && !["Low", "Medium", "High"].includes(String(cookie.priority))) throw new TypeError("Invalid cookie priority value.");
    if (cookie.sourceScheme !== undefined && !["Unset", "NonSecure", "Secure"].includes(String(cookie.sourceScheme))) throw new TypeError("Invalid cookie source scheme.");
    return { ...cookie } as unknown as BrowserCookie;
}
