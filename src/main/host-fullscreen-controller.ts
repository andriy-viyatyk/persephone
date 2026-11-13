import type { BrowserWindow, WebContents } from "electron";
import type { BrowserGuestRegistry } from "./browser/BrowserGuestRegistry";

/** Owns fullscreen state and guest coordination for one application window. */
export class HostFullscreenController {
    private hostFullscreenIntent: boolean;
    private hostFullscreenRevision = 0;
    private guestTransitionUntil = 0;
    private postFullscreenMaximize: boolean | undefined;

    constructor(private readonly window: BrowserWindow, private readonly browserGuests: BrowserGuestRegistry) {
        this.hostFullscreenIntent = window.isFullScreen();
    }

    watch(): void {
        const changed = (): void => {
            const revision = this.hostFullscreenRevision;
            setTimeout(() => {
                if (this.window.isDestroyed() || revision !== this.hostFullscreenRevision) return;
                if (Date.now() < this.guestTransitionUntil) {
                    if (this.window.isFullScreen() !== this.getHostFullscreenIntent()
                        && !this.browserGuests.anyHtmlFullscreen(this.window.webContents)) {
                        this.window.setFullScreen(this.getHostFullscreenIntent());
                    }
                } else if (!this.browserGuests.anyHtmlFullscreen(this.window.webContents)) {
                    this.hostFullscreenIntent = this.window.isFullScreen();
                }
            }, 150);
        };
        this.window.on("enter-full-screen", changed);
        this.window.on("leave-full-screen", changed);
        this.window.on("leave-full-screen", () => {
            const maximize = this.getPostFullscreenMaximize();
            if (maximize === undefined || this.window.isDestroyed()) return;
            this.setPostFullscreenMaximize(undefined);
            if (maximize && !this.window.isMaximized()) this.window.maximize();
            if (!maximize && this.window.isMaximized()) this.window.unmaximize();
        });
    }

    setHostFullscreenIntent(on: boolean): void {
        this.hostFullscreenRevision++;
        this.hostFullscreenIntent = on;
    }

    getHostFullscreenIntent(): boolean {
        return this.hostFullscreenIntent;
    }

    setPostFullscreenMaximize(maximize: boolean | undefined): void {
        this.postFullscreenMaximize = maximize;
    }

    getPostFullscreenMaximize(): boolean | undefined {
        return this.postFullscreenMaximize;
    }

    markGuestTransition(_sender: WebContents): void {
        this.guestTransitionUntil = Date.now() + 1500;
    }

    releaseWindowFullscreen(sender: WebContents): void {
        if (sender.isDestroyed() || this.browserGuests.anyHtmlFullscreen(sender)) return;
        if (!this.window.isDestroyed() && this.window.isFullScreen() !== this.getHostFullscreenIntent()) {
            this.window.setFullScreen(this.getHostFullscreenIntent());
        }
    }

    windowHtmlFullscreenKeys(): string[] {
        return this.browserGuests.forSender(this.window.webContents)
            .filter(guest => guest.htmlFullscreen)
            .map(guest => guest.key);
    }

    async restoreGuestFullscreen(key: string): Promise<boolean> {
        const guest = this.browserGuests.get(key);
        if (!guest || guest.senderWebContents !== this.window.webContents || guest.webContents.isDestroyed()) return false;
        return guest.restoreHtmlFullscreen();
    }

    async exitWindowHtmlFullscreen(): Promise<void> {
        const guests = this.browserGuests.forSender(this.window.webContents).filter(guest => guest.htmlFullscreen);
        await Promise.all(guests.map(guest => guest.exitHtmlFullscreen()));
    }
}
