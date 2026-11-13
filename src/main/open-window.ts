import { globalMuteService } from "./global-mute-service";
import { applicationProfileName } from "./application-profile";
import { browserGuests, reapplyBrowserGuestZoom } from "./browser/BrowserGuestRegistry";
import { HostFullscreenController } from "./host-fullscreen-controller";
import { app, BrowserWindow, nativeImage, screen, type WebContents } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { EventApi } from "../ipc/api-types";
import type { EventPayload } from "../ipc/event-types";
import { sendRendererEvent } from "../ipc/main/renderer-event-sender";
import { debounce } from "../shared/utils";
import { electronStore } from "./e-store";
import { getAssetPath, getDataFolder } from "./utils";
import { STARTUP_DATA_DIR_ARG } from "../shared/application-profile";
import { appPartition } from "./constants";
import { boardAppId, boardProfileArgument, boardRootForLaunchArgs, boardWindowIconPath, getBoardLauncherPath, writeBoardWindowIcon } from "./board-window-identity";
import { BoardRoot } from "../shared/board/board-root";
import { boardWindowStateKey } from "./board-root-hashes";
import { VoiceTypingController, type VoiceTypingState } from "./voice-typing-controller";

interface WindowState {
    width: number;
    height: number;
    x?: number;
    y?: number;
}

export type BoardHostRootLookup = (host: string) => string | undefined;

interface OpenWindowOptions {
    boardHostRootLookup?: BoardHostRootLookup;
}

export class OpenWindow {
    index = 0;
    window: BrowserWindow;
    hostFullscreen: HostFullscreenController;
    customSession = null as Electron.Session | null;
    canQuit = false;
    quitTimeout: ReturnType<typeof setTimeout> | null = null;
    onClose?: (window: OpenWindow) => void;
    onRendererUnavailable?: (window: OpenWindow) => void;
    private readonly voiceTypingController = new VoiceTypingController((eventName, data) => this.send(eventName, data));
    private readonly boardHostRootLookup?: BoardHostRootLookup;

    boardRoot?: string;

    get boardIconPath(): string | undefined {
        return this.boardRoot ? boardWindowIconPath(this.boardRoot) : undefined;
    }

    async updateBoardIdentity(displayName: string, iconDataUrl: string): Promise<void> {
        if (!this.boardRoot) throw new Error("Board identity updates require a board-mode window.");
        if (typeof displayName !== "string" || !displayName.trim() || displayName.length > 256) {
            throw new Error("Invalid board display name.");
        }
        const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(iconDataUrl);
        if (!match || match[1].length > 7_000_000) throw new Error("Invalid board icon data URL.");
        const image = nativeImage.createFromDataURL(iconDataUrl);
        const size = image.getSize();
        if (image.isEmpty() || size.width !== 256 || size.height !== 256) throw new Error("Board icons must be 256x256 PNG images.");
        this.window.setIcon(image);
        const iconPath = await writeBoardWindowIcon(this.boardRoot, image.toPNG());
        this.window.setAppDetails({
            appId: boardAppId(this.boardRoot),
            relaunchCommand: `"${getBoardLauncherPath()}" --board "${boardRootForLaunchArgs(this.boardRoot)}"${boardProfileArgument()}`,
            relaunchDisplayName: displayName.trim(),
            appIconPath: iconPath,
        });
    }

