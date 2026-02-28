/**
 * An object that holds resources and must be cleaned up when no longer needed.
 * Call dispose() to release all resources.
 *
 * Compatible with Monaco editor's IDisposable interface.
 */
export interface IDisposable {
    dispose(): void;
}

/**
 * A subscribable event. Call subscribe() to listen for events,
 * then call dispose() on the returned object to unsubscribe.
 *
 * @example
 * const subscription = app.settings.onChanged.subscribe((e) => {
 *     console.log(`Setting ${e.key} changed to`, e.value);
 * });
 * // Later: subscription.dispose();
 */
export interface IEvent<T> {
    subscribe(handler: (data: T) => void): IDisposable;
}
