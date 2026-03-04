/**
 * Window management API.
 *
 * Controls the application window: minimize, maximize, restore, close,
 * zoom, menu bar, and multi-window support.
 *
 * @example
 * app.window.maximize();
 * console.log(app.window.isMaximized);
 * app.window.zoom(1);  // zoom in
 * await app.window.openNew("C:/file.txt");
 */
export interface IWindow {
    // ── Window actions ───────────────────────────────────────────────

    /** Minimize the window to the taskbar. */
    minimize(): void;

    /** Maximize the window. */
    maximize(): void;

    /** Restore the window from maximized/minimized state. */
    restore(): void;

    /** Close the window. */
    close(): void;

    /** Toggle between maximized and restored state. */
    toggleWindow(): void;

    // ── Window state ─────────────────────────────────────────────────

    /** Whether the window is currently maximized. Updated reactively. */
    readonly isMaximized: boolean;

    // ── Menu bar ─────────────────────────────────────────────────────

    /** Whether the menu bar (sidebar) is currently open. */
    readonly menuBarOpen: boolean;

    /** Toggle the menu bar (sidebar) open/closed. */
    toggleMenuBar(): void;

    // ── Zoom ─────────────────────────────────────────────────────────

    /**
     * Zoom in or out.
     * @param delta Positive to zoom in, negative to zoom out (e.g., 1 or -1).
     */
    zoom(delta: number): void;

    /** Reset zoom to 100%. */
    resetZoom(): void;

    /** Current zoom level (step value). 0 = 100%. Updated reactively. */
    readonly zoomLevel: number;

    // ── Multi-window ─────────────────────────────────────────────────

    /**
     * Open a new application window.
     * @param filePath Optional file to open in the new window.
     * @returns The new window's index.
     */
    openNew(filePath?: string): Promise<number>;

    // ── Window identity ───────────────────────────────────────────

    /** Zero-based index of this window among all application windows. */
    readonly windowIndex: number;
}
