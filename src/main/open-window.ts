import { app, BrowserWindow, clipboard, screen, type WebContents } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EventEndpoint } from "../ipc/api-types";
import { normalizeVoiceTypingShortcut, RIGHT_CTRL_SHORTCUT, SHIFT_RIGHT_CTRL_SHORTCUT, voiceTypingShortcutForInput } from "../shared/voice-typing-shortcut";
import { debounce, errMessage } from "../shared/utils";
import { electronStore } from "./e-store";
import { getAssetPath } from "./utils";
import { appPartition } from "./constants";
import { getBoardRootForHost } from "./board-protocol-service";

interface WindowState {
    width: number;
    height: number;
    x?: number;
    y?: number;
}

type VoiceTypingState = "idle" | "recording" | "transcribing";
type VoiceTypingMode = "transcribe" | "translate";
type VoiceTypingSource = "app" | { kind: "guest"; webContentsId: number };

function inputMatchesShortcut(input: Electron.Input, shortcut: string): boolean {
    return voiceTypingShortcutForInput(input) === shortcut;
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(fallback);
        }, milliseconds);
        promise.then((value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(fallback);
        });
    });
}

export class OpenWindow {
    index = 0;
    window: BrowserWindow;
    customSession = null as Electron.Session | null;
    canQuit = false;
    quitTimeout: ReturnType<typeof setTimeout> | null = null;
    onClose?: (window: OpenWindow) => void;
    private voiceTypingShortcut = "Alt+V";
    private voiceTypingTranslateShortcut = "Alt+Shift+V";
    private rightCtrlTap: { target: WebContents; shift: boolean } | undefined;
    private voiceTypingState: VoiceTypingState = "idle";
    private voiceTypingSession: { id: string; target: WebContents } | undefined;
    private voiceTypingControlSession: { id: string; target: WebContents; mode: VoiceTypingMode } | undefined;

