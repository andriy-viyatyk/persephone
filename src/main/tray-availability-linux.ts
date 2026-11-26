import { execFile } from "node:child_process";
import { isLinux } from "../shared/platform";

export interface TrayAvailabilitySnapshot {
    trayAvailable: boolean;
    closeToTrayAvailable: boolean;
}

export class TrayAvailabilityLinux {
    private trayCreated = false;
    private hostRegistered = false;
    private pendingRefresh?: Promise<void>;

    setTrayCreated(created: boolean): void {
        this.trayCreated = created;
        if (!created) this.hostRegistered = false;
    }

    snapshot(): TrayAvailabilitySnapshot {
        const available = this.trayCreated && this.hostRegistered;
        return { trayAvailable: available, closeToTrayAvailable: available };
    }

    /** Start a probe, or join the one already running. */
    refresh(): Promise<void> {
        if (!this.pendingRefresh) {
            this.pendingRefresh = this.probe().finally(() => { this.pendingRefresh = undefined; });
        }
        return this.pendingRefresh;
    }

    /** The probe still running, if any; a close decision waits for it so it never reads a stale snapshot. */
    get pending(): Promise<void> | undefined {
        return this.pendingRefresh;
    }

    private async probe(): Promise<void> {
        if (!isLinux || !this.trayCreated) {
            this.hostRegistered = false;
            return;
        }

        try {
            this.hostRegistered = await new Promise<boolean>((resolve) => {
                execFile("gdbus", [
                    "call", "--session",
                    "--dest", "org.kde.StatusNotifierWatcher",
                    "--object-path", "/StatusNotifierWatcher",
                    "--method", "org.freedesktop.DBus.Properties.Get",
                    "org.kde.StatusNotifierWatcher",
                    "IsStatusNotifierHostRegistered",
                ], { timeout: 1000, windowsHide: true }, (error, stdout) => {
                    if (error) {
                        resolve(false);
                        return;
                    }
                    resolve(/^\s*\(\s*<\s*true\s*>\s*,?\s*\)\s*$/i.test(stdout));
                });
            });
        } catch {
            this.hostRegistered = false;
        }
    }
}
