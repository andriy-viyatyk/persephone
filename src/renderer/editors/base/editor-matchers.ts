import { EditorId } from "../../../shared/editor-ids";
import { InternalEditorIds } from "./editor-ids";
import type { EditorMatcher, Tier } from "./editorRegistry";
import { isGitRepoDir } from "./folder-markers";
import { fpBasename, fpExtname, isArchiveFile } from "../../core/utils/file-path";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import { settings } from "../../api/settings";

// Match tiers keep the existing score roles explicit; query ordering belongs to QUERY_RULES.
// Monaco's lowest switch-option tier.
export const MONACO_SWITCH: Tier = 0;
// Universal file-open fallback and Category View's folder fallback.
export const FILE_FALLBACK: Tier = 0;
// Language-based switch offer.
export const LANGUAGE_SWITCH: Tier = 10;
// Markdown's preferred file-open tier.
export const MARKDOWN_DEFAULT: Tier = 10;
// Filename-specific built-in editor claim and verified folder claim.
export const SPECIALIZED_FILE: Tier = 20;
// File Diff host offer when Git state is present.
export const FILE_DIFF_HOST: Tier = 25;
// Monaco's host-switch offer.
export const MONACO_HOST: Tier = 50;
// A host content marker detected after file and language rules make no claim.
export const CONTENT_DETECTED: Tier = 60;
// Exclusive binary viewer file claim.
export const EXCLUSIVE_FILE: Tier = 100;
// Category link pseudo-path claim.
export const PSEUDO_PATH: Tier = 200;

const matchesExtension = (fileName: string, extensions: string[]): boolean => {
    const lower = fileName.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext));
};

const matchesPattern = (fileName: string, pattern: RegExp): boolean =>
    pattern.test(fileName.toLowerCase());

// US-1930 owns moving the bundled Excalidraw claim into the board catalog.
const SPECIALIZED_JSON_PATTERNS = [/\.link\.json$/i, /\.excalidraw$/i];
const isSpecializedJson = (fileName?: string): boolean =>
    fileName ? SPECIALIZED_JSON_PATTERNS.some((pattern) => pattern.test(fileName)) : false;

const isMarkdownFile = (fileName: string): boolean => {
    const dot = fileName.lastIndexOf(".");
    return dot >= 0 && getLanguageByExtension(fileName.slice(dot))?.id === "markdown";
};

const hasFileExtension = (fileName?: string): boolean => Boolean(fileName && fpExtname(fileName));
const languageResult = (language: string, supported: string, tier?: Tier): ReturnType<NonNullable<EditorMatcher["language"]>> =>
    language === supported ? { valid: true, tier } : { valid: false };

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"];
const VIDEO_EXTENSIONS = [
    ".mp4", ".webm", ".ogg", ".m3u8", ".m3u", ".mp3", ".wav", ".aac",
    ".flac", ".m4a", ".wma", ".opus", ".avi", ".mkv", ".mov",
];

export const EDITOR_MATCHERS: Record<string, EditorMatcher> = {
    [EditorId.monaco]: {
        file: () => FILE_FALLBACK,
        language: () => ({ valid: true, tier: MONACO_SWITCH }),
        host: () => MONACO_HOST,
    },
    [EditorId.gridJson]: {
        file: (name) => matchesPattern(name, /\.grid\.json$/i) ? SPECIALIZED_FILE : undefined,
        language: (language, name) => languageResult(
            language,
            "json",
            isSpecializedJson(name) ? undefined : LANGUAGE_SWITCH,
        ),
    },
    [EditorId.gridCsv]: {
        file: (name) => matchesPattern(name, /\.grid\.csv$/i) ? SPECIALIZED_FILE : undefined,
        language: (language) => languageResult(language, "csv", LANGUAGE_SWITCH),
    },
    [EditorId.gridJsonl]: {
        file: (name) => matchesPattern(name, /\.grid\.jsonl$/i) ? SPECIALIZED_FILE : undefined,
        language: (language) => languageResult(language, "jsonl", LANGUAGE_SWITCH),
    },
    [EditorId.logView]: {
        file: (name) => matchesPattern(name, /\.log\.jsonl$/i) ? SPECIALIZED_FILE : undefined,
        language: (language, name) => languageResult(
            language,
            "jsonl",
            name && matchesPattern(name, /\.log\.jsonl$/i) ? LANGUAGE_SWITCH : undefined,
        ),
        content: (language, content) => language === "jsonl" && /"type"\s*:\s*"log\./.test(content),
    },
    [EditorId.mdView]: {
        file: (name) => isMarkdownFile(name) ? MARKDOWN_DEFAULT : undefined,
        language: (language) => languageResult(language, "markdown", LANGUAGE_SWITCH),
    },
    [EditorId.svgView]: {
        language: (language, name) => {
            const supported = language === "xml";
            const tier = (!!name && matchesExtension(name, [".svg"]))
                || (supported && !hasFileExtension(name))
                ? LANGUAGE_SWITCH
                : undefined;
            return { valid: supported, tier };
        },
    },
    [EditorId.htmlView]: {
        language: (language) => languageResult(language, "html", LANGUAGE_SWITCH),
    },
    [EditorId.mermaidView]: {
        language: (language) => languageResult(language, "mermaid", LANGUAGE_SWITCH),
    },
    [EditorId.linkView]: {
        file: (name) => matchesPattern(name, /\.link\.json$/i) ? SPECIALIZED_FILE : undefined,
        language: (language, name) => languageResult(
            language,
            "json",
            name && matchesPattern(name, /\.link\.json$/i) ? LANGUAGE_SWITCH : undefined,
        ),
        content: (language, content) => language === "json"
            && content.includes('"type"')
            && /"type"\s*:\s*"link-editor"/.test(content)
            && content.includes('"links"'),
    },
    [EditorId.imageView]: {
        file: (name) => matchesExtension(name, IMAGE_EXTENSIONS) ? EXCLUSIVE_FILE : undefined,
    },
    [EditorId.archiveView]: {
        file: (name) => isArchiveFile(name) ? EXCLUSIVE_FILE : undefined,
    },
    [EditorId.videoView]: {
        file: (name) => matchesExtension(name, VIDEO_EXTENSIONS) ? EXCLUSIVE_FILE : undefined,
    },
    [EditorId.categoryView]: {
        file: (name) => name.startsWith("tree-category://") ? PSEUDO_PATH : undefined,
        folder: () => FILE_FALLBACK,
    },
    [EditorId.gitTree]: {
        folder: (path) => isGitRepoDir(path) ? SPECIALIZED_FILE : undefined,
    },
    [EditorId.mnemeRoot]: {
        folder: (path) => fpBasename(path) === ".mneme" && !!settings.get("mneme.enabled")
            ? SPECIALIZED_FILE
            : undefined,
    },
    [EditorId.envVarsView]: {
        file: (name) => matchesPattern(name, /\.env\.json$/i) ? SPECIALIZED_FILE : undefined,
        language: (language, name) => languageResult(
            language,
            "json",
            name && matchesPattern(name, /\.env\.json$/i) ? LANGUAGE_SWITCH : undefined,
        ),
    },
    [InternalEditorIds.fileDiff]: {
        host: (host) => (host.state.get() as { gitRepo?: unknown }).gitRepo ? FILE_DIFF_HOST : undefined,
    },
};
