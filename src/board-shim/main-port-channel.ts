import { frameEvent, frameRequest, readFrameEnvelope } from "../ipc/board-bridge/frame-protocol";
import type {
    BoardCallRequest, BoardFireMethod, BoardPortParams, BoardPortResult, BoardRpcMethod,
    BoardToMain, BoardToMainEvents, MainToBoardEvents,
} from "../ipc/board-bridge/port-protocol";
import { PendingRequests } from "../shared/pending-requests";
import { fromWireError } from "../shared/wire-error";
import { errMessage } from "../shared/utils";

type RouteName = keyof MainToBoardEvents;
type RouteHandler<E extends RouteName> = (payload: MainToBoardEvents[E]) => void;
type Hook = () => void;
interface HookRegistration { readonly handler: Hook }

const BOARD_CALL_DEAD_PORT_GUARD_MS = 2_147_000_000;
const DISPOSED_ERROR_MESSAGE = "The board page closed or navigated away.";

/** Owns one board frame's main-process port and its private RPC/event transport. */
export class MainPortChannel {
    private port: MessagePort | null = null;
    private readonly sendQueue: BoardToMain[] = [];
    private readonly pendingRpc = new PendingRequests<unknown>({
        timeoutError: () => new Error("persephone.call() timed out."),
    });
    private readonly routes = new Map<RouteName, RouteHandler<RouteName>>();
    private readonly replaceHooks: HookRegistration[] = [];
    private readonly messageErrorHooks: HookRegistration[] = [];
    private disposed = false;

    post(message: BoardToMain): void {
        if (this.disposed) return;
        if (this.port) this.port.postMessage(message);
        else this.sendQueue.push(message);
    }

    rpc<M extends BoardRpcMethod>(method: M, ...params: BoardPortParams<M>): Promise<BoardPortResult<M>> {
        if (this.disposed) return Promise.reject(new Error(DISPOSED_ERROR_MESSAGE));
        const callTimeout = method === "call" ? BOARD_CALL_DEAD_PORT_GUARD_MS : undefined;
        const { id, promise } = this.pendingRpc.create(callTimeout) as {
            id: number;
            promise: Promise<BoardPortResult<M>>;
        };
        try {
            this.post(frameRequest(id, method, params) as BoardToMain);
        } catch (error: unknown) {
            this.pendingRpc.fail(
                id,
                method === "call" ? new Error(errMessage(error, "Persephone host is unavailable.")) : error,
            );
        }
        return promise;
    }

    call(
        path: string,
        options?: { args?: unknown[]; value?: unknown; maxLength?: number; timeoutMs?: number },
    ): Promise<unknown> {
        if (this.disposed) return Promise.reject(new Error(DISPOSED_ERROR_MESSAGE));
        if (typeof path !== "string" || !path) return Promise.reject(new Error("persephone.call() needs a non-empty path."));
        if (options?.args !== undefined && !Array.isArray(options.args)) {
            return Promise.reject(new Error("persephone.call() options.args must be an array."));
        }
        if (options?.timeoutMs !== undefined && !isPositiveInteger(options.timeoutMs)) {
            return Promise.reject(new Error("persephone.call() options.timeoutMs must be a positive integer."));
        }
        const request: BoardCallRequest = {
            path,
            ...(options?.args !== undefined ? { args: options.args } : {}),
            ...(options && Object.prototype.hasOwnProperty.call(options, "value") ? { value: options.value } : {}),
            ...(options?.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
            ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        };
        return this.rpc("call", request);
    }

    fire(method: BoardFireMethod, args: unknown[]): void {
        if (this.disposed) return;
        if (method === "notify") this.post(frameEvent("notify", {
            message: String(args[0] ?? ""),
            ...(args[1] !== undefined ? { type: args[1] as BoardToMainEvents["notify"]["type"] } : {}),
            ...(args[2] === true ? { persistent: true } : {}),
        }) as BoardToMain);
    }

    replace(port: MessagePort): void {
        if (this.disposed) {
            closePort(port);
            return;
        }
        if (this.port === port) return;
        if (this.port) {
            this.detachAndClose(this.port);
            this.port = null;
            this.pendingRpc.failAll(new Error("Persephone bridge was replaced."));
            for (const { handler } of [...this.replaceHooks]) this.runHook(handler, "replacement");
        }
        this.port = port;
        port.onmessage = this.handleMessage;
        port.onmessageerror = this.handleMessageError;
        for (const message of this.sendQueue) port.postMessage(message);
        this.sendQueue.length = 0;
        port.postMessage(frameEvent("connected", {}));
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.pendingRpc.failAll(new Error(DISPOSED_ERROR_MESSAGE));
        this.sendQueue.length = 0;
        if (this.port) this.detachAndClose(this.port);
        this.port = null;
        this.routes.clear();
        this.replaceHooks.length = 0;
        this.messageErrorHooks.length = 0;
    }

    on<E extends RouteName>(name: E, handler: RouteHandler<E>): () => void {
        if (this.disposed) return () => {};
        if (this.routes.has(name)) throw new Error(`Main port route ${String(name)} is already registered.`);
        this.routes.set(name, handler as RouteHandler<RouteName>);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            if (this.routes.get(name) === handler) this.routes.delete(name);
        };
    }

    onReplace(handler: Hook): () => void { return this.addHook(this.replaceHooks, handler); }
    onMessageError(handler: Hook): () => void { return this.addHook(this.messageErrorHooks, handler); }

    private readonly handleMessage = (event: MessageEvent): void => {
        const data = readFrameEnvelope(event.data);
        if (!data) return;
        if (data.__persephone === "res") {
            if (typeof data.id !== "number") return;
            if (data.ok === true) this.pendingRpc.settle(data.id, data.value);
            else if (data.ok === false) this.pendingRpc.fail(data.id, fromWireError(data.error));
            return;
        }
        if (data.__persephone !== "evt") return;
        const handler = this.routes.get(data.name as RouteName);
        if (handler) handler(data.payload as MainToBoardEvents[RouteName]);
    };

    private readonly handleMessageError = (): void => {
        for (const { handler } of [...this.messageErrorHooks]) this.runHook(handler, "message-error");
    };

    private addHook(hooks: HookRegistration[], handler: Hook): () => void {
        if (this.disposed) return () => {};
        const registration = { handler };
        hooks.push(registration);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            const index = hooks.indexOf(registration);
            if (index >= 0) hooks.splice(index, 1);
        };
    }

    private runHook(hook: Hook, label: string): void {
        try { hook(); }
        catch (error: unknown) { console.error(`Main port ${label} hook failed:`, error); }
    }

    private detachAndClose(port: MessagePort): void {
        port.onmessage = null;
        port.onmessageerror = null;
        closePort(port);
    }
}

function closePort(port: MessagePort): void {
    try { port.close(); }
    catch (error: unknown) { console.error("Main port close failed:", error); }
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

