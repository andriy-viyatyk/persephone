import { moduleService } from "../../api/module-service";
import type { IProvider, IProviderDescriptor, IProviderStat } from "../../api/types/io.provider";
import {
    type ProviderOperation,
    type ProviderRequest,
    type ProviderResult,
    type ProviderWireErrorCode,
} from "../../../ipc/module-service-channels";
import { MAX_BUFFERED_PIPE_BYTES } from "../../../shared/board-pipe-constants";
import { ProviderUnavailableError, providerDeclarationFor } from "../registry";

// Node's `stream` module for `Readable.from`. `require` rather than `import` because Vite
// externalizes Node builtins into broken browser stubs when statically imported — same pattern
// as link-utils.ts's `require("url")`.
const { Readable } = require("stream") as typeof import("stream");

let watchNumber = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUint8Array(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array
        && Number.isInteger(value.byteLength)
        && value.byteLength === value.length;
}

function unavailableError(type: string, error: unknown): ProviderUnavailableError {
    const unavailable = new ProviderUnavailableError(type, providerDeclarationFor(type));
    unavailable.cause = error;
    return unavailable;
}

export class ProviderOperationError extends Error {
    constructor(
        readonly code: ProviderWireErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "ProviderOperationError";
    }
}

function resultError(result: ProviderResult): ProviderOperationError | undefined {
    if (result.ok !== false) return undefined;
    return new ProviderOperationError(result.error.code, result.error.message);
}

function invalidResult(operation: ProviderOperation): ProviderOperationError {
    return new ProviderOperationError(
        "provider-invalid-result",
        `Provider operation "${operation}" returned a malformed result.`,
    );
}

export class ProxyProvider implements IProvider {
    readonly restorable = true;
    readonly displayName: string;
    readonly sourceUrl: string;

    constructor(
        private readonly boardRoot: string,
        readonly type: string,
        private readonly config: Record<string, unknown>,
    ) {
        this.displayName = this.stringConfig("displayName")
            ?? this.stringConfig("url")
            ?? type;
        this.sourceUrl = this.stringConfig("sourceUrl")
            ?? this.stringConfig("url")
            ?? type;
    }

    get writable(): boolean {
        return moduleService.providerWritable(this.boardRoot, this.type)
            ?? (this.config.writable === true);
    }

    private stringConfig(key: string): string | undefined {
        const value = this.config[key];
        return typeof value === "string" ? value : undefined;
    }

    private requestMessage(
        operation: ProviderOperation,
        extras: Partial<Pick<ProviderRequest, "subscriptionId" | "data" | "range">> = {},
    ): ProviderRequest {
        return {
            kind: "provider",
            operation,
            type: this.type,
            config: this.config,
            ...extras,
        };
    }

    private async request(
        operation: ProviderOperation,
        extras: Partial<Pick<ProviderRequest, "subscriptionId" | "data" | "range">> = {},
        signal?: AbortSignal,
    ): Promise<Extract<ProviderResult, { ok: true }>> {
        try {
            const result: unknown = await moduleService.request(
                this.boardRoot,
                this.requestMessage(operation, extras),
                signal,
            );
            if (!isRecord(result) || result.kind !== "provider-result" || typeof result.ok !== "boolean") {
                throw invalidResult(operation);
            }
            const providerResult = result as ProviderResult;
            const error = resultError(providerResult);
            if (error) throw error;
            return providerResult as Extract<ProviderResult, { ok: true }>;
        } catch (error: unknown) {
            if (error instanceof ProviderOperationError) throw error;
            throw unavailableError(this.type, error);
        }
    }

    async readBinary(options?: { signal?: AbortSignal }): Promise<Buffer> {
        const result = await this.request("readBinary", {}, options?.signal);
        if (result.operation !== "readBinary" || !isUint8Array(result.data)) {
            throw invalidResult("readBinary");
        }
        if (result.data.byteLength > MAX_BUFFERED_PIPE_BYTES) {
            throw new ProviderOperationError(
                "provider-payload-too-large",
                "readBinary() exceeded the buffered payload limit.",
            );
        }
        return Buffer.from(result.data);
    }

