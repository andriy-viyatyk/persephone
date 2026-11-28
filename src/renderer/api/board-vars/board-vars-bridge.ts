import { showCreateBoardVarsStorageDialog } from "../../api/dialogs/CreateBoardVarsStorageDialog";
import { boardVars } from "./BoardEnvStore";
import { openEnvVarsPage } from "../../editors/env-vars/open-env-vars";
import { errMessage } from "../../../shared/utils";
import { SerialQueue } from "../../../shared/serial-queue";
import { codedError, isCoded } from "../../../shared/coded-error";

export interface BoardVarReply {
    result?: unknown;
    error?: string;
    code?: string;
}

const requestQueue = new SerialQueue();
type BoardVarMethod = "get" | "set" | "list" | "show" | "delete" | "keys";
let nextRequestId = 0;
let declinedThroughRequestId = 0;
let declinedReply: BoardVarReply | undefined;

export function resolveBoardVarRequest(namespace: string, method: BoardVarMethod, args: unknown[], signal?: AbortSignal): Promise<BoardVarReply> {
    const requestId = ++nextRequestId;
    return requestQueue.run(() => runVarRequest(namespace, method, args, signal, requestId));
}

async function runVarRequest(namespace: string, method: BoardVarMethod, args: unknown[], signal: AbortSignal | undefined, requestId: number): Promise<BoardVarReply> {
    // Requests already queued when a user declines share that decision. A later call gets a new id
    // and may ask again, but the same burst must not reopen the dialog for each queued operation.
    if (requestId <= declinedThroughRequestId && declinedReply) return { ...declinedReply };
    const throwIfAborted = (): void => { if (signal?.aborted) throw signal.reason ?? codedError("cancelled"); };
    let load;
    try {
        throwIfAborted();
        load = await boardVars.ensureLoaded();
        throwIfAborted();
    } catch (error: unknown) {
        return codedFailure(error, "board-vars-unavailable", "Failed to load the board environment variables.");
    }

    if (load.status === "not-configured") {
        try {
            throwIfAborted();
            const created = await showCreateBoardVarsStorageDialog();
            throwIfAborted();
            if (!created) return declineQueuedRequests(codedError("board-vars-declined", "Board environment variables storage is not configured."));
            load = await boardVars.ensureLoaded();
            throwIfAborted();
        } catch (error: unknown) {
            return codedFailure(error, "board-vars-unavailable", "Failed to create the board environment variables store.");
        }
    }
    if (load.status === "locked") return declineQueuedRequests(codedError("board-vars-declined", "Board environment variables file is locked."));
    if (load.status === "not-configured") return codedFailure(codedError("board-vars-unavailable", "Failed to load the board environment variables."), "board-vars-unavailable");
    if (load.status !== "ok") return codedFailure(codedError("board-vars-unavailable", load.message || "Failed to load the board environment variables."), "board-vars-unavailable");

    try {
        throwIfAborted();
        switch (method) {
            case "get":
                return { result: boardVars.get(namespace, String(args[0] ?? ""), args[1] as string | undefined) };
            case "list":
            case "keys":
                return { result: boardVars.list(namespace, args[0] as string | undefined) };
            case "set":
                throwIfAborted();
                await boardVars.set(namespace, String(args[0] ?? ""), String(args[1] ?? ""), args[2] as string | undefined);
                return { result: undefined };
            case "delete":
                throwIfAborted();
                await boardVars.delete(namespace, String(args[0] ?? ""), args[1] as string | undefined);
                return { result: undefined };
            case "show":
                await openEnvVarsPage(namespace);
                return { result: undefined };
        }
    } catch (error: unknown) {
        return codedFailure(error, isCoded(error) && error.code === "cancelled" ? "cancelled" : "board-vars-unavailable");
    }
}

function declineQueuedRequests(error: Error & { code: string }): BoardVarReply {
    declinedThroughRequestId = nextRequestId;
    declinedReply = codedFailure(error, "board-vars-declined");
    return { ...declinedReply };
}

function codedFailure(error: unknown, code: string, fallback = "Board environment variables request failed."): BoardVarReply {
    const preservedCodes = ["board-vars-declined", "board-vars-unavailable", "cancelled", "service-exited", "untrusted", "window-unavailable"];
    return { error: errMessage(error, fallback), code: isCoded(error) && preservedCodes.includes(error.code) ? error.code : code };
}
