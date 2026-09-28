import type { ILinkData } from "../../shared/link-data";
import { openImageForEdit, notifyEditCapabilityFailure } from "../api/capability-feedback";
import { errMessage } from "../../shared/utils";
import { parseGuideUrl } from "../../shared/guides/guide-links";
import {
    effectivePathOf,
    resolveUrlToPipeDescriptor,
    splitUrlFragment,
    virtualPipeDescriptor,
} from "./link-utils";
import { registerScheme, type SchemeHookContext } from "./scheme-registry";

function decodeFolderEditorLink(raw: string): { editorId: string; anchorFolder: string } | null {
    const prefix = "folder-editor://";
    if (!raw.startsWith(prefix)) return null;
    try {
        const binary = atob(raw.slice(prefix.length));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const payload: unknown = JSON.parse(json);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
        const candidate = payload as { editorId?: unknown; anchorFolder?: unknown };
        if (
            typeof candidate.editorId !== "string"
            || candidate.editorId.length === 0
            || typeof candidate.anchorFolder !== "string"
            || candidate.anchorFolder.length === 0
        ) return null;
        return { editorId: candidate.editorId, anchorFolder: candidate.anchorFolder };
    } catch {
        return null;
    }
}

async function notifyUser(message: string, type: "error" | "warning"): Promise<void> {
    const { ui } = await import("../api/ui");
    ui.notify(message, type);
}

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
    const parsed = decodeFolderEditorLink(data.href);
    if (!parsed) {
        await notifyUser(`Invalid folder editor link: ${data.href}`, "warning");
        data.handled = true;
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
        await notifyUser(
            `Invalid guide link: ${data.href}. Expected persephone-guide://<corpus-path>[#anchor].`,
            "warning",
        );
        data.handled = true;
        return;
    }
    data.url = parsed.url;
    if (parsed.fragment) data.fragment ??= parsed.fragment;
    data.target ??= "md-view";
    await context.handoff();
}

export async function openLinkInBrowser(data: ILinkData): Promise<void> {
    const browserMode = data.browserMode;
    const openInBrowser = data.target === "browser";

    if (data.browserPageId) {
        const { pagesModel } = await import("../api/pages");
        const page = pagesModel.query.findPage(data.browserPageId);
        const editor = page?.mainEditor;
        if (editor && "navigate" in editor && "addTab" in editor) {
            const tabMode = data.browserTabMode ?? "addTab";
            if (tabMode === "navigate") {
                (editor as any).navigate(data.url); // eslint-disable-line @typescript-eslint/no-explicit-any
            } else {
                (editor as any).addTab(data.url); // eslint-disable-line @typescript-eslint/no-explicit-any
            }
        }
        return;
    }

    if (browserMode === "os-default") {
        const { shell } = await import("../api/shell");
        shell.openExternal(data.url);
    } else if (browserMode === "incognito") {
        const { pagesModel } = await import("../api/pages");
        await pagesModel.lifecycle.openUrlInBrowserTab(data.url, { incognito: true });
    } else if (browserMode?.startsWith("profile:")) {
        const profileName = browserMode.slice("profile:".length);
        const { pagesModel } = await import("../api/pages");
        await pagesModel.lifecycle.openUrlInBrowserTab(data.url, { profileName });
    } else if (browserMode === "internal") {
        const { pagesModel } = await import("../api/pages");
        await pagesModel.lifecycle.openUrlInBrowserTab(data.url, { external: true });
    } else {
        const { settings } = await import("../api/settings");
        const behavior = settings.get("link-open-behavior");
        if (behavior === "internal-browser" || openInBrowser) {
            const { pagesModel } = await import("../api/pages");
            await pagesModel.lifecycle.openUrlInBrowserTab(data.url, { external: openInBrowser });
        } else {
            const { shell } = await import("../api/shell");
            shell.openExternal(data.url);
        }
    }
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
    if (context.phase === "open" && (data.target === "browser" || data.browserMode)) {
        await openLinkInBrowser(data);
        data.handled = true;
        return;
    }
    data.target ||= "monaco";
    data.pipeDescriptor = virtualPipeDescriptor(data.url);
    data.pipe = context.createPipe(data.pipeDescriptor);
    await context.handoff();
}

