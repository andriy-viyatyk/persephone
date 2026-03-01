import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import type { IWindow } from "./types/window";

class Window implements IWindow {
    private _isMaximized = false;
    private _zoomLevel = 1.0;
    private _windowIndex: number | null = null;

    constructor() {
        this._initWindowIndex();

        rendererEvents.eWindowMaximized.subscribe((maximized) => {
            this._isMaximized = maximized;
        });

        rendererEvents.eZoomChanged.subscribe((zoom) => {
            this._zoomLevel = zoom;
        });
    }

    private async _initWindowIndex(): Promise<void> {
        this._windowIndex = await api.getWindowIndex();
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

    // ── Window identity ───────────────────────────────────────────

    get windowIndex(): number {
        if (this._windowIndex === null) {
            throw new Error("Window not initialized yet");
        }
        return this._windowIndex;
    }
}

export const appWindow = new Window();
