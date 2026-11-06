import type { SiteActionResult } from "../../api/types/site-extensions";

const controls = /[\p{Cc}\p{Cs}]/u;
const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max * 2 && Array.from(value).length <= max;
const url = (value: unknown): value is string => {
    if (!text(value, 4096) || !/^https?:\/\//i.test(value) || controls.test(value)) return false;
    try { const parsed = new URL(value); return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password; } catch { return false; }
};

/** Parse bounded page-authored results as a closed union. */
export function validateSiteActionResult(serialized: unknown): SiteActionResult {
    if (typeof serialized !== "string" || serialized.length > 2 * 1024 * 1024 || encoder.encode(serialized).byteLength > 2 * 1024 * 1024) throw new Error("Invalid action result size");
    const result: unknown = JSON.parse(serialized);
    if (!record(result)) throw new Error("Invalid action result");
    if (result.kind === "message" && exact(result, ["kind", "text"]) && text(result.text, 500) && result.text.length > 0) return result as unknown as SiteActionResult;
    if (result.kind === "url" && exact(result, ["kind", "url"]) && url(result.url)) return result as unknown as SiteActionResult;
    if (result.kind === "text" && exact(result, ["kind", "title", "format", "content"]) && text(result.title, 120)
        && ["markdown", "json", "csv", "plain"].includes(result.format as string)
        && typeof result.content === "string" && result.content.length <= 1024 * 1024 && encoder.encode(result.content).byteLength <= 1024 * 1024) return result as unknown as SiteActionResult;
    if (result.kind === "links" && exact(result, ["kind", "title", "items"]) && text(result.title, 120)
        && Array.isArray(result.items) && result.items.length >= 1 && result.items.length <= 500
        && result.items.every(item => record(item) && exact(item, ["title", "url"]) && text(item.title, 120) && url(item.url))) return result as unknown as SiteActionResult;
    if (result.kind === "video" && exact(result, ["kind", "items"]) && Array.isArray(result.items)
        && result.items.length >= 1 && result.items.length <= 20 && result.items.every(item => {
            if (!record(item) || !exact(item, ["label", "url", "headers"]) || !text(item.label, 120) || !url(item.url)) return false;
            if (item.headers === undefined) return true;
            if (!record(item.headers)) return false;
            const names = new Set<string>();
            return Object.entries(item.headers).every(([name, value]) => {
                const normalized = name.toLowerCase();
                if ((normalized !== "referer" && normalized !== "origin") || names.has(normalized) || !text(value, 2048) || controls.test(value)) return false;
                names.add(normalized);
                return true;
            });
        })) return result as unknown as SiteActionResult;
    throw new Error("Invalid action result");
}
