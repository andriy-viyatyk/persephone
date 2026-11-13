import { BrowserWindow, screen, type IpcMainEvent } from "electron";
import type { IWindowDisplay, IWindowMoveResult, WindowDisplayTarget } from "../ipc/api-param-types";
import { openWindows } from "./open-windows";

function senderWindow(event: IpcMainEvent): BrowserWindow {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) throw new Error("Window is unavailable");
    return window;
}

function boundsClose(actual: Electron.Rectangle, expected: Electron.Rectangle): boolean {
    return Math.abs(actual.x - expected.x) <= 8 && Math.abs(actual.y - expected.y) <= 8
        && Math.abs(actual.width - expected.width) <= 8 && Math.abs(actual.height - expected.height) <= 8;
}

async function waitForWindow(window: BrowserWindow, predicate: () => boolean, description: string): Promise<void> {
    const deadline = Date.now() + 4000;
    while (!window.isDestroyed() && !predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (window.isDestroyed()) throw new Error("Window was destroyed");
}

export async function getDisplays(event: IpcMainEvent): Promise<IWindowDisplay[]> {
    const window = senderWindow(event);
    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;
    const currentId = screen.getDisplayMatching(window.getBounds()).id;
    return displays.map((display, index) => ({
        index, id: display.id, bounds: display.bounds, workArea: display.workArea,
        scaleFactor: display.scaleFactor, primary: display.id === primaryId,
        current: display.id === currentId, ...(display.label ? { label: display.label } : {}),
    }));
}

export async function getFullScreen(event: IpcMainEvent): Promise<boolean> {
    return senderWindow(event).isFullScreen();
}

export async function setFullScreen(event: IpcMainEvent, on: boolean): Promise<{ fullscreen: boolean }> {
    if (typeof on !== "boolean") throw new Error("Fullscreen must be a boolean");
    const window = senderWindow(event);
    const owner = openWindows.findByWindow(window);
    owner?.hostFullscreen.setHostFullscreenIntent(on);
    if (!on) await owner?.hostFullscreen.exitWindowHtmlFullscreen();
    if (window.isFullScreen() !== on) window.setFullScreen(on);
    await waitForWindow(window, () => window.isFullScreen() === on, "window fullscreen transition");
    return { fullscreen: window.isFullScreen() };
}

export async function moveToDisplay(event: IpcMainEvent, target: WindowDisplayTarget, options?: { maximize?: boolean; fullscreen?: boolean }): Promise<IWindowMoveResult> {
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some(key => key !== "maximize" && key !== "fullscreen")
        || (options.maximize !== undefined && typeof options.maximize !== "boolean")
        || (options.fullscreen !== undefined && typeof options.fullscreen !== "boolean"))) throw new Error("Invalid display move options");
    const window = senderWindow(event);
    const displays = screen.getAllDisplays();
    const current = screen.getDisplayMatching(window.getBounds());
    const primary = screen.getPrimaryDisplay();
    let index = -1;
    if (typeof target === "number" && Number.isInteger(target)) index = target;
    else if (target === "primary") index = displays.findIndex(display => display.id === primary.id);
    else if (target === "other") index = displays.findIndex(display => display.id !== current.id);
    else if (target === "largest" || target === "smallest") {
        index = displays.reduce((best, display, candidate) => {
            const area = display.bounds.width * display.bounds.height;
            const bestArea = displays[best].bounds.width * displays[best].bounds.height;
            return (target === "largest" ? area > bestArea : area < bestArea) ? candidate : best;
        }, 0);
    }
    if (index < 0 || index >= displays.length || !displays[index]) throw new Error("Invalid display target or no other display is available; call getDisplays() again");
    const display = displays[index];
    const owner = openWindows.findByWindow(window);
    const guestFullscreenKeys = owner?.hostFullscreen.windowHtmlFullscreenKeys() ?? [];
    const desiredFullscreen = options?.fullscreen ?? (owner && guestFullscreenKeys.length
        ? owner.hostFullscreen.getHostFullscreenIntent() : window.isFullScreen());
    const normal = window.getNormalBounds();
    const [minimumWidth, minimumHeight] = window.getMinimumSize();
    const area = display.workArea;
    if (minimumWidth > area.width || minimumHeight > area.height) throw new Error("Window minimum size exceeds the target display work area");
    if (window.isMinimized()) window.restore();
    const desiredMaximized = options?.maximize ?? (window.isFullScreen() ? owner?.hostFullscreen.getPostFullscreenMaximize() : undefined) ?? window.isMaximized();
    const width = Math.min(normal.width, area.width);
    const height = Math.min(normal.height, area.height);
    const bounds = { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
    let topologyChanged = false;
    const onDisplayChange = (): void => { topologyChanged = true; };
    screen.on("display-added", onDisplayChange);
    screen.on("display-removed", onDisplayChange);
    screen.on("display-metrics-changed", onDisplayChange);
    try {
        owner?.hostFullscreen.setPostFullscreenMaximize(undefined);
        owner?.hostFullscreen.setHostFullscreenIntent(false);
        await owner?.hostFullscreen.exitWindowHtmlFullscreen();
        if (window.isFullScreen()) {
            window.setFullScreen(false);
            await waitForWindow(window, () => !window.isFullScreen(), "exit from fullscreen");
        }
        if (topologyChanged) throw new Error("Display topology changed; call getDisplays() again");
        if (window.isMaximized()) window.unmaximize();
        window.setBounds(bounds);
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!window.isDestroyed() && !boundsClose(window.getBounds(), bounds)) window.setBounds(bounds);
        if (desiredMaximized) window.maximize();
        owner?.hostFullscreen.setHostFullscreenIntent(desiredFullscreen);
        if (desiredFullscreen) {
            owner?.hostFullscreen.setPostFullscreenMaximize(desiredMaximized);
            window.setFullScreen(true);
        }
        await waitForWindow(window, () => {
            if (topologyChanged) throw new Error("Display topology changed; call getDisplays() again");
            return screen.getDisplayMatching(window.getBounds()).id === display.id
                && (desiredFullscreen || window.isMaximized() === desiredMaximized) && window.isFullScreen() === desiredFullscreen;
        }, "display move and requested window state");
        if (guestFullscreenKeys.length && options?.fullscreen === undefined && !desiredFullscreen) {
            try { await owner?.hostFullscreen.restoreGuestFullscreen(guestFullscreenKeys[0]); } catch { /* Reported by the state below. */ }
        }
        return { display: index, bounds: window.getBounds(), maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
    } finally {
        screen.removeListener("display-added", onDisplayChange);
        screen.removeListener("display-removed", onDisplayChange);
        screen.removeListener("display-metrics-changed", onDisplayChange);
    }
}