async function resolveData(data: ILinkData, context: SchemeHookContext): Promise<void> {
    if (data.target === "image.edit" && data.url?.startsWith("data:image/")) {
        if (context.phase === "source-path") return;
        try {
            await openImageForEdit({ dataUrl: data.url, title: data.title || "drawing" });
        } catch (error) {
            notifyEditCapabilityFailure(error, "image.edit", "Failed to open image for editing");
        }
        data.handled = true;
        return;
    }

    if (context.phase === "open" && (data.target === "browser" || data.browserMode)) {
        await openLinkInBrowser(data);
        data.handled = true;
        return;
    }

    const { resolveEditorIdForFile } = await import("../editors/board/custom-editor-registry");
    data.target = data.target || resolveEditorIdForFile(data.url, data.url) || "monaco";
    data.pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data) ?? undefined;
    if (!data.pipeDescriptor) return;
    data.pipe = context.createPipe(data.pipeDescriptor);
    await context.handoff();
}

async function resolveMneme(data: ILinkData, context: SchemeHookContext): Promise<void> {
    const path = data.url.slice("mneme://".length);
    const { editorRegistry } = await import("../editors/base/editorRegistry");
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
        await notifyUser(
            `Invalid guide link: ${data.url}. Expected persephone-guide://<corpus-path>[#anchor].`,
            "error",
        );
        data.handled = true;
        return;
    }

    if (context.phase === "source-path") {
        data.url = parsed.url;
        data.target = "md-view";
        data.pipeDescriptor = {
            provider: { type: "guide", config: { path: parsed.path } },
            transformers: [],
        };
        data.pipe = context.createPipe(data.pipeDescriptor);
        return;
    }

    try {
        const { getGuidePage } = await import("../guides");
        const page = await getGuidePage(parsed.path);
        if (!page) {
            const { ui } = await import("../api/ui");
            ui.notify(
                `Guide not found: ${parsed.path}. Use the guide index to inspect available pages.`,
                "error",
            );
            data.handled = true;
            return;
        }

        data.url = parsed.url;
        data.title ??= page.title;
        data.target = "md-view";
        data.pipeDescriptor = {
            provider: { type: "guide", config: { path: parsed.path } },
            transformers: [],
        };
        data.pipe = context.createPipe(data.pipeDescriptor);
        await context.handoff();
    } catch (error) {
        const { ui } = await import("../api/ui");
        ui.notify(`Failed to open guide ${parsed.path}: ${errMessage(error)}`, "error");
        data.handled = true;
    }
}

async function resolveHttp(data: ILinkData, context: SchemeHookContext): Promise<void> {
    if (context.phase === "source-path") {
        data.pipeDescriptor = resolveUrlToPipeDescriptor(data.url, data) ?? undefined;
        if (data.pipeDescriptor) data.pipe = context.createPipe(data.pipeDescriptor);
        return;
    }

    if (data.target === "rest-client") {
        const { openInRestClient } = await import("../editors/rest-client/open-in-rest-client");
        await openInRestClient(data.url, data);
        data.handled = true;
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

    const hasExplicitEditorTarget = data.target && data.target !== "browser";
    const hasContentIntent = hasContentExtension || !!data.headers || !!data.fallbackTarget;
    const browserMode = data.browserMode;
    if (browserMode || openInBrowser || (!hasContentIntent && !hasExplicitEditorTarget)) {
        await openLinkInBrowser(data);
        data.handled = true;
        return;
    }

    const { resolveEditorIdForFile, isBoardEditorId } =
        await import("../editors/board/custom-editor-registry");
    const resolvedTarget = hasContentIntent
        ? resolveEditorIdForFile(data.url, effectivePath)
        : undefined;
    const boardWins = !!resolvedTarget && isBoardEditorId(resolvedTarget);

    if (
        (httpBrowserFallbackExtensions.has(ext) || headerBrowserFallback)
        && !boardWins
        && !hasExplicitEditorTarget
    ) {
        await openLinkInBrowser(data);
        data.handled = true;
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
