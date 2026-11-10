import { TModel } from "./model";
import { TGlobalState } from "./state";
import { errMessage } from "../../../shared/utils";

/** What a main broadcast looks like to the mirror. */
export interface MirrorEvent<E> {
    subscribe(callback: (data: E) => void): () => void;
}

export interface MirrorState<T> {
    snapshot: T;
    loaded: boolean;
}

export abstract class MainSnapshotMirror<T> extends TModel<MirrorState<T>> {
    private started = false;
    private loading: Promise<void> | undefined;
    private pulling: Promise<void> | undefined;
    private appliedStamp = 0;
    private latestRevision = -1;

    protected constructor(initial: T) {
        super(new TGlobalState<MirrorState<T>>({ snapshot: initial, loaded: false }));
    }

    /** Ask main for the current snapshot. `undefined` means there is nothing to apply. */
    protected abstract fetch(): Promise<T | undefined>;
    /** Attach main broadcasts with `this.attach(...)`. Called before the first pull. */
    protected abstract subscribeToMain(): void;
    /** Copy or normalize each incoming snapshot. */
    protected normalize(incoming: T): T { return incoming; }
    /** Return the main supplied revision when snapshots use revision ordering. */
    protected revisionOf?(snapshot: T): number;
    /** Merge a pull with newer local state; per-key mirrors can override this. */
    protected mergePull(current: T, pulled: T, startStamp: number): T | undefined {
        if (this.revisionOf) return this.revisionOf(pulled) >= this.revisionOf(current) ? pulled : undefined;
        return this.stamp === startStamp ? pulled : undefined;
    }

    get snapshot(): T { return this.state.get().snapshot; }
    isLoaded(): boolean { return this.state.get().loaded; }
    subscribeSnapshot(listener: (snapshot: T) => void): () => void {
        return this.state.subscribe(() => listener(this.snapshot));
    }

    /** Attach the broadcast subscription without pulling. Idempotent. */
    start(): void {
        if (this.started) return;
        this.started = true;
        this.subscribeToMain();
    }

    /** First pull, once; a failed pull may be retried. */
    load(): Promise<void> {
        this.loading ??= this.reload().catch((error: unknown) => {
            this.loading = undefined;
            throw error;
        });
        return this.loading;
    }

    /** Pull a fresh snapshot, coalescing concurrent callers. */
    reload(): Promise<void> {
        this.start();
        this.pulling ??= this.pullUntilCurrent().finally(() => { this.pulling = undefined; });
        return this.pulling;
    }

    /** Commit an authoritative snapshot such as a broadcast or mutation response. */
    apply(snapshot: T): void {
        const next = this.normalize(snapshot);
        if (!this.revisionOf || this.revisionOf(next) >= this.revisionOf(this.snapshot)) this.commit(next);
        this.catchUpIfBehind();
    }

    /** Record a revision-only event and pull if this snapshot is behind. */
    protected noteRevision(revision: number): void {
        this.latestRevision = Math.max(this.latestRevision, revision);
        this.catchUpIfBehind();
    }

    protected attach<E>(event: MirrorEvent<E>, handler: (data: E) => void): void {
        this.own(event.subscribe(handler));
    }

    protected get stamp(): number { return this.appliedStamp; }

    protected commit(next: T): number {
        this.appliedStamp += 1;
        this.state.set({ snapshot: next, loaded: true });
        return this.appliedStamp;
    }

    private behind(): boolean { return !!this.revisionOf && this.latestRevision > this.revisionOf(this.snapshot); }

    private catchUpIfBehind(): void {
        if (this.behind()) {
            this.reload().catch((error: unknown) => console.error(`Mirror catch-up failed: ${errMessage(error)}`));
        }
    }

    private async pullUntilCurrent(): Promise<void> {
        do {
            const startStamp = this.stamp;
            const pulled = await this.fetch();
            if (pulled === undefined) return;
            const merged = this.mergePull(this.snapshot, this.normalize(pulled), startStamp);
            if (merged !== undefined) this.commit(merged);
        } while (this.behind());
    }
}
