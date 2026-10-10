import { ui } from "../../api/ui";
import { fpNormalizeForCompare } from "../../core/utils/file-path";
import { legacyBoardsDeprecationToastForUi } from "./board-permission-copy";

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
    const rootKey = fpNormalizeForCompare(boardRoot);
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
