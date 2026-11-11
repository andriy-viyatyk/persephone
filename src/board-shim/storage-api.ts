import type { BoardJsonValue } from "../ipc/board-bridge/port-protocol";
import { validateBoardPageStateKey, validateBoardPageStateValue } from "../shared/board/page-state-validation";
import type { MainPortChannel } from "./main-port-channel";
import type { HostFrameChannel } from "./board-host-frame-channel";

export function createStorageApi(deps: { mainPort: MainPortChannel; hostFrame: HostFrameChannel }) {
    const { mainPort, hostFrame } = deps;
    return { api: {
        storage: {
            get(key: string): Promise<BoardJsonValue | undefined> { return mainPort.rpc("storageGet", key); },
            set(key: string, value: BoardJsonValue): Promise<void> { return mainPort.rpc("storageSet", key, value); },
            delete(key: string): Promise<boolean> { return mainPort.rpc("storageDelete", key); },
            keys(): Promise<string[]> { return mainPort.rpc("storageKeys"); },
        },
        pageState: {
            get(key: string): Promise<string | undefined> {
                try { validateBoardPageStateKey(key); } catch (error: unknown) { return Promise.reject(error); }
                return hostFrame.request("pageState.get", { key }).then((value) => {
                    if (value !== undefined && typeof value !== "string") throw new Error("Malformed persephone.pageState.get() response.");
                    return value;
                });
            },
            set(key: string, value: string): Promise<void> {
                try { validateBoardPageStateKey(key); validateBoardPageStateValue(value); }
                catch (error: unknown) { return Promise.reject(error); }
                return hostFrame.request("pageState.set", { key, value });
            },
            remove(key: string): Promise<void> {
                try { validateBoardPageStateKey(key); } catch (error: unknown) { return Promise.reject(error); }
                return hostFrame.request("pageState.remove", { key });
            },
        },
        clipboard: {
            writeImage(data: Uint8Array | ArrayBuffer): Promise<void> { return mainPort.rpc("clipboardWriteImage", data); },
            writeText(text: string): Promise<void> { return mainPort.rpc("clipboardWriteText", text); },
        },
    } };
}
