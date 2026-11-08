import type { IWindow } from "../../../api/types/window";
import type { IAiMember, IAiVisionDescriptor } from "ai-vision";

const WINDOW_MEMBERS: readonly IAiMember[] = [
    { name: "getDisplays", kind: "method", signature: "getDisplays(): Promise<readonly IWindowDisplay[]>", summary: "Read live displays with zero-based snapshot indexes, DIP bounds and work areas, primary and current flags." },
    { name: "moveToDisplay", kind: "method", signature: "moveToDisplay(target: number | 'primary' | 'largest' | 'smallest' | 'other', options?: { maximize?: boolean; fullscreen?: boolean }): Promise<IWindowMoveResult>", summary: "Center this window on a display; largest/smallest use DIP bounds area and other is relative to this window. A video already in fullscreen goes fullscreen again on the new display.", caution: "moves the visible window" },
    { name: "setFullScreen", kind: "method", signature: "setFullScreen(on: boolean): Promise<{ fullscreen: boolean }>", summary: "Set host fullscreen; false also exits browser HTML fullscreen." },
    { name: "getFullScreen", kind: "method", signature: "getFullScreen(): Promise<boolean>", summary: "Read actual native fullscreen, including browser HTML fullscreen." },
    { name: "getGlobalMuteSnapshot", kind: "method", signature: "getGlobalMuteSnapshot()", summary: "Read global mute holders and managed webContents audio states across all windows." },
    { name: "releaseAllGlobalMute", kind: "method", signature: "releaseAllGlobalMute()", summary: "Release all global mute leases across all windows.", caution: "changes audio playback across all windows" },
    { name: "minimize", kind: "method", signature: "minimize()", summary: "Minimize this window.", caution: "changes the visible application window" },
    { name: "maximize", kind: "method", signature: "maximize()", summary: "Maximize this window.", caution: "changes the visible application window" },
    { name: "restore", kind: "method", signature: "restore()", summary: "Restore this window from maximized or minimized state.", caution: "changes the visible application window" },
    { name: "close", kind: "method", signature: "close()", summary: "Close this window.", caution: "may close the application or prompt about unsaved work" },
    { name: "toggleWindow", kind: "method", signature: "toggleWindow()", summary: "Toggle maximized/restored state.", caution: "changes the visible application window" },
    { name: "isMaximized", kind: "property", summary: "Whether the window is maximized; readonly." },
    { name: "menuBarOpen", kind: "property", summary: "Whether the sidebar/menu bar is open; readonly." },
    { name: "menuBar", kind: "property", summary: "The live Menu Bar model with folders, selection, open/close actions, and curated controls.", node: true },
    { name: "screen", kind: "property", summary: "Persephone's own window accessibility and automation host; use ui.elements for curated shell controls and screen.snapshot() for the complete current tree.", node: true },
    { name: "toggleMenuBar", kind: "method", signature: "toggleMenuBar()", summary: "Toggle the sidebar.", caution: "changes the visible UI" },
    { name: "openMenuBar", kind: "method", signature: "openMenuBar(panelId?: string)", summary: "Legacy sidebar opener; unknown strings still open it without changing selection.", caution: "changes the visible UI" },
    { name: "zoom", kind: "method", signature: "zoom(delta: number)", summary: "Change the window zoom level.", caution: "changes the visible UI" },
    { name: "resetZoom", kind: "method", signature: "resetZoom()", summary: "Reset zoom to 100%.", caution: "changes the visible UI" },
    { name: "zoomLevel", kind: "property", summary: "Current zoom step; readonly." },
    { name: "openNew", kind: "method", signature: "openNew(filePath?: string)", summary: "Open a new application window, optionally with a file.", caution: "creates a visible window" },
    { name: "windowIndex", kind: "property", summary: "Zero-based index among application windows; readonly." },
];

export function describeWindow(instance: unknown): IAiVisionDescriptor {
    const window = instance as IWindow;
    return {
        kind: "Window",
        summary: "Control this window's state, sidebar, zoom, and multi-window actions.",
        members: WINDOW_MEMBERS,
        help: "Use getDisplays() to inspect live snapshot indexes (not window indexes); they can change when monitors reconnect. largest/smallest use DIP bounds area; other means the first display other than this window's current display. Use windows[i].window for another live window. Host fullscreen differs from browser element fullscreen. TV recipe: moveToDisplay('largest') first, then pages[id].editor.fullscreen(). To move a video that is already fullscreen, just call moveToDisplay: it stays fullscreen on the new display.",
        summarize: () => ({
            kind: "Window",
            windowIndex: window.windowIndex,
            isMaximized: window.isMaximized,
            menuBarOpen: window.menuBarOpen,
            zoomLevel: window.zoomLevel,
        }),
    };
}
