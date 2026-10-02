import type { IProvider, IProviderDescriptor, IPipeStageStatus } from "../../api/types/io.provider";
import { CONTENT_USER_AGENT } from "../../../shared/constants";
import { errMessage } from "../../../shared/utils";
import { RateMeter } from "../RateMeter";

interface IActiveRead {
    readonly full: boolean;
    canceled: boolean;
}

/**
 * HttpProvider — reads content from HTTP/HTTPS URLs and reports aggregate byte progress.
 * Status belongs to the provider activity burst and is intentionally not persisted.
 */
export class HttpProvider implements IProvider {
    readonly type = "http";
    readonly restorable = true;
    readonly writable = false;
    readonly sourceUrl: string;
    readonly displayName: string;

    private readonly url: string;
    private readonly method: string;
    private readonly headers: Record<string, string>;
    private readonly body: string | undefined;
    private readonly sessionHandle: string | undefined;
    private readonly boardNetworkPolicy: import("../../api/node-fetch").BoardNetworkPolicy | undefined;
    private _cachedBuffer: Buffer | null = null;
    private _status: IPipeStageStatus | undefined;
    private readonly statusListeners = new Set<() => void>();
    private readonly activeReads = new Set<IActiveRead>();
    private readonly rateMeter = new RateMeter();
    private candidateTotal: number | undefined;
    private burstCanReportTotal = true;
    private burstHadNormalRead = false;
    private burstHadError: string | undefined;
    private lastStatusNotification = 0;
    private statusTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        url: string,
        options?: {
            method?: string;
            headers?: Record<string, string>;
            body?: string;
            sessionHandle?: string;
            boardNetworkPolicy?: import("../../api/node-fetch").BoardNetworkPolicy;
        },
    ) {
        this.url = url;
        this.sourceUrl = url;
        this.method = options?.method ?? "GET";
        this.headers = options?.headers ?? {};
        this.body = options?.body;
        this.sessionHandle = options?.sessionHandle;
        this.boardNetworkPolicy = options?.boardNetworkPolicy;

        try {
            const parsed = new URL(url);
            this.displayName = parsed.hostname + parsed.pathname;
        } catch {
            this.displayName = url;
        }
    }

    get status(): IPipeStageStatus | undefined {
        return this._status ? this.copyStatus(this._status) : undefined;
    }

    onStatusChange(callback: () => void): () => void {
        this.statusListeners.add(callback);
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            this.statusListeners.delete(callback);
            if (this.statusListeners.size === 0 && this.statusTimer !== undefined) {
                clearTimeout(this.statusTimer);
                this.statusTimer = undefined;
            }
        };
    }

    /** Request headers with a default User-Agent. */
    private requestHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = { ...this.headers, ...extra };
        const hasUserAgent = Object.keys(headers).some(
            (name) => name.toLowerCase() === "user-agent",
        );
        if (!hasUserAgent) headers["User-Agent"] = CONTENT_USER_AGENT;
        return headers;
    }

    async readBinary(options?: { signal?: AbortSignal }): Promise<Buffer> {
        if (this._cachedBuffer) return this._cachedBuffer;

        const operation = this.beginRead(true);
        try {
            const headers = this.requestHeaders();
            const response = await this.fetchResponse(headers, options?.signal);
            this.assertResponseOk(response);
            this.setResponseTotal(response, headers, operation);
            const chunks: Buffer[] = [];
            let size = 0;
            const reader = response.body?.getReader();
            if (reader) {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = Buffer.from(value);
                        chunks.push(chunk);
                        size += chunk.length;
                        this.addBytes(chunk.length);
                    }
                } catch (error) {
                    await this.cancelReader(reader);
                    throw error;
                } finally {
                    reader.releaseLock();
                }
            }
            const result = Buffer.concat(chunks, size);
            this.burstHadNormalRead = true;
            this.finishRead(operation, options?.signal);
            this._cachedBuffer = result;
            return result;
        } catch (error) {
            const canceled = this.isCancellation(error, options?.signal);
            if (!canceled) this.recordReadError(error);
            this.finishRead(operation, options?.signal, canceled);
            throw error;
        }
    }

    createReadStream(
        range?: { start: number; end: number },
        options?: { signal?: AbortSignal },
    ): NodeJS.ReadableStream {
        const { PassThrough } = require("stream") as typeof import("stream");
        const passThrough = new PassThrough();
        const operation = this.beginRead(!range);
        const controller = new AbortController();
        const headers = this.requestHeaders(
            range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
        );
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let destroyedForFailure = false;
        let canceledByConsumer = false;

        const abortFromCaller = (): void => controller.abort();
        if (options?.signal?.aborted) controller.abort();
        else options?.signal?.addEventListener("abort", abortFromCaller, { once: true });

        passThrough.once("close", () => {
            if (passThrough.writableEnded || destroyedForFailure) return;
            canceledByConsumer = true;
            controller.abort();
            if (reader) void this.cancelReader(reader);
        });

        void (async () => {
            try {
                const response = await this.fetchResponse(headers, controller.signal);
                this.assertResponseOk(response, true);
                this.setResponseTotal(response, headers, operation);
                if (!response.body) {
                    this.burstHadNormalRead = true;
                    passThrough.end();
                    this.finishRead(operation, options?.signal);
                    return;
                }

                reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (canceledByConsumer) return;
                    const chunk = Buffer.from(value);
                    this.addBytes(chunk.length);
                    await new Promise<void>((resolve, reject) => {
                        passThrough.write(chunk, (error?: Error | null) => {
                            if (error) reject(error);
                            else resolve();
                        });
                    });
                }
                if (canceledByConsumer) return;
                this.burstHadNormalRead = true;
                passThrough.end();
                this.finishRead(operation, options?.signal);
            } catch (error) {
                const canceled = canceledByConsumer || (passThrough.destroyed && !destroyedForFailure)
                    || this.isCancellation(error, options?.signal)
                    || controller.signal.aborted;
                if (!canceled) {
                    this.recordReadError(error);
                    destroyedForFailure = true;
                    passThrough.destroy(error instanceof Error ? error : new Error(errMessage(error)));
                }
                this.finishRead(operation, options?.signal, canceled);
            } finally {
                if (reader) {
                    if (!passThrough.readableEnded && !passThrough.writableEnded) {
                        await this.cancelReader(reader);
                    }
                    reader.releaseLock();
                }
                if (this.activeReads.has(operation)) {
                    this.finishRead(operation, options?.signal, canceledByConsumer || controller.signal.aborted);
                }
                options?.signal?.removeEventListener("abort", abortFromCaller);
            }
        })();

        return passThrough;
    }

    private beginRead(full: boolean): IActiveRead {
        if (this.activeReads.size === 0) {
            this.rateMeter.reset();
            this.candidateTotal = undefined;
            this.burstCanReportTotal = true;
            this.burstHadNormalRead = false;
            this.burstHadError = undefined;
        }
        const operation: IActiveRead = { full, canceled: false };
        if (!full || this.activeReads.size > 0) {
            this.burstCanReportTotal = false;
            this.candidateTotal = undefined;
        }
        this.activeReads.add(operation);
        this.updateActiveStatus();
        return operation;
    }

    private finishRead(operation: IActiveRead, signal?: AbortSignal, canceled = false): void {
        operation.canceled = canceled || !!signal?.aborted;
        this.activeReads.delete(operation);
        if (this.activeReads.size > 0) {
            this.candidateTotal = undefined;
            this.updateActiveStatus();
            return;
        }
        const finalTotal = this.burstCanReportTotal && operation.full
            && this.candidateTotal !== undefined && this.rateMeter.loaded <= this.candidateTotal
            ? this.candidateTotal
            : undefined;
        if (this.burstHadError) {
            this._status = {
                state: "error",
                text: "Download failed",
                detail: this.burstHadError,
                progress: { loaded: this.rateMeter.loaded },
                rate: this.rateMeter.rate(),
            };
        } else if (this.burstHadNormalRead) {
            this._status = {
                state: "done",
                text: "Download complete",
                progress: { loaded: this.rateMeter.loaded, ...(finalTotal !== undefined && { total: finalTotal }) },
                rate: this.rateMeter.rate(),
            };
        } else {
            this._status = {
                state: "idle",
                text: "Download canceled",
                progress: { loaded: this.rateMeter.loaded },
                rate: this.rateMeter.rate(),
            };
        }
        this.candidateTotal = undefined;
        this.queueStatusNotification();
    }

    private updateActiveStatus(): void {
        this._status = {
            state: "active",
            text: "Receiving data",
            progress: this.progressSnapshot(),
            rate: this.rateMeter.rate(),
        };
        this.queueStatusNotification();
    }

    private setResponseTotal(
        response: Response,
        requestHeaders: Record<string, string>,
        operation: IActiveRead,
    ): void {
        const encodingHeader = Object.entries(requestHeaders)
            .find(([name]) => name.toLowerCase() === "accept-encoding")?.[1]?.trim().toLowerCase();
        const encodingIsIdentity = !encodingHeader || encodingHeader === "identity";
        const rawLength = response.headers.get("content-length");
        const total = rawLength && /^\d+$/.test(rawLength) ? Number(rawLength) : undefined;
        this.candidateTotal = this.burstCanReportTotal && operation.full && this.activeReads.size === 1
            && encodingIsIdentity && total !== undefined && Number.isFinite(total)
            ? total
            : undefined;
        if (this.rateMeter.loaded > (this.candidateTotal ?? Number.POSITIVE_INFINITY)) {
            this.candidateTotal = undefined;
        }
        this.updateActiveStatus();
    }

    private progressSnapshot(): { loaded: number; total?: number } {
        const eligible = this.activeReads.size === 1
            && [...this.activeReads][0].full
            && this.candidateTotal !== undefined
            && this.rateMeter.loaded <= this.candidateTotal;
        return {
            loaded: this.rateMeter.loaded,
            ...(eligible && { total: this.candidateTotal }),
        };
    }

    private addBytes(bytes: number): void {
        this.rateMeter.add(bytes);
        if (this.candidateTotal !== undefined && this.rateMeter.loaded > this.candidateTotal) {
            this.candidateTotal = undefined;
        }
        this.updateActiveStatus();
    }

    private recordReadError(error: unknown): void {
        this.burstHadError ??= errMessage(error, "Unable to read HTTP content.");
    }

    private isCancellation(error: unknown, signal?: AbortSignal): boolean {
        if (signal?.aborted) return true;
        return !!error && typeof error === "object"
            && "name" in error && (error as { name?: unknown }).name === "AbortError";
    }

    private assertResponseOk(response: Response, allowPartial = false): void {
        if (!response.ok && !(allowPartial && response.status === 206)) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    }

    private async cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
        try {
            await reader.cancel();
        } catch {
            // Cancellation is best effort; the operation's original result remains authoritative.
        }
    }

    private async fetchResponse(headers: Record<string, string>, signal?: AbortSignal): Promise<Response> {
        if (this.sessionHandle !== undefined) return this.fetchThroughSession(headers, signal);
        const { nodeFetch } = await import("../../api/node-fetch");
        return nodeFetch(this.url, {
            method: this.method,
            headers,
            body: this.body,
            signal,
            ...(this.boardNetworkPolicy ? { boardNetworkPolicy: this.boardNetworkPolicy } : {}),
        });
    }

    private fetchThroughSession(headers: Record<string, string>, signal?: AbortSignal): Promise<Response> {
        const sessionUrl = `session-src://${this.sessionHandle}/?u=${encodeURIComponent(this.url)}`;
        return fetch(sessionUrl, {
            method: this.method,
            headers,
            body: this.body,
            signal,
        });
    }

    private copyStatus(status: IPipeStageStatus): IPipeStageStatus {
        return { ...status, ...(status.progress && { progress: { ...status.progress } }) };
    }

    private queueStatusNotification(): void {
        if (this.statusListeners.size === 0 || this.statusTimer !== undefined) return;
        const wait = Math.max(0, 250 - (Date.now() - this.lastStatusNotification));
        this.statusTimer = setTimeout(() => {
            this.statusTimer = undefined;
            if (this.statusListeners.size === 0) return;
            this.lastStatusNotification = Date.now();
            for (const listener of [...this.statusListeners]) listener();
        }, wait);
    }

    toDescriptor(): IProviderDescriptor {
        return {
            type: "http",
            config: {
                url: this.url,
                ...(this.method !== "GET" && { method: this.method }),
                ...(Object.keys(this.headers).length > 0 && { headers: this.headers }),
                ...(this.body && { body: this.body }),
            },
        };
    }

    dispose(): void {
        if (this.statusTimer !== undefined) clearTimeout(this.statusTimer);
        this.statusTimer = undefined;
        this.statusListeners.clear();
    }
}
