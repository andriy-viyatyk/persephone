import { decodeFolderEditorLink } from "./folder-editor-link";
import type { ILinkData } from "../../shared/link-data";
import { errMessage } from "../../shared/utils";
import { t } from "../../shared/i18n/t";
import { parseGuideUrl } from "../../shared/guides/guide-links";
import {
    effectivePathOf,
    resolveUrlToPipeDescriptor,
    splitUrlFragment,
    virtualPipeDescriptor,
} from "./link-utils";
import { registerScheme, type SchemeHookContext } from "./scheme-registry";
import { resolveEditorIdForFile } from "../api/boards/custom-editor-registry";
import { isBoardEditorId } from "../../shared/board/board-editor-id";
import { getGuidePage } from "../guides";
import { editorRegistry } from "../editors/base/editorRegistry";

async function parsePassThrough(data: ILinkData, context: SchemeHookContext): Promise<void> {
    data.url = data.href;
    await context.handoff();
}

async function parseMneme(data: ILinkData, context: SchemeHookContext): Promise<void> {
    const split = splitUrlFragment(data.href);
    data.url = split.url;
    if (split.fragment) data.fragment ??= split.fragment;
    await context.handoff();
}

async function parseVirtual(
    data: ILinkData,
    context: SchemeHookContext,
    target: string,
): Promise<void> {
    data.url = data.href;
    data.target ??= target;
    await context.handoff();
}

async function parseFolderEditor(data: ILinkData, context: SchemeHookContext): Promise<void> {
    const decoded = decodeFolderEditorLink(data.href);
    const parsed = decoded && { editorId: decoded.editorId, anchorFolder: decoded.anchorFolder };
    if (!parsed) {
        data.action = { kind: "notice", message: t("api.invalidFolderEditorLink", { href: data.href }), level: "warning" };
        return;
    }
    data.url = data.href;
    data.target = parsed.editorId;
    data.folderPath = parsed.anchorFolder;
    await context.handoff();
}

async function parseGuide(data: ILinkData, context: SchemeHookContext): Promise<void> {
    const parsed = parseGuideUrl(data.href);
    if (!parsed) {
        data.action = { kind: "notice", message: t("api.invalidGuideLink", { href: data.href }), level: "warning" };
        return;
    }
    data.url = parsed.url;
    if (parsed.fragment) data.fragment ??= parsed.fragment;
    data.target ??= "md-view";
    await context.handoff();
}

const httpContentExtensions = new Set([
    ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx",
    ".json", ".jsonc", ".jsonl", ".css", ".scss", ".less",
    ".xml", ".xsl", ".xslt", ".xsd", ".yaml", ".yml", ".toml",
    ".ini", ".cfg", ".conf", ".sh", ".bash", ".zsh", ".bat", ".cmd",
    ".ps1", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".cs", ".php", ".r",
    ".lua", ".sql", ".graphql", ".gql", ".proto",
    ".md", ".markdown", ".csv", ".svg", ".txt", ".log", ".env", ".dockerfile",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
    ".pdf",
    ".mp4", ".webm", ".ogg", ".m3u8", ".m3u",
    ".mp3", ".wav", ".aac", ".flac", ".m4a", ".wma", ".opus", ".avi", ".mkv", ".mov",
]);
const httpBrowserFallbackExtensions = new Set([".pdf"]);

async function resolveVirtual(
    data: ILinkData,
    context: SchemeHookContext,
): Promise<void> {
    if (data.target === "browser" || data.browserMode) {
        data.pipeDescriptor = virtualPipeDescriptor(data.url);
        data.pipe = context.createPipe(data.pipeDescriptor);
        data.action = { kind: "browser" };
        return;
    }
    data.target ||= "monaco";
    data.pipeDescriptor = virtualPipeDescriptor(data.url);
    data.pipe = context.createPipe(data.pipeDescriptor);
    await context.handoff();
}

async function resolveData(data: ILinkData, context: SchemeHookContext): Promise<void> {
    if (data.target === "image.edit" && data.url?.startsWith("data:image/")) {
        data.action = { kind: "capability", id: "image.edit", payload: { dataUrl: data.url, title: data.title || "drawing" } };
        return;
    }

    if (data.target === "browser" || data.browserMode) {
        data.pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data) ?? undefined;
        if (data.pipeDescriptor) data.pipe = context.createPipe(data.pipeDescriptor);
        data.action = { kind: "browser" };
        return;
    }

    data.target = data.target || resolveEditorIdForFile(data.url, data.url) || "monaco";
    data.pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data) ?? undefined;
    if (!data.pipeDescriptor) return;
    data.pipe = context.createPipe(data.pipeDescriptor);
    await context.handoff();
}

async function resolveMneme(data: ILinkData, context: SchemeHookContext): Promise<void> {
    const path = data.url.slice("mneme://".length);
    data.target = data.target || editorRegistry.resolveId(path) || "monaco";
    data.pipeDescriptor = {
        provider: { type: "mneme", config: { path } },
        transformers: [],
    };
    data.pipe = context.createPipe(data.pipeDescriptor);
    await context.handoff();
}

