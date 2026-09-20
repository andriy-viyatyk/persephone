import { moduleService } from "../../api/module-service";
import type { IProvider, IProviderDescriptor, IProviderStat } from "../../api/types/io.provider";
import {
    type ProviderOperation,
    type ProviderRequest,
    type ProviderResult,
    type ProviderWireErrorCode,
} from "../../../ipc/module-service-channels";
import { MAX_BUFFERED_PIPE_BYTES } from "../../../shared/board-pipe-constants";
import { errMessage } from "../../../shared/utils";
import { ProviderUnavailableError } from "../registry";

let watchNumber = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUint8Array(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array
        && Number.isInteger(value.byteLength)
        && value.byteLength === value.length;
}

function providerDeclaration(boardRoot: string, type: string) {
    return {
        type,
        boardRoot,
        trusted: true,
        source: "trusted" as const,
    };
}

function unavailableError(boardRoot: string, type: string, error: unknown): ProviderUnavailableError {
    const unavailable = new ProviderUnavailableError(type, providerDeclaration(boardRoot, type));
    unavailable.cause = error;
    Object.defineProperty(unavailable, "serviceCode", {
        value: errMessage(error, "service-error"),
        enumerable: false,
    });
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
        extras: Partial<Pick<ProviderRequest, "subscriptionId" | "data">> = {},
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
        extras: Partial<Pick<ProviderRequest, "subscriptionId" | "data">> = {},
    ): Promise<Extract<ProviderResult, { ok: true }>> {
        try {
            const result: unknown = await moduleService.request(
                this.boardRoot,
                this.requestMessage(operation, extras),
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
            throw unavailableError(this.boardRoot, this.type, error);
        }
    }

    async readBinary(): Promise<Buffer> {
        const result = await this.request("readBinary");
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

    async stat(): Promise<IProviderStat> {
        const result = await this.request("stat");
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