    async writeBinary(data: Buffer): Promise<void> {
        if (!this.writable) {
            throw new ProviderOperationError(
                "provider-read-only",
                `Provider "${this.type}" is read-only.`,
            );
        }
        if (!Buffer.isBuffer(data) || data.byteLength > MAX_BUFFERED_PIPE_BYTES) {
            throw new ProviderOperationError(
                "provider-payload-too-large",
                "writeBinary() exceeded the buffered payload limit.",
            );
        }
        const result = await this.request("writeBinary", {
            data: new Uint8Array(data),
        });
        if (result.operation !== "writeBinary") throw invalidResult("writeBinary");
    }

    private get rangeReadable(): boolean {
        return moduleService.providerRangeReadable(this.boardRoot, this.type) === true;
    }

    /** Present only when the board's registered implementation has `readRange` — mirrors
     *  `get writable()` above (`:82-85`, reading `moduleService.providerWritable(...)`) so
     *  `hasDirectStream()` (board-pipe-handler.ts) sees an absent method, not a function that would
     *  fail, for a provider that never implements ranging. Deliberately asymmetric with `writable`:
     *  there is NO `this.config`-based fallback here. `writable` falls back to `config.writable ===
     *  true` before the capability is known; `rangeReadable` must not, or a board could declare
     *  ranging support its service module never implements and defeat D5's "absence is the buffered
     *  path" guarantee. Do not add a config fallback to "fix" this inconsistency. */
    get createReadStream(): ((
        range?: { start: number; end: number },
        options?: { signal?: AbortSignal },
    ) => NodeJS.ReadableStream) | undefined {
        if (!this.rangeReadable) return undefined;
        return (range, options) => this.buildRangeStream(range, options?.signal);
    }

    private buildRangeStream(
        range?: { start: number; end: number },
        signal?: AbortSignal,
    ): NodeJS.ReadableStream {
        // An UNRANGED call must keep behaving exactly as it did before this provider gained
        // `createReadStream`. `IContentPipe.createReadStream(range?)` passes `range` straight
        // through (ContentPipe.ts:77-80) and is public scripting surface (`io.createPipe`), so a
        // script streaming a board pipe whole used to land in ContentPipe's buffered fallback.
        // Erroring here instead would regress it; `readBinary()` keeps the same 256 MB ceiling
        // that fallback always had. `board-pipe-handler.ts` itself always supplies a bounded
        // range (readChunk():176-181), so the ranged branch is the one that carries the traffic.
        const fetched = range ? this.fetchRange(range, signal) : this.readBinary({ signal });
        return Readable.from((async function* () {
            yield await fetched;
        })());
    }

    private async fetchRange(range: { start: number; end: number }, signal?: AbortSignal): Promise<Buffer> {
        const result = await this.request("readRange", { range }, signal);
        if (result.operation !== "readRange" || !isUint8Array(result.data)) {
            throw invalidResult("readRange");
        }
        const requestedLength = range.end - range.start + 1;
        if (result.data.byteLength > requestedLength) {
            throw new ProviderOperationError(
                "provider-payload-too-large",
                "createReadStream() exceeded the requested range.",
            );
        }
        return Buffer.from(result.data);
    }

    async stat(options?: { signal?: AbortSignal }): Promise<IProviderStat> {
        const result = await this.request("stat", {}, options?.signal);
        if (result.operation !== "stat" || !isRecord(result.stat)
            || typeof result.stat.exists !== "boolean"
            || (result.stat.size !== undefined
                && (typeof result.stat.size !== "number"
                    || !Number.isFinite(result.stat.size)
                    || result.stat.size < 0))
            || (result.stat.mtime !== undefined && typeof result.stat.mtime !== "string")) {
            throw invalidResult("stat");
        }
        return result.stat;
    }

    watch(callback: (event: string) => void): () => void {
        const subscriptionId = `provider-watch-${++watchNumber}`;
        const request = this.requestMessage("watchSubscribe", { subscriptionId });
        const disposeSubscription = moduleService.subscribeProvider(
            this.boardRoot,
            request,
            callback,
        );
        this.watchDisposers.add(disposeSubscription);
        return () => {
            if (!this.watchDisposers.delete(disposeSubscription)) return;
            disposeSubscription();
        };
    }

    private readonly watchDisposers = new Set<() => void>();

    toDescriptor(): IProviderDescriptor {
        return { type: this.type, config: this.config };
    }

    dispose(): void {
        for (const disposer of this.watchDisposers) disposer();
        this.watchDisposers.clear();
    }
}
