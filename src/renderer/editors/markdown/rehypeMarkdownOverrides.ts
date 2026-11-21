import type { Element, Root, RootContent } from "hast";
import { resolveRelatedLink } from "../../core/utils/path-utils";
import { parseGuideUrl, resolveGuideHref } from "../../../shared/guides/guide-links";
import { isWebImageUrl } from "../../../shared/browser-navigation-policy";

interface RehypeMarkdownOverridesOptions {
    filePath?: string;
    wikiRoot?: string;
}

function decodeUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function iconPath(checked: boolean): Element {
    const children: Element[] = [
        {
            type: "element",
            tagName: "rect",
            properties: {
                x: 0.75,
                y: 0.75,
                width: 14.5,
                height: 14.5,
                rx: 3.25,
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.5,
            },
            children: [],
        },
    ];

    if (checked) {
        children.push({
            type: "element",
            tagName: "path",
            properties: {
                d: "M3.75 7.75L6.75 10.75L12.25 5.25",
                stroke: "currentColor",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                fill: "none",
            },
            children: [],
        });
    }

    return {
        type: "element",
        tagName: "svg",
        properties: {
            viewBox: "0 0 16 16",
            width: 14,
            height: 14,
        },
        children: [{
            type: "element",
            tagName: "g",
            properties: {},
            children,
        }],
    };
}

function rewriteLinkProperty(
    element: Element,
    property: "href" | "src",
    filePath: string | undefined,
    wikiRoot: string | undefined,
): void {
    const decoded = decodeUrl(element.properties?.[property]);
    if (decoded === undefined) return;
    element.properties ??= {};
    const guide = filePath ? parseGuideUrl(filePath) : undefined;
    element.properties[property] = guide
        ? resolveGuideHref(guide.path, decoded) ?? decoded
        : resolveRelatedLink(filePath, decoded, wikiRoot);
}

const WEB_DOCUMENT_RE = /^https?:\/\//i;

/**
 * An image in a Markdown document fetched from the web is page-chosen content drawn by the host
 * window: resolve it against the document URL and keep only web images. A `file:` or UNC source
 * would make the host open a local or SMB path on the document's behalf. Local documents keep
 * their local and UNC images.
 */
function rewriteWebDocumentImage(element: Element, documentUrl: string): void {
    // Raw, not decoded: the URL parser keeps the document's own percent-escapes intact.
    const src = element.properties?.src;
    if (typeof src !== "string") return;
    let resolved: string | undefined;
    try {
        resolved = new URL(src, documentUrl).href;
    } catch {
        resolved = undefined;
    }
    element.properties ??= {};
    if (resolved && isWebImageUrl(resolved)) element.properties.src = resolved;
    else delete element.properties.src;
}

function walk(node: Root | Element, options: RehypeMarkdownOverridesOptions): void {
    for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index] as RootContent;
        if (child.type !== "element") continue;

        const properties = child.properties ?? {};
        if (child.tagName === "input" && properties.type === "checkbox") {
            node.children[index] = iconPath(Boolean(properties.checked));
            continue;
        }

        if (child.tagName === "a") {
            rewriteLinkProperty(child, "href", options.filePath, options.wikiRoot);
        } else if (child.tagName === "img") {
            if (options.filePath && WEB_DOCUMENT_RE.test(options.filePath)) {
                rewriteWebDocumentImage(child, options.filePath);
            } else {
                rewriteLinkProperty(child, "src", options.filePath, options.wikiRoot);
            }
        }

        walk(child, options);
    }
}

/** Rewrite markdown-specific HAST without creating framework or DOM nodes. */
export function rehypeMarkdownOverrides(
    options: RehypeMarkdownOverridesOptions = {},
) {
    return (tree: Root): void => {
        walk(tree, options);
    };
}
