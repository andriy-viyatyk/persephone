import { EditorId } from "../editor-ids";
import type { BoardEditorId } from "../editor-ids";

export const BOARD_EDITOR_ID_PREFIX = "board-editor:";

export function boardEditorId(boardRoot: string): BoardEditorId {
    return `${BOARD_EDITOR_ID_PREFIX}${boardRoot}`;
}

/** Extract the board root from a `board-editor:<root>` id, or null if it isn't one. */
export function parseBoardEditorId(editorId: string): string | null {
    return editorId.startsWith(BOARD_EDITOR_ID_PREFIX)
        ? editorId.slice(BOARD_EDITOR_ID_PREFIX.length)
        : null;
}

/** Whether an editor id belongs to the built-in board editor or its custom-editor family. */
export function isBoardEditorId(id: string | undefined): boolean {
    return id === EditorId.boardView || (!!id && parseBoardEditorId(id) !== null);
}
