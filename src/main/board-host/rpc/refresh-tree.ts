import type { BoardBridgeConnection } from "../BoardBridgeConnection";
import type { BoardRefreshTreeRequest } from "../../../shared/board/board-tree-request";
import { openWindows } from "../../open-windows";
import { requestRenderer } from "../../renderer-rpc";

/** Ask the caller renderer first for authorization, then refresh every other live renderer. */
export async function refreshBoardTrees(
    entry: BoardBridgeConnection,
    request: BoardRefreshTreeRequest,
): Promise<number> {
    const params = { ...request, boardRoot: entry.root };
    const caller = { webContents: entry.hostWebContents };
    const callerCount = await requestRenderer("refreshTree", params, caller);
    const otherRenderers = openWindows.windows.flatMap((windowData) => {
        if (windowData.boardRoot || !windowData.window) return [];
        const window = windowData.window.window;
        if (window.isDestroyed() || window.webContents.isDestroyed()
            || window.webContents === entry.hostWebContents) return [];
        return [window.webContents];
    });
    const counts = await Promise.all(otherRenderers.map((webContents) =>
        requestRenderer("refreshTree", params, { webContents }),
    ));
    return callerCount + counts.reduce((total, count) => total + count, 0);
}
