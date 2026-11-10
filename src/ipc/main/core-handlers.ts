import { CAPABILITY_ERROR_CODES } from "../../shared/capability-constants";
import type { CapabilityClientInvoke, CapabilityClientOptions, CapabilityClientResult } from "../capability-bus-channels";
import type { CapabilityErrorCode, CapabilityJson } from "../../shared/capability-contract";
import { errMessage } from "../../shared/utils";
import { BoardGrant } from "../../shared/board/board-grant";
import { applicationProfileName } from "../../main/application-profile";
import { t } from "../../shared/i18n/t";
import { exitWindowHtmlFullscreen, getHostFullscreenIntent, getPostFullscreenMaximize, reapplyBrowserGuestZoom, restoreGuestFullscreen, setHostFullscreenIntent, setPostFullscreenMaximize, windowHtmlFullscreenKeys } from "../../main/browser-service";
import type { WindowDisplayTarget } from "../../renderer/api/types/window";
import { app, clipboard, ClipboardItem, BrowserWindow, IpcMainEvent, nativeImage, nativeTheme, screen, shell } from "electron";
import { CaptureRect, CreateBoardShortcutRequest, Endpoint, EventEndpoint, McpStatus, MnemeStatus } from "../api-types";
import { getAssetPath, getAppRootPath, getDataFolder } from "../../main/utils";
import { getUiPreferences, setUiPreference } from "../../main/ui-preferences";
import { showOpenFileDialog, showOpenFolderDialog, showSaveFileDialog } from "./dialog-handlers";
import { getStartupInputs, windowReady } from "./window-handlers";
import { DownloadEntry, OpenFileDialogParams, RecordingFinalizeRequest, RecordingRegion, RecordingSessionChunk, RuntimeVersions, SaveFileDialogParams, UpdateCheckResult, VideoStreamSessionConfig, VideoStreamSessionResult } from "../api-param-types";
import { openWindows } from "../../main/open-windows";
import { WindowPages, PageDragData } from "../../shared/types";
import { dragModel } from "../../main/drag-model";
import { fileIconCache } from "../../main/fileIconCache";
import { versionService } from "../../main/version-service";
import { onWebContentsGone } from "../../main/webcontents-lifetime";
import * as browserRegistration from "../../main/browser-registration";
import { downloadService } from "../../main/download-service";
import { setMainScriptsEnabled } from "../../main/mcp/ai-vision/main-script-gate";
import { capabilityRegistry } from "../../main/capability-registry";
import { capabilityRouter, publicCapabilityProvider } from "../../main/capability-router";
import { setWindowsSsoEnabled } from "../../main/windows-sso";
import { startMcpHttpServer, stopMcpHttpServer, isMcpHttpServerRunning, getMcpUrl, getMcpClientCount } from "../../main/mcp-http-server";
import { getPrivateMcpClientCount } from "../../main/mcp/private-session-endpoints";
import { startMneme, stopMneme, restartMneme, getMnemeStatus as getMnemeServiceStatus } from "../../main/mneme-service";
import { getAudioCaptureCount as getAudioCaptureCountSnapshot } from "../../main/audio-capture-state";
import type { ClipboardFileList } from "../clipboard-ipc";
import {
    clearClipboardHistory as clearClipboardHistoryService,
    copyClipboardItem as copyClipboardItemService,
    getClipboardHistory as getClipboardHistoryService,
    getClipboardStatus as getClipboardStatusService,
    removeClipboardItem as removeClipboardItemService,
    restartClipboard as restartClipboardService,
    setClipboardEnabled as setClipboardEnabledService,
    setClipboardHealthMonitoring as setClipboardHealthMonitoringService,
} from "../../main/clipboard-service";
import { bindEndpoint, type MainApi } from "./endpoint-registry";
import { boardAppId, boardProfileArgument, boardRootForLaunchArgs, getBoardLauncherPath, writeBoardWindowIcon } from "../../main/board-window-identity";
import { setMainLocale } from "../../main/i18n-locale";
import fs from "node:fs";
import path from "node:path";
import type { BoardEndpoint } from "./board-handlers";

function senderWindow(event: IpcMainEvent): BrowserWindow {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) throw new Error("Window is unavailable");
    return win;
}

/** Windows rounds and adjusts DIP bounds on scaled displays (125%, 150%), so applied bounds can
 *  differ from the requested ones by a few pixels; only a larger difference means a bad move. */
function boundsClose(actual: Electron.Rectangle, expected: Electron.Rectangle): boolean {
    return Math.abs(actual.x - expected.x) <= 8 && Math.abs(actual.y - expected.y) <= 8
        && Math.abs(actual.width - expected.width) <= 8 && Math.abs(actual.height - expected.height) <= 8;
}

