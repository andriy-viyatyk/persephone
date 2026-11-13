import type { EventApi, EventObject } from "../api-types";
import type { EventPayload } from "../event-types";

class RendererEventObject<K extends keyof EventApi> implements EventObject<EventPayload<K>> {
    private subscribers: Array<(data: EventPayload<K>) => void> = [];

    constructor(private readonly eventName: K) {
        this.listen();
    }

    subscribe(callback: (data: EventPayload<K>) => void): () => void {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter((subscriber) => subscriber !== callback);
        };
    }

    send(data: EventPayload<K>): void {
        if (!window.electron?.ipcRenderer) return;
        window.electron.ipcRenderer.sendMessage(this.eventName, data);
    }

    private listen(): void {
        if (!window.electron?.ipcRenderer) {
            console.error("Event Listener: IPC Renderer is not available");
            return;
        }
        window.electron.ipcRenderer.on(this.eventName, (data) => {
            this.subscribers.forEach((subscriber) => {
                try {
                    subscriber(data as EventPayload<K>);
                } catch (error) {
                    console.error("Event callback error:", error);
                }
            });
        });
    }
}

type RendererEvents = { [K in keyof EventApi]: EventApi[K] };
const eventObjects = new Map<keyof EventApi, EventObject<unknown>>();

const rendererEvents = new Proxy({} as RendererEvents, {
    get(_target, key: string | symbol) {
        if (typeof key === "symbol" || key === "then" || key === "toJSON" || key === "constructor") return undefined;
        const eventKey = key as keyof EventApi;
        let eventObject = eventObjects.get(eventKey);
        if (!eventObject) {
            eventObject = new RendererEventObject(eventKey) as EventObject<unknown>;
            eventObjects.set(eventKey, eventObject);
        }
        return eventObject;
    },
});

export default rendererEvents;
