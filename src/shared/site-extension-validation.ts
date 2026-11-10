const EXTENSION_ID_PATTERN = /^[a-z0-9-]+$/;

export function isValidSiteExtensionId(id: string): boolean {
    return EXTENSION_ID_PATTERN.test(id);
}

export function isExactSiteExtensionHost(value: unknown): value is string {
    if (typeof value !== "string" || !value || value !== value.toLowerCase()) return false;
    try {
        const parsed = new URL(`https://${value}`);
        return parsed.hostname === value
            && parsed.port === ""
            && parsed.username === ""
            && parsed.password === ""
            && parsed.pathname === "/"
            && parsed.search === ""
            && parsed.hash === "";
    } catch {
        return false;
    }
}

