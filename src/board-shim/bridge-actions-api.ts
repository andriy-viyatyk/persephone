import type { BoardOpenContentRequest } from "../ipc/board-bridge/frame-protocol";
import type { BoardOpenRawLinkOptions } from "../ipc/board-bridge/port-protocol";
import type { BoardOpenTreeRequest, BoardRefreshTreeRequest } from "../shared/board/board-tree-request";
import type { MainPortChannel } from "./main-port-channel";
import type { HostFrameChannel } from "./board-host-frame-channel";

export function createBridgeActionsApi(deps: { mainPort: MainPortChannel; hostFrame: HostFrameChannel }) {
    const { mainPort, hostFrame } = deps;
    function openRawLink(href: string, options?: BoardOpenRawLinkOptions): Promise<void> {
        const result = mainPort.rpc("openRawLink", href, options);
        void result.catch(() => {});
        return result;
    }
    function openTree(options: BoardOpenTreeRequest): Promise<void> {
        return mainPort.rpc("openTree", options);
    }
    function refreshTree(options: BoardRefreshTreeRequest): Promise<number> {
        return mainPort.rpc("refreshTree", options);
    }
    function openContentRpc(request: BoardOpenContentRequest): Promise<string> {
        return hostFrame.request("openContent", { request }).then((pageId) => {
            if (typeof pageId === "string") return pageId;
            throw new Error("Malformed persephone.openContent() response.");
        });
    }
    const api = {
        openRawLink,
        openTree,
        refreshTree,
        openContent(options: { editor: string; language?: string; title?: string; content?: string }): Promise<string> {
            if (!options || typeof options !== "object") {
                return Promise.reject(new Error('openContent() expects an options object, e.g. { editor: "md-view" }.'));
            }
            return openContentRpc({ editor: options.editor, language: options.language, title: options.title, content: options.content });
        },
        call(path: string, options?: { args?: unknown[]; value?: unknown; maxLength?: number; timeoutMs?: number }): Promise<unknown> {
            return mainPort.call(path, options);
        },
        notify(message: string, type?: "info" | "success" | "warning" | "error", options?: { persistent?: boolean }): void {
            if (type === "error") console.error("[board]", message);
            mainPort.fire("notify", [message, type, options?.persistent === true]);
        },
    };
    return { api, openRawLink };
}
