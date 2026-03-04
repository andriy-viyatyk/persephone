import rendererEvents from "../../../ipc/renderer/renderer-events";
import { appWindow } from "../window";

/**
 * Window state service for window state IPC subscriptions.
 * Syncs maximize/zoom state from main process to appWindow reactive state.
 */
export class WindowStateService {
    async init(): Promise<void> {
        rendererEvents.eWindowMaximized.subscribe((isMaximized) => {
            appWindow.setMaximized(isMaximized);
        });

        rendererEvents.eZoomChanged.subscribe((zoomLevel) => {
            appWindow.setZoomLevel(zoomLevel);
        });
    }
}
