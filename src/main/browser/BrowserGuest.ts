import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog, WebContents, WebFrameMain } from "electron";
import { BrowserChannel, BrowserEvent } from "../../ipc/browser-ipc";
import type { EventApi } from "../../ipc/api-types";
import type { EventPayload } from "../../ipc/event-types";
import { globalPopupRateLimiter } from "../../ipc/popup-rate-limiter";
import { t } from "../../shared/i18n/t";
import { errMessage } from "../../shared/utils";
import { withNativeDialogSync } from "../native-dialog-tracker";
import { hasRecentRendererRequest } from "../renderer-rpc";
import { getNavigationScheme, USER_ACTIVATION_WINDOW_MS } from "./navigation-scheme-policy";
import { destroyPopupWithNodeIntegration, guardPopupWindow, handleGuestPopup } from "./popup-policy";

type AnyEventHandler = (...args: unknown[]) => void;
interface EventTarget {
    on(event: string, handler: AnyEventHandler): void;
    removeListener(event: string, handler: AnyEventHandler): void;
}
type Press = { x: number; y: number; button: "left" | "middle" | "right" };

export interface BrowserGuestHostHooks {
    markGuestTransition(sender: WebContents): void;
    getHostFullscreenIntent(sender: WebContents): boolean;
    releaseHostFullscreen(sender: WebContents): void;
}

export interface BrowserGuestHooks {
    host: BrowserGuestHostHooks;
    sendHostEvent<K extends keyof EventApi>(endpoint: K, data: EventPayload<K>): void;
    forwardVoiceTypingInput(parentWindow: BrowserWindow, event: Electron.Event, input: Electron.Input, guest: WebContents): void;
    settlePermissionRequests(contents: WebContents): void;
    clearNetworkLog(key: string): void;
    clearCdpTargetState(key: string): void;
    removeFromRegistry(guest: BrowserGuest): void;
    unregisterFromRegistry(guest: BrowserGuest): void;
    isCurrent(guest: BrowserGuest): boolean;
}

export class BrowserGuest {
    readonly key: string;
    readonly tabId: string;
    readonly internalTabId: string;
    readonly webContents: WebContents;
    readonly senderWebContents: WebContents;
    readonly listeners: Array<{ event: string; handler: AnyEventHandler }> = [];
    bypassUnloadGuard = false;
    htmlFullscreen = false;
    navigationGeneration = 0;
    pressed: Press | null = null;
    lastUserActivation = 0;
    zoomPercent: number;
    private disposed = false;

    constructor(args: {
        key: string;
        tabId: string;
        internalTabId: string;
        webContents: WebContents;
        senderWebContents: WebContents;
        zoomPercent: number;
        hooks: BrowserGuestHooks;
    }) {
        this.key = args.key;
        this.tabId = args.tabId;
        this.internalTabId = args.internalTabId;
        this.webContents = args.webContents;
        this.senderWebContents = args.senderWebContents;
        this.zoomPercent = args.zoomPercent;
        this.hooks = args.hooks;
    }

    private readonly hooks: BrowserGuestHooks;

    sendEvent(type: BrowserEvent["type"], data: BrowserEvent["data"]): void {
        try {
            if (!this.senderWebContents.isDestroyed()) {
                const event: BrowserEvent = { tabId: this.tabId, internalTabId: this.internalTabId, type, data };
                this.senderWebContents.send(BrowserChannel.event, event);
            }
        } catch {
            // Sender may be destroyed.
        }
    }

    applyZoom(): void {
        if (this.webContents.isDestroyed() || this.senderWebContents.isDestroyed()) return;
        this.webContents.setZoomFactor(this.senderWebContents.getZoomFactor() * this.zoomPercent / 100);
    }

    releaseLostPress(reason: string): void {
        const press = this.pressed;
        if (!press || this.webContents.isDestroyed()) return;
        this.pressed = null;
        console.log(`[browser] released a mouse press lost to ${reason} (${this.tabId}/${this.internalTabId})`);
        this.webContents.sendInputEvent({ type: "mouseUp", x: press.x, y: press.y, button: press.button, clickCount: 1 });
    }

