export const PERSEPHONE_GUIDE_PREFIX = "persephone-guide://";

export interface ParsedGuideUrl {
    readonly path: string;
    readonly url: string;
    readonly fragment?: string;
}

/** Whether a value is a safe, corpus-relative guide path without `.md`. */
export function isCanonicalGuidePath(path: string): boolean {
    if (!isSafeGuidePath(path) || path.toLowerCase().endsWith(".md")) return false;
    return true;
}

/** Whether a value contains only safe corpus-relative path segments. */
export function isSafeGuidePath(path: string): boolean {
    if (!path || path.includes("\\") || path.includes("?") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
    const segments = path.split("/");
    return segments.every(segment => segment !== "" && segment !== "." && segment !== "..");
}

/** Build the stable, fragment-free URL for a guide corpus path. */
export function guideUrl(path: string): string {
    return `${PERSEPHONE_GUIDE_PREFIX}${path}`;
}

/**
 * Parse and validate a `persephone-guide://` URL.
 *
 * Guide paths are deliberately not passed through `URL`: its host/path split
 * would make corpus paths beginning with a directory ambiguous. The scheme is
 * an application identity, so the text after the prefix is the corpus path.
 */
export function parseGuideUrl(value: string): ParsedGuideUrl | undefined {
    if (!value.startsWith(PERSEPHONE_GUIDE_PREFIX)) return undefined;

    const hashIndex = value.indexOf("#");
    const rawPath = hashIndex < 0
        ? value.slice(PERSEPHONE_GUIDE_PREFIX.length)
        : value.slice(PERSEPHONE_GUIDE_PREFIX.length, hashIndex);
    if (!isCanonicalGuidePath(rawPath)) return undefined;

    if (hashIndex < 0) return { path: rawPath, url: guideUrl(rawPath) };

    let fragment: string;
    try {
        fragment = decodeURIComponent(value.slice(hashIndex + 1));
    } catch {
        return undefined;
    }
    return {
        path: rawPath,
        url: guideUrl(rawPath),
        ...(fragment ? { fragment } : {}),
    };
}

/**
 * Resolve a relative Markdown href within a guide corpus.
 *
 * The result is a guide URL when path math is valid. Page existence is an
 * asynchronous index concern and is intentionally left to the pipeline
 * resolver, so this function remains usable by the synchronous HAST pass.
 */
export function resolveGuideHref(fromGuidePath: string, href: string): string | undefined {
    if (!isCanonicalGuidePath(fromGuidePath) || !href) return undefined;

    let decodedHref: string;
    try {
        decodedHref = decodeURIComponent(href);
    } catch {
        return undefined;
    }

    const hashIndex = decodedHref.indexOf("#");
    const pathPart = hashIndex < 0 ? decodedHref : decodedHref.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? "" : decodedHref.slice(hashIndex + 1);
    if (pathPart === "" && hashIndex < 0) return undefined;
    if (isAbsoluteGuideHref(pathPart) || pathPart.includes("\\") || pathPart.includes("?")) return undefined;

    const baseSegments = pathPart === "" ? fromGuidePath.split("/") : fromGuidePath.split("/").slice(0, -1);
    if (pathPart !== "") {
        for (const segment of pathPart.split("/")) {
            if (segment === "" || segment === ".") continue;
            if (segment === "..") {
                if (baseSegments.length === 0) return undefined;
                baseSegments.pop();
                continue;
            }
            baseSegments.push(segment);
        }
    }

    const path = baseSegments.join("/");
    const canonicalPath = path.endsWith(".md") ? path.slice(0, -3) : path;
    if (!isCanonicalGuidePath(canonicalPath)) return undefined;
    return `${guideUrl(canonicalPath)}${fragment ? `#${fragment}` : ""}`;
}

function isAbsoluteGuideHref(value: string): boolean {
    return value.startsWith("/")
        || value.startsWith("\\")
        || /^[A-Za-z]:[/\\]/.test(value)
        || /^[a-z][a-z\d+.-]*:/i.test(value)
        || value.startsWith("//");
}
