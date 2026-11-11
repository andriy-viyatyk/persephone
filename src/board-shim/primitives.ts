export class SettledValue<T> {
    private settled = false;
    private value: T | undefined;
    private readonly waiters: Array<(value: T) => void> = [];

    get isSettled(): boolean { return this.settled; }

    settle(value: T): void {
        if (this.settled) return;
        this.settled = true;
        this.value = value;
        for (const waiter of this.waiters) waiter(value);
        this.waiters.length = 0;
    }

    get(): Promise<T> {
        if (this.settled) return Promise.resolve(this.value as T);
        return new Promise<T>((resolve) => this.waiters.push(resolve));
    }

    peek(): T | undefined { return this.value; }
}

export class Listeners<T extends unknown[]> {
    private readonly callbacks = new Set<(...args: T) => void | Promise<void>>();

    constructor(
        private readonly label: string,
        private readonly options?: { replay?: () => T },
    ) {}

    get size(): number { return this.callbacks.size; }

    add(callback: (...args: T) => void | Promise<void>): () => void {
        this.callbacks.add(callback);
        const replay = this.options?.replay;
        if (replay) {
            try {
                callback(...replay());
            } catch (error: unknown) {
                console.error(this.label, error);
            }
        }
        return () => {
            this.callbacks.delete(callback);
        };
    }

    emit(...args: T): void {
        for (const callback of [...this.callbacks]) {
            try {
                callback(...args);
            } catch (error: unknown) {
                console.error(this.label, error);
            }
        }
    }

    async emitSettled(...args: T): Promise<void> {
        await Promise.allSettled(
            [...this.callbacks].map((callback) => Promise.resolve().then(() => callback(...args))),
        );
    }
}

/** Combines API fragments without invoking getters or losing their descriptors. */
export function composeApi(...fragments: object[]): object {
    const api = {};
    const keys = new Set<PropertyKey>();
    for (const fragment of fragments) {
        const descriptors = Object.getOwnPropertyDescriptors(fragment);
        for (const key of Reflect.ownKeys(descriptors)) {
            if (keys.has(key)) throw new Error(`Duplicate board API member ${String(key)}.`);
            keys.add(key);
        }
        Object.defineProperties(api, descriptors);
    }
    return api;
}
