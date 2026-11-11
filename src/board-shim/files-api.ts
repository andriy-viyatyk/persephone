import type { PathWatchBatch } from "../ipc/api-types";
import type { MainPortChannel } from "./main-port-channel";
import { errMessage } from "../shared/utils";
import type { BoardWatchOptions } from "../ipc/board-bridge/port-protocol";

export function createFilesApi(deps: { mainPort: MainPortChannel }) {
    const { mainPort } = deps;
    const watchCallbacks = new Map<number, (batch: PathWatchBatch) => void>();
    let watchIdCounter = 0;

    mainPort.on("watch", (payload) => {
        const callback = watchCallbacks.get(payload.watchId);
        if (!callback) return;
        try { callback(payload.batch); }
        catch (error: unknown) { console.error("persephone.watch callback error:", errMessage(error)); }
        if (payload.batch.ended) watchCallbacks.delete(payload.watchId);
    });
    mainPort.onReplace(() => watchCallbacks.clear());

    const api = {
        openFileDialog(params?: unknown): Promise<string[] | undefined> {
            return mainPort.rpc("openFileDialog", params ?? {});
        },
        saveFileDialog(params?: unknown): Promise<string | undefined> {
            return mainPort.rpc("saveFileDialog", params ?? {});
        },
        openFolderDialog(params?: unknown): Promise<string[] | undefined> {
            return mainPort.rpc("openFolderDialog", params ?? {});
        },
        listFolder(path: string, options?: unknown): Promise<unknown> {
            return mainPort.rpc("listFolder", path, options ?? {});
        },
        watch(path: string, callback: (batch: PathWatchBatch) => void, options?: BoardWatchOptions): Promise<() => void> {
            if (typeof callback !== "function") {
                return Promise.reject(Object.assign(new Error("persephone.watch() needs a callback function."), { code: "invalid-argument" }));
            }
            if (watchIdCounter >= Number.MAX_SAFE_INTEGER) return Promise.reject(new Error("persephone.watch() exhausted its local watch ids."));
            const watchId = ++watchIdCounter;
            watchCallbacks.set(watchId, callback);
            return mainPort.rpc("watch", watchId, path, options).then(() => {
                let disposed = false;
                return () => {
                    if (disposed) return;
                    disposed = true;
                    watchCallbacks.delete(watchId);
                    void mainPort.rpc("unwatch", watchId).catch((error: unknown) => {
                        console.warn("persephone.watch disposer failed:", errMessage(error));
                    });
                };
            }, (error: unknown) => {
                watchCallbacks.delete(watchId);
                throw error;
            });
        },
        rememberFolder(path: string): Promise<boolean> { return mainPort.rpc("rememberFolder", path); },
        rememberFile(path: string): Promise<boolean> { return mainPort.rpc("rememberFile", path); },
        getFileAccess(path: string): Promise<{ read: boolean; write: boolean }> { return mainPort.rpc("getFileAccess", path); },
        readFile(path: string, options?: { encoding?: "utf8" | "base64" | "binary" }): Promise<string | Uint8Array> {
            return mainPort.rpc("readFile", path, options?.encoding);
        },
        writeFile(path: string, data: string | Uint8Array | ArrayBuffer, options?: { encoding?: "utf8" | "base64" | "binary" }): Promise<void> {
            return mainPort.rpc("writeFile", path, data, options?.encoding);
        },
        trashFile(path: string): Promise<void> { return mainPort.rpc("trashFile", path); },
        registerTypeScriptProject(root: string): Promise<void> { return mainPort.rpc("registerTypeScriptProject", root); },
        unregisterTypeScriptProject(root: string): Promise<void> { return mainPort.rpc("unregisterTypeScriptProject", root); },
        openBoard(folder: string): Promise<void> { return mainPort.rpc("openBoard", folder); },
    };

    return { api };
}
