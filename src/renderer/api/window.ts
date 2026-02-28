import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import type { IWindow } from "./types/window";

class Window implements IWindow {
    private _isMaximized = false;
    private _zoomLevel = 1.0;

    constructor() {
        rendererEvents.eWindowMaximized.subscribe((maximized) => {
            this._isMaximized = maximized;
        });

        rendererEvents.eZoomChanged.subscribe((zoom) => {
            this._zoomLevel = zoom;
        });
    }

    // ── Window actions ───────────────────────────────────────────────

    minimize(): void {
        api.minimizeWindow();
    }

    maximize(): void {
        api.maximizeWindow();
    }

    restore(): void {
        api.restoreWindow();
    }

    close(): void {
        api.closeWindow();
    }

    // ── Window state ─────────────────────────────────────────────────

    get isMaximized(): boolean {
        return this._isMaximized;
    }

    // ── Zoom ─────────────────────────────────────────────────────────

    zoom(delta: number): void {
        api.zoom(delta);
    }

    resetZoom(): void {
        api.resetZoom();
    }

    get zoomLevel(): number {
        return this._zoomLevel;
    }

    // ── Multi-window ─────────────────────────────────────────────────

    async openNew(filePath?: string): Promise<number> {
        return api.openNewWindow(filePath);
    }
}

export const window = new Window();