async function waitForWindow(win: BrowserWindow, predicate: () => boolean, description: string): Promise<void> {
    const deadline = Date.now() + 4000;
    while (!win.isDestroyed() && !predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (win.isDestroyed()) throw new Error("Window was destroyed");
}
import type { GitEndpoint } from "./git-handlers";
import type { SiteExtensionEndpoint } from "./site-extension-handlers";
import type { PathWatchEndpoint } from "./path-watch-handlers";

let siteExtensionRuntime: string | null = null;

const clientErrorCodes = new Set<CapabilityErrorCode>(CAPABILITY_ERROR_CODES);
export const activeCapabilityRequests = new WeakMap<Electron.WebContents, Map<string, AbortController>>();

function checkCapabilitySender(event: IpcMainEvent): void {
    if (event.senderFrame !== event.sender.mainFrame || !openWindows.findByWindow(BrowserWindow.fromWebContents(event.sender)!)) {
        throw Object.assign(new Error("Permission denied."), { code: "permission-denied" });
    }
}

export async function capabilityResult<T>(operation: () => T | Promise<T>): Promise<CapabilityClientResult<T>> {
    try { return { ok: true, value: await operation() }; }
    catch (error) {
        const code = (error as { code?: unknown })?.code;
        return { ok: false, error: { code: typeof code === "string" && clientErrorCodes.has(code as CapabilityErrorCode) ? code as CapabilityErrorCode : "rejected", message: errMessage(error) } };
    }
}

class Controller implements Omit<MainApi, BoardEndpoint | GitEndpoint | SiteExtensionEndpoint | PathWatchEndpoint> {
    capabilityList = async (event: IpcMainEvent, asAgent?: boolean) => capabilityResult(() => {
        checkCapabilitySender(event);
        return capabilityRouter.list(asAgent ? { kind: "agent" } : { kind: "platform" }).map(publicCapabilityProvider);
    });
    capabilityProviders = async (event: IpcMainEvent, id: string, asAgent?: boolean) => capabilityResult(() => {
        checkCapabilitySender(event);
        return capabilityRouter.providers(asAgent ? { kind: "agent" } : { kind: "platform" }, id).map(publicCapabilityProvider);
    });
    capabilityGet = async (event: IpcMainEvent, id: string, options?: CapabilityClientOptions) => capabilityResult(() => {
        checkCapabilitySender(event);
        const bound = capabilityRouter.resolve(options?.asAgent ? { kind: "agent" } : { kind: "platform" }, id, options);
        return bound ? publicCapabilityProvider(bound.registration) : null;
    });
    capabilityLegacyResolve = async (event: IpcMainEvent, id: string, options: { version?: number; filter?: CapabilityClientOptions["filter"] }) => capabilityResult(() => {
        checkCapabilitySender(event);
        return capabilityRouter.resolveLegacy(id, options);
    });
    capabilityInvoke = async (event: IpcMainEvent, request: CapabilityClientInvoke): Promise<CapabilityClientResult<CapabilityJson>> => capabilityResult(async () => {
        checkCapabilitySender(event);
        if (!request || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 256 || typeof request.method !== "string" || !Array.isArray(request.args)) {
            throw Object.assign(new Error("Invalid capability request."), { code: "rejected" });
        }
        let active = activeCapabilityRequests.get(event.sender);
        if (!active) { active = new Map(); activeCapabilityRequests.set(event.sender, active); }
        if (active.has(request.requestId)) throw Object.assign(new Error("Duplicate capability request id."), { code: "rejected" });
        const bound = capabilityRouter.bindKey(request.asAgent ? { kind: "agent" } : { kind: "platform" }, request.key, request.filter);
        if (!bound || !bound.registration.methods[request.method] || bound.registration.methods[request.method].kind === "channel") {
            throw Object.assign(new Error("Capability handler unavailable."), { code: "no-handler" });
        }
        const controller = new AbortController();
        active.set(request.requestId, controller);
        const closed = () => controller.abort();
        const stop = onWebContentsGone(event.sender, closed);
        try {
            const invocation = capabilityRouter.createInvocationContext(bound, { signal: controller.signal, owner: event.sender, target: event.sender });
            try {
                return await capabilityRouter.invoke(bound, request.method, request.args, { invocation, target: event.sender }) as CapabilityJson;
            } finally {
                invocation.dispose();
            }
        } finally {
            active.delete(request.requestId);
            stop();
        }
    });
    capabilityCancel = async (event: IpcMainEvent, requestId: string): Promise<void> => {
        checkCapabilitySender(event);
        if (typeof requestId === "string") activeCapabilityRequests.get(event.sender)?.get(requestId)?.abort();
    };

    getCapabilityIndex = async (event: IpcMainEvent) => {
        if (event.senderFrame !== event.sender.mainFrame || !openWindows.findByWindow(BrowserWindow.fromWebContents(event.sender)!)) throw new Error("permission-denied");
        return capabilityRegistry.snapshot();
    }

    setCapabilityPreferences = async (event: IpcMainEvent, preferences: Record<string, string>): Promise<void> => {
        if (event.senderFrame !== event.sender.mainFrame || !openWindows.findByWindow(BrowserWindow.fromWebContents(event.sender)!)) throw new Error("permission-denied");
        if (!preferences || typeof preferences !== "object" || Array.isArray(preferences) || Object.values(preferences).some((value) => typeof value !== "string")) throw new Error("Invalid capability preferences.");
        capabilityRouter.setPreferences(preferences);
    }
    getAppRootPath = async (_event: IpcMainEvent): Promise<string> => {
        return getAppRootPath();
    }

    getAssetsPath = async (event: IpcMainEvent, fileName: string): Promise<string> => {
        return getAssetPath() + `/${fileName}`;
    }

    getDataFolder = async (_event: IpcMainEvent): Promise<string> => {
        return getDataFolder();
    }

    setActiveLocale = async (_event: IpcMainEvent, code: string): Promise<void> => {
        setMainLocale(code);
    }

    reloadAllWindows = async (_event: IpcMainEvent): Promise<void> => {
        openWindows.send(EventEndpoint.eReloadForLanguage, undefined);
    }

    getUiPreferences = async (_event: IpcMainEvent) => {
        return getUiPreferences();
    }

    setUiPreference = async (
        _event: IpcMainEvent,
        key: string,
        value: string | number | boolean,
    ) => {
        return setUiPreference(key, value);
    }

    setBoardWindowIdentity = async (event: IpcMainEvent, request: { displayName: string; iconDataUrl: string }): Promise<void> => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const boardWindow = browserWindow ? openWindows.findByWindow(browserWindow) : undefined;
        if (!boardWindow?.boardRoot) throw new Error("Board identity updates are only available to registered board windows.");
        await boardWindow.updateBoardIdentity(request?.displayName, request?.iconDataUrl);
    }

    createBoardShortcut = async (event: IpcMainEvent, request: CreateBoardShortcutRequest): Promise<boolean> => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) throw new Error("Board shortcuts can only be created by an application window.");
        if (!request || typeof request.boardRoot !== "string" || !request.boardRoot.trim()
            || typeof request.linkPath !== "string" || !request.linkPath.trim()
            || typeof request.displayName !== "string" || !request.displayName.trim() || request.displayName.length > 256) {
            throw new Error("Invalid board shortcut details.");
        }

        if (!path.isAbsolute(request.linkPath)) throw new Error("linkPath must be absolute.");
        const resolvedLinkPath = path.resolve(request.linkPath);
        if (path.extname(resolvedLinkPath).toLowerCase() !== ".lnk") {
            throw new Error("linkPath must end in .lnk.");
        }
        const parentPath = path.dirname(resolvedLinkPath);
        if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) {
            throw new Error("linkPath parent directory does not exist.");
        }
        if (fs.existsSync(resolvedLinkPath) && request.overwrite !== true) {
            throw new Error("File exists; pass overwrite: true.");
        }

        const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(request.iconDataUrl);
        if (!match || match[1].length > 7_000_000) throw new Error("Invalid board icon data URL.");
        const image = nativeImage.createFromDataURL(request.iconDataUrl);
        const size = image.getSize();
        if (image.isEmpty() || size.width !== 256 || size.height !== 256) {
            throw new Error("Board icons must be 256x256 PNG images.");
        }

        const iconPath = await writeBoardWindowIcon(request.boardRoot, image.toPNG());
        const details: Electron.ShortcutDetails = {
            target: getBoardLauncherPath(),
            args: `--board "${boardRootForLaunchArgs(request.boardRoot)}"${boardProfileArgument()}`,
            description: request.displayName,
            icon: iconPath,
            // Electron writes the icon only when iconIndex is present too; with `icon` alone the
            // shortcut silently gets no icon (verified 2026-11-02, read back as an empty icon).
            iconIndex: 0,
            appUserModelId: boardAppId(request.boardRoot),
        };
        if (!shell.writeShortcutLink(resolvedLinkPath, "create", details)) {
            throw new Error("Failed to create board shortcut.");
        }

        const written = shell.readShortcutLink(resolvedLinkPath);
        const normalizePath = (value: unknown): string | null => typeof value === "string"
            ? path.normalize(path.resolve(value)).replace(/[\\/]+$/, "").toLowerCase()
            : null;
        const verified = normalizePath(written.target) === normalizePath(details.target)
            && written.args === details.args
            && written.description === details.description
            && normalizePath(written.icon) === normalizePath(details.icon)
            && written.appUserModelId === details.appUserModelId;
        if (!verified) throw new Error("Board shortcut verification failed.");
        return true;
    }

    openBoardWindow = async (_event: IpcMainEvent, boardRoot: string): Promise<void> => {
        if (typeof boardRoot !== "string" || !boardRoot.trim()) throw new Error("Invalid board root.");
        const resolvedRoot = path.resolve(boardRoot);
        if (!fs.existsSync(path.join(resolvedRoot, "board-manifest.json"))) {
            throw new Error(`Not a board folder: "${resolvedRoot}" is missing or has no board-manifest.json.`);
        }
        await openWindows.openBoardWindow(resolvedRoot);
    }

    getDisplays = async (event: IpcMainEvent) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed()) throw new Error("Window is unavailable");
        const displays = screen.getAllDisplays();
        const primaryId = screen.getPrimaryDisplay().id;
        const currentId = screen.getDisplayMatching(window.getBounds()).id;
        return displays.map((display, index) => ({
            index, id: display.id, bounds: display.bounds, workArea: display.workArea,
            scaleFactor: display.scaleFactor, primary: display.id === primaryId,
            current: display.id === currentId, ...(display.label ? { label: display.label } : {}),
        }));
    }

    getFullScreen = async (event: IpcMainEvent): Promise<boolean> => senderWindow(event).isFullScreen();

    setFullScreen = async (event: IpcMainEvent, on: boolean): Promise<{ fullscreen: boolean }> => {
        if (typeof on !== "boolean") throw new Error("Fullscreen must be a boolean");
        const win = senderWindow(event);
        setHostFullscreenIntent(win, on);
        if (!on) await exitWindowHtmlFullscreen(win);
        if (win.isFullScreen() !== on) win.setFullScreen(on);
        await waitForWindow(win, () => win.isFullScreen() === on, "window fullscreen transition");
        return { fullscreen: win.isFullScreen() };
    }

    moveToDisplay = async (event: IpcMainEvent, target: WindowDisplayTarget, options?: { maximize?: boolean; fullscreen?: boolean }) => {
        if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)
            || Object.keys(options).some(key => key !== "maximize" && key !== "fullscreen")
            || (options.maximize !== undefined && typeof options.maximize !== "boolean")
            || (options.fullscreen !== undefined && typeof options.fullscreen !== "boolean"))) {
            throw new Error("Invalid display move options");
        }
        const win = senderWindow(event);
        const displays = screen.getAllDisplays();
        const current = screen.getDisplayMatching(win.getBounds());
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
        // A video in fullscreen makes the whole window fullscreen too, but that is the video's state,
        // not the window's: the move exits it and re-enters it on the new display below, unless the
        // caller sets fullscreen explicitly. Only the window's own fullscreen carries over as such.
        const guestFullscreenKeys = windowHtmlFullscreenKeys(win);
        const desiredFullscreen = options?.fullscreen ?? (guestFullscreenKeys.length ? getHostFullscreenIntent(win) : win.isFullScreen());
        const normal = win.getNormalBounds();
        const [minimumWidth, minimumHeight] = win.getMinimumSize();
        const area = display.workArea;
        if (minimumWidth > area.width || minimumHeight > area.height) throw new Error("Window minimum size exceeds the target display work area");
        if (win.isMinimized()) win.restore();
        const desiredMaximized = options?.maximize ?? (win.isFullScreen() ? getPostFullscreenMaximize(win) : undefined) ?? win.isMaximized();
        const width = Math.min(normal.width, area.width);
        const height = Math.min(normal.height, area.height);
        const bounds = { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
        let topologyChanged = false;
        const onDisplayChange = (): void => { topologyChanged = true; };
        screen.on("display-added", onDisplayChange);
        screen.on("display-removed", onDisplayChange);
        screen.on("display-metrics-changed", onDisplayChange);
        try {
            setPostFullscreenMaximize(win, undefined);
            setHostFullscreenIntent(win, false);
            await exitWindowHtmlFullscreen(win);
            if (win.isFullScreen()) {
                win.setFullScreen(false);
                await waitForWindow(win, () => !win.isFullScreen(), "exit from fullscreen");
            }
            if (topologyChanged) throw new Error("Display topology changed; call getDisplays() again");
            if (win.isMaximized()) win.unmaximize();
            win.setBounds(bounds);
            // Moving between displays with different scale factors: Windows applies the first
            // setBounds with the source display's DPI, so the window lands off-centre and resized.
            // Once it has adopted the target display's DPI, a second setBounds lands exactly.
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!win.isDestroyed() && !boundsClose(win.getBounds(), bounds)) win.setBounds(bounds);
            if (desiredMaximized) win.maximize();
            setHostFullscreenIntent(win, desiredFullscreen);
            if (desiredFullscreen) {
                setPostFullscreenMaximize(win, desiredMaximized);
                win.setFullScreen(true);
            }
            await waitForWindow(win, () => {
                if (topologyChanged) throw new Error("Display topology changed; call getDisplays() again");
                // Confirm the display and the window state, not exact pixels: Windows adjusts the
                // applied rectangle by a few pixels on scaled displays (seen: x 3 / width 1532 for a
                // requested x 0 / width 1536 at 125%).
                return screen.getDisplayMatching(win.getBounds()).id === display.id
                    && (desiredFullscreen || win.isMaximized() === desiredMaximized) && win.isFullScreen() === desiredFullscreen;
            }, "display move and requested window state");
            if (guestFullscreenKeys.length && options?.fullscreen === undefined && !desiredFullscreen) {
                // Best effort: a video that cannot re-enter fullscreen leaves the window moved and
                // windowed, which the result reports.
                try { await restoreGuestFullscreen(guestFullscreenKeys[0]); } catch { /* reported by the state below */ }
            }
            return { display: index, bounds: win.getBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
        } finally {
            screen.removeListener("display-added", onDisplayChange);
            screen.removeListener("display-removed", onDisplayChange);
            screen.removeListener("display-metrics-changed", onDisplayChange);
        }
    }

    maximizeWindow = async (event: IpcMainEvent): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.maximize();
    }

    minimizeWindow = async (event: IpcMainEvent): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.minimize();
    }

    restoreWindow = async (event: IpcMainEvent): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.restore();
    }

    closeWindow = async (event: IpcMainEvent): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.close();
    }

    setCanQuit = async (event: IpcMainEvent, canQuit: boolean): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        openWindows.setCanQuit(window, canQuit);
    }

    resolveWindowClose = async (event: IpcMainEvent, result: import("../api-types").WindowCloseResolution): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        openWindows.resolveWindowClose(window, result);
    }

    showOpenFileDialog = (event: IpcMainEvent, params: OpenFileDialogParams) => {
        return showOpenFileDialog(BrowserWindow.fromWebContents(event.sender), params);
    }
    showSaveFileDialog = (event: IpcMainEvent, params: SaveFileDialogParams) => {
        return showSaveFileDialog(BrowserWindow.fromWebContents(event.sender), params);
    }
    showOpenFolderDialog = (event: IpcMainEvent, params: OpenFileDialogParams) => {
        return showOpenFolderDialog(BrowserWindow.fromWebContents(event.sender), params);
    }

    inspectElement = async (event: IpcMainEvent, x: number, y: number): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.webContents.inspectElement(x, y);
    }

    openDevTools = async (event: IpcMainEvent): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.webContents.openDevTools();
    }

    getCommonFolder = async (event: IpcMainEvent, folder: string): Promise<string> => {
        return app.getPath(folder as Parameters<typeof app.getPath>[0]);
    }

    /** The site-extension runtime bundle, built beside `main.js`. Re-read in dev,
     *  where the watcher rebuilds it without restarting Electron. */
    getSiteExtensionRuntime = async (): Promise<string> => {
        if (siteExtensionRuntime === null || !app.isPackaged) {
            siteExtensionRuntime = await fs.promises.readFile(path.join(__dirname, "site-extension-runtime.js"), "utf8");
        }
        return siteExtensionRuntime;
    }

    zoom = async (event: IpcMainEvent, delta: number): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const currentZoom = window?.webContents.getZoomLevel() || 0;
        const newZoom = currentZoom + delta;
        window?.webContents.setZoomLevel(newZoom);
        if (window) reapplyBrowserGuestZoom(window.webContents);
        window?.webContents.send(EventEndpoint.eZoomChanged, newZoom);
    }

    resetZoom = async (event: IpcMainEvent): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window?.webContents.setZoomLevel(0);
        if (window) reapplyBrowserGuestZoom(window.webContents);
        window?.webContents.send(EventEndpoint.eZoomChanged, 0);
    }

    showItemInFolder = async (event: IpcMainEvent, path: string): Promise<void> => {
        await shell.showItemInFolder(path);
    }

    showFolder = async (event: IpcMainEvent, path: string): Promise<void> => {
        await shell.openPath(path);
    }

    /** Open a file or folder with the OS default application. Same `shell.openPath` as
     *  `showFolder`, but the error string is returned instead of discarded: the shell
     *  reports "no application is registered for this extension" that way, and without
     *  it an unopenable file looks like a menu item that does nothing. Empty = accepted. */
    openPath = async (event: IpcMainEvent, path: string, boardRoot?: string): Promise<string> => {
        if (boardRoot && !(await (await import("../../main/board-trust-service")).boardTrustService.allows(boardRoot, "openExternal"))) {
            throw BoardGrant.deny("openExternal");
        }
        return shell.openPath(path);
    }

    windowReady = async (event: IpcMainEvent): Promise<void> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || !openWindows.findByWindow(window)) throw new Error("permission-denied");
        await windowReady(window);
        event.sender.send(EventEndpoint.eCapabilityIndexSnapshot, capabilityRegistry.snapshot());
    }

    setVoiceTypingConfig = async (event: IpcMainEvent, request: { shortcut: string; translateShortcut: string }): Promise<void> => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error("permission-denied");
        if (!request || typeof request.shortcut !== "string" || !request.shortcut || typeof request.translateShortcut !== "string" || !request.translateShortcut) throw new TypeError("Normalized voice typing shortcuts are required.");
        const window = BrowserWindow.fromWebContents(event.sender);
        const openWindow = window && openWindows.findByWindow(window);
        if (!openWindow) throw new Error("permission-denied");
        openWindow.setVoiceTypingShortcuts(request.shortcut, request.translateShortcut);
    }

    setVoiceTypingState = async (event: IpcMainEvent, request: { state: "idle" | "recording" | "transcribing" }): Promise<void> => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error("permission-denied");
        if (!request || !["idle", "recording", "transcribing"].includes(request.state)) throw new TypeError("Invalid voice typing state.");
        const window = BrowserWindow.fromWebContents(event.sender);
        const openWindow = window && openWindows.findByWindow(window);
        if (!openWindow) throw new Error("permission-denied");
        openWindow.setVoiceTypingState(request.state);
    }

    armVoiceTypingMicrophone = async (event: IpcMainEvent): Promise<void> => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error("permission-denied");
        const { armVoiceTypingMediaGrant } = await import("../../main/permission-policy-service");
        armVoiceTypingMediaGrant(event.sender.id);
    }

    clearVoiceTypingMicrophone = async (event: IpcMainEvent): Promise<void> => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error("permission-denied");
        const { clearVoiceTypingMediaGrant } = await import("../../main/permission-policy-service");
        clearVoiceTypingMediaGrant(event.sender.id);
    }

    armTranscriptLoopback = async (event: IpcMainEvent): Promise<void> => {
        if (event.senderFrame !== event.sender.mainFrame || process.platform !== "win32") throw new Error("permission-denied");
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || !openWindows.findByWindow(window)) throw new Error("permission-denied");
        const { armTranscriptLoopbackGrant } = await import("../../main/permission-policy-service");
        armTranscriptLoopbackGrant(event.sender.id);
    }

    clearTranscriptLoopback = async (event: IpcMainEvent): Promise<void> => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error("permission-denied");
        const { clearTranscriptLoopbackGrant } = await import("../../main/permission-policy-service");
        clearTranscriptLoopbackGrant(event.sender.id);
    }
    getStartupInputs = async (_event: IpcMainEvent) => {
        return getStartupInputs();
    }

    getWindowIndex = async (event: IpcMainEvent): Promise<number> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        return openWindows.findByWindow(window)?.index ?? -1;
    }

    openNewWindow = async (event: IpcMainEvent, filePath?: string): Promise<number> => {
        if (filePath) {
            return await openWindows.openPathInNewWindow(filePath);
        }
        const newWindow = openWindows.createWindow();
        return newWindow.index;
    }

    getWindowPages = async (_event: IpcMainEvent): Promise<WindowPages[]> => {
        return openWindows.getWindowPages();
    }

    showWindowPage = async (event: IpcMainEvent, windowIndex: number, pageId: string): Promise<void> => {
        openWindows.showWindowPage(windowIndex, pageId);
    }

    addDragEvent = async (event: IpcMainEvent, dragData: PageDragData): Promise<void> => {
        return dragModel.addDragEvent(dragData);
    }

    getFileIcon = async (event: IpcMainEvent, filePath: string): Promise<string> => {
        return fileIconCache.getFileIcon(filePath);
    }

    checkForUpdates = async (event: IpcMainEvent, force?: boolean): Promise<UpdateCheckResult> => {
        return versionService.checkForUpdates(force);
    }

    getAppVersion = async (_event: IpcMainEvent): Promise<string> => {
        return versionService.getAppVersion();
    }

    getRuntimeVersions = async (_event: IpcMainEvent): Promise<RuntimeVersions> => {
        return versionService.getRuntimeVersions();
    }

    setNativeTheme = async (event: IpcMainEvent, mode: "light" | "dark"): Promise<void> => {
        nativeTheme.themeSource = mode;
    }

    registerAsDefaultBrowser = async (_event: IpcMainEvent): Promise<void> => {
        if (applicationProfileName()) throw new Error(t("settings.profileBrowserRegistration"));
        browserRegistration.registerAsDefaultBrowser();
    }

    unregisterAsDefaultBrowser = async (_event: IpcMainEvent): Promise<void> => {
        if (applicationProfileName()) throw new Error(t("settings.profileBrowserRegistration"));
        browserRegistration.unregisterAsDefaultBrowser();
    }

    isRegisteredAsDefaultBrowser = async (_event: IpcMainEvent): Promise<boolean> => {
        return browserRegistration.isRegisteredAsDefaultBrowser();
    }

    openDefaultAppsSettings = async (_event: IpcMainEvent): Promise<void> => {
        browserRegistration.openDefaultAppsSettings();
    }

    getDownloads = async (_event: IpcMainEvent): Promise<DownloadEntry[]> => {
        return downloadService.getDownloads();
    }

    cancelDownload = async (event: IpcMainEvent, id: string): Promise<void> => {
        downloadService.cancelDownload(id);
    }

    openDownload = async (event: IpcMainEvent, id: string): Promise<void> => {
        downloadService.openDownload(id);
    }

    showDownloadInFolder = async (event: IpcMainEvent, id: string): Promise<void> => {
        downloadService.showInFolder(id);
    }

    clearCompletedDownloads = async (_event: IpcMainEvent): Promise<void> => {
        downloadService.clearCompleted();
    }

    setMcpEnabled = async (event: IpcMainEvent, enabled: boolean, port?: number): Promise<void> => {
        if (enabled) {
            await startMcpHttpServer(port);
        } else {
            await stopMcpHttpServer();
        }
    }

    setMainScriptsEnabled = async (_event: IpcMainEvent, enabled: boolean): Promise<void> => {
        setMainScriptsEnabled(enabled);
    }

    setWindowsSsoEnabled = async (_event: IpcMainEvent, enabled: boolean): Promise<void> => {
        setWindowsSsoEnabled(enabled);
    }

    getMcpStatus = async (_event: IpcMainEvent): Promise<McpStatus> => {
        return {
            running: isMcpHttpServerRunning(),
            url: getMcpUrl(),
            clientCount: getMcpClientCount(),
            inAppAgentCount: getPrivateMcpClientCount(),
        };
    }

    setMnemeEnabled = async (event: IpcMainEvent, enabled: boolean, port?: number): Promise<MnemeStatus> => {
        if (enabled) {
            return startMneme(port);
        }
        stopMneme();
        return getMnemeServiceStatus();
    }

    restartMneme = async (_event: IpcMainEvent, port?: number): Promise<MnemeStatus> => {
        return restartMneme(port);
    }

    getMnemeStatus = async (_event: IpcMainEvent): Promise<MnemeStatus> => {
        return getMnemeServiceStatus();
    }

    getAudioCaptureCount = async (): Promise<{ count: number; revision: number }> => getAudioCaptureCountSnapshot();

    setClipboardEnabled = async (_event: IpcMainEvent, enabled: boolean, maxItems: number) => {
        return setClipboardEnabledService(enabled, maxItems);
    }

    getClipboardHistory = async (_event: IpcMainEvent) => {
        return getClipboardHistoryService();
    }

    removeClipboardItem = async (_event: IpcMainEvent, id: string): Promise<void> => {
        return removeClipboardItemService(id);
    }

    clearClipboardHistory = async (_event: IpcMainEvent): Promise<void> => {
        return clearClipboardHistoryService();
    }

    copyClipboardItem = async (_event: IpcMainEvent, id: string): Promise<boolean> => {
        return copyClipboardItemService(id);
    }

    getClipboardStatus = async (_event: IpcMainEvent) => {
        return getClipboardStatusService();
    }

    setClipboardHealthMonitoring = async (event: IpcMainEvent, active: boolean) => {
        return setClipboardHealthMonitoringService(event.sender.id, active);
    }

    restartClipboard = async (_event: IpcMainEvent, maxItems: number) => {
        return restartClipboardService(maxItems);
    }

    startScreenSnip = async (event: IpcMainEvent, hideWindows: boolean): Promise<string | null> => {
        const { startScreenSnip } = await import("../../main/snip-service");
        return startScreenSnip(hideWindows);
    }

    startWindowRecording = async (event: IpcMainEvent, request: { region: RecordingRegion }) => {
        const { startRecording } = await import("../../main/recording-service");
        return startRecording(event.sender, request.region);
    }

    appendWindowRecordingChunk = async (event: IpcMainEvent, request: RecordingSessionChunk): Promise<void> => {
        const { appendRecordingChunk } = await import("../../main/recording-service");
        await appendRecordingChunk(event.sender.id, request.recordingId, request.chunk);
    }

    finalizeWindowRecording = async (event: IpcMainEvent, request: RecordingFinalizeRequest): Promise<string> => {
        const { finalizeRecording } = await import("../../main/recording-service");
        return finalizeRecording(event.sender.id, request.recordingId, request.extension);
    }

    cancelWindowRecording = async (event: IpcMainEvent, recordingId: string): Promise<void> => {
        const { cancelRecording } = await import("../../main/recording-service");
        await cancelRecording(event.sender.id, recordingId);
    }

    clipboardWriteText = async (_event: IpcMainEvent, text: string): Promise<void> => {
        await clipboard.writeText(text);
    }

    clipboardWritePng = async (_event: IpcMainEvent, bytes: Uint8Array): Promise<void> => {
        await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }) })]);
    }

    clipboardReadFilePaths = async (_event: IpcMainEvent): Promise<ClipboardFileList> => {
        const { readClipboardFiles } = await import("../../main/clip-service");
        return readClipboardFiles();
    }

    clipboardWriteFilePaths = async (_event: IpcMainEvent, paths: string[], cut: boolean): Promise<boolean> => {
        const { writeClipboardFiles } = await import("../../main/clip-service");
        return writeClipboardFiles(paths, cut);
    }

    startOsFileDrag = async (event: IpcMainEvent, paths: string[]): Promise<void> => {
        const { startOsFileDrag } = await import("../../main/os-drag-service");
        return startOsFileDrag(event.sender, paths);
    }

    createVideoStreamSession = async (
        event: IpcMainEvent,
        config: VideoStreamSessionConfig,
        port?: number,
    ): Promise<VideoStreamSessionResult> => {
        const { createSession } = await import("../../main/video-stream-server");
        return createSession(config, port, event.sender);
    };

    deleteVideoStreamSession = async (event: IpcMainEvent, sessionId: string): Promise<void> => {
        const { deleteSession } = await import("../../main/video-stream-server");
        deleteSession(sessionId);
    };

    deleteVideoStreamSessionsByPage = async (event: IpcMainEvent, pageId: string): Promise<void> => {
        const { deleteSessionsByPage } = await import("../../main/video-stream-server");
        deleteSessionsByPage(pageId);
    };

    openTerminal = async (event: IpcMainEvent, path: string, command: string): Promise<void> => {
        const { openTerminalAt } = await import("../../main/terminal-launcher");
        openTerminalAt(path, command);
    };

    detectTerminal = async (_event: IpcMainEvent): Promise<string> => {
        const { detectTerminal } = await import("../../main/terminal-launcher");
        return detectTerminal();
    };

    openInVlc = async (event: IpcMainEvent, url: string, vlcPath?: string): Promise<void> => {
        const { openInVlc } = await import("../../main/vlc-launcher");
        openInVlc(url, vlcPath);
    };

    capturePageRegion = async (event: IpcMainEvent, rect: CaptureRect): Promise<Uint8Array> => {
        const wc = event.sender;
        // getBoundingClientRect() reports CSS pixels; capturePage() expects DIP.
        // When the user has zoomed (Ctrl +/-), scale the rect so the capture stays aligned.
        const zf = wc.getZoomFactor();
        const image = await wc.capturePage({
            x: Math.round(rect.x * zf),
            y: Math.round(rect.y * zf),
            width: Math.round(rect.width * zf),
            height: Math.round(rect.height * zf),
        });
        return image.toPNG();
    };

    setHtmlPreview = async (event: IpcMainEvent, id: string, html: string, resourceRoot?: string): Promise<void> => {
        const { setHtmlPreview } = await import("../../main/html-preview-protocol");
        setHtmlPreview(event.sender, id, html, resourceRoot);
    };

    clearHtmlPreview = async (_event: IpcMainEvent, id: string): Promise<void> => {
        const { clearHtmlPreview } = await import("../../main/html-preview-protocol");
        clearHtmlPreview(id);
    };


}

