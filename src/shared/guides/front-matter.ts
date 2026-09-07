import type { GuideAudience, GuideFrontMatter } from "./index";

interface ParsedGuideFile {
    readonly frontMatter: GuideFrontMatter;
    readonly content: string;
}

const AUDIENCES = new Set<GuideAudience>(["user", "agent", "both"]);

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

    const values: Partial<Record<"title" | "audience" | "summary" | "editorId", string>> = {};
    const keys = new Set<string>();
    for (const line of lines.slice(1, closingIndex)) {
        const match = line.match(/^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/);
        if (!match || keys.has(match[1])) return fallback;
        keys.add(match[1]);

        const value = parseValue(match[1], match[2]);
        if (value === undefined) return fallback;
        values[match[1] as "title" | "audience" | "summary" | "editorId"] = value;
    }

    if (!values.title || !values.summary || !values.audience || !AUDIENCES.has(values.audience as GuideAudience)) {
        return fallback;
    }

    const frontMatter: GuideFrontMatter = {
        title: values.title,
        audience: values.audience as GuideAudience,
        summary: values.summary,
        ...(values.editorId === undefined ? {} : { editorId: values.editorId }),
    };

    return {
        frontMatter,
        content: contentAfterLine(text, lines, closingIndex),
    };
}

function parseValue(key: string, rawValue: string | undefined): string | undefined {
    if (rawValue === undefined) return undefined;
    if (key !== "title" && key !== "summary" && key !== "editorId" && key !== "audience") return undefined;

    if (key === "audience") {
        const quoted = rawValue.match(/^"([^\"]*)"$/);
        return quoted?.[1] ?? (/^(?:user|agent|both)$/.test(rawValue) ? rawValue : undefined);
    }

    const quoted = rawValue.match(/^"([^\"]*)"$/);
    return quoted?.[1];
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
