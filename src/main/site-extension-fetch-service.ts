import { errMessage } from "../shared/utils";
import { siteExtensionTrustService } from "./site-extension-trust-service";

/** Per-response cap: large enough for real API pages, still a bound on one fetch's memory. */
const MAX_BYTES = 8 * 1024 * 1024;
const active = new Map<string, Set<AbortController>>();
siteExtensionTrustService.onChange(() => {
    for (const requests of active.values()) for (const controller of requests) controller.abort();
});

export function cancelSiteExtensionFetches(owner: number, tab: string): void {
    for (const controller of active.get(`${owner}:${tab}`) ?? []) controller.abort();
}

/** Main independently verifies the persisted grant at every network boundary. */
export async function fetchSiteExtensionText(owner: number, tab: string, id: string, address: string): Promise<{ text?: string; error?: string }> {
    if (typeof tab !== "string" || tab.length > 200 || typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)
        || typeof address !== "string" || address.length > 4096) return { error: "Invalid fetch request" };
    const key = `${owner}:${tab}`;
    const requests = active.get(key) ?? new Set<AbortController>();
    if (requests.size >= 4) return { error: "Too many fetch requests" };
    const controller = new AbortController();
    requests.add(controller); active.set(key, requests);
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        let url = new URL(address);
        for (let redirects = 0; ; redirects++) {
            const grant = (await siteExtensionTrustService.getSnapshot())[id];
            if (controller.signal.aborted) throw new Error("Fetch cancelled");
            if (!grant?.enabled || url.protocol !== "https:" || url.port || url.username || url.password
                || !grant.fetchHosts.includes(url.hostname)) throw new Error("Fetch host is not trusted");
            const response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal, credentials: "omit" });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get("location");
                await response.body?.cancel();
                if (!location || redirects >= 3) throw new Error("Invalid or excessive redirects");
                url = new URL(location, url);
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error(`Fetch failed with HTTP status ${response.status}`);
            }
            const reader = response.body?.getReader();
            const decoder = new TextDecoder("utf-8", { fatal: true });
            let text = ""; let size = 0;
            if (reader) {
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    size += chunk.value.byteLength;
                    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Fetch response is too large"); }
                    text += decoder.decode(chunk.value, { stream: true });
                }
            }
            text += decoder.decode();
            const current = (await siteExtensionTrustService.getSnapshot())[id];
            if (controller.signal.aborted || !current?.enabled || !current.fetchHosts.includes(url.hostname)) throw new Error("Fetch cancelled");
            return { text };
        }
    } catch (error) {
        if (controller.signal.aborted) return { error: "Fetch cancelled or timed out" };
        return { error: errMessage(error, "Fetch failed").split("\n")[0].replace(/^(?:Error: )+/, "").slice(0, 200) };
    } finally {
        clearTimeout(timer); requests.delete(controller); if (!requests.size) active.delete(key);
    }
}
