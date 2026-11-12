import type { EditorModel, EditorOrHost } from "../../editors/base";
import { editorRegistry, isExplicitHostTarget } from "../../editors/base/editorRegistry";
import type { EditorView } from "../../../shared/types";
import { cleanForStorage } from "../../../shared/link-data";
import type { ILinkData, StoredLinkData } from "../../../shared/link-data";
import type { ILinkDiffRevision } from "../types/io.link-data";
import type { PageModel } from "./PageModel";
import { fpExtname } from "../../core/utils/file-path";
import { getLanguageByExtension } from "../../core/utils/language-mapping";

export interface PageOpenRequest {
    filePath?: string;
    sourceLink?: StoredLinkData;
    sourceUrl?: string;
    target?: string;
    folderPath?: string;
    title?: string;
    forceTextEditor?: boolean;
    sessionHandle?: string;
    fragment?: string;
    revealLine?: number;
    highlightText?: string;
    diffFrom?: ILinkDiffRevision;
    diffTo?: ILinkDiffRevision;
}

export type OpenHintContext =
    | { exit: "fresh"; newPage: boolean }
    | { exit: "reuse" }
    | { exit: "reveal" };

export function createPageOpenRequest(data: ILinkData, logicalPath: string): PageOpenRequest {
    const sourceLink = cleanForStorage(data);
    sourceLink.url = logicalPath;
    if (!sourceLink.pipeDescriptor && data.pipe) {
        sourceLink.pipeDescriptor = data.pipe.toDescriptor();
    }
    return {
        filePath: logicalPath,
        sourceLink,
        sourceUrl: sourceLink.url ?? data.pipe?.provider.sourceUrl ?? logicalPath,
        target: data.target,
        folderPath: data.folderPath,
        title: data.title ?? sourceLink.title,
        forceTextEditor: !!(data.revealLine || data.highlightText),
        sessionHandle: data.sessionHandle,
        fragment: data.fragment,
        revealLine: data.revealLine,
        highlightText: data.highlightText,
        diffFrom: data.diffFrom,
        diffTo: data.diffTo,
    };
}

export function prepareOpenedEditor(
    editorOrHost: EditorOrHost,
    request: PageOpenRequest,
    options: { selectPreview: boolean },
): void {
    if (request.sourceLink || request.title) {
        editorOrHost.state.update((state) => {
            if (request.sourceLink) state.sourceLink = request.sourceLink;
            if (request.title) state.title = request.title;
        });
    }
    const forceText = request.forceTextEditor || !!request.revealLine || !!request.highlightText;
    if (editorOrHost.state.get().type === "textFile" && request.filePath) {
        const target = forceText ? "monaco" : request.target;
        if (target && isExplicitHostTarget(target, request.filePath)) {
            editorOrHost.state.update((state) => { state.editor = target as EditorView; });
        } else if (options.selectPreview && !forceText) {
            const languageId = getLanguageByExtension(fpExtname(request.filePath).toLowerCase())?.id ?? "plaintext";
            const preview = editorRegistry.getPreviewEditor(languageId, request.filePath);
            if (preview) editorOrHost.state.update((state) => { state.editor = preview as EditorView; });
        }
    }
}

export function registerOpenSession(adapter: EditorModel, request: PageOpenRequest): void {
    const sourceUrl = request.sourceUrl ?? request.sourceLink?.url ?? request.filePath;
    if (!request.sessionHandle || !sourceUrl) return;
    adapter.acceptOpenContext?.({
        mode: "register-session",
        sourceUrl,
        sessionHandle: request.sessionHandle,
    });
}

export function applyOpenHints(
    page: PageModel,
    editor: EditorModel,
    request: PageOpenRequest,
    context: OpenHintContext,
): void {
    if (context.exit === "fresh" && (request.diffFrom || request.diffTo)) {
        editor.applyDiffRevisions?.(request.diffFrom, request.diffTo);
    }
    if (request.fragment) editor.revealFragment?.(request.fragment);
    if (context.exit === "fresh" || context.exit === "reveal") {
        const host = editor.contentHost;
        if (request.revealLine) host?.revealLine(request.revealLine);
        if (request.highlightText) host?.setHighlightText(request.highlightText);
    }
    if (context.exit === "fresh" && context.newPage && (request.diffFrom || request.diffTo)) {
        const panelId = editor.secondaryView?.[0];
        if (panelId) page.expandPanel(panelId);
    }
}
