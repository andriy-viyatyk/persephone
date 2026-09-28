/**
 * Session proxy primitives shared by Tor mode and proxied browser profiles
 * (US-1557).
 *
 * Both put an Electron session behind a single proxy with no direct fallback
 * and no bypass rules beyond Chromium's implicit loopback/link-local ones, and
 * both look up the egress address through that same session — a main-process
 * or renderer fetch would go out unproxied and report the user's real IP.
 */
import type { Session } from "electron";
import type { EgressIpInfo } from "../ipc/browser-network-ipc";

/** Tighter cap per geo provider; they are tried in sequence, and location is optional. */
const GEO_TIMEOUT_MS = 8_000;

/** Geo providers, tried in order. Both are keyless and HTTPS-only. */
const GEO_URLS = [
    "https://ipinfo.io/json",
    "https://freeipapi.com/api/json",
];

/**
 * Point `ses` at exactly one proxy, then drop pooled connections so nothing
 * keeps flowing over the previous route.
 *
 * `proxyBypassRules: ""` adds no bypass; Chromium still sends loopback and
 * link-local destinations direct. No `direct://` fallback is ever appended, so an
 * unreachable proxy fails closed with ERR_PROXY/SOCKS_CONNECTION_FAILED.
 */
export async function applySessionProxy(ses: Session, proxyRules: string): Promise<void> {
    await ses.setProxy({ mode: "fixed_servers", proxyRules, proxyBypassRules: "" });
    await ses.closeAllConnections();
}

/** Return `ses` to a direct connection and drop connections made through the proxy. */
export async function setSessionDirect(ses: Session): Promise<void> {
    await ses.setProxy({ mode: "direct" });
    await ses.closeAllConnections();
}

/**
 * Ask the geo providers, through `ses`, where its traffic appears to come from.
 * Resolves with the first provider that reports a location, or `null`. Never
 * rejects — a dead provider is skipped.
 */
export async function lookupGeo(ses: Session): Promise<Partial<EgressIpInfo> | null> {
    for (const url of GEO_URLS) {
        try {
            const res = await ses.fetch(url, {
                cache: "no-store",
                signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
            });
            if (!res.ok) continue;
            const data = await res.json() as Record<string, unknown>;
            const geo = normalizeGeo(data);
            if (!geo) continue;
            geo.geoSource = new URL(url).hostname;
            return geo;
        } catch {
            // Try the next provider.
        }
    }
    return null;
}

/** Read `key` from an untrusted JSON object, but only when it is a non-empty string. */
function str(data: Record<string, unknown>, key: string): string | undefined {
    const value = data[key];
    return typeof value === "string" && value ? value : undefined;
}

/**
 * Fold one geo provider's response into `EgressIpInfo` fields. Handles the two
 * shapes we call: ipinfo.io (`ip`/`city`/`region`/`country`/`org`, country as a
 * 2-letter code) and freeipapi.com (`ipAddress`/`cityName`/`regionName`/
 * `countryName`, country as a full name).
 *
 * Returns null when the payload carries no location at all, so the caller falls
 * through to the next provider instead of stopping on an empty answer.
 */
function normalizeGeo(data: Record<string, unknown>): Partial<EgressIpInfo> | null {
    const geo: Partial<EgressIpInfo> = {
        ip: str(data, "ip") ?? str(data, "ipAddress"),
        city: str(data, "city") ?? str(data, "cityName"),
        region: str(data, "region") ?? str(data, "regionName"),
        country: str(data, "country") ?? str(data, "countryName"),
        org: str(data, "org"),
    };
    if (!geo.city && !geo.region && !geo.country) return null;
    return geo;
}
