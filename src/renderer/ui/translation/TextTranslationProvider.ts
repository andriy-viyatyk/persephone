import { api } from "../../../ipc/renderer/api";
import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../../ipc/module-service-channels";
import type { BoardServiceProvider } from "../../../ipc/board-bridge-channels";
import { errMessage } from "../../../shared/utils";
import { createTranslationServiceChannel, type TranslationServiceChannel } from "./TranslationServiceChannel";

const DESCRIBE_TIMEOUT_MS = 4000;
const MAX_TRANSLATE_CHANNELS = 4;
const MAX_CHANNELS_PER_HOST_BOARD = 15;
const PRIORITIES = ["visible", "near", "background"] as const;
let sharedProvider: TextTranslationProvider | undefined;

/** One provider transport and four-channel translation window per renderer. */
export function getTextTranslationProvider(): TextTranslationProvider {
    return sharedProvider ??= new TextTranslationProvider();
}

export type TranslationPriority = typeof PRIORITIES[number];
export type TranslationFormat = "text" | "html";
export interface TranslationPair { from: string; to: string; installed: boolean; sizeBytes: number }
export interface TranslationDescription { type: "description"; engine: string; model: string; pairs: TranslationPair[]; features: string[] }
export interface TranslationCandidate { language: string; score: number }
export interface TranslationDetection { type: "detection"; language: string; confidence: "high" | "low"; sampleChars: number; candidates: TranslationCandidate[] }
export interface TranslationProgress { type: "progress"; id: string; done: number; total: number }
export interface TranslationItem { key: string; text: string; format: TranslationFormat }
export type TranslationItemResult = { key: string; ok: true; text: string } | { key: string; ok: false; error: { code: string; message: string } };
export interface TranslationResult { type: "result"; id: string; items: TranslationItemResult[] }
export interface TranslationDownloadResult { type: "download-result"; from: string; to: string; installed: true }
export interface TranslationDownloadProgress { type: "download-progress"; from: string; to: string; leg: { from: string; to: string }; loadedBytes: number; totalBytes: number }
export interface TranslationBatch { id: string; from?: string; to: string; priority?: TranslationPriority; items: TranslationItem[] }
export interface TranslationOperation<T> { promise: Promise<T>; cancel(): void }

interface OperationState<T> {
    provider: string;
    scope: string;
    translate: boolean;
    priority: TranslationPriority;
    request: unknown;
    expected: string[];
    onProgress?: (message: TranslationDownloadProgress | TranslationProgress) => void;
    channel?: TranslationServiceChannel;
    cancelled: boolean;
    settled: boolean;
    resolve(value: T): void;
    reject(error: Error): void;
    cancel(): void;
}

function codedError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}

function priorityOrder(priority: TranslationPriority): number { return PRIORITIES.indexOf(priority); }

/** Host consumer for text.translate@1. Translation batches are isolated to one channel each. */
export class TextTranslationProvider {
    private readonly pendingPorts = new Map<string, MessagePort>();
    private readonly portWaiters = new Map<string, { resolve(port: MessagePort): void; reject(error: Error): void }>();
    private readonly operations = new Set<OperationState<unknown>>();
    private readonly queuedTranslations: OperationState<TranslationResult>[] = [];
    private readonly queuedControls: OperationState<unknown>[] = [];
    private readonly activeChannels = new Set<OperationState<unknown>>();
    private readonly activeTranslations = new Set<OperationState<TranslationResult>>();
    private readonly unsubscribe: () => void;
    private disposed = false;

    public constructor() {
        this.unsubscribe = api.onBoardServiceChannel((boardId, channelId, port) => {
            if (this.disposed || !boardId.startsWith("text-translation:")) { port.close(); return; }
            const waiter = this.portWaiters.get(channelId);
            if (waiter) { this.portWaiters.delete(channelId); waiter.resolve(port); }
            else this.pendingPorts.set(channelId, port);
        });
    }

    public async list(): Promise<BoardServiceProvider[]> {
        return (await api.getBoardServiceProviders("text.translate")).filter((provider) => provider.version === 1);
    }

    public describe(provider: string, scope = "global"): TranslationOperation<TranslationDescription> {
        return this.createOperation(provider, { type: "describe" }, scope, ["description"], false);
    }

