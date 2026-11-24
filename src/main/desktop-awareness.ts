import { powerMonitor, type BrowserWindow } from "electron";
import { openWindows } from "./open-windows";
import { unseenMode } from "./unseen-mode";

export interface VirtualDesktopVisibilityProbe {
    isOnCurrentDesktop(window: BrowserWindow): boolean;
}

/** Owns the process-wide session lock state and derives each window's desktop visibility live. */
export class DesktopAwarenessService {
    private lockedValue = false;
    private started = false;
    private virtualDesktopProbe: VirtualDesktopVisibilityProbe | undefined;

    private readonly onLockScreen = (): void => this.setLocked(true);
    private readonly onUnlockScreen = (): void => this.setLocked(false);

    get locked(): boolean {
        return this.lockedValue;
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.lockedValue = powerMonitor.getSystemIdleState(60) === "locked";
        powerMonitor.on("lock-screen", this.onLockScreen);
        powerMonitor.on("unlock-screen", this.onUnlockScreen);
    }

    dispose(): void {
        if (this.started) {
            powerMonitor.removeListener("lock-screen", this.onLockScreen);
            powerMonitor.removeListener("unlock-screen", this.onUnlockScreen);
        }
        this.started = false;
    }

    /** Without a probe, visibility covers lock, minimized, and shown state only. */
    setVirtualDesktopProbe(probe: VirtualDesktopVisibilityProbe | undefined): void {
        this.virtualDesktopProbe = probe;
    }

    isDesktopVisible(window: BrowserWindow | undefined): boolean {
        if (!window || window.isDestroyed() || this.lockedValue || window.isMinimized() || !window.isVisible()) {
            return false;
        }
        return this.virtualDesktopProbe?.isOnCurrentDesktop(window) ?? true;
    }

    isDesktopVisibleForIndex(index: number): boolean {
        const window = openWindows.findWindowDataByIndex(index)?.window?.window;
        return this.isDesktopVisible(window);
    }

    private setLocked(locked: boolean): void {
        if (this.lockedValue === locked) return;
        this.lockedValue = locked;
        openWindows.send("eSessionLockChanged", {
            locked,
            unseenModeEnabled: unseenMode.enabled,
            text: this.getLockMessage(locked, unseenMode.enabled),
        });
    }

    private getLockMessage(locked: boolean, unseenModeEnabled: boolean): string {
        if (locked) {
            return "Windows session locked; without unseen mode, animation frames stop (and anything waiting for them) and timers slow to about 1 s. "
                + "OS clipboard, native file dialogs, real OS focus, and global hotkeys remain unavailable in every mode. "
                + `main.unseenMode.enabled is ${unseenModeEnabled}; call main.unseenMode.enable with args: [] to keep frames and timers running.`;
        }
        return "Windows session unlocked; main.session.locked is false, desktopVisible still depends on the window's minimized/virtual-desktop state, "
            + `and main.unseenMode.enabled remains ${unseenModeEnabled}.`;
    }
}

export const desktopAwareness = new DesktopAwarenessService();
