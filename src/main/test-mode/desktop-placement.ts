import { app, BrowserWindow } from "electron";
import { virtualDesktopManager, type ResolvedVirtualDesktop } from "../virtual-desktop-manager";
import { desktopAwareness } from "../desktop-awareness";
import { isTestInstance, parseTestInstanceOptions } from "./instance-options";
import { errMessage } from "../../shared/utils";
import { getPlatformFeature } from "../../shared/platform-features";

/** Owns pre-show placement and activation suppression for an owned desktop-selected run. */
export class DesktopPlacementService {
    private target: ResolvedVirtualDesktop | undefined;
    private started = false;
    private readonly placedWindows = new WeakSet<BrowserWindow>();
    private readonly focusRequested = new WeakSet<BrowserWindow>();

    private readonly onBrowserWindowCreated = (_event: Electron.Event, window: BrowserWindow): void => {
        if (!this.target) return;
        this.installGuards(window);
        this.placedWindows.add(window);
    };

    /**
     * Moves a window to the target desktop right before its first show. A move issued during
     * `browser-window-created` (inside the BrowserWindow constructor) returns S_OK but has no
     * effect; the US-2184 prototype moved a created, still-hidden window just before
     * `showInactive()`, which works.
     */
    private placeBeforeFirstShow(window: BrowserWindow): boolean {
        const target = this.target;
        if (!target) return true;
        try {
            virtualDesktopManager.moveToDesktop(window, target.id);
            return true;
        } catch (error) {
            const available = target.desktops.map((desktop) => `${desktop.number}${desktop.name ? ` (${desktop.name})` : ""}`).join(", ");
            console.error(`[test-desktop] Could not place window on ${target.selector}: ${errMessage(error)}. Available desktops: ${available}`);
            app.exit(1);
            return false;
        }
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        const options = parseTestInstanceOptions(process.argv.slice(1)).options;
        if (isTestInstance() && options?.desktop) {
            const availability = getPlatformFeature("desktop.virtualPlacement");
            if (availability.available === false) {
                console.error(`[test-desktop] --test-desktop: ${availability.reason}`);
                app.exit(1);
                return;
            }
            try {
                this.target = virtualDesktopManager.resolveSelector(options.desktop);
            } catch (error) {
                console.error(`[test-desktop] Could not resolve ${options.desktop}: ${errMessage(error)}`);
                app.exit(1);
                return;
            }
            app.on("browser-window-created", this.onBrowserWindowCreated);
        }
        if (getPlatformFeature("desktop.virtualPlacement").available) desktopAwareness.setVirtualDesktopProbe({
            isOnCurrentDesktop: (window) => {
                try {
                    return virtualDesktopManager.isOnCurrentDesktop(window);
                } catch (error) {
                    console.warn(`[test-desktop] Visibility probe failed; using lock/minimized/shown fallback: ${errMessage(error)}`);
                    return true;
                }
            },
        });
    }

    dispose(): void {
        if (this.started) app.removeListener("browser-window-created", this.onBrowserWindowCreated);
        this.started = false;
        this.target = undefined;
        desktopAwareness.setVirtualDesktopProbe(undefined);
    }

    showPlacedWindow(window: BrowserWindow): void {
        if (this.placedWindows.has(window) && !window.isDestroyed()) window.show();
    }

    isActive(): boolean {
        return this.target !== undefined;
    }

    /**
     * True once code asked to focus this placed window. The guard swallows `focus()`, so the
     * window never gets a real `focus` event; callers that treat focus as user attention (the
     * pop-up policy's nested-pop-up gate) use this instead.
     */
    hasFocusRequest(window: BrowserWindow): boolean {
        return this.focusRequested.has(window);
    }

    private installGuards(window: BrowserWindow): void {
        const showInactive = window.showInactive.bind(window);
        let placed = false;
        const showOnTarget = (): void => {
            if (!placed) {
                placed = true;
                if (!this.placeBeforeFirstShow(window)) return;
            }
            showInactive();
        };
        window.focus = (): void => { this.focusRequested.add(window); };
        // Win32 restore (SW_RESTORE) activates the window, which switches the user to its desktop.
        // showInactive() (SW_SHOWNOACTIVATE) restores a minimized window without activating it.
        window.restore = (): void => { if (window.isMinimized()) showInactive(); };
        window.show = showOnTarget;
        window.showInactive = showOnTarget;
        window.moveTop = (): void => {};
        window.setAlwaysOnTop = (): void => {};
        window.webContents.focus = (): void => {};
    }
}

export const desktopPlacement = new DesktopPlacementService();