    public detect(provider: string, text: string, htmlLang?: string, scope = "global"): TranslationOperation<TranslationDetection> {
        if (Array.from(text).length > 4096) throw codedError("too-large", "Detection samples may contain at most 4,096 characters.");
        return this.createOperation(provider, { type: "detect", text, ...(htmlLang ? { htmlLang } : {}) }, scope, ["detection"], false);
    }

    public translate(provider: string, batch: TranslationBatch, scope: string, onProgress?: (message: TranslationProgress) => void): TranslationOperation<TranslationResult> {
        if (batch.items.length > 32 || batch.items.reduce((total, item) => total + Array.from(item.text).length, 0) > 64000) {
            throw codedError("too-large", "Translation batches are limited to 32 items and 64,000 code points.");
        }
        if (new Set(batch.items.map((item) => item.key)).size !== batch.items.length) {
            throw codedError("invalid-argument", "Translation item keys must be unique within a batch.");
        }
        const state = this.createState<TranslationResult>(provider, { type: "translate", ...batch }, scope, ["result"], true, batch.priority ?? "background", onProgress);
        this.queuedTranslations.push(state);
        this.drainTranslations();
        return { promise: this.promiseFor(state), cancel: state.cancel };
    }

    public download(provider: string, from: string, to: string, scope = "global", onProgress?: (message: TranslationDownloadProgress) => void): TranslationOperation<TranslationDownloadResult> {
        return this.createOperation(provider, { type: "download", from, to }, scope, ["download-result"], false, "background", onProgress);
    }

    public cancelScope(scope: string): void {
        for (const operation of [...this.operations]) if (operation.scope === scope) operation.cancel();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
        for (const operation of [...this.operations]) operation.cancel();
        this.pendingPorts.forEach((port) => port.close());
        this.pendingPorts.clear();
        this.portWaiters.forEach((waiter) => waiter.reject(codedError("cancelled", "Translation provider disposed.")));
        this.portWaiters.clear();
        this.queuedTranslations.length = 0;
        this.queuedControls.length = 0;
    }

    private createOperation<T>(provider: string, request: unknown, scope: string, expected: string[], translate: boolean, priority: TranslationPriority = "background", onProgress?: (message: TranslationDownloadProgress | TranslationProgress) => void): TranslationOperation<T> {
        const state = this.createState<T>(provider, request, scope, expected, translate, priority, onProgress);
        this.queuedControls.push(state as OperationState<unknown>);
        this.drainControls();
        return { promise: this.promiseFor(state), cancel: state.cancel };
    }

    private createState<T>(provider: string, request: unknown, scope: string, expected: string[], translate: boolean, priority: TranslationPriority, onProgress?: (message: TranslationDownloadProgress | TranslationProgress) => void): OperationState<T> {
        let resolvePromise!: (value: T) => void;
        let rejectPromise!: (error: Error) => void;
        const state: OperationState<T> = {
            provider, request, scope, expected, translate, priority, onProgress,
            cancelled: false, settled: false,
            resolve: (value: T) => { state.settled = true; resolvePromise(value); },
            reject: (error: Error) => { state.settled = true; rejectPromise(error); },
            cancel: () => {
                if (state.settled || state.cancelled) return;
                state.cancelled = true;
                try { state.channel?.send({ type: "cancel" }); } catch { /* the provider may already have closed */ }
                state.channel?.close({ code: "cancelled", message: "Translation operation cancelled." });
                state.reject(codedError("cancelled", "Translation operation cancelled."));
                this.finishState(state as OperationState<unknown>);
            },
        };
        this.operations.add(state as OperationState<unknown>);
        return state;
    }

