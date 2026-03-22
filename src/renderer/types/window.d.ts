import { Endpoint, EventEndpoint } from "../../ipc/api-types";

declare global {
    /** Active script context set by ScriptContext.customRequire() during require() calls.
     *  Extension handlers read this to inject context prefix into library modules. */
    var __activeScriptContext__: import("../scripting/ScriptContext").ScriptContext | null;

    interface Window {
        electron: {
            ipcRenderer: {
                sendMessage(
                    channel: Endpoint | EventEndpoint | PreloadEvent,
                    ...args: unknown[]
                ): void;
                on(
                    channel: Endpoint | `${Endpoint}_${number}` | EventEndpoint,
                    func: (...args: unknown[]) => void
                ): () => void;
                once(
                    channel: Endpoint | `${Endpoint}_${number}`,
                    func: (...args: unknown[]) => void
                ): void;
            };
            getPathForFile(file: File): string;
        };
    }
}

export {};
