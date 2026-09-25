import { app } from "../../api/app";
import { appServiceDescriptors, type AppServiceKey, type AppServiceSurface } from "../../api/app-service-registry";
import { PageCollectionWrapper } from "./PageCollectionWrapper";
import type { PageWrapper } from "./PageWrapper";
import type { EventChannel, EventHandler } from "../../api/events/EventChannel";
import type { IApp, IAppCallOptions } from "../../api/types/app";
import { resolveCall } from "ai-vision";
import { UNBOUNDED_CALL_MAX_LENGTH } from "../ai-vision/call-limits";
import { AiRoot } from "../ai-vision/root";
import { isPositiveIntegerTimeout } from "../../../shared/ai-vision-timeout";

/**
 * Wrap an EventChannel to auto-track subscriptions in the releaseList.
 * When the script scope is disposed, all subscriptions are unsubscribed.
 */
function wrapEventChannel<TEvent extends { handled?: boolean }>(
    channel: EventChannel<TEvent>,
    releaseList: Array<() => void>,
) {
    return {
        subscribe(handler: EventHandler<TEvent>) {
            const sub = channel.subscribe(handler);
            releaseList.push(sub);
            return sub;
        },
        send(event: TEvent) {
            return channel.send(event);
        },
        sendAsync(event: TEvent) {
            return channel.sendAsync(event);
        },
    };
}

/**
 * Recursively wrap app.events namespace. Intercepts subscribe() on
 * EventChannel leaves, passes through namespace objects. The proxy returns
 * a structurally-identical shape to the input, so we type the return as T.
 */
function createEventsProxy<T extends object>(target: T, releaseList: Array<() => void>): T {
    return new Proxy(target, {
        get(obj, prop) {
            const value = (obj as Record<PropertyKey, unknown>)[prop];
            if (value && typeof value === "object") {
                // EventChannel leaf — has subscribe method
                if (typeof (value as { subscribe?: unknown }).subscribe === "function") {
                    return wrapEventChannel(value as EventChannel<{ handled?: boolean }>, releaseList);
                }
                // Namespace object — recurse
                return createEventsProxy(value as object, releaseList);
            }
            return value;
        },
    });
}

/**
 * Safe wrapper around App for script access.
 * Mirrors the IApp interface from api/types/app.d.ts. Service members are descriptor-backed;
 * the compile-time check at the bottom protects the remaining fixed members.
 *
 * - Most sub-interfaces (settings, fs, ui, etc.) pass through directly —
 *   they expose only the safe public .d.ts surface.
 * - `pages` is wrapped to return PageWrapper instances.
 * - `events` is wrapped to auto-track subscriptions for cleanup.
 */
class AppWrapperImplementation {
    private readonly _pages: PageCollectionWrapper;
    private _events: unknown;
    private readonly releaseList: Array<() => void>;

    /** @param openedByAgent true for MCP-originated contexts — browser pages they open are the agent's own. */
    constructor(
        releaseList: Array<() => void>,
        openedByAgent = false,
        private readonly contextPage?: PageWrapper,
    ) {
        this.releaseList = releaseList;
        this._pages = new PageCollectionWrapper(app.pages, releaseList, openedByAgent);
        for (const { key } of appServiceDescriptors) {
            Object.defineProperty(this, key, {
                get: () => app[key],
            });
        }
    }

    get version() {
        return app.version;
    }

    get pages(): PageCollectionWrapper {
        return this._pages;
    }

    get events() {
        if (!this._events) {
            this._events = createEventsProxy(app.events, this.releaseList);
        }
        return this._events;
    }

    async call(path: string, options?: IAppCallOptions): Promise<unknown> {
        if (options?.timeoutMs !== undefined && !isPositiveIntegerTimeout(options.timeoutMs)) {
            throw new TypeError("app.call() options.timeoutMs must be a positive integer.");
        }
        const request = {
            path,
            hints: "never" as const,
            ...(options?.args !== undefined ? { args: options.args } : {}),
            ...(options && Object.prototype.hasOwnProperty.call(options, "value")
                ? { value: options.value }
                : {}),
            // Same reasoning as the board bridge: a script reads this value in JavaScript,
            // so it does not get the agent-facing default. See UNBOUNDED_CALL_MAX_LENGTH.
            maxLength: options?.maxLength ?? UNBOUNDED_CALL_MAX_LENGTH,
        };
        const callContext = { timeoutMs: options?.timeoutMs };
        const result = await resolveCall(new AiRoot(this as unknown as AppWrapper, {
            page: this.contextPage,
            callContext,
        }), request);
        if (result.error) throw new Error(result.error);
        return result.result;
    }

    fetch = app.fetch;

    openRawLink = app.openRawLink;

    runAsync = async <TData, TProxy, TResult>(
        fn: (data: TData, proxy: TProxy) => Promise<TResult>,
        data: TData,
        proxyObj?: TProxy
    ): Promise<TResult> => {
        const { runAsync: workerRunAsync } = await import("../worker/WorkerRunner");
        return workerRunAsync(fn, data, proxyObj);
    };
}

export type AppWrapper = AppWrapperImplementation & AppServiceSurface;

export const AppWrapper: {
    new (
        releaseList: Array<() => void>,
        openedByAgent?: boolean,
        contextPage?: PageWrapper,
    ): AppWrapper;
} = AppWrapperImplementation as unknown as {
    new (
        releaseList: Array<() => void>,
        openedByAgent?: boolean,
        contextPage?: PageWrapper,
    ): AppWrapper;
};

/**
 * The descriptor table covers service names and is exhaustively checked in the registry.
 * This assertion protects the remaining fixed IApp members whose wrapper behavior is special.
 *
 * `implements IApp` is not usable here. The wrapper deliberately returns richer concrete types
 * than the script-facing interfaces — `pages` yields `PageCollectionWrapper` (whose `PageWrapper`
 * facades are structurally narrower than `IPage`'s), and `events` is an `unknown`-typed lazy
 * proxy — so a structural assertion fails on types that are intentionally mismatched.
 *
 */
type AssertNever<T extends never> = T;
type _AppWrapperCoversFixedIApp = AssertNever<
    Exclude<Exclude<keyof IApp, AppServiceKey>, keyof AppWrapper>
>;
