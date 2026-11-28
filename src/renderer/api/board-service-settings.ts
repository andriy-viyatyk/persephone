import { BoardServiceSettingsChannel, type BoardServiceSettingsChange } from "../../ipc/board-service-settings-channels";
import { getBoardSetting, initializeBoardSettings, subscribeBoardSettings } from "./board-settings/board-settings-bridge";
import { toCodedError } from "../../shared/coded-error";
import { validateBoardServiceRoot } from "./board-service-validation";
import type { RendererRpcServer } from "./renderer-rpc";

const subscriptions = new Map<string, () => void>();

function isScalar(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

export function registerBoardServiceSettingsRpc(server: RendererRpcServer): void {
    server.register("serviceSettingsGet", ({ boardRoot, id }) => asSettingsRequest(async () => {
        const root = await validateBoardServiceRoot(boardRoot);
        if (typeof id !== "string" || !id.trim()) throw new Error("Board setting id must be a non-empty string.");
        const result = await getBoardSetting(root, id.trim());
        if (!isScalar(result)) throw new Error("Board setting result must be a finite scalar.");
        return result;
    }));
    server.register("serviceSettingsSubscribe", (params: { boardRoot: string; subscriptionId: string }): Promise<null> => {
        const { boardRoot, subscriptionId } = params;
        return asSettingsRequest(async (): Promise<null> => {
            const root = await validateBoardServiceRoot(boardRoot);
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
