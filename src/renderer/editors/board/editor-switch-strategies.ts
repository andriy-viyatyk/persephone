import { parseBoardEditorId } from "../../../shared/board/board-editor-id";
import { matchesFileMask } from "../../../shared/board/board-masks";
import type { ILinkData } from "../../../shared/link-data";
import { customEditorRegistry } from "../../api/boards/custom-editor-registry";
import { fpBasename } from "../../core/utils/file-path";
import { isBoardContextSourceId } from "../base/editor-ids";
import type { EditorCandidate } from "../base/editor-catalog";
import {
    editorSwitchStrategies,
    rebuildEditorOverFile,
    transferEditorById,
    type EditorSwitchStrategy,
} from "../base/editor-switch-strategies";
import type { EditorModelInstance as EditorModel } from "../base/EditorModel";
import type { PageModel } from "../../api/pages/PageModel";
import { captureBoardSourceContext } from "../shared/source-context";

async function boardSwitchSourceLink(
    page: PageModel,
    oldEditor: EditorModel,
    candidate: EditorCandidate,
    filePath: string,
): Promise<ILinkData | undefined> {
    if (parseBoardEditorId(candidate.id) === null) return undefined;
    const board = customEditorRegistry.findByEditorId(candidate.id);
    const sourceLink = oldEditor.sourceLink;
    if (!board || !sourceLink || !isBoardContextSourceId(sourceLink.sourceId)) return undefined;

    const sourceContext = await captureBoardSourceContext({
        page,
        sourceLink,
        currentHref: sourceLink.url ?? sourceLink.href ?? filePath,
        include: (item) => board.fileMasks.length === 0
            || board.fileMasks.some((mask) => matchesFileMask(fpBasename(item.href), mask)),
    });
    return { ...sourceLink, sourceContext };
}

function boardInvolved(oldEditor: EditorModel, candidate: EditorCandidate): boolean {
    return parseBoardEditorId(oldEditor.editorId) !== null
        || parseBoardEditorId(candidate.id) !== null;
}

const boardContentHostStrategy: EditorSwitchStrategy = {
    order: 300,
    matches: (oldEditor, candidate) =>
        boardInvolved(oldEditor, candidate)
        && !!oldEditor.contentHost
        && candidate.transition === "host-transfer",
    run: async (page, oldEditor, candidate) => {
        const filePath = oldEditor.filePath;
        const sourceLink = candidate.boardRoot && filePath
            ? await boardSwitchSourceLink(page, oldEditor, candidate, filePath)
            : undefined;
        if (!candidate.boardRoot) {
            await transferEditorById(page, oldEditor, candidate);
            return;
        }

        const { createBoardEditor } = await import("./index");
        const next = await createBoardEditor({
            kind: "file",
            boardRoot: candidate.boardRoot,
            filePath: filePath ?? undefined,
            editorKind: "content-host",
        });
        next.switchFrom(oldEditor);
        if (sourceLink) next.state.update((state) => { state.sourceLink = sourceLink; });
        await next.restore();
        await page.setMainEditor(next);
    },
};

const boardSimpleStrategy: EditorSwitchStrategy = {
    order: 310,
    matches: (oldEditor, candidate) =>
        boardInvolved(oldEditor, candidate)
        && (!oldEditor.contentHost || candidate.transition !== "host-transfer"),
    run: async (page, oldEditor, candidate) => {
        const filePath = oldEditor.filePath;
        if (!filePath) return;
        const sourceLink = candidate.boardRoot
            ? await boardSwitchSourceLink(page, oldEditor, candidate, filePath)
            : undefined;
        await rebuildEditorOverFile(page, oldEditor, filePath, candidate, sourceLink);
    },
};

export function registerBoardEditorSwitchStrategies(): void {
    editorSwitchStrategies.register(boardContentHostStrategy);
    editorSwitchStrategies.register(boardSimpleStrategy);
}
