import type { EditorModel } from "../../editors/base";
import { cleanForStorage } from "../../../shared/link-data";
import type { ILinkData, StoredLinkData } from "../../../shared/link-data";
import type { ILinkDiffRevision } from "../types/io.link-data";
import type { PageModel } from "./PageModel";
import { TEXT_NAVIGATION_TRAIT } from "../../editors/base/editor-traits";

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
    editor: EditorModel,
    request: PageOpenRequest,
): void {
    if (request.sourceLink || request.title) {
        const stateOwner = editor.contentHost ?? editor;
        stateOwner.state.update((state) => {
            if (request.sourceLink) state.sourceLink = request.sourceLink;
            if (request.title) state.title = request.title;
        });
    }
}

export function registerOpenSession(editor: EditorModel, request: PageOpenRequest): void {
    const sourceUrl = request.sourceUrl ?? request.sourceLink?.url ?? request.filePath;
    if (!request.sessionHandle || !sourceUrl) return;
    editor.acceptOpenContext?.({
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
        const navigation = editor.traits.get(TEXT_NAVIGATION_TRAIT);
        if (request.revealLine) navigation?.revealLine(request.revealLine);
        if (request.highlightText) navigation?.setHighlightText(request.highlightText);
    }
    if (context.exit === "fresh" && context.newPage && (request.diffFrom || request.diffTo)) {
        const panelId = editor.secondaryView?.[0];
        if (panelId) page.expandPanel(panelId);
    }
}
