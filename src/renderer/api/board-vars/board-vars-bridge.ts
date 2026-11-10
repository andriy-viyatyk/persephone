import { showCreateBoardVarsStorageDialog } from "../../ui/dialogs/CreateBoardVarsStorageDialog";
import { boardVars } from "./BoardEnvStore";
import { openEnvVarsPage } from "../../editors/env-vars/open-env-vars";
import { errMessage } from "../../../shared/utils";
import { SerialQueue } from "../../../shared/serial-queue";

// =============================================================================
// Board vars bridge orchestration.
//
// The single renderer-side entry point `BoardWebview` calls for every
// `persephone.var.*` request: loads the store (showing the "Create environment
// variables storage" dialog when unconfigured), then dispatches get/set/list
// against the CALLER'S namespace (resolved by `BoardWebview` from the board
// root — never supplied by the board itself).
//
// Requests are serialized so two boards hitting a locked/not-configured store
// at once can't each pop a password/create dialog.
// Coordinates loading, updates, and access to the board environment-variable store.
// =============================================================================

export interface BoardVarReply {
    result?: unknown;
    error?: string;
}

const requestQueue = new SerialQueue();

export function resolveBoardVarRequest(
    namespace: string,
    method: "get" | "set" | "list" | "show",
    args: unknown[],
): Promise<BoardVarReply> {
    return requestQueue.run(() => runVarRequest(namespace, method, args));
}

async function runVarRequest(
    namespace: string,
    method: "get" | "set" | "list" | "show",
    args: unknown[],
): Promise<BoardVarReply> {
    // "show" needs the store configured and unlocked to resolve the path that
    // `openEnvVarsPage()` opens.
    let load = await boardVars.ensureLoaded();

    if (load.status === "not-configured") {
        const created = await showCreateBoardVarsStorageDialog();
        if (!created) return { error: "Board environment variables storage is not configured." };
        load = await boardVars.ensureLoaded(); // setting changed → reset → reload
    }
    if (load.status === "locked") return { error: "Board environment variables file is locked." };
    if (load.status !== "ok") {
        return { error: load.message || "Failed to load the board environment variables." };
    }

    try {
        switch (method) {
            case "get":
                return {
                    result: boardVars.get(namespace, String(args[0] ?? ""), args[1] as string | undefined),
                };
            case "list":
                return { result: boardVars.list(namespace, args[0] as string | undefined) };
            case "set":
                await boardVars.set(
                    namespace,
                    String(args[0] ?? ""),
                    String(args[1] ?? ""),
                    args[2] as string | undefined,
                );
                return { result: undefined };
            case "show":
                await openEnvVarsPage(namespace);
                return { result: undefined };
            default:
                return { error: `Unknown var method: ${String(method)}` };
        }
    } catch (e) {
        return { error: errMessage(e) };
    }
}