    constructor(position?: { x: number; y: number }, boardRoot?: string, options: OpenWindowOptions = {}) {
        this.boardRoot = boardRoot;
        this.boardHostRootLookup = options.boardHostRootLookup;
        const boardKey = boardRoot ? boardWindowStateKey(BoardRoot.from(boardRoot)) : "windowState";
        let windowState: WindowState = electronStore.get(boardKey, {
            width: 1024,
            height: 680,
            x: undefined as number | undefined,
            y: undefined as number | undefined,
        });

        if (position) {
            windowState.x = position.x - Math.floor(windowState.width / 2);
            windowState.y = position.y - 16;
        }

        windowState = this.ensureVisiblePosition(windowState);

        this.window = new BrowserWindow({
            show: false, // show after size fix on 'ready-to-show' event
            height: windowState.height,
            width: windowState.width,
            x: windowState.x,
            y: windowState.y,
            icon: getAssetPath("icon.png"),
            frame: false,
            webPreferences: {
                preload: path.join(__dirname, "preload.js"),
                partition: appPartition,
                nodeIntegration: true,
                contextIsolation: false,
                additionalArguments: [
                    `${STARTUP_DATA_DIR_ARG}${getDataFolder()}`,
                    `--persephone-preferred-languages=${JSON.stringify(app.getPreferredSystemLanguages())}`,
                    `--persephone-languages-dir=${getAssetPath("languages")}`,
                    ...(applicationProfileName() ? [`--persephone-application-profile=${applicationProfileName()}`] : []),
                    ...(boardRoot ? [`--persephone-board-root=${encodeURIComponent(boardRoot)}`] : []),
                ],
                // webSecurity stays off because the renderer reads cross-origin responses with
                // Chromium fetch — favicon cache, Image editor, the in-app MCP client (which must send no Origin:
                // the MCP servers refuse browser requests, and user scripts' global fetch — and the dev
                // origin (http://localhost) loads file:// media. It grants nothing an attacker in this window lacks:
                // nodeIntegration already bypasses SOP. Guest content stays isolated (sandboxed preview, board://).
                webSecurity: false,
                webviewTag: true,
                plugins: true,
                nodeIntegrationInSubFrames: false,
                spellcheck: false,
            },
        });

        this.hostFullscreen = new HostFullscreenController(this.window, browserGuests);
        this.hostFullscreen.watch();
        globalMuteService.register(this.window.webContents, "window");

        if (boardRoot) {
            const displayName = path.basename(boardRoot);
            this.window.setAppDetails({
                appId: boardAppId(boardRoot),
                relaunchCommand: `"${getBoardLauncherPath()}" --board "${boardRootForLaunchArgs(boardRoot)}"${boardProfileArgument()}`,
                relaunchDisplayName: displayName,
            });
        }

        this.window.once("ready-to-show", () => {
            this.window?.setSize(windowState.width, windowState.height);
            this.window?.show();
        });

        this.window.webContents.on("render-process-gone", () => this.onRendererUnavailable?.(this));
        this.window.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
            if (isMainFrame && !_inPlace) this.onRendererUnavailable?.(this);
        });

        this.window.on("close", (event) => {
            if (!this.canQuit) {
                event.preventDefault();
                this.send("eBeforeQuit", undefined);
                // If renderer is crashed or unresponsive, force-quit after timeout.
                //
                // This deliberately calls close() directly rather than going
                // through openWindows.setCanQuit, so it does NOT honour the
                // close-to-tray setting: a hung last window is destroyed, and
                // the app quits with it. That is the intended failure mode.
                // Hiding a renderer that never answered would leave a frozen
                // window behind the tray icon, which looks like a working
                // background app until the user clicks it. Failing closed is
                // recoverable; failing into a zombie is not.
                if (!this.quitTimeout) {
                    this.quitTimeout = setTimeout(() => {
                        this.close();
                    }, 2000);
                }
                return;
            }

            if (this.quitTimeout) {
                clearTimeout(this.quitTimeout);
                this.quitTimeout = null;
            }
            this.window = null;
            this.voiceTypingController.clearSessions();
            this.onClose?.(this);
        });

        this.window.on("maximize", () => {
            this.send("eWindowMaximized", true);
        });

        this.window.on("unmaximize", () => {
            this.send("eWindowMaximized", false);
        });

        this.window.on("resize", () => {
            this.saveWindowSize();
        });

        this.window.on("move", () => {
            this.saveWindowSize();
        });

        this.window.webContents.on("before-input-event", (event, input) => {
            if (!this.window) return;

            this.voiceTypingController.handleInput(event, input, this.window.webContents, "app");

            if (input.control || input.meta) {
                if (input.key === "+" || input.key === "=") {
                    event.preventDefault();
                    const currentZoom = this.window.webContents.getZoomLevel();
                    this.window.webContents.setZoomLevel(currentZoom + 0.5);
                    reapplyBrowserGuestZoom(this.window.webContents);
                    this.send("eZoomChanged", currentZoom + 0.5);
                } else if (input.key === "-") {
                    event.preventDefault();
                    const currentZoom = this.window.webContents.getZoomLevel();
                    this.window.webContents.setZoomLevel(currentZoom - 0.5);
                    reapplyBrowserGuestZoom(this.window.webContents);
                    this.send("eZoomChanged", currentZoom - 0.5);
                } else if (input.key === "0") {
                    event.preventDefault();
                    this.window.webContents.setZoomLevel(0);
                    reapplyBrowserGuestZoom(this.window.webContents);
                    this.send("eZoomChanged", 0);
                }
            }
        });

        this.window.webContents.setWindowOpenHandler((details) => {
            let boardRoot: string | undefined;
            try {
                const referrer = new URL(details.referrer.url);
                if (referrer.protocol === "board:") boardRoot = this.boardHostRootLookup?.(referrer.host);
            } catch { /* Empty or malformed referrer is deliberately unattributed. */ }
            this.send("eOpenUrl", {
                url: details.url,
                ...(boardRoot ? { boardRoot } : {}),
                ...(!boardRoot ? { unattributedPopup: true } : {}),
            });
            return { action: "deny" };
        });

        this.window.webContents.on("will-navigate", (event, url) => {
            console.log("Navigating to:", url);

            if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
                // Allow only the Vite dev server's own initial load (dev mode).
                // Any other http://localhost:<port> link is an external app —
                // route it through eOpenUrl so it doesn't replace the Persephone UI.
                if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
                    const uri = new URL(url);
                    const devUri = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
                    if (
                        uri.origin === devUri.origin &&
                        (uri.pathname === "/" || uri.pathname === "")
                    ) {
                        return;
                    }
                }
                event.preventDefault();
                this.send("eOpenUrl", { url });
                return;
            }

            if (url.startsWith("file://")) {
                const uri = new URL(url);
                const currentUrl = this.window.webContents.getURL();

                // Allow initial load of your index.html
                if (!currentUrl || currentUrl === "about:blank") {
                    return;
                }

                // Check if this is the main app file
                const currentUri = new URL(currentUrl);
                if (uri.pathname === currentUri.pathname) {
                    return; // Allow same-page navigation (unlikely but safe)
                }

                event.preventDefault();

                const filePath = fileURLToPath(url);
                this.send("eOpenFile", filePath);
                return;
            }

            // Allow navigation within your app protocols
            if (url.startsWith("app-asset://")) {
                return;
            }

            // Block and send to renderer for routing
            event.preventDefault();
            this.send("eOpenUrl", { url });
        });

        //: `will-navigate` above covers only the MAIN frame. A board renders in an
        // out-of-process subframe on a `board://<host>` origin; a stray link inside it (e.g.
        // an <a href="http://…"> in a rendered .docx) navigates the FRAME away from board://,
        // which can't load http — the frame goes blank (white screen). Subframe navigations
        // fire `will-frame-navigate`, not `will-navigate`, so guard them here: never let a
        // board frame leave its own origin, and route the intended URL through the normal
        // openRawLink pipeline (eOpenUrl → RendererEventsService.handleOpenUrl) so the click
        // still opens the link in a Persephone page / browser instead of dying silently.
        this.window.webContents.on("will-frame-navigate", (details) => {
            // The main frame is already handled by `will-navigate` above.
            if (details.isMainFrame) return;

            // Only guard frames that currently live on a board:// origin — other subframes
            // (dev iframes, etc.) keep their default behavior. `frame` may be null if the
            // frame was destroyed mid-navigation.
            const currentUrl = details.frame?.url ?? "";
            if (!currentUrl.startsWith("board://")) return;

            // Same-origin in-board navigation (board://<host>/other.html) is a legitimate,
            // supported path (BoardWebview re-handshakes on each load) — allow it. Anything
            // that leaves the board's origin would blank the frame → block + route.
            let currentOrigin = "";
            let targetOrigin = "";
            try {
                currentOrigin = new URL(currentUrl).origin;
                targetOrigin = new URL(details.url).origin;
            } catch {
                // Unparseable target → treat as external and block below.
            }
            if (targetOrigin && targetOrigin === currentOrigin) return;

            details.preventDefault();
            let boardRoot: string | undefined;
            try { boardRoot = this.boardHostRootLookup?.(new URL(currentUrl).host); } catch { /* no board origin */ }
            this.send("eOpenUrl", { url: details.url, ...(boardRoot ? { boardRoot } : {}) });
        });

        if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
            this.window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
        } else {
            this.window.loadFile(
                path.join(
                    __dirname,
                    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
                ),
            );
        }

        // this.window.webContents.openDevTools();
    }

    send<K extends keyof EventApi>(eventName: K, data: EventPayload<K>): void {
        if (!this.window) {
            return;
        }
        sendRendererEvent(this.window.webContents, eventName, data);
    }

    focus = () => {
        if (this.window) {
            if (this.window.isMinimized()) {
                this.window.restore();
            }
            // Re-check position against current display layout (display may have
            // changed since window was last shown, e.g. VM disconnect, dock/undock)
            const currentBounds = this.window.getBounds();
            const fixed = this.ensureVisiblePosition(currentBounds);
            if (
                fixed.x !== currentBounds.x || fixed.y !== currentBounds.y ||
                fixed.width !== currentBounds.width || fixed.height !== currentBounds.height
            ) {
                this.window.setBounds(fixed);
            }
            this.window.focus();
        }
    };

    close = () => {
        const win = this.window;
        this.window = null;
        this.voiceTypingController.clearSession();
        this.onClose?.(this);
        if (win) {
            win.destroy();
        }
    };

    saveWindowSize = debounce(() => {
        // A fullscreen window (a video in a browser page) has the display's size; saving it
        // would restore the next launch as a screen-sized ordinary window.
        if (this.window && !this.window.isMaximized() && !this.window.isFullScreen()) {
            const bounds = this.window?.getBounds();
            if (bounds) {
                electronStore.set(this.boardRoot ? boardWindowStateKey(BoardRoot.from(this.boardRoot)) : "windowState", {
                    width: bounds.width,
                    height: bounds.height,
                    x: bounds.x,
                    y: bounds.y,
                });
            }
        }
    }, 500);

    setVoiceTypingShortcuts(shortcut: string, translateShortcut: string): void {
        this.voiceTypingController.setShortcuts(shortcut, translateShortcut);
    }

    setVoiceTypingState(state: VoiceTypingState): void {
        this.voiceTypingController.setState(state);
    }

    handleGuestVoiceTypingInput(event: Electron.Event, input: Electron.Input, target: WebContents): void {
        this.voiceTypingController.handleInput(event, input, target, { kind: "guest", webContentsId: target.id });
    }

    async insertVoiceTypingText(sessionId: string, text: string, deferClipboard = false): Promise<{ copied: boolean }> {
        return this.voiceTypingController.insertText(sessionId, text, deferClipboard);
    }

    ensureVisiblePosition = (bounds: WindowState): WindowState => {
        if (bounds.x === undefined || bounds.y === undefined) {
            return bounds;
        }

        const displays = screen.getAllDisplays();
        const headerHeight = 40;
        const minVisibleArea = 100;

        // Find which display the window is on (based on center point)
        const centerX = bounds.x + Math.floor(bounds.width / 2);
        const centerY = bounds.y + Math.floor(bounds.height / 2);

        let targetDisplay = displays.find((display) => {
            const { x, y, width, height } = display.bounds;
            return (
                centerX >= x &&
                centerX < x + width &&
                centerY >= y &&
                centerY < y + height
            );
        });

        // If center is not on any display, use primary display
        if (!targetDisplay) {
            targetDisplay = screen.getPrimaryDisplay();
        }

        const {
            x: displayX,
            y: displayY,
            width: displayWidth,
            height: displayHeight,
        } = targetDisplay.workArea;

        let newX = bounds.x;
        let newY = bounds.y;
        let newWidth = bounds.width;
        let newHeight = bounds.height;

        // If window is too large for the display, shrink it to fit
        if (newWidth > displayWidth) {
            newWidth = displayWidth;
            newX = displayX;
        }
        if (newHeight > displayHeight) {
            newHeight = displayHeight;
            newY = displayY;
        }

        // Ensure header is visible (top of window must be below top of work area)
        if (newY < displayY) {
            newY = displayY;
        }

        // Ensure header doesn't go below the bottom of the screen
        if (newY + headerHeight > displayY + displayHeight) {
            newY = displayY + displayHeight - headerHeight;
        }

        // Ensure enough of the window is visible horizontally (left side)
        if (newX + minVisibleArea > displayX + displayWidth) {
            newX = displayX + displayWidth - minVisibleArea;
        }

        // Ensure enough of the window is visible horizontally (right side)
        if (newX + newWidth < displayX + minVisibleArea) {
            newX = displayX + minVisibleArea - newWidth;
        }

        return {
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
        };
    };
}
