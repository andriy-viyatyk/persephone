/**
 * How the browser chrome shows a page's address: the URL bar's text and formatted rendering, its
 * security marker, and the origin named in host notices and prompts. A page controls its URL, so
 * every rule here is about not letting it look like something else.
 */

/** The URL without `user:password@`. A URL with no userinfo is returned unchanged. */
export function stripUrlUserinfo(url: string): string {
    if (!URL.canParse(url)) return url;
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
}

export type UrlSecurity = "secure" | "not-secure" | "neutral";

/** Chrome's "potentially trustworthy" loopback hosts, which it does not mark as not secure. */
function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]"
        || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * The marker the URL bar shows for a committed URL. `https:` is secure; `http:` is not secure
 * unless it is a loopback host. Error pages need no rule of their own: Persephone has no
 * certificate-error bypass, so an `https:` URL never commits content without a valid certificate,
 * and an error page is Chromium's own document.
 */
export function urlSecurity(url: string): UrlSecurity {
    if (!URL.canParse(url)) return "neutral";
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return "secure";
    if (parsed.protocol === "http:") return isLoopbackHost(parsed.hostname) ? "neutral" : "not-secure";
    return "neutral";
}

export interface UrlDisplayParts {
    /** `http://` or `https://`. */
    scheme: string;
    /** Host and port, punycode for international names, never userinfo. */
    host: string;
    /** Path, query and fragment; empty for the bare root. */
    rest: string;
}

/** The parts the unfocused URL bar draws separately, for `http(s):` URLs only. */
export function urlDisplayParts(url: string): UrlDisplayParts | undefined {
    if (!URL.canParse(url)) return undefined;
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    const rest = parsed.pathname + parsed.search + parsed.hash;
    return { scheme: `${parsed.protocol}//`, host: parsed.host, rest: rest === "/" ? "" : rest };
}

/** The origin a host notice or prompt names: `scheme://host` for web pages, the scheme otherwise. */
export function originLabel(url: string): string {
    if (!URL.canParse(url)) return "";
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return `${parsed.protocol}//${parsed.host}`;
    return parsed.protocol;
}
