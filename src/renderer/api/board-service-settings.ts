import { BoardServiceSettingsChannel, type BoardServiceSettingsRequest, type BoardServiceSettingsReply } from "../../ipc/board-service-settings-channels";
import { getBoardSetting, initializeBoardSettings, subscribeBoardSettings } from "./board-settings/board-settings-bridge";
import { boardTrust } from "./boards/board-trust";
import { bundledBoardRegistry } from "./boards/bundled-board-registry";
import { readBoardManifest } from "./boards/board-manifest-io";
import { BoardRoot } from "../../shared/board/board-root";
import { codedError } from "../../shared/coded-error";
import { toWireError } from "../../shared/wire-error";

const subscriptions = new Map<string, () => void>();
let initialized = false;

function isScalar(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

async function validateBoardRoot(boardRoot: unknown): Promise<string> {
    if (typeof boardRoot !== "string" || !boardRoot.trim()) throw new Error("service-exited");
    await Promise.all([boardTrust.load(), bundledBoardRegistry.ensureInitialized()]);
    const root = BoardRoot.tryFrom(boardRoot);
    if (!root) throw new Error("service-exited");
    const bundled = bundledBoardRegistry.list().some((entry) => root.equals(entry.root));
    if (!bundled && !boardTrust.isTrusted(boardRoot)) throw codedError("untrusted");
    if (!await readBoardManifest(boardRoot)) throw codedError("service-exited");
    return boardRoot;
}

function reply(channel: typeof BoardServiceSettingsChannel.getReply | typeof BoardServiceSettingsChannel.subscribeReply | typeof BoardServiceSettingsChannel.unsubscribeReply, requestId: string, values: Omit<BoardServiceSettingsReply, "requestId">): void {
    window.electron.ipcRenderer.sendMessage(channel, { requestId, ...values });
}

/** Install the main-only service settings IPC adapter once per renderer process. */
export function initBoardServiceSettings(): void {
    if (initialized) return;
    initialized = true;
    window.electron.ipcRenderer.on(BoardServiceSettingsChannel.get, (request: BoardServiceSettingsRequest) => {
        void (async () => {
            try {
                const boardRoot = await validateBoardRoot(request.boardRoot);
                if (typeof request.id !== "string" || !request.id.trim()) {
                    throw new Error("Board setting id must be a non-empty string.");
                }
                const result = await getBoardSetting(boardRoot, request.id.trim());
                if (!isScalar(result)) throw new Error("Board setting result must be a finite scalar.");
                reply(BoardServiceSettingsChannel.getReply, request.requestId, { ok: true, result });
            } catch (error: unknown) {
                reply(BoardServiceSettingsChannel.getReply, request.requestId, { ok: false, error: toWireError(error, "Board settings request failed.", "service-error") });
            }
        })();
    });
    window.electron.ipcRenderer.on(BoardServiceSettingsChannel.subscribe, (request: BoardServiceSettingsRequest) => {
        void (async () => {
            try {
                const boardRoot = await validateBoardRoot(request.boardRoot);
                if (typeof request.subscriptionId !== "string" || !request.subscriptionId) throw new Error("Malformed board settings subscription.");
                if (!subscriptions.has(request.subscriptionId)) {
                    await initializeBoardSettings();
                    const stop = subscribeBoardSettings(boardRoot, ({ id, value }) => {
                        if (!isScalar(value)) return;
                        window.electron.ipcRenderer.sendMessage(BoardServiceSettingsChannel.changed, {
                            subscriptionId: request.subscriptionId,
                            id,
                            value,
                        });
                    });
                    subscriptions.set(request.subscriptionId, stop);
                }
                reply(BoardServiceSettingsChannel.subscribeReply, request.requestId, { ok: true });
            } catch (error: unknown) {
                reply(BoardServiceSettingsChannel.subscribeReply, request.requestId, { ok: false, error: toWireError(error, "Board settings request failed.", "service-error") });
            }
        })();
    });
    window.electron.ipcRenderer.on(BoardServiceSettingsChannel.unsubscribe, (request: BoardServiceSettingsRequest) => {
        if (typeof request.subscriptionId === "string") {
            subscriptions.get(request.subscriptionId)?.();
            subscriptions.delete(request.subscriptionId);
        }
        reply(BoardServiceSettingsChannel.unsubscribeReply, request.requestId, { ok: true });
    });
}

