import { ui } from "../../api/ui";
import { BoardRoot } from "../../../shared/board/board-root";
import { legacyBoardsDeprecationToastForUi } from "../../api/boards/board-permission-copy";

const pendingBoards = new Map<string, string>();
const pendingEditorIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export function queueLegacyBoardDeprecationNotice(
    editorId: string,
    boardRoot: string,
    boardName: string,
): void {
    if (pendingEditorIds.has(editorId)) return;
    pendingEditorIds.add(editorId);
    const rootKey = BoardRoot.from(boardRoot).key;
    pendingBoards.set(rootKey, boardName);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        const names = [...pendingBoards.values()];
        pendingBoards.clear();
        pendingEditorIds.clear();
        flushTimer = undefined;
        if (names.length > 0) void ui.notify(legacyBoardsDeprecationToastForUi(names), "warning", { persistent: true });
    }, 1000);
}
