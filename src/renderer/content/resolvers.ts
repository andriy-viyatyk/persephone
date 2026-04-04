import { app } from "../api/app";
import { OpenContentEvent } from "../api/events/events";
import { editorRegistry } from "../editors/registry";
import { isArchivePath, parseArchivePath } from "../core/utils/file-path";
import { createPipeFromDescriptor } from "./registry";
import { resolveUrlToPipeDescriptor, isHttpUrl } from "./link-utils";

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
    if (isArchivePath(url)) {
        const { innerPath } = parseArchivePath(url);
        return innerPath;
    }

    // HTTP/HTTPS URL: extract last pathname segment (before query string)
    if (isHttpUrl(url)) {
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
 * - httpResolver registered after → runs first (matches http/https URLs)
 *
 * Call during app bootstrap, before scripts load.
 */
export function registerResolvers(): void {
    // File resolver — fallback, handles plain file paths and virtual paths (tree-category://)
    app.events.openLink.subscribe(async (event) => {
        // Skip HTTP URLs — handled by HTTP resolver
        if (isHttpUrl(event.url)) return;

        const pipeDescriptor = resolveUrlToPipeDescriptor(event.url);
        if (!pipeDescriptor) {
            // Virtual paths (tree-category://, etc.) don't resolve to a pipe
            // but still need to flow through openContent for page creation.
            // Create a placeholder file pipe — ExplorerFolderEditor uses the explorer's treeProvider, not the pipe.
            if (event.url.includes("://")) {
                const target = event.target || "monaco";
                const placeholder = createPipeFromDescriptor({
                    provider: { type: "file", config: { path: event.url } },
                    transformers: [],
                });
                await app.events.openContent.sendAsync(
                    new OpenContentEvent(placeholder, target, event.metadata),
                );
                event.handled = true;
            }
            return;
        }

        // Resolve target editor if not already specified
        const target = event.target
            || editorRegistry.resolveId(extractEffectivePath(event.url))
            || "monaco";

        const pipe = createPipeFromDescriptor(pipeDescriptor);

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
    // Extension map determines which editor handles each URL.

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

        const metadata = event.metadata;
        const openInBrowser = event.target === "browser";
        const effectivePath = extractEffectivePath(event.url);
        const ext = effectivePath.includes(".")
            ? effectivePath.slice(effectivePath.lastIndexOf(".")).toLowerCase()
            : "";
        let mapping = ext ? httpContentExtensions[ext] : undefined;

        // For cURL/fetch requests without file extension: use Accept header to pick editor
        if (!mapping && metadata?.headers) {
            const accept = metadata.headers["accept"] || metadata.headers["Accept"] || "";
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

        if (openInBrowser || !mapping) {
            // No recognized extension or explicit browser target — open in browser tab
            const { settings } = await import("../api/settings");
            const behavior = settings.get("link-open-behavior");
            if (behavior === "internal-browser" || openInBrowser) {
                const { pagesModel } = await import("../api/pages");
                await pagesModel.lifecycle.openUrlInBrowserTab(event.url, {
                    external: openInBrowser,
                });
            } else {
                const { shell } = await import("../api/shell");
                shell.openExternal(event.url);
            }
            event.handled = true;
            return;
        }

        // Recognized extension — open as content via pipe
        const target = event.target || mapping.editor;

        const pipeDescriptor = resolveUrlToPipeDescriptor(event.url, event.metadata);
        if (!pipeDescriptor) return;
        const pipe = createPipeFromDescriptor(pipeDescriptor);

        await app.events.openContent.sendAsync(
            new OpenContentEvent(pipe, target, event.metadata)
        );
        event.handled = true;
    });
}
