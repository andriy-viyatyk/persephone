import { app, type WebContents, type IpcMainEvent } from "electron";
import type { RendererRpcMethods } from "../../ipc/renderer-rpc";
import type { ServiceMainMessage, ServiceParentMessage } from "../../ipc/module-service-channels";
import { onWebContentsGone } from "../webcontents-lifetime";
import { openWindows } from "../open-windows";
import { requestRenderer } from "../renderer-rpc";
import { isCoded } from "../../shared/coded-error";
import { errMessage } from "../../shared/utils";
import { ServiceError, isStartedOrRunning, type ServiceRecord } from "./record";
import type { ModuleServiceProcess } from "./process";
import { SERVICE_REQUEST_DEADLINE_MS } from "../../ipc/module-service-channels";

export interface BoardSettingsSubscription {
    record: ServiceRecord;
    process: ModuleServiceProcess;
    subscriptionId: string;
    webContents?: WebContents;
    lifecycleListeners: Array<() => void>;
}

export interface BoardSettingsAdapterContext {
    isAllowed(record: ServiceRecord): boolean;
    selectRenderer(excluded?: WebContents): Promise<WebContents | undefined>;
}

type BoardSettingsRequest = Extract<ServiceMainMessage, { kind: "board-settings-get" | "board-settings-subscribe" | "board-settings-unsubscribe" }>;
type SettingsMethod = "serviceSettingsGet" | "serviceSettingsSubscribe" | "serviceSettingsUnsubscribe";

export class ServiceBoardSettingsAdapter {
    private readonly aborts = new Map<ServiceRecord, Set<AbortController>>();
    private readonly subscriptions = new Map<string, BoardSettingsSubscription>();

    constructor(private readonly context: BoardSettingsAdapterContext) {}

    start(): void {
        app.on("browser-window-created", (_event, window) => {
            window.webContents.once("did-finish-load", (): void => {
                for (const subscription of this.subscriptions.values()) {
                    if (!subscription.webContents) {
                        void this.install(subscription).catch((error: unknown): void => {
                            console.error(`Board settings subscription reinstall failed: ${errMessage(error)}`);
                        });
                    }
                }
            });
        });
    }

    handleChanged(event: IpcMainEvent, change: { subscriptionId: string; id: string; value: unknown }): void {
        if (!change || typeof change.subscriptionId !== "string" || typeof change.id !== "string"
            || !(typeof change.value === "string" || typeof change.value === "boolean"
                || (typeof change.value === "number" && Number.isFinite(change.value)))) return;
        const subscription = [...this.subscriptions.values()].find((candidate) => candidate.subscriptionId === change.subscriptionId);
        if (!subscription || subscription.webContents !== event.sender
            || subscription.record.current !== subscription.process
            || !isStartedOrRunning(subscription.record) || !this.context.isAllowed(subscription.record)) return;
        try {
            subscription.process.postMessage({ kind: "board-settings-changed", subscriptionId: subscription.subscriptionId,
                id: change.id, value: change.value } satisfies ServiceParentMessage);
        } catch { /* The generation check prevents forwarding to a replacement service. */ }
    }

    handle(record: ServiceRecord, process: ModuleServiceProcess, message: BoardSettingsRequest): void {
        void this.handleRequest(record, process, message);
    }

    settle(record: ServiceRecord, code: string): void {
        for (const controller of this.aborts.get(record) ?? []) controller.abort(new ServiceError(code));
    }

    removeForRecord(record: ServiceRecord): void {
        const subscription = this.subscriptions.get(record.key);
        if (subscription) this.remove(subscription);
    }

