/** Shared request correlation for one-shot request/reply flows. This dependency-light module
 *  follows `shared/execute-handle.ts`; `assets/module-service-host.mjs` keeps a checked mirror. */
export type RequestId = string | number;

/** Default rejection for a timeout or an abort when a site does not supply its own error. */
export class PendingRequestError extends Error {
    constructor(readonly code: "timeout" | "aborted", message: string) {
        super(message);
        this.name = "PendingRequestError";
    }
}

export interface PendingRequestsOptions<Id extends RequestId> {
    /** Id source. Default: 1, 2, 3, ... */
    nextId?: () => Id;
    /** The value a timed-out request rejects with. */
    timeoutError?: () => unknown;
    /** The value an aborted request rejects with. */
    abortError?: (reason: unknown) => unknown;
}

interface PendingEntry<T, Meta> {
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
    meta: Meta;
    timer?: ReturnType<typeof setTimeout>;
    signal?: AbortSignal;
    abortListener?: () => void;
    timeoutError?: () => unknown;
}

export class PendingRequests<T, Meta = undefined, Id extends RequestId = number> {
    private readonly entries = new Map<Id, PendingEntry<T, Meta>>();
    private readonly nextId: () => Id;
    private readonly timeoutError: () => unknown;
    private readonly abortError: (reason: unknown) => unknown;
    private generatedId = 0;

    constructor(options: PendingRequestsOptions<Id> = {}) {
        this.nextId = options.nextId ?? (() => ++this.generatedId as Id);
        this.timeoutError = options.timeoutError ?? (() => new PendingRequestError("timeout", "Request timed out."));
        this.abortError = options.abortError ?? (() => new PendingRequestError("aborted", "Request aborted."));
    }

    /** Creates a pending request; non-positive or missing timeout disables the timer. */
    create(timeoutMs?: number, signal?: AbortSignal, extra: { id?: Id; meta?: Meta; timeoutError?: () => unknown } = {}): { id: Id; promise: Promise<T> } {
        const id = extra.id ?? this.nextId();
        if (this.entries.has(id)) throw new Error("Duplicate pending request id");
        let resolve: (value: T) => void = () => {};
        let reject: (error: unknown) => void = () => {};
        const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
        if (signal?.aborted) {
            reject(this.abortError(signal.reason));
            return { id, promise };
        }
        const entry: PendingEntry<T, Meta> = { resolve, reject, meta: extra.meta as Meta, signal, timeoutError: extra.timeoutError };
        this.entries.set(id, entry);
        if (signal) {
            entry.abortListener = () => this.fail(id, this.abortError(signal.reason));
            signal.addEventListener("abort", entry.abortListener, { once: true });
        }
        if (timeoutMs !== undefined && timeoutMs > 0) {
            entry.timer = setTimeout(() => this.fail(id, (entry.timeoutError ?? this.timeoutError)()), timeoutMs);
        }
        return { id, promise };
    }

    settle(id: Id, value: T, accept?: (meta: Meta) => boolean): boolean {
        const entry = this.take(id, accept);
        if (!entry) return false;
        entry.resolve(value);
        return true;
    }

    fail(id: Id, error: unknown, accept?: (meta: Meta) => boolean): boolean {
        const entry = this.take(id, accept);
        if (!entry) return false;
        entry.reject(error);
        return true;
    }

    failAll(error: unknown): void {
        for (const id of this.entries.keys()) this.fail(id, error);
    }

    failWhere(match: (meta: Meta, id: Id) => boolean, error: unknown, afterFail?: (id: Id) => void): number {
        let failed = 0;
        for (const [id, entry] of this.entries) {
            if (!match(entry.meta, id)) continue;
            if (this.fail(id, error)) {
                failed++;
                afterFail?.(id);
            }
        }
        return failed;
    }

    clear(): void {
        for (const id of this.entries.keys()) this.take(id);
    }

    has(id: Id): boolean { return this.entries.has(id); }
    get size(): number { return this.entries.size; }
    some(match: (meta: Meta) => boolean): boolean {
        for (const entry of this.entries.values()) if (match(entry.meta)) return true;
        return false;
    }

    private take(id: Id, accept?: (meta: Meta) => boolean): PendingEntry<T, Meta> | undefined {
        const entry = this.entries.get(id);
        if (!entry || (accept && !accept(entry.meta))) return undefined;
        this.entries.delete(id);
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        if (entry.signal && entry.abortListener) entry.signal.removeEventListener("abort", entry.abortListener);
        return entry;
    }
}
