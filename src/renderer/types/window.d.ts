import { Endpoint, EventEndpoint } from "../../ipc/api-types";
import type { BoardPipeChannel } from "../../ipc/board-pipe-channels";

declare global {
    /** Active script context set by ScriptContext.customRequire() during require() calls.
     *  Extension handlers read this to inject context prefix into library modules. */
    var __activeScriptContext__: import("../scripting/ScriptContext").ScriptContext | null;

    interface Window {
        electron: {
            ipcRenderer: {
                sendMessage(
                    channel: Endpoint | EventEndpoint | BoardPipeChannel | PreloadEvent,
                    ...args: unknown[]
                ): void;
                on(
                    channel: Endpoint | `${Endpoint}_${number}` | EventEndpoint | BoardPipeChannel,
                    func: (...args: unknown[]) => void
                ): () => void;
                once(
                    channel: Endpoint | `${Endpoint}_${number}` | BoardPipeChannel,
                    func: (...args: unknown[]) => void
                ): void;
                /** Ports-aware listener (EPIC-037 / US-771) — surfaces a transferred
                 *  MessagePort (on `event.ports`) that `on`/`once` drop. */
                onPort(
                    channel: EventEndpoint,
                    func: (payload: unknown, ports: readonly MessagePort[]) => void
                ): () => void;
            };
            getPathForFile(file: File): string;
        };
    }
}

export {};
