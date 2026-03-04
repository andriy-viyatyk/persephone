import { TOneState } from "../../core/state/state";
import { IContentHost } from "./IContentHost";

/**
 * Abstract base class for editor-specific view models (Grid, Notebook, Todo, etc.).
 *
 * Lifecycle:
 * - Created by ContentViewModelHost when first acquired
 * - `init()` subscribes to host content changes and calls `onInit()`
 * - `dispose()` cleans up subscriptions and calls `onDispose()`
 *
 * Subclasses implement:
 * - `onInit()` — parse initial content, set up internal state
 * - `onContentChanged(content)` — react to host content updates
 * - `onDispose()` (optional) — custom cleanup
 *
 * Does NOT manage its own reference count — that's ContentViewModelHost's job.
 */
export abstract class ContentViewModel<TState> {
    readonly state: TOneState<TState>;
    protected host: IContentHost;
    private _subscriptions: (() => void)[] = [];
    private _disposed = false;

    constructor(host: IContentHost, defaultState: TState) {
        this.host = host;
        this.state = new TOneState(defaultState);
    }

    /** Called once after creation. Sets up content subscription and calls onInit(). */
    init(): void {
        let lastContent = this.host.state.get().content;

        const unsub = this.host.state.subscribe(() => {
            const newContent = this.host.state.get().content;
            if (newContent !== lastContent) {
                lastContent = newContent;
                this.onContentChanged(newContent);
            }
        });
        this._subscriptions.push(unsub);

        this.onInit();
    }

    /** Cleanup. Called when reference count reaches zero. */
    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;

        for (const unsub of this._subscriptions) {
            unsub();
        }
        this._subscriptions = [];

        this.onDispose();
    }

    /** Subclass hook: called once after init. Parse initial content, set up state. */
    protected abstract onInit(): void;

    /** Subclass hook: called when host content changes. */
    protected abstract onContentChanged(content: string): void;

    /** Subclass hook: custom cleanup on dispose. Override if needed. */
    protected onDispose(): void {}

    /**
     * Register a subscription for automatic cleanup on dispose.
     * Use for any external subscriptions the subclass creates.
     */
    protected addSubscription(unsubscribe: () => void): void {
        this._subscriptions.push(unsubscribe);
    }
}
