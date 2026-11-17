export interface TemporarySiteExtensionHost {
    readonly host: string;
    readonly hostname: string;
    readonly explicitPort?: number;
    readonly key: string;
}

export interface TemporarySiteExtensionMatch<T> {
    readonly entry: T;
    readonly explicitPort: boolean;
}

/** Parse a bare host authority while preserving whether its port was written. */
export function parseTemporarySiteExtensionHost(value: unknown): TemporarySiteExtensionHost {
    if (typeof value !== "string" || !value || value.length > 259 || value.trim() !== value
        || /[\s/@?#*\\]/u.test(value) || value.includes("://")) {
        throw new Error("Host must be a bare hostname or host:port authority.");
    }

    let hostPart = value;
    let portText: string | undefined;
    if (value.startsWith("[")) {
        const close = value.indexOf("]");
        if (close < 0) throw new Error("Host contains an invalid IPv6 address.");
        hostPart = value.slice(0, close + 1);
        const suffix = value.slice(close + 1);
        if (suffix) {
            if (!suffix.startsWith(":")) throw new Error("Host must not include a path or other URL parts.");
            portText = suffix.slice(1);
        }
    } else {
        const firstColon = value.indexOf(":");
        if (firstColon >= 0) {
            if (firstColon !== value.lastIndexOf(":")) throw new Error("IPv6 hosts must be enclosed in brackets.");
            hostPart = value.slice(0, firstColon);
            portText = value.slice(firstColon + 1);
        }
    }
    if (!hostPart || hostPart.length > 253) throw new Error("Host must be between 1 and 253 characters.");

    let explicitPort: number | undefined;
    if (portText !== undefined) {
        if (!/^[0-9]+$/u.test(portText)) throw new Error("Host port must be an integer from 1 to 65535.");
        explicitPort = Number(portText);
        if (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535) {
            throw new Error("Host port must be an integer from 1 to 65535.");
        }
    }

    let parsed: URL;
    try { parsed = new URL(`https://${hostPart}`); }
    catch { throw new Error("Host must contain a valid hostname or IPv6 address."); }
    if (parsed.username || parsed.password || parsed.hostname === "" || parsed.hostname.includes("%")
        || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.port) {
        throw new Error("Host must contain only a valid hostname or IPv6 address.");
    }
    const hostname = parsed.hostname.toLowerCase();
    const host = explicitPort === undefined ? hostname : `${hostname}:${explicitPort}`;
    return { host, hostname, explicitPort, key: host };
}

export function matchTemporarySiteExtensionHost<T extends { host: string }>(url: URL, entries: Iterable<T>): TemporarySiteExtensionMatch<T> | undefined {
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const hostname = url.hostname.toLowerCase();
    const effectivePort = Number(url.port || (url.protocol === "https:" ? "443" : "80"));
    let noPortMatch: T | undefined;
    for (const entry of entries) {
        let parsed: TemporarySiteExtensionHost;
        try { parsed = parseTemporarySiteExtensionHost(entry.host); } catch { continue; }
        if (parsed.hostname !== hostname) continue;
        if (parsed.explicitPort !== undefined && parsed.explicitPort === effectivePort) {
            return { entry, explicitPort: true };
        }
        if (parsed.explicitPort === undefined && effectivePort === (url.protocol === "https:" ? 443 : 80)) noPortMatch = entry;
    }
    return noPortMatch ? { entry: noPortMatch, explicitPort: false } : undefined;
}
