import { frameResponse, readFrameEnvelope } from "../../../ipc/board-bridge/frame-protocol";
import type { BoardRpcMethod, BoardPortParams } from "../../../ipc/board-bridge/port-protocol";
import { BoardGrant } from "../../../shared/board/board-grant";
import { toWireError } from "../../../shared/wire-error";
import { boardTrustService } from "../../board-trust-service";
import { boardFileAccess } from "../../board-file-access";
import { BoardRpcError, asBoardRpcError } from "./errors";
import type { BoardRpcHandlerTable } from "./types";
import type { BoardBridgeConnection } from "../BoardBridgeConnection";

export interface BoardRpcDispatcher {
    dispatchEvent(connection: BoardBridgeConnection, data: unknown): void;
}

export async function runRpc<M extends BoardRpcMethod>(
    entry: BoardBridgeConnection,
    method: M,
    params: unknown[],
    handlers: BoardRpcHandlerTable,
): Promise<unknown> {
    if (!Object.prototype.hasOwnProperty.call(handlers, method)) {
        throw new Error(`Unknown board RPC method: ${method}`);
    }
    const handler = handlers[method];
    const permission = handler.permission;
    if (permission === "service-interface" && !boardTrustService.getGrantedUsesFromSnapshot(entry.root).length) {
        throw new BoardRpcError("permission-denied", BoardGrant.deny("service interface").message);
    }
    if (permission === "service" && !(await boardTrustService.allows(entry.root, "service"))) {
        throw new BoardRpcError("permission-denied", BoardGrant.deny("service").message);
    }
    if (permission === "dialog") await boardFileAccess.requireDialogPermission(entry.root);
    if (handler.liveFrameOnly && (!entry.isCurrent() || !entry.token || entry.hostWebContents.isDestroyed())) {
        throw new BoardRpcError("cancelled", "The board frame is closed.");
    }
    return handler.handle(entry, ...(params as BoardPortParams<M>));
}

export function handleBoardMessage(
    entry: BoardBridgeConnection,
    raw: unknown,
    handlers: BoardRpcHandlerTable,
    dispatcher: BoardRpcDispatcher,
): void {
    if (!entry.isCurrent()) return;
    const data = readFrameEnvelope(raw);
    if (!data) return;
    if (data.__persephone === "req") {
        const { id, method, params } = data;
        if (!Array.isArray(params) || !Object.prototype.hasOwnProperty.call(handlers, method)) return;
        void runRpc(entry, method as BoardRpcMethod, params, handlers)
            .then((value) => {
                if (entry.isCurrent()) entry.port.postMessage(frameResponse(id, { ok: true, value }));
            })
            .catch((error: unknown) => {
                if (entry.isCurrent()) {
                    entry.port.postMessage(frameResponse(id, { ok: false, error: toWireError(asBoardRpcError(error)) }));
                }
            });
        return;
    }
    if (data.__persephone === "evt") dispatcher.dispatchEvent(entry, data);
}