    private async handleRequest(record: ServiceRecord, process: ModuleServiceProcess, message: BoardSettingsRequest): Promise<void> {
        const post = (kind: "board-settings-response" | "board-settings-subscribe-response" | "board-settings-unsubscribe-response",
            payload: { result?: unknown; error?: { code: string; message: string } } = {}): void => {
            if (record.current !== process) return;
            try { process.postMessage({ kind, requestId: message.requestId, ...payload }); } catch { /* service exited */ }
        };
        try {
            if (typeof message.requestId !== "string" || !message.requestId) throw new ServiceError("service-error", "Malformed board settings request.");
            if (record.current !== process || !isStartedOrRunning(record) || record.stopRequested) throw new ServiceError("service-exited");
            if (!this.context.isAllowed(record)) throw new ServiceError("untrusted");
            if (message.kind === "board-settings-get") {
                if (typeof message.id !== "string" || !message.id.trim()) throw new ServiceError("service-error", "Board setting id must be a non-empty string.");
                const result = await this.requestRenderer(record, process, "serviceSettingsGet", { boardRoot: record.boardRoot, id: message.id.trim() });
                if (!(typeof result === "string" || typeof result === "boolean" || (typeof result === "number" && Number.isFinite(result)))) {
                    throw new ServiceError("service-error", "Board setting result must be a finite scalar.");
                }
                post("board-settings-response", { result });
                return;
            }
            if (typeof message.subscriptionId !== "string" || !message.subscriptionId) throw new ServiceError("service-error", "Malformed board settings subscription.");
            if (message.kind === "board-settings-subscribe") {
                const existing = this.subscriptions.get(record.key);
                if (existing && existing.subscriptionId !== message.subscriptionId) throw new ServiceError("service-busy", "A board settings subscription is already active.");
                const subscription = existing ?? { record, process, subscriptionId: message.subscriptionId, lifecycleListeners: [] };
                this.subscriptions.set(record.key, subscription);
                try { await this.install(subscription); }
                catch (error: unknown) { if (!existing) this.remove(subscription); throw error; }
                post("board-settings-subscribe-response");
                return;
            }
            const subscription = this.subscriptions.get(record.key);
            if (subscription?.subscriptionId === message.subscriptionId) {
                try {
                    await this.sendToWebContents(record, process, subscription.webContents, "serviceSettingsUnsubscribe",
                        { boardRoot: record.boardRoot, subscriptionId: message.subscriptionId }).catch((): undefined => undefined);
                } finally { this.remove(subscription); }
            }
            post("board-settings-unsubscribe-response");
        } catch (error: unknown) {
            const serviceError = this.toServiceError(error);
            const kind = message.kind === "board-settings-get" ? "board-settings-response"
                : message.kind === "board-settings-subscribe" ? "board-settings-subscribe-response" : "board-settings-unsubscribe-response";
            post(kind, { error: { code: serviceError.code, message: serviceError.message } });
        }
    }

    private async requestRenderer<M extends SettingsMethod>(record: ServiceRecord, process: ModuleServiceProcess,
        method: M, params: RendererRpcMethods[M]["params"], getRenderer: () => Promise<WebContents | undefined> | WebContents | undefined = () => this.context.selectRenderer()): Promise<RendererRpcMethods[M]["result"]> {
        const deadlineAt = Date.now() + SERVICE_REQUEST_DEADLINE_MS;
        const abort = new AbortController();
        const controllers = this.aborts.get(record) ?? new Set<AbortController>();
        controllers.add(abort);
        this.aborts.set(record, controllers);
        let stopWatching: (() => void) | undefined;
        try {
            const renderer = await getRenderer();
            abort.signal.throwIfAborted();
            if (!renderer || renderer.isDestroyed()) throw new ServiceError("service-exited", "No renderer window is available.");
            if (record.current !== process) throw new ServiceError("service-exited", "The service has exited.");
            const remainingMs = deadlineAt - Date.now();
            if (remainingMs <= 0) throw new ServiceError("service-timeout", "Service request timed out.");
            stopWatching = onWebContentsGone(renderer, () => abort.abort(new ServiceError("service-exited", "The renderer became unavailable.")), { repeat: true });
            const result = await requestRenderer(method, params, { webContents: renderer }, remainingMs, abort.signal);
            if (record.current !== process) throw new ServiceError("service-exited", "The service has exited.");
            return result;
        } catch (error: unknown) { throw this.toServiceError(error); }
        finally {
            stopWatching?.();
            controllers.delete(abort);
            if (!controllers.size) this.aborts.delete(record);
        }
    }

