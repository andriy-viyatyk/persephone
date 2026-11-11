// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcRenderer } = require("electron");
import type { IpcRendererEvent } from "electron";
import { RendererRpcChannel, type RendererRpcMethod, type RendererRpcMethods } from "../../ipc/renderer-rpc";
import { codedError } from "../../shared/coded-error";
import { toWireError, wireError } from "../../shared/wire-error";

type RpcHandler = (params: unknown, signal: AbortSignal) => Promise<unknown> | unknown;

export class RendererRpcServer {
    private readonly handlers = new Map<RendererRpcMethod, RpcHandler>();
    private readonly inflight = new Map<string, AbortController>();
    private handlerRegistered = false;
    private markHandlerReady: () => void = () => undefined;
    private readonly handlerReady = new Promise<void>((resolve) => { this.markHandlerReady = resolve; });

    register<M extends RendererRpcMethod>(
        method: M,
        handler: (params: RendererRpcMethods[M]["params"], signal: AbortSignal) => Promise<RendererRpcMethods[M]["result"]> | RendererRpcMethods[M]["result"],
    ): void {
        if (this.handlers.has(method)) throw new Error(`Renderer RPC handler already registered: ${method}`);
        this.handlers.set(method, (params, signal) => handler(params as RendererRpcMethods[M]["params"], signal));
    }

    init(): void {
        if (this.handlerRegistered) return;
        this.handlerRegistered = true;
        ipcRenderer.on(RendererRpcChannel.cancel, (_event: IpcRendererEvent, requestId: string) => {
            const controller = typeof requestId === "string" ? this.inflight.get(requestId) : undefined;
            if (!controller) return;
            this.inflight.delete(requestId);
            controller.abort(codedError("cancelled"));
        });
        ipcRenderer.on(RendererRpcChannel.request, async (
            _event: IpcRendererEvent,
            requestId: string,
            method: string,
            params: unknown,
        ) => {
            const controller = new AbortController();
            this.inflight.set(requestId, controller);
            try {
                await this.handlerReady;
                if (controller.signal.aborted) return;
                const handler = this.handlers.get(method as RendererRpcMethod);
                let reply: { ok: true; result: unknown } | { ok: false; error: ReturnType<typeof toWireError> };
                if (!handler) {
                    reply = { ok: false, error: wireError(`Method not found: ${method}`, "method-not-found") };
                } else {
                    try {
                        reply = { ok: true, result: await handler(params, controller.signal) };
                    } catch (error: unknown) {
                        reply = { ok: false, error: toWireError(error, "Internal error") };
                    }
                }
                if (controller.signal.aborted) return;
                ipcRenderer.send(RendererRpcChannel.reply, requestId, reply);
            } finally {
                if (this.inflight.get(requestId) === controller) this.inflight.delete(requestId);
            }
        });
    }

    markReady(): void {
        this.markHandlerReady();
    }
}

export const rendererRpc = new RendererRpcServer();
