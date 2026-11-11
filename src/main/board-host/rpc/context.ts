import { BrowserWindow, type WebContents } from "electron";
import type { RendererRpcMethod, RendererRpcMethods } from "../../../ipc/renderer-rpc";
import { BoardRoot } from "../../../shared/board/board-root";
import { errMessage } from "../../../shared/utils";
import { boardDisplayName, readBoardManifest } from "../../board-manifest-reader";
import { requestRenderer } from "../../renderer-rpc";
import type { BoardBridgeConnection } from "../BoardBridgeConnection";

export async function boardName(entry: BoardBridgeConnection): Promise<string> {
    const root = BoardRoot.from(entry.root);
    return boardDisplayName(root, await readBoardManifest(root));
}

export function ownerWindow(hostWebContents: WebContents): BrowserWindow | undefined {
    return BrowserWindow.fromWebContents(hostWebContents)
        ?? BrowserWindow.getFocusedWindow()
        ?? BrowserWindow.getAllWindows()[0]
        ?? undefined;
}

export async function hostRequest<M extends RendererRpcMethod>(
    entry: BoardBridgeConnection,
    method: M,
    params: RendererRpcMethods[M]["params"],
    timeoutMs?: number,
): Promise<RendererRpcMethods[M]["result"]> {
    try {
        return await requestRenderer(method, params, { webContents: entry.hostWebContents }, timeoutMs);
    } catch (error: unknown) {
        throw new Error(errMessage(error));
    }
}
