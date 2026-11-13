import * as cheerio from "cheerio";
import type { WebContents, WebFrameMain } from "electron";

interface BrowserDomRegistration {
    webContents: WebContents;
}

/** Compare two URLs ignoring protocol, trailing slashes, and fragment. */
function urlsMatch(a: string, b: string): boolean {
    try {
        const urlA = new URL(a, "http://base");
        const urlB = new URL(b, "http://base");
        const normalize = (u: URL) =>
            (u.hostname + u.pathname).replace(/\/+$/, "") + u.search;
        return normalize(urlA) === normalize(urlB);
    } catch {
        return false;
    }
}

/**
 * URLs of every resource the page's frames loaded, read from each frame's Resource Timing
 * buffer. Unlike the network log, this includes HTTP-cache hits and requests made before the
 * tab registered, and it sees fonts that stylesheets pull in.
 */
export async function collectLoadedResources(reg: BrowserDomRegistration | undefined): Promise<string[]> {
    if (!reg || reg.webContents.isDestroyed()) return [];
    const urls = new Set<string>();
    for (const frame of reg.webContents.mainFrame.framesInSubtree) {
        try {
            const names = await frame.executeJavaScript(
                "performance.getEntriesByType('resource').map((entry) => entry.name)",
            ) as unknown;
            if (Array.isArray(names)) {
                for (const name of names) if (typeof name === "string") urls.add(name);
            }
        } catch {
            // Frame destroyed or navigated away mid-collection — skip it.
        }
    }
    return [...urls];
}

interface FrameResult {
    url: string;
    name: string;
    html: string;
}

/** Inject iframe DOM content inside an <iframe> element. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectIframeContent($: cheerio.CheerioAPI, el: any, result: FrameResult) {
    const $el = $(el);
    const comment = `<!-- IFRAME DOM: src="${result.url}"${result.name ? ` name="${result.name}"` : ""} -->`;
    $el.attr("data-dom-injected", "true");
    $el.html(comment + "\n" + result.html);
}

/**
 * Collect the full DOM from a registered webview, including all iframe content.
 * Uses Electron's WebFrameMain API to iterate all frames in the subtree and
 * cheerio to inject each iframe's DOM into the corresponding <iframe> element.
 */
export async function collectDom(reg: BrowserDomRegistration | undefined): Promise<string> {
    if (!reg || reg.webContents.isDestroyed()) return "";

    const mainFrame = reg.webContents.mainFrame;

    // Collect DOM from main frame
    const mainHtml = await mainFrame.executeJavaScript(
        "document.documentElement.outerHTML",
    ) as string;

    // Collect DOM from all child frames
    const childFrames = mainFrame.framesInSubtree.filter(
        (f: WebFrameMain) => f !== mainFrame,
    );
    if (childFrames.length === 0) return mainHtml;

    // Collect each frame's DOM
    const frameResults: FrameResult[] = [];
    for (const frame of childFrames) {
        try {
            const frameHtml = await frame.executeJavaScript(
                "document.documentElement.outerHTML",
            ) as string;
            frameResults.push({
                url: frame.url || "",
                name: frame.name || "",
                html: frameHtml,
            });
        } catch {
            // Frame may have been destroyed or navigated away — skip
        }
    }

    if (frameResults.length === 0) return mainHtml;

    // Use cheerio to find <iframe> elements and inject content
    const $ = cheerio.load(mainHtml, { xml: false });
    const unmatched: FrameResult[] = [];

    for (const result of frameResults) {
        let matched = false;

        // Try to match by src attribute
        if (result.url && result.url !== "about:blank") {
            $("iframe").each((_i, el) => {
                if (matched) return;
                const src = $(el).attr("src") || "";
                if (
                    src &&
                    !$(el).attr("data-dom-injected") &&
                    (result.url.includes(src) ||
                        src.includes(result.url) ||
                        urlsMatch(src, result.url))
                ) {
                    injectIframeContent($, el, result);
                    matched = true;
                    return false; // break .each()
                }
            });
        }

        // Try to match by name attribute
        if (!matched && result.name) {
            $("iframe").each((_i, el) => {
                if (matched) return;
                const name = $(el).attr("name") || "";
                if (name && name === result.name && !$(el).attr("data-dom-injected")) {
                    injectIframeContent($, el, result);
                    matched = true;
                    return false;
                }
            });
        }

        if (!matched) {
            unmatched.push(result);
        }
    }

    // For unmatched frames, try matching by index order
    if (unmatched.length > 0) {
        const emptyIframes = $("iframe").filter((_i, el) => {
            return !$(el).attr("data-dom-injected");
        });

        for (let i = 0; i < unmatched.length && i < emptyIframes.length; i++) {
            injectIframeContent($, emptyIframes[i], unmatched[i]);
        }

        // Any remaining unmatched frames: append at end of body
        for (let i = emptyIframes.length; i < unmatched.length; i++) {
            const result = unmatched[i];
            const comment = `<!-- UNMATCHED IFRAME: src="${result.url}"${result.name ? ` name="${result.name}"` : ""} -->`;
            $("body").append("\n" + comment + "\n" + result.html + "\n");
        }
    }

    return $.html();
}
