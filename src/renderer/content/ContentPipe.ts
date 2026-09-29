import type { IContentPipe, IPipeDescriptor, IPipeStage } from "../api/types/io.pipe";
import type { IProvider, IProviderStat, IPipeStageStatus } from "../api/types/io.provider";
import type { ITransformer } from "../api/types/io.transformer";
import { createProviderFromDescriptor } from "./registry";
import { decodeBuffer, encodeString } from "./encoding";

/**
 * ContentPipe — chains a provider with an ordered list of transformers.
 *
 * Read flow:  provider.readBinary() → transformer[0].read() → transformer[1].read() → ... → result
 * Write flow: result → ... → transformer[1].write(data, readOriginal) → transformer[0].write(data, readOriginal) → provider.writeBinary()
 */
export class ContentPipe implements IContentPipe {
    readonly provider: IProvider;
    private readonly _transformers: ITransformer[];
    private _encoding: string | undefined;
    private readonly statusListeners = new Set<() => void>();
    private readonly stageUnsubscribers = new Map<object, () => void>();
    private readonly stageUpdateOrder = new Map<object, number>();
    private updateCounter = 0;
    private lastStatusNotification = 0;
    private statusTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    constructor(provider: IProvider, transformers: ITransformer[] = [], encoding?: string) {
        this.provider = provider;
        this._transformers = [...transformers];
        this._encoding = encoding;
    }

    /** Detected content encoding after first readText(). Persisted in descriptor. */
    get encoding(): string | undefined {
        return this._encoding;
    }

    get transformers(): ReadonlyArray<ITransformer> {
        return this._transformers;
    }

    get stages(): ReadonlyArray<IPipeStage> {
        return this.getStageEntries().map(({ stage, role }) => ({
            role,
            type: stage.type,
            displayName: "displayName" in stage && typeof stage.displayName === "string"
                ? stage.displayName
                : stage.type,
            ...(stage.status && { status: this.copyStatus(stage.status) }),
        }));
    }

    get summary(): IPipeStageStatus | undefined {
        const stages = this.getStageEntries().filter(({ stage }) => stage.status);
        const errors = stages.filter(({ stage }) => stage.status?.state === "error");
        const candidates = errors.length > 0 ? errors : stages;
        const latest = candidates.reduce<typeof candidates[number] | undefined>((current, entry) => {
            if (!current) return entry;
            return (this.stageUpdateOrder.get(entry.stage) ?? 0)
                > (this.stageUpdateOrder.get(current.stage) ?? 0) ? entry : current;
        }, undefined);
        return latest?.stage.status ? this.copyStatus(latest.stage.status) : undefined;
    }

