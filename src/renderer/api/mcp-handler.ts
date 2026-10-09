// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcRenderer } = require("electron");
import type { IpcRendererEvent } from "electron";
import { MCP_EXECUTE, MCP_RESULT } from "../../shared/constants";
import { errMessage } from "../../shared/utils";
import { dispatchMcpCommand } from "./mcp/command-registry";
import { logIncomingRequest } from "./mcp/request-log";
import type { McpParams, McpResponse } from "./mcp/types";

export { showMcpRequestLog } from "./mcp/request-log";

let handlerRegistered = false;
let markHandlerReady: () => void = () => undefined;
const handlerReady = new Promise<void>((resolve) => { markHandlerReady = resolve; });

/** Registers the renderer half of the main-process MCP IPC bridge. Requests that arrive before
 *  markMcpHandlerReady() wait instead of being dropped: restored boards call the bridge while
 *  startup is still running, and main has no retry, so a dropped request hangs until its timeout. */
export function initMcpHandler(): void {
    if (handlerRegistered) return;
    handlerRegistered = true;
    // The renderer's application bootstrap owns this main-process bridge for the
    // process lifetime; it is not a view/model subscription.
    ipcRenderer.on(MCP_EXECUTE, async (
        _event: IpcRendererEvent,
        requestId: string,
        method: string,
        params: McpParams,
    ) => {
        await handlerReady;
        const startTime = Date.now();
        let response: McpResponse;
        try {
            response = await dispatchMcpCommand(method, params);
        } catch (err) {
            response = { error: { code: -32603, message: errMessage(err, "Internal error") } };
        }
        logIncomingRequest(method, params, response, Date.now() - startTime);
        ipcRenderer.send(MCP_RESULT, requestId, response);
    });
}

/** Start serving queued and new requests; called once the app's event wiring is complete. */
export function markMcpHandlerReady(): void {
    markHandlerReady();
}
