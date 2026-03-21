import { BaseEvent } from "./BaseEvent";

export interface SubscriptionObject {
    unsubscribe: () => void;
}

export type EventHandler<TEvent> = (event: TEvent) => void | Promise<void>;

export interface EventChannelOptions {
    /** Optional name for debugging/error messages. */
    name?: string;
    /** Optional error handler. Called when a subscriber throws. Defaults to console.error. */
    onError?: (error: unknown, channelName: string) => void;
}

/**
 * A typed event channel that supports both fire-and-forget and async pipeline patterns.
 *
 * - `send(event)` — sync, freezes the event, all subscribers run (observe-only)
 * - `sendAsync(event)` — async pipeline, subscribers can modify the event,
 *   short-circuits on `event.handled === true`
 * - `subscribe(handler)` — register a handler (sync or async)
 * - `subscribeDefault(handler)` — register a default handler that runs last
 *   (skipped if `event.handled === true`)
 */
export class EventChannel<TEvent extends BaseEvent> {
    private handlers: EventHandler<TEvent>[] = [];
    private defaultHandler: EventHandler<TEvent> | null = null;
    private readonly channelName: string;
    private readonly errorHandler: (error: unknown, channelName: string) => void;

    constructor(options?: EventChannelOptions) {
        this.channelName = options?.name ?? "EventChannel";
        this.errorHandler = options?.onError ?? ((error, name) => {
            console.error(`[${name}] Subscriber error:`, error);
        });
    }

    /** Whether any handlers (including default) are registered. */
    get hasSubscribers(): boolean {
        return this.handlers.length > 0 || this.defaultHandler !== null;
    }

    /**
     * Register a handler. Accepts sync or async functions.
     * Returns an object with `unsubscribe()` to remove the handler.
     */
    subscribe = (handler: EventHandler<TEvent>): SubscriptionObject => {
        this.handlers.push(handler);
        return {
            unsubscribe: () => {
                const index = this.handlers.indexOf(handler);
                if (index >= 0) {
                    this.handlers.splice(index, 1);
                }
            },
        };
    };

    /**
     * Register a default handler that runs last, after all regular subscribers.
     * Only one default handler per channel — calling again overrides the previous.
     * Skipped if `event.handled === true` after regular subscribers.
     */
    subscribeDefault = (handler: EventHandler<TEvent>): SubscriptionObject => {
        this.defaultHandler = handler;
        return {
            unsubscribe: () => {
                if (this.defaultHandler === handler) {
                    this.defaultHandler = null;
                }
            },
        };
    };

    /**
     * Fire-and-forget: freezes the event and calls all subscribers synchronously.
     * Subscribers cannot modify the event. Errors are caught and logged.
     */
    send = (event: TEvent): void => {
        const frozen = Object.freeze(event);
        for (const handler of [...this.handlers]) {
            try {
                handler(frozen);
            } catch (error) {
                this.errorHandler(error, this.channelName);
            }
        }
        if (this.defaultHandler) {
            try {
                this.defaultHandler(frozen);
            } catch (error) {
                this.errorHandler(error, this.channelName);
            }
        }
    };

    /**
     * Async pipeline: calls subscribers sequentially, awaiting async handlers.
     * Subscribers can modify the event. Short-circuits if `event.handled` becomes true.
     * Default handler runs last (skipped if handled).
     *
     * @returns `true` if completed normally, `false` if cancelled (future).
     */
    sendAsync = async (event: TEvent): Promise<boolean> => {
        for (const handler of [...this.handlers]) {
            try {
                const result = handler(event);
                if (result && typeof (result as Promise<void>).then === "function") {
                    await result;
                }
            } catch (error) {
                this.errorHandler(error, this.channelName);
            }
            if (event.handled) {
                return true;
            }
        }
        if (this.defaultHandler && !event.handled) {
            try {
                const result = this.defaultHandler(event);
                if (result && typeof (result as Promise<void>).then === "function") {
                    await result;
                }
            } catch (error) {
                this.errorHandler(error, this.channelName);
            }
        }
        return true;
    };
}
