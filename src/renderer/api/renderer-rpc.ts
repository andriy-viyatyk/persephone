// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcRenderer } = require("electron");
import type { IpcRendererEvent } from "electron";
import { RendererRpcChannel, type RendererRpcMethod, type RendererRpcMethods } from "../../ipc/renderer-rpc";
import { toWireError, wireError } from "../../shared/wire-error";

type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

export class RendererRpcServer {
    private readonly handlers = new Map<RendererRpcMethod, RpcHandler>();
    private handlerRegistered = false;
    private markHandlerReady: () => void = () => undefined;
    private readonly handlerReady = new Promise<void>((resolve) => { this.markHandlerReady = resolve; });

    register<M extends RendererRpcMethod>(
        method: M,
        handler: (params: RendererRpcMethods[M]["params"]) => Promise<RendererRpcMethods[M]["result"]> | RendererRpcMethods[M]["result"],
    ): void {
        if (this.handlers.has(method)) throw new Error(`Renderer RPC handler already registered: ${method}`);
        this.handlers.set(method, (params) => handler(params as RendererRpcMethods[M]["params"]));
    }

    init(): void {
        if (this.handlerRegistered) return;
        this.handlerRegistered = true;
        ipcRenderer.on(RendererRpcChannel.request, async (
            _event: IpcRendererEvent,
            requestId: string,
            method: string,
            params: unknown,
        ) => {
            await this.handlerReady;
            const handler = this.handlers.get(method as RendererRpcMethod);
            let reply: { ok: true; result: unknown } | { ok: false; error: ReturnType<typeof toWireError> };
            if (!handler) {
                reply = { ok: false, error: wireError(`Method not found: ${method}`, "method-not-found") };
            } else {
                try {
                    reply = { ok: true, result: await handler(params) };
                } catch (error: unknown) {
                    reply = { ok: false, error: toWireError(error, "Internal error") };
                }
            }
            ipcRenderer.send(RendererRpcChannel.reply, requestId, reply);
        });
    }

    markReady(): void {
        this.markHandlerReady();
    }
}

export const rendererRpc = new RendererRpcServer();
