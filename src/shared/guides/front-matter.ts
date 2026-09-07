import type { GuideAudience, GuideFrontMatter } from "./index";

interface ParsedGuideFile {
    readonly frontMatter: GuideFrontMatter;
    readonly content: string;
}

const AUDIENCES = new Set<GuideAudience>(["user", "agent", "both"]);
const GUIDE_KEYS = new Set(["title", "audience", "summary", "screen", "editorId"]);

type GuideMetadataKey = "title" | "audience" | "summary" | "screen" | "editorId";
type GuideValue = string | readonly string[];

export function parseGuideFile(relativePath: string, text: string): ParsedGuideFile {
    const lines = text.split(/\r?\n/);
    const fallback: ParsedGuideFile = {
        frontMatter: {
            title: filenameStem(relativePath),
            audience: "both",
            summary: "",
        },
        content: text,
    };

    if (lines[0] !== "---") return fallback;

    const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
    if (closingIndex === -1) return fallback;

    const values: Partial<Record<GuideMetadataKey, GuideValue>> = {};
    const keys = new Set<string>();
    for (const line of lines.slice(1, closingIndex)) {
        const match = line.match(/^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/);
        if (!match) return fallback;
        const key = match[1];
        if (!GUIDE_KEYS.has(key)) continue;
        if (keys.has(key)) return fallback;
        keys.add(key);

        const value = parseValue(key as GuideMetadataKey, match[2]);
        if (value === undefined) return fallback;
        values[key as GuideMetadataKey] = value;
    }

    const title = values.title;
    const summary = values.summary;
    const audience = values.audience;
    if (typeof title !== "string" || !title
        || typeof summary !== "string" || !summary
        || typeof audience !== "string" || !AUDIENCES.has(audience as GuideAudience)) {
        return fallback;
    }

    const frontMatter: GuideFrontMatter = {
        title,
        audience: audience as GuideAudience,
        summary,
        ...(typeof values.screen === "string" ? { screen: values.screen } : {}),
        ...(values.editorId === undefined ? {} : { editorId: values.editorId }),
    };

    return {
        frontMatter,
        content: contentAfterLine(text, lines, closingIndex),
    };
}

function parseValue(key: GuideMetadataKey, rawValue: string | undefined): GuideValue | undefined {
    if (rawValue === undefined) return undefined;

    if (key === "audience") {
        const quoted = rawValue.match(/^"([^\"]*)"$/);
        return quoted?.[1] ?? (/^(?:user|agent|both)$/.test(rawValue) ? rawValue : undefined);
    }

    if (key === "editorId") {
        const quoted = rawValue.match(/^"([^\"]*)"$/);
        if (quoted) return quoted[1] || undefined;

        const list = rawValue.match(/^\[(.*)\]$/)?.[1];
        if (list === undefined) return undefined;
        const members = list.split(",").map(member => member.trim().match(/^"([^\"]*)"$/)?.[1]);
        return members.length > 0 && members.every((member): member is string => member !== undefined && member.length > 0)
            ? members
            : undefined;
    }

    const quoted = rawValue.match(/^"([^\"]*)"$/);
    return quoted?.[1] || undefined;
}

function contentAfterLine(text: string, lines: readonly string[], lineIndex: number): string {
    let currentLine = 0;
    let contentStart = text.length;
    for (let index = 0; index < text.length; index++) {
        if (currentLine === lineIndex + 1) {
            contentStart = index;
            break;
        }
        if (text[index] === "\n") currentLine++;
    }

    if (lineIndex + 1 >= lines.length) return "";
    return text.slice(contentStart);
}

function filenameStem(relativePath: string): string {
    const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}
