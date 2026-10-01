import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import { schemeOf } from "../../content/scheme-registry";

const allowedHrefSchemes = new Set([
    "http",
    "https",
    "mailto",
    "tel",
    "file",
    "mneme",
    "persephone-guide",
    "persephone-board",
]);

const allowedSrcSchemes = new Set([
    "http",
    "https",
    "file",
    "mneme",
    "blob",
]);

function normalizeMarkdownUrl(value: string): string {
    return Array.from(value)
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code > 0x20 && code !== 0x7f;
        })
        .join("");
}

/** Check URL values after Markdown's link overrides have rewritten them. */
export function isSafeMarkdownUrl(value: string, kind: "href" | "src"): boolean {
    const normalized = normalizeMarkdownUrl(value);
    const scheme = schemeOf(normalized);
    if (!scheme || scheme.length === 1) return true;

    if (kind === "href") return allowedHrefSchemes.has(scheme);
    if (allowedSrcSchemes.has(scheme)) return true;
    return scheme === "data" && normalized.toLowerCase().startsWith("data:image/");
}

export const BLOCKED_MARKDOWN_TAGS: ReadonlySet<string> = new Set([
    "script",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "base",
    "meta",
    "link",
    "style",
    "form",
    "template",
    "noscript",
    "portal",
    "foreignobject",
    "animate",
    "set",
    "animatemotion",
    "animatetransform",
    "use",
]);

function isNameAttribute(attribute: unknown): boolean {
    return Array.isArray(attribute) ? attribute[0] === "name" : attribute === "name";
}

const baseSchema: Options = defaultSchema;
const attributes: NonNullable<Options["attributes"]> = {};
for (const [tagName, allowedAttributes] of Object.entries(baseSchema.attributes ?? {})) {
    attributes[tagName] = allowedAttributes.filter((attribute) => !isNameAttribute(attribute));
}

export const markdownSanitizeSchema: Options = {
    ...baseSchema,
    attributes: {
        ...attributes,
        "*": [
            ...(baseSchema.attributes?.["*"] ?? []).filter((attribute) => !isNameAttribute(attribute)),
            "className",
            // Inline styles support existing notes; fixed-position overlays remain a UI-redress risk.
            "style",
        ],
    },
    clobber: [],
    clobberPrefix: "",
    protocols: {},
    strip: [...(baseSchema.strip ?? []), "style"],
    tagNames: [
        ...(baseSchema.tagNames ?? []),
        "figure",
        "figcaption",
        "mark",
        "u",
        "small",
        "abbr",
        "center",
    ],
};

export { rehypeSanitize };
