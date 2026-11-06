/** Exact public-looking DNS names accepted for privileged extension fetch grants. */
export function isSiteExtensionFetchHost(host: unknown): host is string {
    if (typeof host !== "string" || host.length > 253 || host !== host.toLowerCase()
        || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".")) return false;
    if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host)
        || host.split(".").some(label => label.length > 63)) return false;
    try {
        const url = new URL(`https://${host}`);
        return url.hostname === host && !/^\d+(?:\.\d+)*$/.test(host);
    } catch { return false; }
}

export function validateSiteExtensionFetchHosts(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || value.length > 32 || !value.every(isSiteExtensionFetchHost)) return undefined;
    return [...new Set(value)];
}
