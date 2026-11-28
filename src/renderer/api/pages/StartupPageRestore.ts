import type { PageDescriptor } from "../../../shared/persistence";
import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";
import { errMessage } from "../../../shared/utils";
import { codedError } from "../../../shared/coded-error";

/** Per-renderer gate for persisted startup page construction and page-dependent work. */
export class StartupPageRestore {
    private readonly placeholders = new Map<string, PageModel>();
    private releaseRequested = false;
    private closed = false;
    private settledResolve: () => void = () => {};
    private settledPromise: Promise<void> = Promise.resolve();
    private readyResolve: () => void = () => {};
    private readyPromise = new Promise<void>((resolve) => { this.readyResolve = resolve; });
    private retryReadiness?: () => Promise<void>;
    private readonly readinessFailedPages = new Set<string>();

    get settled(): Promise<void> { return this.settledPromise; }
    get ready(): Promise<void> { return this.readyPromise; }
    get isClosed(): boolean { return this.closed; }

    constructor(private readonly model: PagesModel) {
    }

    begin(descriptors: PageDescriptor[]): PageModel[] {
        if (this.placeholders.size || this.closed) return [];
        let resolve: () => void = () => {};
        this.settledPromise = new Promise<void>((done) => { resolve = done; });
        this.settledResolve = resolve;
        for (const descriptor of descriptors) {
            const page = this.model.persistence.createStartupPlaceholder(descriptor);
            this.placeholders.set(page.id, page);
            if (page.recovery) {
                page.recovery.onInvalidated = () => this.complete(page.id);
                page.recovery.onCloseCancelled = () => {
                    if (this.model.query.findPage(page.id) === page
                        && page.restore.state.get().status === "ready") {
                        void this.retryPage(page);
                    }
                };
            }
        }
        if (!this.placeholders.size) this.finish();
        else if (this.releaseRequested) this.release();
        return [...this.placeholders.values()];
    }

    createPlaceholder(descriptor: PageDescriptor): PageModel {
        return this.model.persistence.createStartupPlaceholder(descriptor);
    }

    release(): void {
        this.releaseRequested = true;
        this.markReady();
        if (this.closed) return;
        for (const [id, page] of this.placeholders) {
            if (page.recovery?.isInvalidated) {
                this.complete(id);
                continue;
            }
            void page.restore.start(async () => {
                try {
                    await this.model.pageRecovery.restore(page);
                } finally {
                    if (this.model.query.findPage(id) !== page) this.complete(id);
                }
            }).catch(() => this.complete(id));
        }
        if (!this.placeholders.size) this.finish();
    }

    acknowledgementFailed(error: unknown): void {
        for (const page of this.placeholders.values()) {
            this.readinessFailedPages.add(page.id);
            page.restore.retry = () => this.retryPage(page);
            page.restore.state.update((state) => {
                state.status = "error";
                state.error = errMessage(error, "Window readiness failed.");
            });
        }
        this.finish();
    }

    setReadinessRetry(retry: () => Promise<void>): void {
        this.retryReadiness = retry;
    }

    async waitForReadinessRetry(): Promise<void> {
        if (!this.retryReadiness) throw new Error("Window readiness retry is unavailable.");
        await this.retryReadiness();
        this.markReady();
    }

    async retryPage(page: PageModel): Promise<void> {
        if (this.readinessFailedPages.has(page.id)) {
            try {
                await this.waitForReadinessRetry();
                this.readinessFailedPages.delete(page.id);
            } catch (error) {
                page.restore.state.update((state) => {
                    state.status = "error";
                    state.error = errMessage(error, "Window readiness failed.");
                });
                return;
            }
        }
        if (this.model.query.findPage(page.id) !== page) return;
        try { await page.restore.start(() => this.model.pageRecovery.restore(page)); }
        catch { /* PageRestore already publishes the recoverable error state. */ }
    }

    async waitForSettled(signal?: AbortSignal, timeoutMs?: number): Promise<void> {
        if (signal?.aborted) throw signal.reason ?? codedError("cancelled");
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        const waits: Promise<void>[] = [this.settledPromise];
        if (signal) {
            waits.push(new Promise<void>((_, reject) => {
                abort = () => reject(signal.reason ?? codedError("cancelled"));
                signal.addEventListener("abort", abort, { once: true });
            }));
        }
        if (timeoutMs !== undefined) {
            waits.push(new Promise<void>((_, reject) => {
                timeout = setTimeout(() => reject(codedError("timeout", "Page restore is still in progress.")), timeoutMs);
            }));
        }
        try { await Promise.race(waits); }
        finally {
            if (timeout) clearTimeout(timeout);
            if (abort && signal) signal.removeEventListener("abort", abort);
        }
    }

    close(): void {
        this.closed = true;
        this.markReady();
        for (const [id, page] of this.placeholders) {
            page.restore.cancel();
            void page.recovery?.cancel();
            this.complete(id);
        }
    }

    private complete(id: string): void {
        this.placeholders.delete(id);
        if (!this.placeholders.size) this.finish();
    }

    private finish(): void {
        this.settledResolve();
    }

    private markReady(): void {
        this.readyResolve();
    }
}
