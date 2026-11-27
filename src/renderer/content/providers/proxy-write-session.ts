import type { IProviderWrite } from "../../api/types/io.provider";
import type { ProviderRequest, ProviderResult } from "../../../ipc/module-service-channels";
import { MAX_BOARD_PIPE_CHUNK_BYTES } from "../../../shared/board-pipe-constants";
import { moduleService } from "../../api/module-service";
import { invalidProviderResult, mapProviderRequestError, ProviderOperationError, providerResultError } from "./proxy-provider-errors";

export async function beginProxyWriteSession(
    boardRoot: string,
    type: string,
    config: Record<string, unknown>,
    signal?: AbortSignal,
    onSettled?: () => void,
): Promise<IProviderWrite> {
    const writeId = `renderer-write-${globalThis.crypto.randomUUID()}`;
    const request = async (
        operation: "writeBegin" | "writeChunk" | "writeCommit" | "writeAbort",
        requestSignal?: AbortSignal,
        data?: Uint8Array,
    ): Promise<void> => {
        const message: ProviderRequest = { kind: "provider", operation, type, config, writeId, ...(data ? { data } : {}) };
        try {
            const value: unknown = await moduleService.request(boardRoot, message, requestSignal);
            if (!value || typeof value !== "object") throw invalidProviderResult(operation);
            const result = value as ProviderResult;
            const failure = providerResultError(result);
            if (failure) throw failure;
            if (result.kind !== "provider-result" || result.ok !== true
                || result.operation !== operation || result.writeId !== writeId) {
                throw invalidProviderResult(operation);
            }
        } catch (error: unknown) {
            if (error instanceof ProviderOperationError) throw error;
            throw mapProviderRequestError(type, error);
        }
    };

    try {
        await request("writeBegin", signal);
    } catch (error: unknown) {
        // A timed-out begin may still finish in the host; its ID lets host cleanup find it.
        void request("writeAbort").catch((): undefined => undefined);
        throw error;
    }

    return new ProxyWriteSession(request, signal, onSettled);
}

class ProxyWriteSession implements IProviderWrite {
    private state: "open" | "busy" | "committed" | "aborted" = "open";
    private abortPromise?: Promise<void>;
    private readonly onAbort: () => void;

    constructor(
        private readonly request: (operation: "writeBegin" | "writeChunk" | "writeCommit" | "writeAbort", signal?: AbortSignal, data?: Uint8Array) => Promise<void>,
        private readonly signal?: AbortSignal,
        private readonly onSettled?: () => void,
    ) {
        this.onAbort = () => { void this.abort().catch((): undefined => undefined); };
        signal?.addEventListener("abort", this.onAbort, { once: true });
        if (signal?.aborted) this.onAbort();
    }

    async write(chunk: Buffer): Promise<void> {
        this.assertOpen();
        if (!Buffer.isBuffer(chunk) || chunk.byteLength > MAX_BOARD_PIPE_CHUNK_BYTES) {
            throw new ProviderOperationError("provider-payload-too-large", "Provider write chunk exceeded the 1 MiB limit.");
        }
        this.state = "busy";
        try {
            await this.request("writeChunk", this.signal, new Uint8Array(chunk));
            this.assertSignal();
            this.state = "open";
        } catch (error: unknown) {
            this.state = "open";
            await this.abort().catch((): undefined => undefined);
            throw error;
        }
    }

    async commit(): Promise<void> {
        this.assertOpen();
        this.state = "busy";
        try {
            await this.request("writeCommit", this.signal);
            this.state = "committed";
            this.finish();
        } catch (error: unknown) {
            this.state = "open";
            await this.abort().catch((): undefined => undefined);
            throw error;
        }
    }

    abort(): Promise<void> {
        if (this.state === "committed" || this.state === "aborted") return this.abortPromise ?? Promise.resolve();
        if (this.abortPromise) return this.abortPromise;
        this.abortPromise = Promise.resolve().then(async () => {
            while (this.state === "busy") await new Promise<void>(resolve => setTimeout(resolve, 0));
            if (this.state === "committed" || this.state === "aborted") return;
            this.state = "aborted";
            try { await this.request("writeAbort"); }
            finally { this.finish(); }
        });
        return this.abortPromise;
    }

    private assertOpen(): void {
        if (this.state !== "open") throw new Error("Provider write session has terminated or is busy.");
        this.assertSignal();
    }

    private assertSignal(): void {
        if (this.signal?.aborted) throw new Error("Provider write was cancelled.");
    }

    private finish(): void {
        this.signal?.removeEventListener("abort", this.onAbort);
        this.onSettled?.();
    }
}
