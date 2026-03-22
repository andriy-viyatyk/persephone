import { Endpoint, EventEndpoint } from "../../ipc/api-types";

declare global {
    /** Script context globals injected into library modules via require() extension handlers. */
    var __scriptContext__: Record<string, any> | undefined;

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
