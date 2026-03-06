import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { TOneState } from "../core/state/state";
import type { IWindow } from "./types/window";

interface WindowState {
    isMaximized: boolean;
    zoomLevel: number;
    menuBarOpen: boolean;
    mcpRunning: boolean;
    mcpClientCount: number;
}

export class Window implements IWindow {
    private _windowIndex: number | null = null;
    private _state = new TOneState<WindowState>({
        isMaximized: false,
        zoomLevel: 0,
        menuBarOpen: false,
        mcpRunning: false,
        mcpClientCount: 0,
    });

    constructor() {
        this._initWindowIndex();
        this._initMcpStatus();
    }

    private async _initWindowIndex(): Promise<void> {
        this._windowIndex = await api.getWindowIndex();
    }

    private async _initMcpStatus(): Promise<void> {
        try {
            const status = await api.getMcpStatus();
            this._state.update(s => {
                s.mcpRunning = status.running;
                s.mcpClientCount = status.clientCount;
            });
        } catch { /* MCP may not be enabled */ }

        rendererEvents.eMcpStatusChanged.subscribe((status) => {
            this._state.update(s => {
                s.mcpRunning = status.running;
                s.mcpClientCount = status.clientCount;
            });
        });
    }

    // ── Window state setters ───────────────────────────────────────

    setMaximized(isMaximized: boolean): void {
        this._state.update(s => { s.isMaximized = isMaximized; });
    }

    setZoomLevel(zoomLevel: number): void {
        this._state.update(s => { s.zoomLevel = zoomLevel; });
    }

    // ── React hook (not in .d.ts) ──────────────────────────────────

    use() {
        return this._state.use();
    }

    // ── Window actions ─────────────────────────────────────────────

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

    toggleWindow(): void {
        if (this._state.get().isMaximized) {
            this.restore();
        } else {
            this.maximize();
        }
    }

    // ── Window state ───────────────────────────────────────────────

    get isMaximized(): boolean {
        return this._state.get().isMaximized;
    }

    // ── Menu bar ───────────────────────────────────────────────────

    get menuBarOpen(): boolean {
        return this._state.get().menuBarOpen;
    }

    toggleMenuBar(): void {
        this._state.update(s => { s.menuBarOpen = !s.menuBarOpen; });
    }

    // ── Zoom ───────────────────────────────────────────────────────

    zoom(delta: number): void {
        api.zoom(delta);
    }

    resetZoom(): void {
        api.resetZoom();
    }

    get zoomLevel(): number {
        return this._state.get().zoomLevel;
    }

    // ── Multi-window ───────────────────────────────────────────────

    async openNew(filePath?: string): Promise<number> {
        return api.openNewWindow(filePath);
    }

    // ── Window identity ────────────────────────────────────────────

    get windowIndex(): number {
        if (this._windowIndex === null) {
            throw new Error("Window not initialized yet");
        }
        return this._windowIndex;
    }
}

export const appWindow = new Window();
