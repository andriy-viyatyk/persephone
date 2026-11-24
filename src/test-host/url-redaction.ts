export function redactUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "[redacted URL]";
        url.username = ""; url.password = ""; url.hash = "";
        const query = [...url.searchParams.entries()];
        url.search = "";
        for (const [key] of query) url.searchParams.append(key, "\u2026");
        return url.toString();
    } catch { return "[redacted URL]"; }
}
