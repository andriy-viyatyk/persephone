import { app } from "../api/app";
import { OpenContentEvent } from "../api/events/events";
import { editorRegistry } from "../editors/registry";
import { FileProvider } from "./providers/FileProvider";
import { HttpProvider } from "./providers/HttpProvider";
import { ZipTransformer } from "./transformers/ZipTransformer";
import { ContentPipe } from "./ContentPipe";

/**
 * Extract the effective path from a URL for editor resolution.
 * The effective path is the portion that carries the file extension,
 * which is passed to editorRegistry.resolve() for editor matching.
 *
 * - Archive paths ("C:\docs.zip!data/report.grid.json") → inner path after "!"
 * - HTTP URLs ("https://api.com/data.json?token=x") → pathname last segment
 * - Plain file paths → as-is
 */
export function extractEffectivePath(url: string): string {
    // Archive path: return inner path after "!"
    const bangIndex = url.indexOf("!");
    if (bangIndex >= 0) {
        return url.slice(bangIndex + 1);
    }

    // HTTP/HTTPS URL: extract last pathname segment (before query string)
    if (url.startsWith("http://") || url.startsWith("https://")) {
        try {
            const parsed = new URL(url);
            return parsed.pathname.split("/").pop() || "";
        } catch {
            return "";
        }
    }

    // Plain file path: as-is
    return url;
}

/**
 * Register Layer 2 resolvers on openLink.
 *
 * Registration order matters (LIFO execution):
 * - fileResolver registered first → runs last (fallback)
 * - Future resolvers (HTTP in US-270) register after and run first
 *
 * Call during app bootstrap, before scripts load.
 */
function isHttpUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
}

