import { boardInstallRegistry } from "../../api/board-install-registry";
import { publishedBoards } from "../../api/published-boards";
import { fpNormalizeForCompare, isPlainLocalPath } from "../../core/utils/file-path";
import { customEditorRegistry } from "../board/custom-editor-registry";
import { BOARD_INFO_EDITOR_ID } from "../board-info/board-info-id";
import { isTextFileModel, type TextFileModel } from "../text/TextEditorModel";
import type { EditorModel } from "./EditorModel";
import { editorRegistry } from "./editorRegistry";

export interface IEditorSwitchOption {
    readonly id: string;
    readonly label: string;
    readonly title?: string;
}

/** The exact candidate projection used by the page toolbar and page scripting node. */
export function getEditorSwitchOptions(model: EditorModel): IEditorSwitchOption[] {
    const host = getTextHost(model);
    const hostState = host?.state.get();
    const editorState = model.state.get();
    const filePath = hostState?.filePath ?? model.filePath;
    const local = Boolean(filePath) && isPlainLocalPath(filePath);
    const fileName = filePath ?? hostState?.title ?? editorState.title ?? "";

    // Boards claim a page by file name (`fileMasks`) or by CONTENT (`contentMasks`, US-1404 — the
    // manifest counterpart of a built-in matcher's `detectsContent`). The content path is what lets
    // a board be offered on an UNTITLED, in-memory page, whose "file name" is just its title. Both
    // sets then pass the same locality gate, so a content match on a non-local source still needs a
    // content-host board.
    const content = hostState?.content ?? "";
    const boardMatchesAll = [...customEditorRegistry.getBoardsForFile(fileName)];
    for (const board of customEditorRegistry.getBoardsForContent(content)) {
        if (!boardMatchesAll.some((existing) => existing.editorId === board.editorId)) {
            boardMatchesAll.push(board);
        }
    }
    const boardMatches = local
        ? boardMatchesAll
        : boardMatchesAll.filter((board) => board.editorKind === "content-host");
    const catalogAll = publishedBoards.catalogBoardsForFile(fileName);
    const installed = boardInstallRegistry.listInstalled();
    const trustedRoots = new Set(
        boardMatches.map((board) => fpNormalizeForCompare(board.boardRoot)),
    );
    const catalogMatches = catalogAll.filter((catalogBoard) => {
        if (!local && catalogBoard.editorKind !== "content-host") return false;
        const installedEntry = installed.find((entry) => entry.id === catalogBoard.id);
        return !installedEntry || !trustedRoots.has(fpNormalizeForCompare(installedEntry.root));
    });

    const merged = [...model.findCompatibleEditors()];
    for (const board of boardMatches) {
        if (!merged.includes(board.editorId)) merged.push(board.editorId);
    }
    if (catalogMatches.length > 0 && !merged.includes(BOARD_INFO_EDITOR_ID)) {
        merged.push(BOARD_INFO_EDITOR_ID);
    }
    const plusIndex = merged.indexOf(BOARD_INFO_EDITOR_ID);
    if (plusIndex !== -1 && plusIndex !== merged.length - 1) {
        merged.splice(plusIndex, 1);
        merged.push(BOARD_INFO_EDITOR_ID);
    }

    const boardNameById = new Map(boardMatches.map((board) => [board.editorId, board.name]));
    return merged.map((id) => ({
        id,
        label: id === BOARD_INFO_EDITOR_ID
            ? "  +  "
            : boardNameById.get(id) ?? editorRegistry.getById(id)?.name ?? id,
        title: id === BOARD_INFO_EDITOR_ID
            ? "Install an editor for this file type…"
            : undefined,
    }));
}

/** File identity used by the toolbar's catalog subscription. */
export function getEditorSwitchFileName(model: EditorModel): string {
    const host = getTextHost(model);
    const hostState = host?.state.get();
    const editorState = model.state.get();
    return hostState?.filePath ?? model.filePath ?? hostState?.title ?? editorState.title ?? "";
}

function getTextHost(model: EditorModel): TextFileModel | null {
    return isTextFileModel(model.contentHost) ? model.contentHost : null;
}
