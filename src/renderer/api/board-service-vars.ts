import { codedError, toCodedError } from "../../shared/coded-error";
import type { RendererRpcServer } from "./renderer-rpc";
import { validateBoardServiceRoot } from "./board-service-validation";
import { resolveBoardNamespace } from "./boards/board-namespace";
import { resolveBoardVarRequest } from "./board-vars/board-vars-bridge";

export function registerBoardServiceVarsRpc(server: RendererRpcServer): void {
    server.register("serviceBoardVar", async ({ boardRoot, operation, args }, signal) => {
        try {
            const root = await validateBoardServiceRoot(boardRoot);
            if (operation !== "get" && operation !== "set" && operation !== "delete" && operation !== "keys") {
                throw codedError("invalid-params", "Malformed board environment variables request.");
            }
            if (!Array.isArray(args)) throw codedError("invalid-params", "Malformed board environment variables request.");
            signal.throwIfAborted();
            const namespace = await resolveBoardNamespace(root);
            signal.throwIfAborted();
            const method = operation === "keys" ? "keys" : operation;
            const reply = await resolveBoardVarRequest(namespace, method, args, signal);
            if (reply.error !== undefined) throw codedError(reply.code ?? "board-vars-unavailable", reply.error);
            return reply.result;
        } catch (error: unknown) {
            throw toCodedError(error, "service-error", { fallbackMessage: "Board environment variables request failed." });
        }
    });
}
