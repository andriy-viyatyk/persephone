/**
 * Menu item definition for context menus and popup menus.
 *
 * @example
 * const item: MenuItem = {
 *     label: "Generate Graph",
 *     onClick: () => runGraphScript(target.path),
 * };
 */
export interface MenuItem {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    icon?: any;
    invisible?: boolean;
    /** When true, a separator line is shown above this item. */
    startGroup?: boolean;
    hotKey?: string;
    /** Initially highlighted item. */
    selected?: boolean;
    id?: string;
    /** Sub-menu items. */
    items?: MenuItem[];
    minor?: boolean;
}

/** Base event passed through an EventChannel. */
export interface IBaseEvent {
    /** Set to `true` to short-circuit the pipeline in sendAsync(). */
    handled: boolean;
}

/**
 * Context menu event. Generic over the target type.
 *
 * @example
 * app.events.fileExplorer.onContextMenu.subscribe((event) => {
 *     if (event.target.name === "package.json") {
 *         event.addItem({ label: "Generate Deps Graph", onClick: () => { ... } });
 *     }
 * });
 */
export interface IContextMenuEvent<T> extends IBaseEvent {
    readonly target: T;
    readonly items: MenuItem[];
    /** Add a menu item. */
    addItem(item: MenuItem): void;
    /** Add a menu item with a separator line above it. */
    addGroupItem(item: MenuItem): void;
}

/** File target for file explorer context menu events. */
export interface IFileTarget {
    /** Full file path. */
    path: string;
    /** File name with extension. */
    name: string;
    /** True if this is a directory. */
    isDirectory: boolean;
}

/** Concrete type alias for file explorer context menu events. */
export type FileContextMenuEvent = IContextMenuEvent<IFileTarget>;

/** Subscription handle returned by subscribe(). */
export interface ISubscriptionObject {
    unsubscribe(): void;
}

/**
 * A typed event channel. Subscribe to receive events.
 *
 * @example
 * const sub = channel.subscribe((event) => {
 *     console.log("Event received:", event);
 * });
 * // Later: sub.unsubscribe();
 */
export interface IEventChannel<T extends IBaseEvent> {
    /** Register a handler (sync or async). */
    subscribe(handler: (event: T) => void | Promise<void>): ISubscriptionObject;
    /** Register a default handler that runs last (skipped if event.handled is true). */
    subscribeDefault(handler: (event: T) => void | Promise<void>): ISubscriptionObject;
}
