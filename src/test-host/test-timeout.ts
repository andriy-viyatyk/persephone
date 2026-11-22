import { AsyncLocalStorage } from "node:async_hooks";

export class TestTimeoutError extends Error {
    constructor(readonly timeout: number, readonly step: string) {
        super(`Test timed out after ${timeout} ms; last step: ${step}`);
        this.name = "TestTimeoutError";
    }
}

interface LifetimeScope { owner: string; active: boolean; expiry?: TestTimeoutError; }

export interface TestLifetime {
    assertActive(): void;
    run<T>(callback: () => Promise<T>, getStep: () => string, owner?: string, timeout?: number): Promise<T>;
    runSetup<T>(owner: string, callback: () => Promise<T>): Promise<T>;
    trackRestart<T>(restart: Promise<T>): Promise<T>;
    waitForRestart(): Promise<void>;
}

export function contextEndedMessage(owner: string): string {
    return `This stand-in belongs to the ${owner} context, which has ended. Pass plain values (ids, URLs, flags) through module variables and re-read the page in the test with ctx.usePage or ctx.app.pages[…].`;
}

export function createTestLifetime(defaultTimeout: number, defaultOwner = "test"): TestLifetime {
    const scopes = new AsyncLocalStorage<LifetimeScope>();
    let restart: Promise<unknown> | undefined;
    const assertActive = (): void => {
        const scope = scopes.getStore();
        if (!scope) throw new Error(contextEndedMessage(defaultOwner));
        if (!scope.active) throw scope.expiry ?? new Error(contextEndedMessage(scope.owner));
    };
    const run = async <T>(callback: () => Promise<T>, getStep: () => string, owner = "test", timeout = defaultTimeout): Promise<T> => {
        const scope: LifetimeScope = { owner, active: true };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const body = scopes.run(scope, () => Promise.resolve().then(callback));
        // Observe late hook rejections when a timeout has already won the race.
        void body.catch((): undefined => undefined);
        if (timeout === 0) {
            try { return await body; }
            finally { scope.active = false; }
        }
        const timedOut = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                scope.expiry = new TestTimeoutError(timeout, getStep());
                scope.active = false;
                reject(scope.expiry);
            }, timeout);
        });
        try { return await Promise.race([body, timedOut]); }
        finally {
            if (timer !== undefined) clearTimeout(timer);
            scope.active = false;
        }
    };
    return {
        assertActive,
        run,
        runSetup: async <T>(owner: string, callback: () => Promise<T>): Promise<T> => {
            const scope: LifetimeScope = { owner, active: true };
            try { return await scopes.run(scope, callback); }
            finally { scope.active = false; }
        },
        trackRestart<T>(pending: Promise<T>): Promise<T> { restart = pending; return pending; },
        async waitForRestart() { if (restart) await restart; },
    };
}
