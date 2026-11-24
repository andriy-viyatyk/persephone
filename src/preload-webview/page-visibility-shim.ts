import { BrowserChannel, type BrowserEvent } from "../ipc/browser-ipc";
import { BrowserGuestMessageChannel, sendToHost } from "../ipc/browser-guest-messages";

const { contextBridge, ipcRenderer } = require("electron");
const MODE_ARGUMENT = "--persephone-unseen-mode-enabled";

type VisibilitySetter = (enabled: boolean) => void;

/** Installs the private Page Visibility override in this document's main world. */
function installMainWorldSetter(): VisibilitySetter {
    return contextBridge.executeInMainWorld({
        func: (): VisibilitySetter => {
            const prototype = Document.prototype;
            const visibilityDescriptor = Object.getOwnPropertyDescriptor(prototype, "visibilityState");
            const hiddenDescriptor = Object.getOwnPropertyDescriptor(prototype, "hidden");
            if (!visibilityDescriptor?.get || !hiddenDescriptor?.get) return () => undefined;

            const nativeVisibility = visibilityDescriptor.get;
            let enabled = false;
            let exposedState = nativeVisibility.call(document) as DocumentVisibilityState;
            let dispatchingExposedChange = false;
            const onVisibilityChange = (event: Event): void => {
                if (dispatchingExposedChange) return;
                const nextState = enabled ? "visible" : nativeVisibility.call(document) as DocumentVisibilityState;
                if (nextState === exposedState) {
                    event.stopImmediatePropagation();
                    return;
                }
                exposedState = nextState;
            };
            const restore = (): void => {
                Object.defineProperty(prototype, "visibilityState", visibilityDescriptor);
                Object.defineProperty(prototype, "hidden", hiddenDescriptor);
                window.removeEventListener("visibilitychange", onVisibilityChange, true);
            };
            const expose = (): void => {
                Object.defineProperty(prototype, "visibilityState", {
                    configurable: true,
                    enumerable: visibilityDescriptor.enumerable,
                    get: () => "visible",
                });
                Object.defineProperty(prototype, "hidden", {
                    configurable: true,
                    enumerable: hiddenDescriptor.enumerable,
                    get: () => false,
                });
                window.addEventListener("visibilitychange", onVisibilityChange, true);
            };

            return (nextEnabled: boolean): void => {
                if (enabled === nextEnabled) return;
                const previousState = exposedState;
                enabled = nextEnabled;
                if (enabled) expose();
                else restore();
                const nextState = enabled ? "visible" : nativeVisibility.call(document) as DocumentVisibilityState;
                exposedState = nextState;
                if (previousState !== nextState) {
                    dispatchingExposedChange = true;
                    document.dispatchEvent(new Event("visibilitychange"));
                    dispatchingExposedChange = false;
                }
            };
        },
    });
}

export function installPageVisibilityShim(): void {
    let enabled = process.argv.includes(MODE_ARGUMENT);
    let setVisibility: VisibilitySetter | undefined;

    if (enabled) {
        setVisibility = installMainWorldSetter();
        setVisibility(true);
    }
    sendToHost(ipcRenderer, { channel: BrowserGuestMessageChannel.visibilityDocumentStart });

    ipcRenderer.on(BrowserChannel.event, (_event: Electron.IpcRendererEvent, browserEvent: BrowserEvent) => {
        if (browserEvent.type !== "visibility-mode-changed" || typeof browserEvent.data.unseenModeEnabled !== "boolean") return;
        const nextEnabled = browserEvent.data.unseenModeEnabled;
        if (enabled === nextEnabled) return;
        enabled = nextEnabled;
        if (!setVisibility && enabled) setVisibility = installMainWorldSetter();
        setVisibility?.(enabled);
    });
}
