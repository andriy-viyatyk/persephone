import rendererEvents from "../../../ipc/renderer/renderer-events";
import { appWindow } from "../window";

/**
 * Window state service for window state IPC subscriptions.
 * Syncs maximize/zoom state from main process to appWindow API cache.
 */
export class WindowStateService {
    async init(): Promise<void> {
        // Subscribe to window maximize events
        rendererEvents.eWindowMaximized.subscribe((isMaximized) => {
            (appWindow as any)._isMaximized = isMaximized;
        });

        // Subscribe to zoom change events
        rendererEvents.eZoomChanged.subscribe((zoomLevel) => {
            (appWindow as any)._zoomLevel = zoomLevel;
        });
    }
}
