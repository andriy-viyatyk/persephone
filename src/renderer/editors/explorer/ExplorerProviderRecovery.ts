import { subscribeProviderAvailability } from "../../content/registry";

/** Coalesces provider-registry refresh notifications until synchronous claims settle. */
export class ExplorerProviderRecovery {
    private queued = false;
    private disposed = false;
    private readonly unsubscribe: () => void;

    constructor(private readonly refresh: () => void) {
        this.unsubscribe = subscribeProviderAvailability(this.scheduleRefresh);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
    }

    private readonly scheduleRefresh = (): void => {
        if (this.queued || this.disposed) return;
        this.queued = true;
        queueMicrotask(() => {
            queueMicrotask(() => {
                this.queued = false;
                if (!this.disposed) this.refresh();
            });
        });
    };
}
