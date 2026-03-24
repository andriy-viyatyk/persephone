import { fpDirname, fpResolve } from "./file-path";
const url = require("url");

/**
 * Resolves a link relative to a current file path.
 * Returns the original link for absolute URLs (http, https, file, mailto) and anchors (#).
 * For relative paths, resolves to an absolute file:// URL.
 */
export function resolveRelatedLink(currentFilePath?: string, link?: string): string {
    if (!currentFilePath || !link) return link || "";

    const lowerLink = link.toLowerCase();
    if (
        lowerLink.startsWith("http://") ||
        lowerLink.startsWith("https://") ||
        lowerLink.startsWith("file://") ||
        lowerLink.startsWith("mailto:") ||
        lowerLink.startsWith("#")
    ) {
        return link;
    }

    try {
        // Decode URL-encoded characters (e.g. %5C for backslashes from markdown parsers)
        const decoded = decodeURIComponent(link);

        // Strip fragment (#section) before resolving — otherwise it becomes part of the filename
        const hashIndex = decoded.indexOf("#");
        const pathPart = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded;
        const fragment = hashIndex >= 0 ? decoded.slice(hashIndex) : "";

        const currentDir = fpDirname(currentFilePath);
        const absolutePath = fpResolve(currentDir, pathPart);
        const fileUrl = url.pathToFileURL(absolutePath).href + fragment;
        return fileUrl;
    } catch {
        return link;
    }
}

/**
 * Checks whether a link is a local/relative file reference
 * (not an external URL, mailto, or anchor-only link).
 */
export function isLocalLink(link: string): boolean {
    const lower = link.toLowerCase();
    return !(
        lower.startsWith("http://") ||
        lower.startsWith("https://") ||
        lower.startsWith("file://") ||
        lower.startsWith("mailto:") ||
        lower.startsWith("#")
    );
}

/**
 * Resolves a relative link to an absolute file path (not a file:// URL).
 * Strips URL fragments (#section) before resolution.
 */
export function resolveRelativePath(currentFilePath: string, link: string): string {
    const linkWithoutFragment = link.split("#")[0];
    const currentDir = fpDirname(currentFilePath);
    return fpResolve(currentDir, linkWithoutFragment);
}