    attach(): void {
        const contents = this.webContents as unknown as EventTarget;
        const on = (event: string, handler: AnyEventHandler): void => {
            contents.on(event, handler);
            this.listeners.push({ event, handler });
        };

        on("did-navigate", (_event: Electron.Event, url: string) => {
            this.sendEvent("did-navigate", { url, canGoBack: this.webContents.canGoBack(), canGoForward: this.webContents.canGoForward() });
        });
        on("did-navigate-in-page", (_event: Electron.Event, url: string, isMainFrame: boolean) => {
            if (isMainFrame) this.sendEvent("did-navigate-in-page", {
                url, canGoBack: this.webContents.canGoBack(), canGoForward: this.webContents.canGoForward(), isMainFrame,
            });
        });
        on("did-start-navigation", (_event: Electron.Event, url: string, inPlace: boolean, isMainFrame: boolean) => {
            if (!inPlace) this.navigationGeneration++;
            if (isMainFrame) {
                this.hooks.settlePermissionRequests(this.webContents);
                this.sendEvent("did-start-navigation", { url, isMainFrame, isSameDocument: inPlace });
            }
        });
        on("did-start-loading", () => this.sendEvent("did-start-loading", {}));
        on("did-stop-loading", () => {
            this.bypassUnloadGuard = false;
            this.sendEvent("did-stop-loading", {});
        });
        on("will-prevent-unload", (event: Electron.Event) => this.handleBeforeUnload(event));
        on("enter-html-full-screen", () => this.setHtmlFullscreen(true));
        on("leave-html-full-screen", () => this.setHtmlFullscreen(false));
        on("before-mouse-event", (_event: Electron.Event, mouse: Electron.MouseInputEvent) => this.trackPress(mouse));
        on("blur", () => this.releaseLostPress("focus loss"));
        on("audio-state-changed", (event: Electron.Event & { audible: boolean }) => {
            this.sendEvent("audio-state-changed", { audible: event.audible });
        });
        on("will-navigate", (event: Electron.Event, url: string) => this.handleNavigation(event, url));
        on("will-redirect", (event: Electron.Event, details: Electron.WebContentsWillRedirectEventParams) => {
            if (getNavigationScheme(details.url) === "blocked") event.preventDefault();
        });
        on("will-frame-navigate", (details: Electron.Event & Electron.WebContentsWillFrameNavigateEventParams) => {
            if (!details.isMainFrame && getNavigationScheme(details.url) === "blocked") details.preventDefault();
        });
        on("context-menu", (event: Electron.Event, params: Electron.ContextMenuParams) => {
            event.preventDefault();
            this.sendEvent("context-menu", {
                linkURL: params.linkURL || undefined, srcURL: params.srcURL || undefined,
                mediaType: params.mediaType !== "none" ? params.mediaType : undefined,
                selectionText: params.selectionText || undefined, isEditable: params.isEditable || undefined,
                editFlags: params.editFlags, x: params.x, y: params.y,
            });
        });
        on("before-input-event", (event: Electron.Event, input: Electron.Input) => this.handleInput(event, input));
        this.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
            if (disposition === "foreground-tab" || disposition === "background-tab") {
                this.releaseLostPress("a new tab");
                this.sendEvent("new-window", { url, disposition });
                return { action: "deny" };
            }
            if (!globalPopupRateLimiter.isAllowed("popups") && !globalPopupRateLimiter.check("popups")) {
                this.sendEvent("popups-blocked", { url });
                return { action: "deny" };
            }
            const parentWindow = BrowserWindow.fromWebContents(this.senderWebContents) ?? undefined;
            return { action: "allow", overrideBrowserWindowOptions: handleGuestPopup(parentWindow, features) };
        });
        on("zoom-changed", (event: Electron.Event, direction: "in" | "out") => {
            event.preventDefault();
            this.sendEvent("zoom-intent", { zoomIntent: direction });
        });
        on("did-create-window", (childWindow: BrowserWindow, details: Electron.DidCreateWindowDetails) => {
            if (destroyPopupWithNodeIntegration(childWindow, details)) return;
            this.releaseLostPress("a popup window");
            guardPopupWindow(childWindow, this.senderWebContents, (type, data) => this.sendEvent(type, data));
        });
        on("destroyed", () => this.hooks.unregisterFromRegistry(this));
    }

    private setHtmlFullscreen(on: boolean): void {
        this.htmlFullscreen = on;
        this.hooks.host.markGuestTransition(this.senderWebContents);
        if (!on) this.hooks.host.releaseHostFullscreen(this.senderWebContents);
    }

    private trackPress(mouse: Electron.MouseInputEvent): void {
        if (mouse.type === "mouseDown") {
            this.lastUserActivation = Date.now();
            this.pressed = { x: mouse.x, y: mouse.y, button: mouse.button ?? "left" };
        } else if (mouse.type === "mouseUp") {
            this.lastUserActivation = Date.now();
            this.pressed = null;
        } else if (mouse.type === "mouseMove" && this.pressed) {
            this.pressed.x = mouse.x;
            this.pressed.y = mouse.y;
        }
    }

    private handleNavigation(event: Electron.Event, url: string): void {
        const scheme = getNavigationScheme(url);
        if (scheme === "invalid") return;
        if (scheme === "blocked") {
            event.preventDefault();
            this.sendEvent("did-start-navigation", { url, blocked: true });
        } else if (scheme === "external") {
            event.preventDefault();
            const activated = Date.now() - this.lastUserActivation <= USER_ACTIVATION_WINDOW_MS;
            this.lastUserActivation = 0;
            if (activated) this.hooks.sendHostEvent("eOpenPipelineCandidate", url);
        }
    }

    handleInput(event: Electron.Event, input: Electron.Input): void {
        const parentWindow = BrowserWindow.fromWebContents(this.senderWebContents);
        if (parentWindow) this.hooks.forwardVoiceTypingInput(parentWindow, event, input, this.webContents);
        if (input.type !== "keyDown" || event.defaultPrevented) return;
        this.lastUserActivation = Date.now();
        if (input.key === "Escape" && this.htmlFullscreen) {
            event.preventDefault();
            void this.exitFullscreen().catch((): void => undefined);
            return;
        }
        const keyLower = input.key.toLowerCase();
        if (input.control && !input.alt && !input.meta && ["=", "+", "-", "0"].includes(input.key)) {
            event.preventDefault();
            this.sendEvent("zoom-intent", { zoomIntent: input.key === "0" ? "reset" : input.key === "-" ? "out" : "in" });
            return;
        }
        if (input.key === "F5" || (keyLower === "r" && input.control)) {
            event.preventDefault();
            if (input.key === "F5" ? input.control : input.shift) {
                this.bypassUnloadGuard = true;
                this.webContents.reloadIgnoringCache();
            } else this.webContents.reload();
        } else if (input.key === "F12") {
            event.preventDefault();
            this.webContents.openDevTools();
        } else if (input.alt && (input.key === "ArrowLeft" || input.key === "ArrowRight")) {
            event.preventDefault();
            if (input.key === "ArrowLeft") this.webContents.goBack();
            else this.webContents.goForward();
        }
    }

    private handleBeforeUnload(event: Electron.Event): void {
        if (this.bypassUnloadGuard) {
            this.bypassUnloadGuard = false;
            event.preventDefault();
            return;
        }
        if (hasRecentRendererRequest()) {
            event.preventDefault();
            return;
        }
        const parentWindow = BrowserWindow.fromWebContents(this.senderWebContents);
        const options: Electron.MessageBoxSyncOptions = {
            type: "question", buttons: [t("main.unsavedChangesLeave"), t("main.unsavedChangesCancel")],
            defaultId: 1, cancelId: 1, title: t("main.unsavedChangesTitle"), message: t("main.unsavedChangesMessage"),
        };
        const choice = withNativeDialogSync(parentWindow, "messageBox", () => parentWindow
            ? dialog.showMessageBoxSync(parentWindow, options) : dialog.showMessageBoxSync(options));
        if (choice === 0) event.preventDefault();
    }

    async enterFullscreen(selector?: string): Promise<{ fullscreen: boolean }> {
        const generation = this.navigationGeneration;
        const mainFrame = this.webContents.mainFrame;
        const frames = selector === undefined ? [mainFrame, ...mainFrame.framesInSubtree.filter(frame => frame !== mainFrame)] : [mainFrame];
        const token = randomUUID();
        let best: { frame: WebFrameMain; url: string; area: number; playing: boolean } | undefined;
        for (const frame of frames) {
            this.assertCurrent(generation);
            const code = `(() => {
                const selector = ${JSON.stringify(selector ?? "video")};
                const videoMode = ${selector === undefined};
                const nodes = Array.from(document.querySelectorAll(selector));
                let best = null;
                for (const element of nodes) {
                    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
                    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight || style.display === 'none' || style.visibility !== 'visible') continue;
                    const area = rect.width * rect.height, playing = videoMode && !element.paused && !element.ended;
                    if (!best || (playing && !best.playing) || (playing === best.playing && area > best.area)) best = { element, area, playing };
                }
                if (!best) return null;
                globalThis[${JSON.stringify(token)}] = best.element;
                return { area: best.area, playing: best.playing };
            })()`;
            let candidate: { area: number; playing: boolean } | null;
            try { candidate = await frame.executeJavaScript(code, true) as typeof candidate; }
            catch (error) {
                if (selector !== undefined) throw new Error(`Invalid selector or unavailable frame: ${errMessage(error)}`);
                continue;
            }
            if (candidate && (!best || (candidate.playing && !best.playing) || (candidate.playing === best.playing && candidate.area > best.area))) {
                best = { frame, url: frame.url, ...candidate };
            }
        }
        if (!best) throw new Error(selector === undefined ? "No visible video found" : "No visible element matches the selector");
        this.assertSelectedFrame(best, generation);
        const code = `(async () => {
            const element = globalThis[${JSON.stringify(token)}]; delete globalThis[${JSON.stringify(token)}];
            if (!element || !element.isConnected || element.ownerDocument !== document) throw new Error('Selected element is no longer available');
            if (!element.matches(${JSON.stringify(selector ?? "video")})) throw new Error('Selected element no longer matches');
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight || style.display === 'none' || style.visibility !== 'visible') throw new Error('Selected element is no longer visible');
            await element.requestFullscreen();
        })()`;
        try {
            await Promise.race([best.frame.executeJavaScript(code, true), new Promise((_, reject) => setTimeout(() => reject(new Error("Fullscreen request timed out")), 4000))]);
        } catch (error) {
            throw new Error(`Browser fullscreen failed: ${errMessage(error)}. If iframe permission is denied, click the player's fullscreen button using browser automation.`);
        }
        this.assertCurrent(generation);
        const deadline = Date.now() + 3000;
        while (!this.htmlFullscreen) {
            this.assertCurrent(generation);
            if (Date.now() >= deadline) throw new Error("Timed out waiting for browser fullscreen transition");
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        return { fullscreen: this.htmlFullscreen };
    }

    private assertCurrent(generation: number): void {
        if (this.disposed || !this.hooks.isCurrent(this) || this.webContents.isDestroyed() || this.navigationGeneration !== generation) {
            throw new Error("Browser tab navigated or closed");
        }
    }

    private assertSelectedFrame(best: { frame: WebFrameMain; url: string }, generation: number): void {
        this.assertCurrent(generation);
        if (!this.webContents.mainFrame.framesInSubtree.includes(best.frame) || best.frame.url !== best.url) {
            throw new Error("Browser tab or selected frame navigated during fullscreen selection");
        }
    }

    async exitHtmlFullscreen(): Promise<void> {
        if (!this.htmlFullscreen || this.webContents.isDestroyed()) return;
        const webContents = this.webContents;
        const sender = this.senderWebContents;
        const fallback = setTimeout(() => {
            if (!this.htmlFullscreen) return;
            const win = BrowserWindow.fromWebContents(sender);
            if (win && !win.isDestroyed() && !this.hooks.host.getHostFullscreenIntent(sender)) win.setFullScreen(false);
        }, 1000);
        try {
            await Promise.race([
                webContents.executeJavaScript("document.fullscreenElement ? document.exitFullscreen() : undefined", true),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Browser fullscreen exit timed out")), 2500)),
            ]);
            if (this.disposed || !this.hooks.isCurrent(this)) throw new Error("Browser tab navigated or closed during fullscreen exit");
            const deadline = Date.now() + 2500;
            while (this.htmlFullscreen) {
                if (this.disposed || !this.hooks.isCurrent(this) || this.webContents !== webContents || this.webContents.isDestroyed()) {
                    throw new Error("Browser tab navigated or closed during fullscreen exit");
                }
                if (Date.now() >= deadline) throw new Error("Timed out waiting for browser fullscreen exit");
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        } finally {
            clearTimeout(fallback);
        }
    }

    async exitFullscreen(): Promise<void> {
        await this.exitHtmlFullscreen();
    }

    async restoreHtmlFullscreen(): Promise<boolean> {
        return (await this.enterFullscreen()).fullscreen;
    }

    hardReload(): void {
        if (this.webContents.isDestroyed()) return;
        this.bypassUnloadGuard = true;
        this.webContents.reloadIgnoringCache();
    }

    dispose(options: { keepCdpState?: boolean } = {}): void {
        if (this.disposed) return;
        this.disposed = true;
        this.hooks.settlePermissionRequests(this.webContents);
        for (const { event, handler } of this.listeners) {
            try {
                if (!this.webContents.isDestroyed()) (this.webContents as unknown as EventTarget).removeListener(event, handler);
            } catch { /* webContents may already be destroyed */ }
        }
        this.hooks.removeFromRegistry(this);
        if (this.htmlFullscreen) {
            this.hooks.host.markGuestTransition(this.senderWebContents);
            this.hooks.host.releaseHostFullscreen(this.senderWebContents);
            this.htmlFullscreen = false;
        }
        if (!options.keepCdpState) {
            this.hooks.clearNetworkLog(this.key);
            this.hooks.clearCdpTargetState(this.key);
        }
    }
}