async function resolveGuide(data: ILinkData, context: SchemeHookContext): Promise<void> {
    const parsed = parseGuideUrl(data.url);
    if (!parsed) {
        data.action = { kind: "notice", message: t("api.invalidGuideUrl", { url: data.url }), level: "error" };
        return;
    }

    data.url = parsed.url;
    data.target = "md-view";
    data.pipeDescriptor = {
        provider: { type: "guide", config: { path: parsed.path } },
        transformers: [],
    };

    try {
        const page = await getGuidePage(parsed.path);
        if (!page) {
            data.action = { kind: "notice", message: t("api.guideNotFound", { path: parsed.path }), level: "error" };
            return;
        }

        data.title ??= page.title;
        data.pipe = context.createPipe(data.pipeDescriptor);
        await context.handoff();
    } catch (error) {
        data.action = {
            kind: "notice",
            message: t("api.failedToOpenGuide", { path: parsed.path, error: errMessage(error) }),
            level: "error",
        };
    }
}

async function resolveHttp(data: ILinkData, context: SchemeHookContext): Promise<void> {
    if (data.target === "http.request.open") {
        const title = requestTitle(data.url);
        const payload = {
            url: data.url,
            ...(data.method !== undefined ? { method: data.method } : {}),
            ...(data.headers !== undefined ? { headers: data.headers } : {}),
            ...(data.body !== undefined ? { body: data.body } : {}),
            title,
        };
        data.pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data) ?? undefined;
        if (data.pipeDescriptor) data.pipe = context.createPipe(data.pipeDescriptor);
        data.action = { kind: "capability", id: "http.request.open", payload };
        return;
    }

    const openInBrowser = data.target === "browser";
    const effectivePath = effectivePathOf(data.url);
    const ext = effectivePath.includes(".")
        ? effectivePath.slice(effectivePath.lastIndexOf(".")).toLowerCase()
        : "";
    const hasContentExtension = httpContentExtensions.has(ext);
    let headerTarget: string | undefined;
    let headerBrowserFallback = false;

    if (!hasContentExtension && data.headers) {
        const accept = data.headers["accept"] || data.headers["Accept"] || "";
        if (accept.includes("image/")) headerTarget = "image-view";
        else if (accept.includes("pdf")) headerBrowserFallback = true;
        else if (
            accept.includes("json")
            || accept.includes("xml")
            || accept.includes("css")
            || accept.includes("javascript")
            || accept.includes("text/")
            || accept.includes("*/*")
        ) headerTarget = "monaco";
    }

    // A board that registered this extension as a custom editor (a font, an office document)
    // is content intent too; otherwise the browser would just download the file.
    const boardClaimsExtension = !hasContentExtension && !!ext
        && isBoardEditorId(resolveEditorIdForFile(data.url, effectivePath));

    const hasExplicitEditorTarget = data.target && data.target !== "browser";
    const hasContentIntent = hasContentExtension || boardClaimsExtension || !!data.headers || !!data.fallbackTarget;
    const browserMode = data.browserMode;
    if (browserMode || openInBrowser || (!hasContentIntent && !hasExplicitEditorTarget)) {
        data.pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data) ?? undefined;
        if (data.pipeDescriptor) data.pipe = context.createPipe(data.pipeDescriptor);
        data.action = { kind: "browser" };
        return;
    }

    const resolvedTarget = hasContentIntent
        ? resolveEditorIdForFile(data.url, effectivePath)
        : undefined;
    const boardWins = !!resolvedTarget && isBoardEditorId(resolvedTarget);

    if (
        (httpBrowserFallbackExtensions.has(ext) || headerBrowserFallback)
        && !boardWins
        && !hasExplicitEditorTarget
    ) {
        data.pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data) ?? undefined;
        if (data.pipeDescriptor) data.pipe = context.createPipe(data.pipeDescriptor);
        data.action = { kind: "browser" };
        return;
    }

    data.target = data.target
        || (boardWins ? resolvedTarget : undefined)
        || data.fallbackTarget
        || headerTarget
        || resolvedTarget;

    const pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data);
    if (!pipeDescriptor) return;

    data.pipeDescriptor = pipeDescriptor;
    data.pipe = context.createPipe(pipeDescriptor);
    await context.handoff();
}

function requestTitle(url: string): string {
    try {
        return `${new URL(url).hostname}.rest.json`;
    } catch {
        return "request.rest.json";
    }
}

// ── Built-in scheme declarations ────────────────────────────────────────────

const platformRegistration = { origin: "platform" } as const;

registerScheme("http", { parse: parsePassThrough, resolve: resolveHttp }, platformRegistration);
registerScheme("https", { parse: parsePassThrough, resolve: resolveHttp }, platformRegistration);
registerScheme("data", { parse: parsePassThrough, resolve: resolveData }, platformRegistration);
registerScheme("folder-editor", { parse: parseFolderEditor, resolve: resolveVirtual }, platformRegistration);
registerScheme("git-tree", { parse: (data, context) => parseVirtual(data, context, "git-tree"), resolve: resolveVirtual }, platformRegistration);
registerScheme("mneme", { parse: parseMneme, resolve: resolveMneme }, platformRegistration);
registerScheme("mneme-folder", { parse: (data, context) => parseVirtual(data, context, "mneme-root"), resolve: resolveVirtual }, platformRegistration);
registerScheme("persephone-board", { parse: (data, context) => parseVirtual(data, context, "board-view"), resolve: resolveVirtual }, platformRegistration);
registerScheme("persephone-guide", { parse: parseGuide, resolve: resolveGuide }, platformRegistration);
registerScheme("persephone-toolset", { parse: (data, context) => parseVirtual(data, context, "toolset-view"), resolve: resolveVirtual }, platformRegistration);
registerScheme("tree-category", { parse: (data, context) => parseVirtual(data, context, "category-view"), resolve: resolveVirtual }, platformRegistration);
