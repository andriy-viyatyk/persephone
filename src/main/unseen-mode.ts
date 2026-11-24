import { app, webContents, type WebContents } from "electron";
import { isTestInstance } from "./test-mode/instance-options";
import { PageVisibilityOverride } from "./browser/PageVisibilityOverride";

/** Process-wide runtime control for Chromium work while Persephone is unseen. */
export class UnseenModeService {
    private enabledValue = false;
    private started = false;
    private readonly managedContents = new Set<WebContents>();
    private readonly pageVisibility = new PageVisibilityOverride();

    private readonly onWebContentsCreated = (_event: Electron.Event, contents: WebContents): void => {
        // `backgroundThrottling` reads null during this event and reflects webPreferences (e.g. the
        // audio window's explicit false) only from the next tick, so the opt-out check waits for it.
        process.nextTick(() => { if (this.enabledValue) this.apply(contents); });
    };

    get enabled(): boolean {
        return this.enabledValue;
    }

    get managedCount(): number {
        let count = 0;
        for (const contents of this.managedContents) {
            if (!contents.isDestroyed()) count++;
        }
        return count;
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.enabledValue = isTestInstance();
        this.pageVisibility.start(this.enabledValue);
        app.on("web-contents-created", this.onWebContentsCreated);
        if (this.enabledValue) {
            for (const contents of webContents.getAllWebContents()) this.apply(contents);
        }
    }

    enable(): { enabled: true } {
        this.enabledValue = true;
        this.pageVisibility.setEnabled(true);
        for (const contents of webContents.getAllWebContents()) this.apply(contents);
        return { enabled: true };
    }

    disable(): { enabled: false } {
        this.enabledValue = false;
        this.pageVisibility.setEnabled(false);
        this.restoreManagedContents();
        return { enabled: false };
    }

    dispose(): void {
        if (this.started) app.removeListener("web-contents-created", this.onWebContentsCreated);
        this.started = false;
        this.enabledValue = false;
        this.pageVisibility.dispose();
        this.restoreManagedContents();
    }

    private apply(contents: WebContents): void {
        if (contents.isDestroyed() || !contents.backgroundThrottling) return;
        contents.setBackgroundThrottling(false);
        this.managedContents.add(contents);
    }

    private restoreManagedContents(): void {
        for (const contents of this.managedContents) {
            if (!contents.isDestroyed()) contents.setBackgroundThrottling(true);
        }
        this.managedContents.clear();
    }
}

export const unseenMode = new UnseenModeService();
