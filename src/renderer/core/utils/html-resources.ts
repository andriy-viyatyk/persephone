import type { ILink } from "../../api/types/io.tree";

interface ExtractOptions {
    /** Base URL for resolving relative URLs. */
    baseUrl?: string;
}

/**
 * Parse HTML and extract resource URLs grouped by category.
 * Returns ILink[] suitable for app.pages.openLinks().
 *
 * Uses cheerio via require() — loaded at runtime from node_modules,
 * not bundled by Vite. Also available in user scripts.
 */
export function extractHtmlResources(html: string, options?: ExtractOptions): ILink[] {
    const cheerio = require("cheerio"); // eslint-disable-line @typescript-eslint/no-var-requires
    const $ = cheerio.load(html);
    const links: ILink[] = [];
    const seen = new Set<string>();

    const add = (category: string, href: string, title?: string) => {
        if (!href || href.startsWith("data:")) return;
        const resolved = resolveUrl(href.trim(), options?.baseUrl);
        if (!resolved || seen.has(resolved)) return;
        seen.add(resolved);
        links.push({
            title: title || urlBaseName(resolved) || resolved,
            href: resolved,
            category,
            tags: [] as string[],
            isDirectory: false,
        });
    };

    // Images
    $("img[src]").each((_: number, el: any) => add("Images", $(el).attr("src")!, $(el).attr("alt"))); // eslint-disable-line @typescript-eslint/no-explicit-any
    $("picture source[srcset]").each((_: number, el: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const first = $(el).attr("srcset")!.split(",")[0].trim().split(/\s+/)[0];
        add("Images", first);
    });
    $("input[type=image][src]").each((_: number, el: any) => add("Images", $(el).attr("src")!)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Scripts
    $("script[src]").each((_: number, el: any) => add("Scripts", $(el).attr("src")!)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Stylesheets
    $("link[rel=stylesheet][href]").each((_: number, el: any) => add("Stylesheets", $(el).attr("href")!)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Media
    $("video[src]").each((_: number, el: any) => add("Media", $(el).attr("src")!)); // eslint-disable-line @typescript-eslint/no-explicit-any
    $("audio[src]").each((_: number, el: any) => add("Media", $(el).attr("src")!)); // eslint-disable-line @typescript-eslint/no-explicit-any
    $("video source[src], audio source[src]").each((_: number, el: any) => add("Media", $(el).attr("src")!)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Fonts
    $("link[rel=preload][as=font][href]").each((_: number, el: any) => add("Fonts", $(el).attr("href")!)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Iframes
    $("iframe[src]").each((_: number, el: any) => add("Iframes", $(el).attr("src")!)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Favicons
    $("link[rel~=icon][href]").each((_: number, el: any) => add("Favicons", $(el).attr("href")!)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Links (external only — skip anchors and javascript:)
    $("a[href]").each((_: number, el: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const href = $(el).attr("href")!;
        if (href.startsWith("#") || href.startsWith("javascript:")) return;
        add("Links", href, $(el).text().trim() || undefined);
    });

    return links;
}

function resolveUrl(href: string, baseUrl?: string): string {
    if (!baseUrl) return href;
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return href;
    }
}

function urlBaseName(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const parts = pathname.split("/").filter(Boolean);
        return parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : "";
    } catch {
        // Not a valid URL — try simple path split
        const parts = url.split(/[/\\]/).filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : "";
    }
}
