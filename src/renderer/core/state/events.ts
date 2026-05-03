export class AppEvent extends EventTarget {
    emitEvent = <D = undefined>(type: string, detail?: D) => {
        const event = new CustomEvent(type, { detail });
        this.dispatchEvent(event);
    }
}

export type SubsribtionCallback<D> = (detail?: D) => void;
export interface SubscriptionObject {
    unsubscribe: () => void;
}

export class Subscription<D = undefined> {
    type: string;
    appEvent: AppEvent;

    constructor(type?: string, appEvent?: AppEvent){
        this.type = type ?? 'default';
        this.appEvent = appEvent || new AppEvent();
    }

    send = (data: D) => {
        this.appEvent.emitEvent(this.type, data);
    }

    subscribe = (callback: SubsribtionCallback<D>): SubscriptionObject => {
        const callbackWrapper = (event: Event) => {
            const customEvent = event as CustomEvent;
            callback(customEvent.detail);
        }

        this.appEvent.addEventListener(this.type, callbackWrapper);
        return {
            unsubscribe: () => {
                this.appEvent.removeEventListener(this.type, callbackWrapper);
            }
        }
    }
}

/** Global keyboard event broadcast. Sent from MainPage's window keydown listener. */
export const globalKeyDown = new Subscription<KeyboardEvent>();

export interface BrowserUrlEvent {
    url: string;
    /** Set to `true` by the first handler that processes this URL. */
    handled?: boolean;
}

/** Fired by browser editor on every URL change (navigation, redirect). */
export const browserUrlChanged = new Subscription<BrowserUrlEvent>();

/** Fired when the renderer window is about to close. Subscribers should release resources. */
export const windowClosing = new Subscription<void>();

export interface PageNavigatorEvent {
    pageId: string;
    isOpen: boolean;
}

/** Fired when any PageNavigator sidebar opens or closes. */
export const pageNavigatorToggled = new Subscription<PageNavigatorEvent>();

export interface PanelExpandedEvent {
    pageId: string;
    panelId: string;
}

/** Fired when a secondary editor panel is expanded in PageNavigator. */
export const panelExpanded = new Subscription<PanelExpandedEvent>();

/** Fired when any text editor's compareMode toggles. Pages listens to refresh its layout. */
export const compareModeChanged = new Subscription<void>();
