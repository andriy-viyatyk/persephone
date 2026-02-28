import type { IEvent } from "./common";

/**
 * Application configuration. Read and write settings with typed access
 * and change notifications.
 *
 * Available as `app.settings`.
 *
 * @example
 * const theme = app.settings.theme;
 * app.settings.set("theme", "monokai");
 * app.settings.onChanged.subscribe(({ key, value }) => {
 *     console.log(`${key} changed to`, value);
 * });
 */
export interface ISettings {
    /** Current theme name. */
    readonly theme: string;

    /** Get a setting value by key. Returns `undefined` for unknown keys. */
    get<T = any>(key: string): T;

    /** Set a setting value. Persisted automatically (debounced). */
    set<T = any>(key: string, value: T): void;

    /** Fires when any setting changes via `set()`. */
    readonly onChanged: IEvent<{ key: string; value: any }>;
}
