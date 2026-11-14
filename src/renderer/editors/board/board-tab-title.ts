import { EditorId } from "../../../shared/editor-ids";
import { englishMessage, t } from "../../../shared/i18n/t";
import { boardIdentity } from "./board-identity";

interface BoardTabTitleModel {
    filePath?: string;
    folderAnchor?: string;
    displayNameEnglish?: string;
    boardRoot?: string;
}

export type BoardTabTitleContext = "tab" | "sidebar";

export interface BoardTabTitleState {
    editor?: string;
    title?: string;
    filePath?: string;
    folderPath?: string;
    boardRoot?: string;
}

export function formatBoardTabTitle(
    state: BoardTabTitleState,
    context: BoardTabTitleContext,
    model?: unknown,
    editorStateTitle?: string,
): string | undefined {
    let root: string | undefined;
    if (context === "tab") {
        const boardModel = state.editor === EditorId.boardView ? model as BoardTabTitleModel | undefined : undefined;
        root = boardModel
            && !boardModel.filePath
            && !boardModel.folderAnchor
            && editorStateTitle === boardModel.displayNameEnglish
            ? boardModel.boardRoot
            : undefined;
    } else {
        const candidateRoot = state.editor === EditorId.boardView && !state.filePath && !state.folderPath
            ? state.boardRoot
            : undefined;
        if (candidateRoot) boardIdentity.warm(candidateRoot);
        if (candidateRoot !== undefined && state.title !== undefined
            && state.title === boardIdentity.manifestName(candidateRoot)) {
            root = candidateRoot;
        }
    }
    if (root && state.title) return boardIdentity.displayName(root, state.title);
    if (state.title === englishMessage("board.editor")) return t("board.editor");
    return undefined;
}
