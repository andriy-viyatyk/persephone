import { BoardServiceSettingsChannel, type BoardServiceSettingsChange } from "../../ipc/board-service-settings-channels";
import { getBoardSetting, initializeBoardSettings, subscribeBoardSettings } from "./board-settings/board-settings-bridge";
import { boardRegistry } from "./boards/board-registry";
import { readBoardManifest } from "./boards/board-manifest-io";
import { BoardRoot } from "../../shared/board/board-root";
import { codedError, toCodedError } from "../../shared/coded-error";
import type { RendererRpcServer } from "./renderer-rpc";

const subscriptions = new Map<string, () => void>();

function isScalar(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

async function validateBoardRoot(boardRoot: unknown): Promise<string> {
    if (typeof boardRoot !== "string" || !boardRoot.trim()) throw new Error("service-exited");
    await boardRegistry.load();
    const root = BoardRoot.tryFrom(boardRoot);
    if (!root) throw new Error("service-exited");
    if (!boardRegistry.isPermitted(boardRoot)) throw codedError("untrusted");
    if (!await readBoardManifest(boardRoot)) throw codedError("service-exited");
    return boardRoot;
}

export function registerBoardServiceSettingsRpc(server: RendererRpcServer): void {
    server.register("serviceSettingsGet", ({ boardRoot, id }) => asSettingsRequest(async () => {
        const root = await validateBoardRoot(boardRoot);
        if (typeof id !== "string" || !id.trim()) throw new Error("Board setting id must be a non-empty string.");
        const result = await getBoardSetting(root, id.trim());
        if (!isScalar(result)) throw new Error("Board setting result must be a finite scalar.");
        return result;
    }));
    server.register("serviceSettingsSubscribe", (params: { boardRoot: string; subscriptionId: string }): Promise<null> => {
        const { boardRoot, subscriptionId } = params;
        return asSettingsRequest(async (): Promise<null> => {
            const root = await validateBoardRoot(boardRoot);
            if (typeof subscriptionId !== "string" || !subscriptionId) throw new Error("Malformed board settings subscription.");
            if (!subscriptions.has(subscriptionId)) {
                await initializeBoardSettings();
                subscriptions.set(subscriptionId, subscribeBoardSettings(root, ({ id, value }) => {
                    if (!isScalar(value)) return;
                    window.electron.ipcRenderer.sendMessage(BoardServiceSettingsChannel.changed, { subscriptionId, id, value } satisfies BoardServiceSettingsChange);
                }));
            }
            return null;
        });
    });
    server.register("serviceSettingsUnsubscribe", (params: { boardRoot: string; subscriptionId: string }): null => {
        const { subscriptionId } = params;
        if (typeof subscriptionId === "string") { subscriptions.get(subscriptionId)?.(); subscriptions.delete(subscriptionId); }
        return null;
    });
}

/** Keeps the pre-RPC error contract: a coded error keeps its code, anything else becomes `service-error`. */
function asSettingsRequest<T>(work: () => Promise<T>): Promise<T> {
    return work().catch((error: unknown) => { throw toCodedError(error, "service-error", { fallbackMessage: "Board settings request failed." }); });
}