const controllerInstance = new Controller();

/** Register core desktop and local-service renderer endpoints. */
export function initCoreHandlers(): void {
    bindEndpoint(Endpoint.getAppRootPath, controllerInstance.getAppRootPath);
    bindEndpoint(Endpoint.getAssetsPath, controllerInstance.getAssetsPath);
    bindEndpoint(Endpoint.getDataFolder, controllerInstance.getDataFolder);
    bindEndpoint(Endpoint.setActiveLocale, controllerInstance.setActiveLocale);
    bindEndpoint(Endpoint.reloadAllWindows, controllerInstance.reloadAllWindows);
    bindEndpoint(Endpoint.getUiPreferences, controllerInstance.getUiPreferences);
    bindEndpoint(Endpoint.setUiPreference, controllerInstance.setUiPreference);
    bindEndpoint(Endpoint.setBoardWindowIdentity, controllerInstance.setBoardWindowIdentity);
    bindEndpoint(Endpoint.createBoardShortcut, controllerInstance.createBoardShortcut);
    bindEndpoint(Endpoint.openBoardWindow, controllerInstance.openBoardWindow);
    bindEndpoint(Endpoint.maximizeWindow, controllerInstance.maximizeWindow);
    bindEndpoint(Endpoint.getDisplays, controllerInstance.getDisplays);
    bindEndpoint(Endpoint.moveToDisplay, controllerInstance.moveToDisplay);
    bindEndpoint(Endpoint.setFullScreen, controllerInstance.setFullScreen);
    bindEndpoint(Endpoint.getFullScreen, controllerInstance.getFullScreen);
    bindEndpoint(Endpoint.minimizeWindow, controllerInstance.minimizeWindow);
    bindEndpoint(Endpoint.restoreWindow, controllerInstance.restoreWindow);
    bindEndpoint(Endpoint.closeWindow, controllerInstance.closeWindow);
    bindEndpoint(Endpoint.setCanQuit, controllerInstance.setCanQuit);
    bindEndpoint(Endpoint.resolveWindowClose, controllerInstance.resolveWindowClose);
    bindEndpoint(Endpoint.setVoiceTypingConfig, controllerInstance.setVoiceTypingConfig);
    bindEndpoint(Endpoint.setVoiceTypingState, controllerInstance.setVoiceTypingState);
    bindEndpoint(Endpoint.armVoiceTypingMicrophone, controllerInstance.armVoiceTypingMicrophone);
    bindEndpoint(Endpoint.clearVoiceTypingMicrophone, controllerInstance.clearVoiceTypingMicrophone);
    bindEndpoint(Endpoint.armTranscriptLoopback, controllerInstance.armTranscriptLoopback);
    bindEndpoint(Endpoint.clearTranscriptLoopback, controllerInstance.clearTranscriptLoopback);
    bindEndpoint(Endpoint.showOpenFileDialog, controllerInstance.showOpenFileDialog);
    bindEndpoint(Endpoint.showSaveFileDialog, controllerInstance.showSaveFileDialog);
    bindEndpoint(Endpoint.showOpenFolderDialog, controllerInstance.showOpenFolderDialog);
    bindEndpoint(Endpoint.inspectElement, controllerInstance.inspectElement);
    bindEndpoint(Endpoint.openDevTools, controllerInstance.openDevTools);
    bindEndpoint(Endpoint.getCommonFolder, controllerInstance.getCommonFolder);
    bindEndpoint(Endpoint.getSiteExtensionRuntime, controllerInstance.getSiteExtensionRuntime);
    bindEndpoint(Endpoint.zoom, controllerInstance.zoom);
    bindEndpoint(Endpoint.resetZoom, controllerInstance.resetZoom);
    bindEndpoint(Endpoint.showItemInFolder, controllerInstance.showItemInFolder);
    bindEndpoint(Endpoint.showFolder, controllerInstance.showFolder);
    bindEndpoint(Endpoint.openPath, controllerInstance.openPath);
    bindEndpoint(Endpoint.windowReady, controllerInstance.windowReady);
    bindEndpoint(Endpoint.getStartupInputs, controllerInstance.getStartupInputs);
    bindEndpoint(Endpoint.getWindowIndex, controllerInstance.getWindowIndex);
    bindEndpoint(Endpoint.openNewWindow, controllerInstance.openNewWindow);
    bindEndpoint(Endpoint.getWindowPages, controllerInstance.getWindowPages);
    bindEndpoint(Endpoint.showWindowPage, controllerInstance.showWindowPage);
    bindEndpoint(Endpoint.addDragEvent, controllerInstance.addDragEvent);
    bindEndpoint(Endpoint.getFileIcon, controllerInstance.getFileIcon);
    bindEndpoint(Endpoint.checkForUpdates, controllerInstance.checkForUpdates);
    bindEndpoint(Endpoint.getAppVersion, controllerInstance.getAppVersion);
    bindEndpoint(Endpoint.getRuntimeVersions, controllerInstance.getRuntimeVersions);
    bindEndpoint(Endpoint.setNativeTheme, controllerInstance.setNativeTheme);
    bindEndpoint(Endpoint.registerAsDefaultBrowser, controllerInstance.registerAsDefaultBrowser);
    bindEndpoint(Endpoint.unregisterAsDefaultBrowser, controllerInstance.unregisterAsDefaultBrowser);
    bindEndpoint(Endpoint.isRegisteredAsDefaultBrowser, controllerInstance.isRegisteredAsDefaultBrowser);
    bindEndpoint(Endpoint.openDefaultAppsSettings, controllerInstance.openDefaultAppsSettings);
    bindEndpoint(Endpoint.getDownloads, controllerInstance.getDownloads);
    bindEndpoint(Endpoint.cancelDownload, controllerInstance.cancelDownload);
    bindEndpoint(Endpoint.openDownload, controllerInstance.openDownload);
    bindEndpoint(Endpoint.showDownloadInFolder, controllerInstance.showDownloadInFolder);
    bindEndpoint(Endpoint.clearCompletedDownloads, controllerInstance.clearCompletedDownloads);
    bindEndpoint(Endpoint.setMcpEnabled, controllerInstance.setMcpEnabled);
    bindEndpoint(Endpoint.setMainScriptsEnabled, controllerInstance.setMainScriptsEnabled);
    bindEndpoint(Endpoint.capabilityList, controllerInstance.capabilityList);
    bindEndpoint(Endpoint.capabilityProviders, controllerInstance.capabilityProviders);
    bindEndpoint(Endpoint.capabilityGet, controllerInstance.capabilityGet);
    bindEndpoint(Endpoint.capabilityInvoke, controllerInstance.capabilityInvoke);
    bindEndpoint(Endpoint.capabilityCancel, controllerInstance.capabilityCancel);
    bindEndpoint(Endpoint.capabilityLegacyResolve, controllerInstance.capabilityLegacyResolve);
    bindEndpoint(Endpoint.getCapabilityIndex, controllerInstance.getCapabilityIndex);
    bindEndpoint(Endpoint.setCapabilityPreferences, controllerInstance.setCapabilityPreferences);
    bindEndpoint(Endpoint.setWindowsSsoEnabled, controllerInstance.setWindowsSsoEnabled);
    bindEndpoint(Endpoint.getMcpStatus, controllerInstance.getMcpStatus);
    bindEndpoint(Endpoint.setMnemeEnabled, controllerInstance.setMnemeEnabled);
    bindEndpoint(Endpoint.restartMneme, controllerInstance.restartMneme);
    bindEndpoint(Endpoint.getMnemeStatus, controllerInstance.getMnemeStatus);
    bindEndpoint(Endpoint.getAudioCaptureCount, controllerInstance.getAudioCaptureCount);
    bindEndpoint(Endpoint.setClipboardEnabled, controllerInstance.setClipboardEnabled);
    bindEndpoint(Endpoint.getClipboardHistory, controllerInstance.getClipboardHistory);
    bindEndpoint(Endpoint.removeClipboardItem, controllerInstance.removeClipboardItem);
    bindEndpoint(Endpoint.clearClipboardHistory, controllerInstance.clearClipboardHistory);
    bindEndpoint(Endpoint.copyClipboardItem, controllerInstance.copyClipboardItem);
    bindEndpoint(Endpoint.getClipboardStatus, controllerInstance.getClipboardStatus);
    bindEndpoint(Endpoint.setClipboardHealthMonitoring, controllerInstance.setClipboardHealthMonitoring);
    bindEndpoint(Endpoint.restartClipboard, controllerInstance.restartClipboard);
    bindEndpoint(Endpoint.startScreenSnip, controllerInstance.startScreenSnip);
    bindEndpoint(Endpoint.startWindowRecording, controllerInstance.startWindowRecording);
    bindEndpoint(Endpoint.appendWindowRecordingChunk, controllerInstance.appendWindowRecordingChunk);
    bindEndpoint(Endpoint.finalizeWindowRecording, controllerInstance.finalizeWindowRecording);
    bindEndpoint(Endpoint.cancelWindowRecording, controllerInstance.cancelWindowRecording);
    bindEndpoint(Endpoint.clipboardWriteText, controllerInstance.clipboardWriteText);
    bindEndpoint(Endpoint.clipboardWritePng, controllerInstance.clipboardWritePng);
    bindEndpoint(Endpoint.clipboardReadFilePaths, controllerInstance.clipboardReadFilePaths);
    bindEndpoint(Endpoint.clipboardWriteFilePaths, controllerInstance.clipboardWriteFilePaths);
    bindEndpoint(Endpoint.startOsFileDrag, controllerInstance.startOsFileDrag);
    bindEndpoint(Endpoint.createVideoStreamSession, controllerInstance.createVideoStreamSession);
    bindEndpoint(Endpoint.deleteVideoStreamSession, controllerInstance.deleteVideoStreamSession);
    bindEndpoint(Endpoint.deleteVideoStreamSessionsByPage, controllerInstance.deleteVideoStreamSessionsByPage);
    bindEndpoint(Endpoint.openInVlc, controllerInstance.openInVlc);
    bindEndpoint(Endpoint.openTerminal, controllerInstance.openTerminal);
    bindEndpoint(Endpoint.detectTerminal, controllerInstance.detectTerminal);
    bindEndpoint(Endpoint.capturePageRegion, controllerInstance.capturePageRegion);
    bindEndpoint(Endpoint.setHtmlPreview, controllerInstance.setHtmlPreview);
    bindEndpoint(Endpoint.clearHtmlPreview, controllerInstance.clearHtmlPreview);
}
