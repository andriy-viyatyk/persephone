import { BrowserWindow, desktopCapturer, ipcMain, screen, NativeImage } from "electron";
import { openWindows } from "./open-windows";
import { getAssetPath } from "./utils";

interface DisplaySource {
    display: Electron.Display;
    screenshot: NativeImage;
}

export async function startScreenSnip(): Promise<string | null> {
    const displays = screen.getAllDisplays();

    // Hide all js-notepad windows — no explicit delay needed because
    // desktopCapturer.getSources is async and gives the OS enough time to repaint.
    openWindows.hideWindows();

    // Capture each screen individually to get correct resolution per display.
    // desktopCapturer uses the same thumbnailSize for all sources, so we request
    // the largest physical size to avoid downscaling any display.
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));

    // Pre-create overlay windows (show: false) — HTML starts loading while we capture.
    const overlayMap = preCreateOverlays(displays);

    let sources;
    try {
        sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: maxW, height: maxH },
        });
    } catch {
        destroyOverlays(overlayMap);
        openWindows.showWindows();
        return null;
    }

    // Match sources to displays by display_id
    const displaySources: DisplaySource[] = [];
    for (const display of displays) {
        const source = sources.find((s) => s.display_id === String(display.id));
        if (source && !source.thumbnail.isEmpty()) {
            displaySources.push({ display, screenshot: source.thumbnail });
        }
    }

    if (displaySources.length === 0) {
        destroyOverlays(overlayMap);
        openWindows.showWindows();
        return null;
    }

    try {
        return await showOverlaysWithPreCreated(displaySources, overlayMap);
    } finally {
        openWindows.showWindows();
    }
}

/** Pre-create overlay windows for each display so they load HTML in parallel with screenshot capture. */
function preCreateOverlays(displays: Electron.Display[]): Map<number, BrowserWindow> {
    const map = new Map<number, BrowserWindow>();
    for (const display of displays) {
        const overlay = new BrowserWindow({
            x: display.bounds.x,
            y: display.bounds.y,
            width: display.bounds.width,
            height: display.bounds.height,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            movable: false,
            focusable: true,
            hasShadow: false,
            enableLargerThanScreen: true,
            show: false, // don't show until screenshot is ready
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });
        overlay.setBounds({
            x: display.bounds.x,
            y: display.bounds.y,
            width: display.bounds.width,
            height: display.bounds.height,
        });
        overlay.setAlwaysOnTop(true, "screen-saver");
        overlay.loadFile(getAssetPath("snip-overlay.html"));
        map.set(display.id, overlay);
    }
    return map;
}

function destroyOverlays(overlayMap: Map<number, BrowserWindow>): void {
    for (const o of overlayMap.values()) {
        if (!o.isDestroyed()) o.close();
    }
}

function showOverlaysWithPreCreated(
    displaySources: DisplaySource[],
    overlayMap: Map<number, BrowserWindow>,
): Promise<string | null> {
    return new Promise((resolve) => {
        const overlays: BrowserWindow[] = [];

        for (const { display, screenshot } of displaySources) {
            const overlay = overlayMap.get(display.id);
            if (!overlay || overlay.isDestroyed()) continue;

            const thumbSize = screenshot.getSize();

            const sendInit = () => {
                // Send raw PNG buffer instead of base64 dataURL — avoids
                // expensive base64 encoding of large screenshots in main process.
                overlay.webContents.send("snip-init", {
                    screenshotPng: screenshot.toPNG(),
                    displayId: display.id,
                    thumbWidth: thumbSize.width,
                    thumbHeight: thumbSize.height,
                    canvasWidth: display.bounds.width,
                    canvasHeight: display.bounds.height,
                });
                overlay.show();
            };

            // HTML may already be loaded (pre-created early), or still loading
            if (!overlay.webContents.isLoading()) {
                sendInit();
            } else {
                overlay.webContents.on("did-finish-load", sendInit);
            }

            overlays.push(overlay);
        }

        // Close any pre-created overlays that had no matching display source
        for (const [id, o] of overlayMap) {
            if (!displaySources.some((ds) => ds.display.id === id)) {
                if (!o.isDestroyed()) o.close();
            }
        }

        const cleanup = () => {
            ipcMain.removeAllListeners("snip-complete");
            ipcMain.removeAllListeners("snip-cancel");
            for (const o of overlays) {
                if (!o.isDestroyed()) o.close();
            }
        };

        ipcMain.once(
            "snip-complete",
            (
                _event: Electron.IpcMainEvent,
                rect: { x: number; y: number; w: number; h: number },
                displayId: number,
            ) => {
                cleanup();

                const ds = displaySources.find((d) => d.display.id === displayId);
                if (!ds) {
                    resolve(null);
                    return;
                }

                const cropped = ds.screenshot.crop({
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.w),
                    height: Math.round(rect.h),
                });

                resolve(cropped.toDataURL());
            },
        );

        ipcMain.once("snip-cancel", () => {
            cleanup();
            resolve(null);
        });
    });
}
