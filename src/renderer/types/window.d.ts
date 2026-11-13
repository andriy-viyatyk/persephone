import type { PreloadListenerChannel, PreloadOnceChannel, PreloadPortChannel, PreloadSendChannel } from "../../ipc/preload-channels";

declare global {
    /** Active script context set by ScriptContext.customRequire() during require() calls.
     *  Extension handlers read this to inject context prefix into library modules. */
    var __activeScriptContext__: import("../scripting/ScriptContext").ScriptContext | null;

    interface Window {
        electron: {
            ipcRenderer: {
                sendMessage(
                    channel: PreloadSendChannel,
                    ...args: unknown[]
                ): void;
                on(
                    channel: PreloadListenerChannel,
                    func: (...args: unknown[]) => void
                ): () => void;
                once(
                    channel: PreloadOnceChannel,
                    func: (...args: unknown[]) => void
                ): void;
                /** Ports-aware listener — surfaces a transferred
                 *  MessagePort (on `event.ports`) that `on`/`once` drop. */
                onPort(
                    channel: PreloadPortChannel,
                    func: (payload: unknown, ports: readonly MessagePort[]) => void
                ): () => void;
            };
            getPathForFile(file: File): string;
        };
    }
}

export {};
