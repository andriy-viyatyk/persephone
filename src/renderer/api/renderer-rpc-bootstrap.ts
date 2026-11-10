import { registerBoardHostRpc } from "./boards/board-host-rpc";
import { registerBoardServiceSettingsRpc } from "./board-service-settings";
import { registerMcpCallRpc } from "./mcp/mcp-call-rpc";
import { rendererRpc } from "./renderer-rpc";

let initialized = false;

export function initRendererRpc(): void {
    if (initialized) return;
    initialized = true;
    registerMcpCallRpc(rendererRpc);
    registerBoardHostRpc(rendererRpc);
    registerBoardServiceSettingsRpc(rendererRpc);
    rendererRpc.init();
}

export function markRendererRpcReady(): void {
    rendererRpc.markReady();
}