    onStatusChange(callback: () => void): () => void {
        if (this.disposed) return () => undefined;
        this.statusListeners.add(callback);
        if (this.statusListeners.size === 1) this.refreshStageSubscriptions();
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            this.statusListeners.delete(callback);
            if (this.statusListeners.size === 0) this.releaseStageSubscriptions();
        };
    }

    get writable(): boolean {
        return this.provider.writable
            && this._transformers.every(t => t.writable !== false);
    }

    get displayName(): string {
        return this.provider.displayName;
    }

    // ── Transformer manipulation (clone-and-try pattern) ────────────

    addTransformer(transformer: ITransformer, index?: number): void {
        if (index !== undefined && index >= 0 && index <= this._transformers.length) {
            this._transformers.splice(index, 0, transformer);
        } else {
            this._transformers.push(transformer);
        }
        this.onStagesChanged();
    }

    removeTransformer(type: string): ITransformer | undefined {
        const index = this._transformers.findIndex((t) => t.type === type);
        if (index >= 0) {
            const [removed] = this._transformers.splice(index, 1);
            this.onStagesChanged();
            return removed;
        }
        return undefined;
    }

    // ── Read ────────────────────────────────────────────────────────

    async readBinary(options?: { signal?: AbortSignal }): Promise<Buffer> {
        let data = await this.provider.readBinary(options);
        for (const transformer of this._transformers) {
            data = await transformer.read(data, options?.signal);
        }
        return data;
    }

    async readText(options?: { signal?: AbortSignal }): Promise<string> {
        const buffer = await this.readBinary(options);
        const decoded = decodeBuffer(buffer, this._encoding);
        this._encoding = decoded.encoding;
        return decoded.content;
    }

    createReadStream(
        range?: { start: number; end: number },
        options?: { signal?: AbortSignal },
    ): NodeJS.ReadableStream {
        if (this._transformers.length === 0 && this.provider.createReadStream) {
            return this.provider.createReadStream(range, options);
        }

        const { Readable } = require("stream") as typeof import("stream");
        const read = this.readBinary(options).then((buffer) => {
            const selected = range
                ? buffer.subarray(range.start, Math.min(buffer.length, range.end + 1))
                : buffer;
            return selected;
        });
        return Readable.from((async function* () {
            yield await read;
        })());
    }

    async stat(options?: { signal?: AbortSignal }): Promise<IProviderStat> {
        if (this._transformers.length === 0 && this.provider.stat) {
            return this.provider.stat(options);
        }
        const buffer = await this.readBinary(options);
        return { exists: true, size: buffer.length };
    }

    // ── Write ───────────────────────────────────────────────────────

    async writeBinary(data: Buffer): Promise<void> {
        if (!this.writable) {
            throw new Error("Cannot write: pipe is read-only");
        }
        await this._writeBinary(data);
    }

    async writeText(content: string): Promise<void> {
        if (!this.writable) {
            throw new Error("Cannot write: pipe is read-only");
        }
        const buffer = encodeString(content, this._encoding);
        await this._writeBinary(buffer);
    }

    private _writeBinary = async (data: Buffer): Promise<void> => {
        if (!this.provider.writeBinary) return;

        if (this._transformers.length === 0) {
            await this.provider.writeBinary(data);
            return;
        }

        // Archive writes need the original ZIP bytes, but common transforms such as
        // DecryptTransformer do not. Build each pre-transform stage only on demand and
        // memoize it so a transformer that asks twice never re-reads the provider.
        let providerOriginal: Promise<Buffer> | undefined;
        const stageOriginals: Array<Promise<Buffer> | undefined> = [];
        const readProviderOriginal = (): Promise<Buffer> => {
            providerOriginal ??= (async () => {
                try {
                    const stat = await this.provider.stat?.();
                    return stat?.exists ? await this.provider.readBinary() : Buffer.alloc(0);
                } catch {
                    // Provider read failed — preserve the former empty-original fallback.
                    return Buffer.alloc(0);
                }
            })();
            return providerOriginal;
        };
        const readStageOriginal = (index: number): Promise<Buffer> => {
            stageOriginals[index] ??= (async () => {
                let current = await readProviderOriginal();
                for (let sourceIndex = 0; sourceIndex < index; sourceIndex++) {
                    current = await this._transformers[sourceIndex].read(current);
                }
                return current;
            })();
            return stageOriginals[index];
        };

        // Walk transformers in reverse, applying write().
        let result = data;
        for (let i = this._transformers.length - 1; i >= 0; i--) {
            const transformer = this._transformers[i];
            result = await transformer.write(result, () => readStageOriginal(i));
        }

        await this.provider.writeBinary(result);
    };

    // ── Watch ───────────────────────────────────────────────────────

    get watch(): ((callback: (event: string) => void) => () => void) | undefined {
        if (!this.provider.watch) return undefined;
        return (callback) => this.provider.watch(callback);
    }

    // ── Clone ───────────────────────────────────────────────────────

    cloneWithProvider(provider: IProvider): IContentPipe {
        const transformers = this._transformers.map((t) => t.clone());
        return new ContentPipe(provider, transformers, this._encoding);
    }

    clone(): IContentPipe {
        const provider = createProviderFromDescriptor(this.provider.toDescriptor());
        const transformers = this._transformers.map((t) => t.clone());
        return new ContentPipe(provider, transformers, this._encoding);
    }

    // ── Serialization ───────────────────────────────────────────────

    toDescriptor(): IPipeDescriptor {
        return {
            provider: this.provider.toDescriptor(),
            transformers: this._transformers
                .filter((t) => t.persistent)
                .map((t) => t.toDescriptor()),
            encoding: this._encoding,
        };
    }

    // ── Dispose ─────────────────────────────────────────────────────

    dispose(): void {
        this.disposed = true;
        this.statusListeners.clear();
        this.releaseStageSubscriptions();
        this.provider.dispose?.();
    }

    private getStageEntries(): Array<{ stage: IProvider | ITransformer; role: "provider" | "transformer" }> {
        return [
            { stage: this.provider, role: "provider" },
            ...this._transformers.map((stage) => ({ stage, role: "transformer" as const })),
        ];
    }

    private copyStatus(status: IPipeStageStatus): IPipeStageStatus {
        return {
            ...status,
            ...(status.progress && { progress: { ...status.progress } }),
        };
    }

    private onStagesChanged(): void {
        if (this.statusListeners.size > 0) this.refreshStageSubscriptions();
        this.queueStatusNotification();
    }

    private refreshStageSubscriptions(): void {
        const stages = this.getStageEntries().map(({ stage }) => stage);
        const current = new Set(stages);
        for (const [stage, unsubscribe] of this.stageUnsubscribers) {
            if (!current.has(stage as IProvider | ITransformer)) {
                unsubscribe();
                this.stageUnsubscribers.delete(stage);
                this.stageUpdateOrder.delete(stage);
            }
        }
        for (const stage of stages) {
            if (stage.status && !this.stageUpdateOrder.has(stage)) {
                this.stageUpdateOrder.set(stage, ++this.updateCounter);
            }
            if (this.stageUnsubscribers.has(stage) || !stage.onStatusChange) continue;
            const unsubscribe = stage.onStatusChange(() => {
                if (this.disposed || !this.statusListeners.size
                    || !this.getStageEntries().some(({ stage: current }) => current === stage)) return;
                this.stageUpdateOrder.set(stage, ++this.updateCounter);
                this.queueStatusNotification();
            });
            this.stageUnsubscribers.set(stage, unsubscribe);
        }
    }

    private releaseStageSubscriptions(): void {
        for (const unsubscribe of this.stageUnsubscribers.values()) unsubscribe();
        this.stageUnsubscribers.clear();
        if (this.statusTimer !== undefined) clearTimeout(this.statusTimer);
        this.statusTimer = undefined;
    }

    private queueStatusNotification(): void {
        if (this.disposed || this.statusListeners.size === 0) return;
        if (this.statusTimer !== undefined) return;
        const wait = Math.max(0, 250 - (Date.now() - this.lastStatusNotification));
        this.statusTimer = setTimeout(() => {
            this.statusTimer = undefined;
            if (this.disposed || this.statusListeners.size === 0) return;
            this.lastStatusNotification = Date.now();
            for (const listener of [...this.statusListeners]) listener();
        }, wait);
    }
}

/** Create a content pipe from a provider and optional transformers. */
export function createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe {
    return new ContentPipe(provider, transformers);
}
