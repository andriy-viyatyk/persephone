/** Tracks per-tab dom-ready state and resolves waiters when guests become ready. */
export class BrowserWebviewReadiness {
    private readonly ready = new Set<string>();
    private readonly waiters = new Map<string, Set<() => void>>();

    isReady = (id: string): boolean => this.ready.has(id);
    markLoaded = (id: string): void => { this.ready.add(id); this.clearLoadedWaiters(id); };
    release = (id: string): void => { this.ready.delete(id); };

    waitForLoaded = (id: string): Promise<void> => {
        if (this.isReady(id)) return Promise.resolve();
        return new Promise((resolve) => {
            const waiters = this.waiters.get(id) ?? new Set<() => void>();
            this.waiters.set(id, waiters);
            const finish = (): void => {
                clearTimeout(timer);
                waiters.delete(finish);
                if (!waiters.size) this.waiters.delete(id);
                resolve();
            };
            const timer = setTimeout(finish, 5000);
            waiters.add(finish);
        });
    };

    clearLoadedWaiters = (id: string): void => {
        for (const resolve of this.waiters.get(id) ?? []) resolve();
    };
}
