import { BrowserWindow, type IpcMainEvent } from "electron";
import type { CreateBoardShortcutRequest, WindowApi, WindowCloseResolution } from "../contracts/window";
import type { WindowDisplayTarget } from "../api-param-types";
import type { PageDragData } from "../../shared/types";
import { openWindows } from "../../main/open-windows";
import { dragModel } from "../../main/drag-model";
import { capabilityRegistry } from "../../main/capability-registry";
import { createBoardShortcut } from "../../main/board-window-identity";
import { getDisplays, getFullScreen, moveToDisplay, setFullScreen } from "../../main/window-display-service";
import { zoom, resetZoom } from "../../main/window-zoom-service";
import { requireAppWindow } from "../../main/ipc-sender-policies";
import { bindDomain } from "./endpoint-registry";


export function initWindowHandlers(): void {
    bindDomain<WindowApi>({
        setBoardWindowIdentity: async (event: IpcMainEvent, request: { displayName: string; iconDataUrl: string }) =>
            openWindows.updateBoardIdentity(BrowserWindow.fromWebContents(event.sender), request),
        createBoardShortcut: async (event: IpcMainEvent, request: CreateBoardShortcutRequest) =>
            createBoardShortcut(request),
        openBoardWindow: async (_event: IpcMainEvent, boardRoot: string) =>
            openWindows.openBoardWindowFromRequest(boardRoot),
        getDisplays: async (event: IpcMainEvent) => getDisplays(event),
        getFullScreen: async (event: IpcMainEvent) => getFullScreen(event),
        setFullScreen: async (event: IpcMainEvent, on: boolean) => setFullScreen(event, on),
        moveToDisplay: async (
            event: IpcMainEvent,
            target: WindowDisplayTarget,
            options?: { maximize?: boolean; fullscreen?: boolean },
        ) => moveToDisplay(event, target, options),
        maximizeWindow: async (event: IpcMainEvent) =>
            openWindows.windowAction(BrowserWindow.fromWebContents(event.sender), "maximize"),
        minimizeWindow: async (event: IpcMainEvent) =>
            openWindows.windowAction(BrowserWindow.fromWebContents(event.sender), "minimize"),
        restoreWindow: async (event: IpcMainEvent) =>
            openWindows.windowAction(BrowserWindow.fromWebContents(event.sender), "restore"),
        closeWindow: async (event: IpcMainEvent) =>
            openWindows.windowAction(BrowserWindow.fromWebContents(event.sender), "close"),
        setCanQuit: async (event: IpcMainEvent, canQuit: boolean) =>
            openWindows.setCanQuit(BrowserWindow.fromWebContents(event.sender), canQuit),
        resolveWindowClose: async (event: IpcMainEvent, result: WindowCloseResolution) =>
            openWindows.resolveWindowClose(BrowserWindow.fromWebContents(event.sender), result),
        zoom: async (event: IpcMainEvent, delta: number) => zoom(event.sender, delta),
        resetZoom: async (event: IpcMainEvent) => resetZoom(event.sender),
        windowReady: async (event: IpcMainEvent) => capabilityRegistry.rendererReady(event.sender),
        getWindowIndex: async (event: IpcMainEvent) =>
            openWindows.getWindowIndex(BrowserWindow.fromWebContents(event.sender)),
        openNewWindow: async (event: IpcMainEvent, filePath?: string) => openWindows.openNewWindow(filePath),
        getWindowPages: async () => openWindows.getWindowPages(),
        showWindowPage: async (_event: IpcMainEvent, windowIndex: number, pageId: string) =>
            openWindows.showWindowPage(windowIndex, pageId),
        addDragEvent: async (_event: IpcMainEvent, dragData: PageDragData) => dragModel.addDragEvent(dragData)
    }, {
        windowReady: { policy: requireAppWindow, deny: () => new Error("permission-denied") },
    });
}
