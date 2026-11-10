/** Runs tasks one at a time in call order. A task's rejection reaches only its own caller. */
export class SerialQueue {
    private tail: Promise<void> = Promise.resolve();
    private pending = 0;

    run<T>(task: () => Promise<T> | T): Promise<T> {
        this.pending++;
        const result = this.tail.then(task);
        this.tail = result.then((): void => undefined, (): void => undefined).then((): void => { this.pending--; });
        return result;
    }

    /** True when no task is queued or running (lets a keyed owner drop an idle queue). */
    get idle(): boolean { return this.pending === 0; }
}

/** One SerialQueue per key; a key's queue is dropped once it is idle. */
export class KeyedSerialQueue {
    private readonly queues = new Map<string, SerialQueue>();

    run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        let queue = this.queues.get(key);
        if (!queue) {
            queue = new SerialQueue();
            this.queues.set(key, queue);
        }
        const result = queue.run(task);
        const owner = queue;
        void result.then((): void => undefined, (): void => undefined).then((): void => {
            if (owner.idle && this.queues.get(key) === owner) this.queues.delete(key);
        });
        return result;
    }
}