    constructor(position?: { x: number; y: number }) {
        let windowState: WindowState = electronStore.get("windowState", {
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
                    `--persephone-preferred-languages=${JSON.stringify(app.getPreferredSystemLanguages())}`,
                    `--persephone-languages-dir=${getAssetPath("languages")}`,
                ],
                // webSecurity stays off (investigated in US-1590). The renderer reads cross-origin responses with
                // Chromium fetch — favicon cache, Image editor, the in-app MCP client (which must send no Origin:
                // the MCP servers refuse browser requests, US-1588), and user scripts' global fetch — and the dev
                // origin (http://localhost) loads file:// media. It grants nothing an attacker in this window lacks:
                // nodeIntegration already bypasses SOP. Guest content stays isolated (sandboxed preview, board://).
                webSecurity: false,
                webviewTag: true,
                plugins: true,
                nodeIntegrationInSubFrames: false,
                spellcheck: false,
            },
        });

        this.window.once("ready-to-show", () => {
            this.window?.setSize(windowState.width, windowState.height);
            this.window?.show();
        });

        this.window.on("close", (event) => {
            if (!this.canQuit) {
                event.preventDefault();
                this.send(EventEndpoint.eBeforeQuit, undefined);
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
            this.clearVoiceTypingSession();
            this.clearVoiceTypingControlSession();
            this.onClose?.(this);
        });

        this.window.on("maximize", () => {
            this.send(EventEndpoint.eWindowMaximized, true);
        });

        this.window.on("unmaximize", () => {
            this.send(EventEndpoint.eWindowMaximized, false);
        });

        this.window.on("resize", () => {
            this.saveWindowSize();
        });

        this.window.on("move", () => {
            this.saveWindowSize();
        });

        this.window.webContents.on("before-input-event", (event, input) => {
            if (!this.window) return;

            this.handleVoiceTypingInput(event, input, this.window.webContents, "app");

            if (input.control || input.meta) {
                if (input.key === "+" || input.key === "=") {
                    event.preventDefault();
                    const currentZoom = this.window.webContents.getZoomLevel();
                    this.window.webContents.setZoomLevel(currentZoom + 0.5);
                    this.send(EventEndpoint.eZoomChanged, currentZoom + 0.5);
                } else if (input.key === "-") {
                    event.preventDefault();
                    const currentZoom = this.window.webContents.getZoomLevel();
                    this.window.webContents.setZoomLevel(currentZoom - 0.5);
                    this.send(EventEndpoint.eZoomChanged, currentZoom - 0.5);
                } else if (input.key === "0") {
                    event.preventDefault();
                    this.window.webContents.setZoomLevel(0);
                    this.send(EventEndpoint.eZoomChanged, 0);
                }
            }
        });

        this.window.webContents.setWindowOpenHandler((details) => {
            let boardRoot: string | undefined;
            try {
                const referrer = new URL(details.referrer.url);
                if (referrer.protocol === "board:") boardRoot = getBoardRootForHost(referrer.host) ?? undefined;
            } catch { /* Empty or malformed referrer is deliberately unattributed. */ }
            this.send(EventEndpoint.eOpenUrl, {
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
                this.send(EventEndpoint.eOpenUrl, { url });
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
                this.send(EventEndpoint.eOpenFile, filePath);
                return;
            }

            // Allow navigation within your app protocols
            if (url.startsWith("app-asset://")) {
                return;
            }

            // Block and send to renderer for routing
            event.preventDefault();
            this.send(EventEndpoint.eOpenUrl, { url });
        });

        // US-884: `will-navigate` above covers only the MAIN frame. A board renders in an
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
            try { boardRoot = getBoardRootForHost(new URL(currentUrl).host) ?? undefined; } catch { /* no board origin */ }
            this.send(EventEndpoint.eOpenUrl, { url: details.url, ...(boardRoot ? { boardRoot } : {}) });
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

    send(eventName: EventEndpoint, data: unknown) {
        if (!this.window) {
            return;
        }
        this.window.webContents.send(eventName, data);
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
        this.clearVoiceTypingSession();
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
                electronStore.set("windowState", {
                    width: bounds.width,
                    height: bounds.height,
                    x: bounds.x,
                    y: bounds.y,
                });
            }
        }
    }, 500);

    setVoiceTypingShortcuts(shortcut: string, translateShortcut: string): void {
        this.voiceTypingShortcut = normalizeVoiceTypingShortcut(shortcut) ?? "Alt+V";
        this.voiceTypingTranslateShortcut = normalizeVoiceTypingShortcut(translateShortcut) ?? "Alt+Shift+V";
    }

    setVoiceTypingState(state: VoiceTypingState): void {
        this.voiceTypingState = state;
        if (state === "idle") {
            this.clearVoiceTypingSession();
            this.clearVoiceTypingControlSession();
        }
    }

    handleGuestVoiceTypingInput(event: Electron.Event, input: Electron.Input, target: WebContents): void {
        this.handleVoiceTypingInput(event, input, target, { kind: "guest", webContentsId: target.id });
    }

    async insertVoiceTypingText(sessionId: string, text: string, deferClipboard = false): Promise<{ copied: boolean }> {
        const session = this.voiceTypingSession;
        if (!session || session.id !== sessionId || !["recording", "transcribing"].includes(this.voiceTypingState)) throw new Error("The voice typing session is no longer active.");
        const target = session.target;
        if (!target.isDestroyed()) {
            const frame = target.focusedFrame;
            if (frame) {
                try {
                    // Returns the character before the caret ("" at the start), or null when nothing editable has focus.
                    const before = await withDeadline(frame.executeJavaScript(`(() => {
                        const element = document.activeElement;
                        const textInput = element instanceof HTMLTextAreaElement
                            || element instanceof HTMLInputElement && ["text", "search", "url", "tel", "email", "password", "number"].includes(element.type);
                        if (textInput) {
                            try { return element.value.slice(0, element.selectionStart ?? element.value.length).slice(-1); } catch { return ""; }
                        }
                        if (!(element instanceof HTMLElement)) return null;
                        // Monaco keeps focus on an EditContext element, which is neither an input nor contenteditable.
                        if (element.editContext) return element.editContext.text.slice(0, element.editContext.selectionStart).slice(-1);
                        if (!element.isContentEditable) return null;
                        const selection = getSelection();
                        if (!selection || !selection.rangeCount || !element.contains(selection.anchorNode)) return "";
                        const range = document.createRange();
                        range.selectNodeContents(element);
                        range.setEnd(selection.anchorNode, selection.anchorOffset);
                        return range.toString().slice(-1);
                    })()`) as Promise<string | null>, 1200, null);
                    const editable = typeof before === "string";
                    // Dictation continues the text: separate it from a preceding word.
                    if (before && !/\s/.test(before)) text = ` ${text}`;
                    if (this.voiceTypingSession?.id !== sessionId || !["recording", "transcribing"].includes(this.voiceTypingState)) {
                        throw new Error("The voice typing session is no longer active.");
                    }
                    if (editable && !target.isDestroyed()) {
                        // webContents.insertText() crashes the renderer when focus is in a cross-origin
                        // child frame (a board iframe), so a child frame inserts through its own document.
                        const inserted = frame === target.mainFrame
                            ? await withDeadline(target.insertText(text).then(() => true), 1500, false)
                            : await withDeadline(frame.executeJavaScript(`document.execCommand("insertText", false, ${JSON.stringify(text)})`) as Promise<boolean>, 1500, false);
                        if (inserted) {
                            if (!deferClipboard) this.clearVoiceTypingSession();
                            return { copied: false };
                        }
                    }
                } catch (error: unknown) {
                    console.warn(`Voice typing insertion check failed: ${errMessage(error)}`);
                }
            }
        }
        if (!deferClipboard) clipboard.writeText(text);
        this.clearVoiceTypingSession();
        return { copied: true };
    }

    private handleVoiceTypingInput(event: Electron.Event, input: Electron.Input, target: WebContents, source: VoiceTypingSource): void {
        const rightCtrlShortcut = this.trackRightCtrlTap(input, target);
        if (rightCtrlShortcut && [this.voiceTypingShortcut, this.voiceTypingTranslateShortcut].includes(rightCtrlShortcut)) {
            this.toggleVoiceTyping(target, source, rightCtrlShortcut === this.voiceTypingTranslateShortcut ? "translate" : "transcribe");
            return;
        }
        if (input.type !== "keyDown" || input.isAutoRepeat) return;
        if (inputMatchesShortcut(input, this.voiceTypingShortcut) || inputMatchesShortcut(input, this.voiceTypingTranslateShortcut)) {
            event.preventDefault();
            const mode = inputMatchesShortcut(input, this.voiceTypingTranslateShortcut) ? "translate" : "transcribe";
            this.toggleVoiceTyping(target, source, mode);
            return;
        }
        if (input.key === "Escape" && this.voiceTypingState !== "idle" && this.voiceTypingControlSession) {
            event.preventDefault();
            const sessionId = this.voiceTypingControlSession.id;
            this.voiceTypingState = "idle";
            this.clearVoiceTypingSession();
            this.clearVoiceTypingControlSession();
            this.send(EventEndpoint.eVoiceTypingShortcut, { sessionId, action: "cancel", source });
        }
    }

    /** Returns the plain or Shift-modified right Ctrl tap chord on release. */
    private trackRightCtrlTap(input: Electron.Input, target: WebContents): string | undefined {
        const isRightCtrl = input.code === "ControlRight";
        if (input.type === "keyDown") {
            if (isRightCtrl) {
                if (!input.isAutoRepeat) this.rightCtrlTap = input.alt || input.meta ? undefined : { target, shift: input.shift };
            } else if (input.key === "Shift" && this.rightCtrlTap?.target === target) {
                this.rightCtrlTap.shift = true;
            } else {
                this.rightCtrlTap = undefined;
            }
            return undefined;
        }
        if (input.type !== "keyUp" || !isRightCtrl) {
            if (input.type === "keyUp" && input.key === "Shift" && this.rightCtrlTap?.target === target) this.rightCtrlTap.shift = true;
            return undefined;
        }
        const tap = this.rightCtrlTap;
        this.rightCtrlTap = undefined;
        if (tap?.target !== target) return undefined;
        return tap.shift ? SHIFT_RIGHT_CTRL_SHORTCUT : RIGHT_CTRL_SHORTCUT;
    }

    private toggleVoiceTyping(target: WebContents, source: VoiceTypingSource, mode: VoiceTypingMode): void {
        if (this.voiceTypingState === "transcribing") return;
        if (this.voiceTypingState === "idle") {
            const sessionId = crypto.randomUUID();
            this.voiceTypingSession = { id: sessionId, target };
            this.voiceTypingControlSession = { id: sessionId, target, mode };
            this.voiceTypingState = "recording";
            this.send(EventEndpoint.eVoiceTypingShortcut, { sessionId, action: "start", mode, source });
        } else if (this.voiceTypingControlSession) {
            this.voiceTypingState = "transcribing";
            this.send(EventEndpoint.eVoiceTypingShortcut, { sessionId: this.voiceTypingControlSession.id, action: "stop", source });
        }
    }

    private clearVoiceTypingSession(): void {
        this.voiceTypingSession = undefined;
    }

    private clearVoiceTypingControlSession(): void {
        this.voiceTypingControlSession = undefined;
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