    private promiseFor<T>(state: OperationState<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            state.resolve = (value) => { state.settled = true; resolve(value); };
            state.reject = (error) => { state.settled = true; reject(error); };
        });
    }

    private async run<T>(state: OperationState<T>): Promise<void> {
        let channel: TranslationServiceChannel | undefined;
        let removeMessage = (): void => undefined;
        let removeClose = (): void => undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const connect = api.connectHostServiceChannel({
                interfaceId: "text.translate", provider: state.provider, version: 1, openMessage: state.request,
            });
            const channelId = await this.withTimeout(connect, SERVICE_CHANNEL_OPEN_TIMEOUT_MS, "Translation provider channel did not open.");
            const port = await this.waitForPort(channelId);
            if (state.cancelled || this.disposed) { port.close(); throw codedError("cancelled", "Translation operation cancelled."); }
            channel = createTranslationServiceChannel(port);
            state.channel = channel;
            const response = await new Promise<unknown>((resolve, reject) => {
                let finished = false;
                const settle = (action: () => void): void => {
                    if (finished) return;
                    finished = true;
                    if (timeout) clearTimeout(timeout);
                    action();
                };
                removeMessage = channel!.onMessage((message) => {
                    if (!message || typeof message !== "object") return;
                    const value = message as { type?: unknown; code?: unknown; message?: unknown };
                    if (state.expected.includes(String(value.type))) settle(() => resolve(message));
                    else if (value.type === "progress" && state.translate) {
                        state.onProgress?.(message as TranslationProgress);
                    } else if (value.type === "download-progress" && state.onProgress) state.onProgress(message as TranslationDownloadProgress);
                    else if (value.type === "error") settle(() => reject(codedError(typeof value.code === "string" ? value.code : "engine-failed", typeof value.message === "string" ? value.message : "Translation provider failed.")));
                });
                removeClose = channel!.onClose((reason) => settle(() => reject(codedError(reason.code, reason.message))));
                if (state.expected.includes("description")) timeout = setTimeout(() => settle(() => reject(codedError("timeout", "Translation provider description timed out."))), DESCRIBE_TIMEOUT_MS);
                // Connect's open message initiates the operation; no request body is sent here.
            });
            if (!state.cancelled && !state.settled) state.resolve(response as T);
        } catch (error) {
            if (!state.settled) state.reject(codedError("service-error", errMessage(error, "Translation operation failed.")));
        } finally {
            if (timeout) clearTimeout(timeout);
            removeMessage();
            removeClose();
            channel?.close();
            this.finishState(state as OperationState<unknown>);
        }
    }

    private finishState(state: OperationState<unknown>): void {
        this.operations.delete(state);
        this.activeChannels.delete(state);
        const controlIndex = this.queuedControls.indexOf(state);
        if (controlIndex >= 0) this.queuedControls.splice(controlIndex, 1);
        if (state.translate) {
            this.activeTranslations.delete(state as OperationState<TranslationResult>);
            const index = this.queuedTranslations.indexOf(state as OperationState<TranslationResult>);
            if (index >= 0) this.queuedTranslations.splice(index, 1);
        }
        this.drainControls();
    }

    private drainControls(): void {
        while (!this.disposed && this.activeChannels.size < MAX_CHANNELS_PER_HOST_BOARD && this.queuedControls.length > 0) {
            const next = this.queuedControls.shift()!;
            if (next.cancelled) continue;
            this.activeChannels.add(next);
            void this.run(next);
        }
        this.drainTranslations();
    }

    private drainTranslations(): void {
        while (!this.disposed && this.activeTranslations.size < MAX_TRANSLATE_CHANNELS && this.activeChannels.size < MAX_CHANNELS_PER_HOST_BOARD && this.queuedTranslations.length > 0) {
            this.queuedTranslations.sort((left, right) => priorityOrder(left.priority) - priorityOrder(right.priority));
            const next = this.queuedTranslations.shift()!;
            if (next.cancelled) continue;
            this.activeTranslations.add(next);
            this.activeChannels.add(next);
            void this.run(next);
        }
    }

    private async waitForPort(channelId: string): Promise<MessagePort> {
        const pending = this.pendingPorts.get(channelId);
        if (pending) { this.pendingPorts.delete(channelId); return pending; }
        return new Promise<MessagePort>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.portWaiters.delete(channelId);
                reject(codedError("timeout", "Translation provider channel port did not arrive."));
            }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
            this.portWaiters.set(channelId, {
                resolve: (port) => { clearTimeout(timer); resolve(port); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
        });
    }

    private withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(codedError("timeout", message)), milliseconds);
            promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
        });
    }
}