    private toServiceError(error: unknown): ServiceError {
        if (error instanceof ServiceError) return error;
        if (isCoded(error)) {
            if (error.code === "timeout") return new ServiceError("service-timeout", "Service request timed out.");
            if (error.code === "window-unavailable") return new ServiceError("service-exited", errMessage(error, "Renderer is unavailable."));
            if (["method-not-found", "invalid-params", "cancelled"].includes(error.code)) return new ServiceError("service-error", errMessage(error));
            return new ServiceError(error.code, errMessage(error));
        }
        return new ServiceError("service-error", errMessage(error, "Board settings request failed."));
    }

    private async install(subscription: BoardSettingsSubscription, excluded?: WebContents): Promise<void> {
        if (subscription.record.current !== subscription.process || !this.context.isAllowed(subscription.record)) throw new ServiceError("untrusted");
        const renderer = await this.context.selectRenderer(excluded);
        if (!renderer) throw new ServiceError("service-exited", "No renderer window is available.");
        await this.sendToWebContents(subscription.record, subscription.process, renderer, "serviceSettingsSubscribe",
            { boardRoot: subscription.record.boardRoot, subscriptionId: subscription.subscriptionId });
        if (subscription.record.current !== subscription.process) throw new ServiceError("service-exited");
        this.detach(subscription);
        subscription.webContents = renderer;
        const lost = (): void => {
            if (subscription.webContents !== renderer) return;
            this.detach(subscription);
            void this.reinstall(subscription, renderer);
        };
        subscription.lifecycleListeners.push(onWebContentsGone(renderer, lost, { repeat: true }));
    }

    private async reinstall(subscription: BoardSettingsSubscription, previous: WebContents): Promise<void> {
        if (subscription.record.current !== subscription.process
            || this.subscriptions.get(subscription.record.key) !== subscription) return;
        const others = openWindows.windows.some((entry) => entry.window && !entry.window.window.isDestroyed()
            && !entry.window.window.webContents.isDestroyed() && entry.window.window.webContents !== previous);
        if (!others && !previous.isDestroyed()) {
            previous.once("did-finish-load", (): void => {
                void this.install(subscription).catch((error: unknown): void => console.error(`Board settings subscription reinstall failed: ${errMessage(error)}`));
            });
            return;
        }
        try { await this.install(subscription, previous); }
        catch (error: unknown) { console.error(`Board settings subscription reinstall failed: ${errMessage(error)}`); }
    }

    private detach(subscription: BoardSettingsSubscription): void {
        for (const dispose of subscription.lifecycleListeners) dispose();
        subscription.lifecycleListeners = [];
        subscription.webContents = undefined;
    }

    private remove(subscription: BoardSettingsSubscription): void {
        if (subscription.webContents && !subscription.webContents.isDestroyed()) {
            void requestRenderer("serviceSettingsUnsubscribe", { boardRoot: subscription.record.boardRoot, subscriptionId: subscription.subscriptionId },
                { webContents: subscription.webContents }, SERVICE_REQUEST_DEADLINE_MS).catch((): undefined => undefined);
        }
        this.detach(subscription);
        if (this.subscriptions.get(subscription.record.key) === subscription) this.subscriptions.delete(subscription.record.key);
    }

    private sendToWebContents<M extends SettingsMethod>(record: ServiceRecord, process: ModuleServiceProcess,
        webContents: WebContents | undefined, method: M, params: RendererRpcMethods[M]["params"]): Promise<RendererRpcMethods[M]["result"]> {
        if (!webContents || webContents.isDestroyed()) throw new ServiceError("service-exited", "The renderer is unavailable.");
        return this.requestRenderer(record, process, method, params, () => webContents);
    }
}
