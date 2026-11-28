import { moduleService } from "../../api/module-service";
import type { ClassifiedTreeWatchBatch } from "./tree-provider-capabilities";

interface AcceptedProvider {
    boardRoot: string;
}

interface FolderIntent {
    href: string;
    path: string;
    generation: number;
    unsubscribe?: () => void;
    notify: (batch: ClassifiedTreeWatchBatch) => void;
}

let nextExplorerId = 1;

/** Owns board service watch intents for one Explorer instance. */
export class BoardTreeWatches {
    private readonly explorerId = nextExplorerId++;
    private readonly intents = new Map<number, FolderIntent>();
    private readonly unsubscribeAvailability: () => void;
    private lastOwner: string | undefined;
    private disposed = false;
    private nextSubscriptionId = 1;
    private nextIntentId = 1;

    constructor(
        private readonly type: string,
        private readonly config: Record<string, unknown>,
        private readonly getAccepted: () => AcceptedProvider | undefined,
        private readonly requireAccepted: () => Promise<AcceptedProvider>,
        subscribeAvailability: (callback: () => void) => () => void,
    ) {
        this.lastOwner = getAccepted()?.boardRoot;
        this.unsubscribeAvailability = subscribeAvailability(() => queueMicrotask(this.onAvailability));
    }

    watch(href: string, path: string, notify: (batch: ClassifiedTreeWatchBatch) => void): () => void {
        const key = this.nextIntentId++;
        const intent: FolderIntent = { href, path, generation: 1, notify };
        this.intents.set(key, intent);
        void this.start(intent, key);
        let done = false;
        return () => {
            if (done) return;
            done = true;
            if (this.intents.get(key) !== intent) return;
            intent.generation++;
            intent.unsubscribe?.();
            this.intents.delete(key);
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribeAvailability();
        for (const intent of this.intents.values()) {
            intent.generation++;
            intent.unsubscribe?.();
        }
        this.intents.clear();
    }

    private start = async (intent: FolderIntent, key: number): Promise<void> => {
        const generation = intent.generation;
        try {
            const accepted = await this.requireAccepted();
            if (this.disposed || this.intents.get(key) !== intent || intent.generation !== generation) return;
            const current = this.getAccepted();
            if (!current || current.boardRoot !== accepted.boardRoot) return;
            const subscriptionId = `tree-folder:${this.explorerId}:${this.nextSubscriptionId++}`;
            intent.unsubscribe = moduleService.subscribeProvider(
                accepted.boardRoot,
                {
                    kind: "provider",
                    operation: "watchSubscribe",
                    type: this.type,
                    config: this.config,
                    subscriptionId,
                    treePath: intent.path,
                },
                () => {
                    if (this.intents.get(key) === intent && intent.generation === generation) {
                        intent.notify({ relist: [{ href: intent.href }] });
                    }
                },
                () => {
                    if (this.intents.get(key) === intent && intent.generation === generation) {
                        intent.notify({ relist: [{ href: intent.href }] });
                    }
                },
            );
        } catch {
            // Watch is optional. Listing remains available when no accepted service can watch.
        }
    };

    private onAvailability = (): void => {
        if (this.disposed) return;
        const owner = this.getAccepted()?.boardRoot;
        if (owner === this.lastOwner) return;
        this.lastOwner = owner;
        for (const [key, intent] of this.intents) {
            intent.generation++;
            intent.unsubscribe?.();
            intent.unsubscribe = undefined;
            if (owner) void this.start(intent, key);
        }
    };
}