export function registerResolvers(): void {
    // File resolver — fallback, handles plain file paths
    app.events.openLink.subscribe(async (event) => {
        // Skip HTTP URLs — handled by HTTP resolver
        if (isHttpUrl(event.url)) return;
        // Resolve target editor if not already specified
        const target = event.target
            || editorRegistry.resolveId(extractEffectivePath(event.url))
            || "monaco";

        // Build provider and pipe (detect archive paths with "!")
        let pipe: ContentPipe;
        const bangIndex = event.url.indexOf("!");
        if (bangIndex >= 0) {
            const archivePath = event.url.slice(0, bangIndex);
            const entryPath = event.url.slice(bangIndex + 1);
            pipe = new ContentPipe(
                new FileProvider(archivePath),
                [new ZipTransformer(entryPath)],
            );
        } else {
            pipe = new ContentPipe(new FileProvider(event.url));
        }

        // Fire Layer 3
        await app.events.openContent.sendAsync(
            new OpenContentEvent(pipe, target, event.metadata)
        );
        event.handled = true;
    });

    // HTTP resolver — handles http:// and https:// URLs.
    // URLs with recognized text extensions → open as content via HttpProvider.
    // Everything else → open in browser tab.
    //
    // Extension map is self-contained — does not rely on editor registry.
    // Only text-based content is supported (Monaco editor). Page-editors
    // (image, PDF) can't handle HTTP sources yet (US-274).

    /** Maps file extensions to { editor, language? } for HTTP content opening. */
    const httpContentExtensions: Record<string, { editor: string }> = {
        // Programming languages → Monaco
        ".js": { editor: "monaco" }, ".mjs": { editor: "monaco" }, ".cjs": { editor: "monaco" },
        ".ts": { editor: "monaco" }, ".mts": { editor: "monaco" }, ".cts": { editor: "monaco" },
        ".jsx": { editor: "monaco" }, ".tsx": { editor: "monaco" },
        ".json": { editor: "monaco" }, ".jsonc": { editor: "monaco" }, ".jsonl": { editor: "monaco" },
        ".css": { editor: "monaco" }, ".scss": { editor: "monaco" }, ".less": { editor: "monaco" },
        ".xml": { editor: "monaco" }, ".xsl": { editor: "monaco" }, ".xslt": { editor: "monaco" }, ".xsd": { editor: "monaco" },
        ".yaml": { editor: "monaco" }, ".yml": { editor: "monaco" },
        ".toml": { editor: "monaco" },
        ".ini": { editor: "monaco" }, ".cfg": { editor: "monaco" }, ".conf": { editor: "monaco" },
        ".sh": { editor: "monaco" }, ".bash": { editor: "monaco" }, ".zsh": { editor: "monaco" },
        ".bat": { editor: "monaco" }, ".cmd": { editor: "monaco" },
        ".ps1": { editor: "monaco" },
        ".py": { editor: "monaco" },
        ".rb": { editor: "monaco" },
        ".go": { editor: "monaco" },
        ".rs": { editor: "monaco" },
        ".java": { editor: "monaco" },
        ".kt": { editor: "monaco" },
        ".swift": { editor: "monaco" },
        ".c": { editor: "monaco" }, ".h": { editor: "monaco" },
        ".cpp": { editor: "monaco" }, ".cc": { editor: "monaco" }, ".cxx": { editor: "monaco" }, ".hpp": { editor: "monaco" },
        ".cs": { editor: "monaco" },
        ".php": { editor: "monaco" },
        ".r": { editor: "monaco" },
        ".lua": { editor: "monaco" },
        ".sql": { editor: "monaco" },
        ".graphql": { editor: "monaco" }, ".gql": { editor: "monaco" },
        ".proto": { editor: "monaco" },
        // Markup / data → Monaco
        ".md": { editor: "monaco" }, ".markdown": { editor: "monaco" },
        ".csv": { editor: "monaco" },
        ".svg": { editor: "monaco" },
        ".txt": { editor: "monaco" },
        ".log": { editor: "monaco" },
        ".env": { editor: "monaco" },
        ".dockerfile": { editor: "monaco" },
        // Images → Image viewer
        ".png": { editor: "image-view" },
        ".jpg": { editor: "image-view" }, ".jpeg": { editor: "image-view" },
        ".gif": { editor: "image-view" },
        ".webp": { editor: "image-view" },
        ".bmp": { editor: "image-view" },
        ".ico": { editor: "image-view" },
        // PDF → PDF viewer
        ".pdf": { editor: "pdf-view" },
    };

    app.events.openLink.subscribe(async (event) => {
        if (!isHttpUrl(event.url)) return;

        const metadata = event.metadata as Record<string, unknown> | undefined;
        const forceBrowser = metadata?.forceBrowser as boolean | undefined;
        const effectivePath = extractEffectivePath(event.url);
        const ext = effectivePath.includes(".")
            ? effectivePath.slice(effectivePath.lastIndexOf(".")).toLowerCase()
            : "";
        let mapping = ext ? httpContentExtensions[ext] : undefined;

        // For cURL/fetch requests without file extension: use Accept header to pick editor
        if (!mapping && metadata?.headers) {
            const headers = metadata.headers as Record<string, string>;
            const accept = headers["accept"] || headers["Accept"] || "";
            if (accept.includes("json")) mapping = { editor: "monaco" };
            else if (accept.includes("xml")) mapping = { editor: "monaco" };
            else if (accept.includes("css")) mapping = { editor: "monaco" };
            else if (accept.includes("javascript")) mapping = { editor: "monaco" };
            else if (accept.includes("image/")) mapping = { editor: "image-view" };
            else if (accept.includes("pdf")) mapping = { editor: "pdf-view" };
            else if (accept.includes("text/") || accept.includes("*/*")) mapping = { editor: "monaco" };
        }

        // If headers present (cURL/fetch) but still no mapping — default to Monaco plaintext
        if (!mapping && metadata?.headers) {
            mapping = { editor: "monaco" };
        }

        if (forceBrowser || !mapping) {
            // No recognized extension or forced browser — open in browser tab
            const { settings } = await import("../api/settings");
            const behavior = settings.get("link-open-behavior");
            if (behavior === "internal-browser" || forceBrowser) {
                const { pagesModel } = await import("../api/pages");
                await pagesModel.lifecycle.openUrlInBrowserTab(event.url, {
                    external: !!forceBrowser,
                });
            } else {
                const { shell } = await import("../api/shell");
                shell.openExternal(event.url);
            }
            event.handled = true;
            return;
        }

        // Recognized extension — open as content via HttpProvider
        const target = event.target || mapping.editor;
        const httpOptions = {
            method: metadata?.method as string | undefined,
            headers: metadata?.headers as Record<string, string> | undefined,
            body: metadata?.body as string | undefined,
        };

        let pipe: ContentPipe;
        const bangIndex = event.url.indexOf("!");
        if (bangIndex >= 0) {
            const httpUrl = event.url.slice(0, bangIndex);
            const entryPath = event.url.slice(bangIndex + 1);
            pipe = new ContentPipe(
                new HttpProvider(httpUrl, httpOptions),
                [new ZipTransformer(entryPath)],
            );
        } else {
            pipe = new ContentPipe(new HttpProvider(event.url, httpOptions));
        }

        await app.events.openContent.sendAsync(
            new OpenContentEvent(pipe, target, event.metadata)
        );
        event.handled = true;
    });
}
