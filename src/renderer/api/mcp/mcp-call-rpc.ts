import type { RendererRpcServer } from "../renderer-rpc";
import { errMessage } from "../../../shared/utils";
import { handleCall } from "./call-command";
import { logIncomingRequest } from "./request-log";

export function registerMcpCallRpc(server: RendererRpcServer): void {
    server.register("mcpCall", async (params) => {
        const startedAt = Date.now();
        try {
            const result = await handleCall(params);
            logIncomingRequest("call", params, { result }, Date.now() - startedAt);
            return result;
        } catch (error: unknown) {
            logIncomingRequest("call", params, { error: errMessage(error, "Internal error") }, Date.now() - startedAt);
            throw error;
        }
    });
}
