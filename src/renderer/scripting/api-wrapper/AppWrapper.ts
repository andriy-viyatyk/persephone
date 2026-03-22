import { app } from "../../api/app";
import { PageCollectionWrapper } from "./PageCollectionWrapper";

/**
 * Wrap an EventChannel to auto-track subscriptions in the releaseList.
 * When the script scope is disposed, all subscriptions are unsubscribed.
 */
function wrapEventChannel(channel: any, releaseList: Array<() => void>) {
    return {
        subscribe(handler: any) {
            const sub = channel.subscribe(handler);
            releaseList.push(() => sub.unsubscribe());
            return sub;
        },
        subscribeDefault(handler: any) {
            const sub = channel.subscribeDefault(handler);
            releaseList.push(() => sub.unsubscribe());
            return sub;
        },
    };
}

/**
 * Recursively wrap app.events namespace. Intercepts subscribe() on
 * EventChannel leaves, passes through namespace objects.
 */
function createEventsProxy(target: any, releaseList: Array<() => void>): any {
    return new Proxy(target, {
        get(obj, prop) {
            const value = obj[prop];
            if (value && typeof value === "object") {
                // EventChannel leaf — has subscribe method
                if (typeof value.subscribe === "function") {
                    return wrapEventChannel(value, releaseList);
                }
                // Namespace object — recurse
                return createEventsProxy(value, releaseList);
            }
            return value;
        },
    });
}

/**
 * Safe wrapper around App for script access.
 * Implements the IApp interface from api/types/app.d.ts.
 *
 * - Most sub-interfaces (settings, fs, ui, etc.) pass through directly —
 *   they are already safe (.d.ts hides internals like .use()).
 * - `pages` is wrapped to return PageWrapper instances.
 * - `events` is wrapped to auto-track subscriptions for cleanup.
 */
export class AppWrapper {
    private readonly _pages: PageCollectionWrapper;
    private _events: unknown;
    private readonly releaseList: Array<() => void>;

    constructor(releaseList: Array<() => void>) {
        this.releaseList = releaseList;
        this._pages = new PageCollectionWrapper(app.pages, releaseList);
    }

    get version() {
        return app.version;
    }

    get settings() {
        return app.settings;
    }

    get editors() {
        return app.editors;
    }

    get recent() {
        return app.recent;
    }

    get fs() {
        return app.fs;
    }

    get window() {
        return app.window;
    }

    get shell() {
        return app.shell;
    }

    get ui() {
        return app.ui;
    }

    get downloads() {
        return app.downloads;
    }

    get menuFolders() {
        return app.menuFolders;
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
}
