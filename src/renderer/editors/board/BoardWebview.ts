import color from "../../theme/color";
import { api } from "../../../ipc/renderer/api";
import { fs } from "../../api/fs";
import { fpJoin, isPlainLocalPath } from "../../core/utils/file-path";
import { pagesModel } from "../../api/pages";
import { isFocusInSidebar } from "../../core/utils/focus-utils";
import type {
    BoardAiVisionRegistrationMsg,
    BoardAiVisionNotifyMsg,
    BoardAiVisionRequestMsg,
    BoardAiVisionResultMsg,
    BoardCapabilityIntentCancelMsg,
    BoardCapabilityIntentRequestMsg,
    BoardCapabilityIntentResultMsg,
    BoardCapabilityInvokeRequestMsg,
    BoardCapabilityInvokeResultMsg,
    BoardCapabilityListRequestMsg,
    BoardCapabilityListResultMsg,
    BoardFilePathResultMsg,
    BoardHostContentMsg,
    BoardOpenContentRequest,
    BoardOpenContentResultMsg,
    BoardNavigationCreateReturnUrlMsg,
    BoardNavigationReturnUrlResultMsg,
    BoardPortInitMsg,
    BoardStateSyncMsg,
    BoardToolbarControlEventMsg,
    BoardToolbarControlPatch,
    BoardToolbarSetMsg,
    BoardToolbarUpdateMsg,
    BoardToHostMsg,
    BoardVarResultMsg,
} from "../../../ipc/board-bridge-channels";
import type { CapabilityErrorCode, IntentRequest } from "../../../ipc/capability-bus-channels";
import { resolveBoardNamespace } from "../../api/board-namespace";
import { resolveBoardVarRequest } from "../../api/board-vars/board-vars-bridge";
import { resolveBoardOpenContent } from "./board-open-content";
import { cycleAppTheme } from "../../api/cycle-app-theme";
import { BOARD_CDP_TAB } from "../../../ipc/api-types";
import { BOARD_TOKEN_VARS, computeBoardThemePalette, ensureBoardThemeSubscription } from "./board-theme";
import { boardSecondaryPanelId } from "./board-secondary";
import type { BoardEditorModel } from "./BoardEditorModel";
import type { BoardContentEditorModel } from "./BoardContentEditorModel";
import type { IAiRemoteRequest, IAiRemoteResponse, IAiVisionShape } from "ai-vision";
import { isBoardPermitted, subscribeBoardPermission } from "./board-access";
import { errMessage } from "../../../shared/utils";
import { ui } from "../../api/ui";
import { isProviderResolutionError } from "../../content/registry";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { dismissOverlays } from "../../uikit/shared/overlayLayer";
import "../../uikit/Panel/Panel.css";
import { logBoardReloaded, logRemoteNotify, logShapeChanged } from "../../scripting/ai-vision/event-log";
import {
    BoardCapabilityTransportError,
    registerBoardCapabilityFrame,
    unregisterBoardCapabilityFrame,
    type BoardCapabilityFrame,
} from "../../api/board-capability-transport";
import { app } from "../../api/app";
import { boardNavigationReturnService } from "../../api/board-navigation-return";
import {
    normalizeToolbarControlPatches,
    normalizeToolbarControlSet,
    type ToolbarAction,
} from "./BoardToolbarControls";

export interface BoardWebviewProps {
    model: BoardEditorModel;
    boardRoot: string;
    entry?: string;
    view?: string;
    isMain?: boolean;
    onToolbarSet?: (controls: readonly import("../../../ipc/board-bridge-channels").BoardToolbarControlDescriptor[], frameGeneration: number, warning: (message: string) => void) => void;
    onToolbarUpdate?: (patches: readonly BoardToolbarControlPatch[], warning: (message: string) => void) => void;
    onToolbarClear?: (frameGeneration: number) => void;
}

const BOARD_NOTIFY_LIMIT = 5;
const BOARD_NOTIFY_WINDOW_MS = 60_000;
const acceptedBoardNotifyTimes: number[] = [];

function acceptBoardNotify(now: number): boolean {
    while (acceptedBoardNotifyTimes[0] !== undefined
        && acceptedBoardNotifyTimes[0] <= now - BOARD_NOTIFY_WINDOW_MS) {
        acceptedBoardNotifyTimes.shift();
    }
    if (acceptedBoardNotifyTimes.length >= BOARD_NOTIFY_LIMIT) return false;
    acceptedBoardNotifyTimes.push(now);
    return true;
}

function isDataCloneError(error: unknown): boolean {
    return error !== null && typeof error === "object"
        && (error as { name?: unknown }).name === "DataCloneError";
}

/**
 * Locked-down host for one cross-origin board iframe. The board origin, CSP and
 * nodeIntegrationInSubFrames setting provide isolation; this view deliberately
 * does not use a sandbox attribute. A new instance owns one board registration,
 * frame registration and MessagePort lifetime.
 */
export class BoardWebview extends VanillaView<BoardWebviewProps> {
    private readonly boardId = `board_${Math.random().toString(36).slice(2)}`;
    private readonly tabId: string;
    private readonly isMain: boolean;
    private host: string | null = null;
    private registeredHost: string | null = null;
    private iframe: HTMLIFrameElement | undefined;
    private pendingPort: MessagePort | null = null;
    private lastBoardContent: string | undefined;
    private live = false;
    private generation = 0;
    private portDeliveryUnsubscribe: (() => void) | undefined;
    private contentHostUnsubscribe: (() => void) | undefined;
    private sharedStateUnsubscribe: (() => void) | undefined;
    private focusUnsubscribe: (() => void) | undefined;
    private focusTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly pendingAiVision = new Map<number, {
        resolve: (response: IAiRemoteResponse) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        generation: number;
        iframe: HTMLIFrameElement;
        contentWindow: Window;
    }>();
    private aiVisionRequestId = 0;
    private readonly pendingCapability = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (error: BoardCapabilityTransportError) => void;
        timer: ReturnType<typeof setTimeout>;
        generation: number;
        iframe: HTMLIFrameElement;
        contentWindow: Window;
    }>();
    private readonly initialIntentIds = new Set<string>();
    private capabilityFrame: BoardCapabilityFrame | undefined;

    public constructor(props: BoardWebviewProps) {
        super(props, createPanelElement({
            direction: "column",
            flex: true,
            width: "100%",
            height: 0,
            background: "default",
        }));
        this.isMain = props.isMain ?? true;
        this.tabId = this.isMain ? BOARD_CDP_TAB : boardSecondaryPanelId(props.view ?? "main");
    }

    protected onMount(): void {
        this.live = true;
        this.ownSubscription(subscribeBoardPermission(() => {
            if (!isBoardPermitted(this.props.boardRoot)) {
                this.rejectPendingAiVision(new Error("The board is no longer trusted."));
                this.rejectPendingCapability("untrusted", "The board is no longer trusted.", true);
                this.unregisterCapabilityFrame();
            }
        }));
        ensureBoardThemeSubscription();
        void this.registerBoard();
    }

    protected onUpdate(): void {
        // A board-root/view/reload change is a parent branch identity change. The
        // parent releases this instance instead of retargeting a live iframe.
    }

    protected onDispose(): void {
        this.live = false;
        const retiredGeneration = this.generation;
        this.props.model.clearToolbarControlsForFrame(retiredGeneration);
        if (this.isMain) this.props.model.clearToolbarTextForFrame(retiredGeneration);
        this.props.onToolbarClear?.(retiredGeneration);
        this.generation++;
        this.rejectPendingAiVision(new Error("Board frame was replaced."));
        this.rejectPendingCapability("handler-closed", "The board frame was replaced.", false);
        this.unregisterCapabilityFrame();
        this.initialIntentIds.clear();
        if (this.focusTimer !== undefined) {
            clearTimeout(this.focusTimer);
            this.focusTimer = undefined;
        }
        this.focusUnsubscribe?.();
        this.focusUnsubscribe = undefined;
        this.contentHostUnsubscribe?.();
        this.contentHostUnsubscribe = undefined;
        this.sharedStateUnsubscribe?.();
        this.sharedStateUnsubscribe = undefined;
        this.portDeliveryUnsubscribe?.();
        this.portDeliveryUnsubscribe = undefined;
        this.closePendingPort();
        void api.disposeBoardPort(this.boardId);

        const iframe = this.iframe;
        this.iframe = undefined;
        if (iframe) {
            boardNavigationReturnService.releaseBoardFrame(this.props.model, iframe, this.tabId);
            const ownsFrame = this.props.model.frames.get(this.tabId) === iframe;
            this.props.model.clearIframe(iframe, this.tabId);
            if (ownsFrame) void api.unregisterBoardFrame(this.props.model.id, this.tabId, this.boardId);
            iframe.remove();
        }
        const registeredHost = this.registeredHost;
        this.registeredHost = null;
        this.host = null;
        if (registeredHost) void api.unregisterBoard(registeredHost);
    }

    private async registerBoard(): Promise<void> {
        const { boardRoot } = this.props;
        const h = await api.registerBoard(boardRoot, computeBoardThemePalette(), BOARD_TOKEN_VARS);
        if (!this.live) {
            void api.unregisterBoard(h);
            return;
        }
        if (this.isMain) {
            await fs.write(fpJoin(boardRoot, "ui.log"), this.logLine("info", "board loaded")).catch(() => {});
        }
        if (!this.live) {
            void api.unregisterBoard(h);
            return;
        }
        this.registeredHost = h;
        this.host = h;
        this.createIframe();
        this.startHostResources();
    }

    private createIframe(): void {
        const host = this.host;
        if (!host || this.iframe) return;
        const { entry = "index.html", view = "main" } = this.props;
        const iframe = document.createElement("iframe");
        iframe.title = "board";
        iframe.allow = "clipboard-read; clipboard-write";
        iframe.src = `board://${host}/${entry}?v=${this.boardId}&view=${encodeURIComponent(view)}`;
        iframe.style.flex = "1";
        iframe.style.width = "100%";
        iframe.style.border = "none";
        iframe.style.backgroundColor = color.background.default;
        this.iframe = iframe;
        this.props.model.setIframe(iframe, this.tabId);
        this.props.model.setAiVisionTransport(this.tabId, iframe, this.generation, this.requestAiVision);
        this.listen(iframe, "load", this.handleLoad);
        this.listen(iframe, "error", this.handleFrameError);
        window.addEventListener("message", this.handleMessage);
        this.ownSubscription(() => window.removeEventListener("message", this.handleMessage));
        this.root.append(iframe);
        if (this.isMain) {
            const focusSubscription = pagesModel.onFocus.subscribe((pageModel) => {
                if (!this.live || pageModel !== this.props.model.page) return;
                if (this.focusTimer !== undefined) clearTimeout(this.focusTimer);
                this.focusTimer = setTimeout(() => {
                    this.focusTimer = undefined;
                    if (this.live) this.focusFrame();
                }, 200);
            });
            this.focusUnsubscribe = this.ownSubscription(focusSubscription);
        }
    }

    private startHostResources(): void {
        const host = this.host;
        if (!host) return;
        const model = this.props.model;
        this.portDeliveryUnsubscribe = this.ownSubscription(api.onBoardPort((boardId, port) => {
            // `onBoardPort` is a GLOBAL ipcRenderer subscription (`ipc/renderer/api.ts:422`):
            // every mounted board frame's callback receives every board's port, and `boardId`
            // is the only filter. So a port that is not ours belongs to another live frame —
            // ignore it and leave it alone. Closing it here would destroy that frame's bridge
            // before it could transfer the port, and the failure is silent on this side: the
            // victim's shim never posts `connected`, so main's watchdog reports "board bridge
            // did not connect". Test the ownership check BEFORE the liveness check, so a
            // disposed view only ever closes a port addressed to itself.
            if (boardId !== this.boardId) return;
            if (!this.live) {
                port.close();
                return;
            }
            this.closePendingPort();
            this.pendingPort = port;
            this.transferPort();
        }));

        const contentHost = model.contentHost;
        if (contentHost) {
            this.contentHostUnsubscribe = this.ownSubscription(contentHost.state.subscribe(
                (content) => {
                    if (!this.live || content === this.lastBoardContent) return;
                    const frame = this.iframe;
                    if (!frame || !this.host) return;
                    const message: BoardHostContentMsg = {
                        __persephone: "host:content",
                        content: content as string,
                        language: contentHost.state.get().language,
                    };
                    frame.contentWindow?.postMessage(message, `board://${this.host}`);
                },
                (state) => state.content,
            ));
        }

        this.sharedStateUnsubscribe = this.ownSubscription(model.state.subscribe(
            (sharedState) => {
                if (!this.live || !this.host) return;
                const frame = this.iframe;
                if (!frame) return;
                const message: BoardStateSyncMsg = {
                    __persephone: "state:sync",
                    state: (sharedState as Record<string, unknown>) ?? {},
                    seq: model.sharedStateSeq,
                };
                frame.contentWindow?.postMessage(message, `board://${this.host}`);
            },
            (state) => state.sharedState,
        ));
    }

    private transferPort(): void {
        const host = this.host;
        const frame = this.iframe;
        const port = this.pendingPort;
        if (!this.live || !host || !frame || !port) return;
        const filePath = this.props.model.currentFilePath();
        const pageId = this.props.model.page?.id;
        const pipeUrlEnabled = this.props.model.pipeUrlEnabled;
        if (pageId) void api.registerBoardPipePage(pageId, host);
        const init: BoardPortInitMsg = {
            __persephoneInit: true,
            busy: !!this.props.model.state.get().busy,
            pageId,
            pipeUrlEnabled,
            filePath,
            folderPath: this.props.model.folderPath,
            contentHost: !!this.props.model.contentHost,
            materialize: !!filePath && !isPlainLocalPath(filePath) && !this.props.model.isStreamHost,
            intent: this.props.model.peekInitialIntent(),
        };
        const contentWindow = frame.contentWindow;
        if (!contentWindow) return;
        const intent = this.props.model.peekInitialIntent();
        if (intent) this.initialIntentIds.add(intent.requestId);
        try {
            contentWindow.postMessage(init, `board://${host}`, [port]);
            this.props.model.consumeInitialIntent();
            this.pendingPort = null;
        } catch (error: unknown) {
            this.rejectPendingCapability("crashed", errMessage(error, "The board handshake failed."), false);
            this.closePendingPort();
        }
    }

    private readonly handleLoad = (): void => {
        const host = this.host;
        const frame = this.iframe;
        if (!this.live || !host || !frame) return;
        const retiredGeneration = this.generation;
        this.props.model.clearToolbarControlsForFrame(retiredGeneration);
        if (this.isMain) this.props.model.clearToolbarTextForFrame(retiredGeneration);
        this.props.onToolbarClear?.(retiredGeneration);
        boardNavigationReturnService.resetBoardFrame(this.props.model, frame, this.tabId);
        this.generation++;
        this.props.model.setAiVisionTransport(this.tabId, frame, this.generation, this.requestAiVision);
        if (this.capabilityFrame?.iframe === frame) {
            this.rejectPendingCapability("crashed", "The board frame was reloaded.", false);
            this.unregisterCapabilityFrame();
        }
        const generation = this.generation;
        const model = this.props.model;
        const initialIntent = model.peekInitialIntent();
        if (initialIntent) this.initialIntentIds.add(initialIntent.requestId);
        if (this.isMain && model.page?.id && frame.contentWindow) {
            this.capabilityFrame = {
                boardRoot: this.props.boardRoot,
                pageId: model.page.id,
                generation,
                iframe: frame,
                contentWindow: frame.contentWindow,
                dispatch: this.dispatchCapabilityIntent,
                cancel: this.cancelCapabilityIntent,
            };
            registerBoardCapabilityFrame(this.capabilityFrame);
        }
        const contentHost = model.contentHost;
        const win = frame.contentWindow;
        if (contentHost && win) {
            const { content, language } = contentHost.state.get();
            this.lastBoardContent = undefined;
            const message: BoardHostContentMsg = { __persephone: "host:content", content, language };
            win.postMessage(message, `board://${host}`);
        }
        void api.requestBoardPort(this.boardId, host, model.id);
        void api.registerBoardFrame(model.id, host, this.boardId, this.tabId).then(() => {
            if (this.live && generation === this.generation) model.markFrameLoaded(this.tabId);
            else if (model.frames.get(this.tabId) === frame) {
                void api.unregisterBoardFrame(model.id, this.tabId, this.boardId);
            }
        }).catch((error: unknown) => {
            if (this.live && generation === this.generation) {
                this.rejectPendingCapability("crashed", errMessage(error, "The board frame failed to register."), false);
                this.unregisterCapabilityFrame();
            }
        });

        if (win) {
            const message: BoardStateSyncMsg = {
                __persephone: "state:sync",
                state: model.state.get().sharedState ?? {},
                seq: model.sharedStateSeq,
            };
            win.postMessage(message, `board://${host}`);
        }
        if (this.isMain) this.focusFrame();
    };

    private readonly handleMessage = (event: MessageEvent): void => {
        const host = this.host;
        const frame = this.iframe;
        if (!this.live || !host || !frame) return;
        const data = event.data as BoardToHostMsg | BoardAiVisionRegistrationMsg | BoardAiVisionNotifyMsg
            | BoardAiVisionResultMsg | BoardCapabilityIntentResultMsg | BoardCapabilityListRequestMsg
            | BoardCapabilityInvokeRequestMsg | BoardNavigationCreateReturnUrlMsg
            | BoardToolbarSetMsg | BoardToolbarUpdateMsg | undefined;
        if (!data?.__persephone || event.origin !== `board://${host}`
            || event.source !== frame.contentWindow) return;

        const model = this.props.model;
        const legacy = data as BoardToHostMsg & {
            message?: string; level?: string; busy?: boolean; content?: string;
            state?: Record<string, unknown>; partial?: Record<string, unknown>;
            defaults?: Record<string, unknown>; restorableKeys?: string[]; views?: unknown;
            statusText?: string; toolbarText?: string; direction?: 1 | -1; reqId?: number;
            varMethod?: "get" | "set" | "list" | "show"; varArgs?: unknown[];
            openContent?: BoardOpenContentRequest;
            controls?: unknown;
        };
        switch (data.__persephone) {
            case "board:interact":
                // The shim posts this on every capture-phase pointerdown inside the board.
                // It must dismiss host overlays through the shared helper: dispatching a
                // `mousedown` here stopped working when PopoverView moved to `pointerdown`
                // (US-1286 converted the browser guest and the HTML iframe, and missed this
                // third frame — the menu stayed open over the board being clicked).
                dismissOverlays();
                break;
            case "board:error":
                if (legacy.message) this.appendLog("error", legacy.message);
                break;
            case "board:log":
                if (legacy.message) this.appendLog(legacy.level === "warn" ? "warn" : "error", legacy.message);
                break;
            case "board:busy":
                model.setBusy(!!legacy.busy);
                break;
            case "board:setContent": {
                const content = typeof legacy.content === "string" ? legacy.content : "";
                this.lastBoardContent = content;
                (model as BoardContentEditorModel).hostChangeContent?.(content);
                break;
            }
            case "board:save":
                (model as BoardContentEditorModel).hostSave?.();
                break;
            case "board:setState":
                model.setSharedState(legacy.state ?? {});
                break;
            case "board:mergeState":
                model.mergeSharedState(legacy.partial ?? {});
                break;
            case "board:stateInit":
                model.initSharedState(legacy.defaults ?? {}, legacy.restorableKeys);
                break;
            case "board:setSecondaryViews":
                model.setSecondaryViews(legacy.views);
                break;
            case "board:setToolbarControls": {
                if (!this.isMain || model.frames.get(BOARD_CDP_TAB) !== frame || !isBoardPermitted(this.props.boardRoot)) {
                    this.appendLog("warn", "Ignored board toolbar controls from a non-main or unavailable frame.");
                    break;
                }
                const controls = normalizeToolbarControlSet(legacy.controls, (message) => this.appendLog("warn", message));
                this.props.onToolbarSet?.(controls, this.generation, (message) => this.appendLog("warn", message));
                break;
            }
            case "board:updateToolbarControls": {
                if (!this.isMain || model.frames.get(BOARD_CDP_TAB) !== frame || !isBoardPermitted(this.props.boardRoot)) {
                    this.appendLog("warn", "Ignored board toolbar update from a non-main or unavailable frame.");
                    break;
                }
                const patches = normalizeToolbarControlPatches(legacy.controls, (message) => this.appendLog("warn", message));
                this.props.onToolbarUpdate?.(patches, (message) => this.appendLog("warn", message));
                break;
            }
            case "board:setStatusText":
                if (this.isMain) model.setStatusText(typeof legacy.statusText === "string" ? legacy.statusText : "");
                break;
            case "board:setToolbarText":
                if (!this.isMain || model.frames.get(BOARD_CDP_TAB) !== frame || !isBoardPermitted(this.props.boardRoot)) {
                    this.appendLog("warn", "Ignored board toolbar text from a non-main or unavailable frame.");
                    break;
                }
                model.setToolbarTextForFrame(
                    this.generation,
                    typeof legacy.toolbarText === "string" ? legacy.toolbarText : "",
                );
                break;
            case "board:cycleTheme":
                cycleAppTheme(legacy.direction === 1 ? 1 : -1);
                break;
            case "board:aiVision":
                this.handleAiVisionRegistration(data as BoardAiVisionRegistrationMsg, model, frame);
                break;
            case "board:aiNotify":
                this.handleAiVisionNotify(data as BoardAiVisionNotifyMsg, model, frame);
                break;
            case "board:aiResult":
                this.handleAiVisionResult(data as BoardAiVisionResultMsg, frame);
                break;
            case "capabilities:intent:result":
                this.handleCapabilityResult(data as BoardCapabilityIntentResultMsg, frame);
                break;
            case "board:capabilities:list":
                void this.resolveCapabilityList(data as BoardCapabilityListRequestMsg, frame, host);
                break;
            case "board:capabilities:invoke":
                void this.resolveCapabilityInvoke(data as BoardCapabilityInvokeRequestMsg, model, frame, host);
                break;
            case "board:filePath":
                if (typeof legacy.reqId === "number") void this.resolveFilePath(legacy.reqId, model, host, frame);
                break;
            case "board:openContent":
                if (typeof legacy.reqId === "number") {
                    this.resolveOpenContent(legacy.reqId, legacy.openContent, host, frame);
                }
                break;
            case "navigation:createReturnUrl":
                if (typeof data.reqId === "number") {
                    this.resolveNavigationReturnUrl(data as BoardNavigationCreateReturnUrlMsg, model, host, frame);
                }
                break;
            case "board:var":
                if (typeof legacy.reqId === "number") {
                    void this.resolveVariable(
                        legacy.reqId,
                        legacy.varMethod as "get" | "set" | "list" | "show",
                        Array.isArray(legacy.varArgs) ? legacy.varArgs : [],
                        model,
                        host,
                        frame,
                    );
                }
                break;
        }
    };

    /** Deliver one catalog interaction to the current main board frame. */
    public sendToolbarControl(event: ToolbarAction): void {
        const host = this.host;
        const frame = this.iframe;
        const contentWindow = frame?.contentWindow;
        const model = this.props.model;
        if (!this.live || !this.isMain || !host || !frame || !contentWindow
            || model.frames.get(BOARD_CDP_TAB) !== frame
            || !isBoardPermitted(this.props.boardRoot)) return;
        const message: BoardToolbarControlEventMsg = {
            __persephone: "toolbar:control",
            id: event.id,
            type: event.type,
            ...(event.type !== "button" && event.value !== undefined ? { value: event.value } : {}),
        };
        try {
            contentWindow.postMessage(message, `board://${host}`);
        } catch {
            // The frame may be replaced while the control event is posted.
        }
    }

    private handleAiVisionRegistration(
        message: BoardAiVisionRegistrationMsg,
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
    ): void {
        if (!this.isMain || model.frames.get(BOARD_CDP_TAB) !== frame
            || !isBoardPermitted(this.props.boardRoot)
            || !isAiVisionShape(message.shape)
            || !isSchemaMajorOne(message.schemaVersion)
            || !isSchemaMajorOne(message.shape.schemaVersion)) {
            this.appendLog("warn", "Ignored invalid or untrusted AiVision registration.");
            return;
        }
        // A refresh is the SAME remote re-publishing its structure (the board added its first
        // item, so an indexed member finally has an item shape). The handlers behind the frame
        // are unchanged, so a request already on the wire — very often the very call that
        // triggered the refresh — must be allowed to complete. Only a new remote invalidates.
        const reason = message.reason === "refresh" ? "refresh" : "register";
        if (reason !== "refresh") {
            this.rejectPendingAiVision(new Error("Board AiVision registration was replaced."));
        }
        warnUnknownAiVisionViews(message.shape, model, (warning) => this.appendLog("warn", warning));
        const accepted = model.setAiVisionRegistration(
            message.shape,
            frame,
            this.generation,
            this.requestAiVision,
            (warning) => this.appendLog("warn", warning),
            reason,
        );
        const pageId = model.page?.id;
        if (accepted && pageId && reason === "refresh") logShapeChanged(pageId);
        if (accepted && reason === "register" && model.consumeReloadRegistration() && pageId) {
            logBoardReloaded(pageId);
        }
    }

    private handleAiVisionNotify(
        message: BoardAiVisionNotifyMsg,
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
    ): void {
        if (!this.isMain || model.frames.get(BOARD_CDP_TAB) !== frame
            || !isBoardPermitted(this.props.boardRoot)
            || typeof message.text !== "string") return;
        const pageId = model.page?.id;
        if (!pageId) return;
        const normalizedText = message.text.replace(/\s+/g, " ").trim();
        if (!normalizedText) return;
        const text = normalizedText.length > 512
            ? `${normalizedText.slice(0, 509)}...`
            : normalizedText;
        if (!acceptBoardNotify(Date.now())) return;
        const path = `pages[${JSON.stringify(pageId)}].editor.app`;
        logRemoteNotify(text, path, "board");
    }

    private readonly requestAiVision = (
        request: IAiRemoteRequest,
        timeoutMs: number,
        timeoutError: Error,
    ): Promise<IAiRemoteResponse> => {
        const host = this.host;
        const frame = this.iframe;
        const contentWindow = frame?.contentWindow;
        if (!this.live || !host || !frame || !contentWindow
            || this.props.model.frames.get(this.tabId) !== frame
            || !isBoardPermitted(this.props.boardRoot)) {
            return Promise.reject(new Error("The board frame is unavailable or untrusted."));
        }
        const generation = this.generation;
        const reqId = ++this.aiVisionRequestId;
        return new Promise<IAiRemoteResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingAiVision.delete(reqId);
                reject(timeoutError);
            }, timeoutMs);
            this.pendingAiVision.set(reqId, { resolve, reject, timer, generation, iframe: frame, contentWindow });
            const message: BoardAiVisionRequestMsg = { __persephone: "ai:request", reqId, request };
            try {
                contentWindow.postMessage(message, `board://${host}`);
            } catch (error) {
                clearTimeout(timer);
                this.pendingAiVision.delete(reqId);
                reject(new Error(errMessage(error, "The board frame is unavailable.")));
            }
        });
    };

    private handleAiVisionResult(message: BoardAiVisionResultMsg, frame: HTMLIFrameElement): void {
        const pending = this.pendingAiVision.get(message.reqId);
        if (!pending || pending.generation !== this.generation || pending.iframe !== frame
            || pending.contentWindow !== frame.contentWindow) return;
        this.pendingAiVision.delete(message.reqId);
        clearTimeout(pending.timer);
        pending.resolve(message.response);
    }

    private rejectPendingAiVision(error: Error): void {
        for (const pending of this.pendingAiVision.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingAiVision.clear();
    }

    private readonly dispatchCapabilityIntent = (request: IntentRequest): Promise<unknown> => {
        const host = this.host;
        const frame = this.iframe;
        const contentWindow = frame?.contentWindow;
        if (!this.live || !host || !frame || !contentWindow || !this.isMain
            || this.props.model.frames.get(BOARD_CDP_TAB) !== frame
            || !isBoardPermitted(this.props.boardRoot)) {
            return Promise.reject(new BoardCapabilityTransportError(
                "handler-closed",
                "The board frame is unavailable or untrusted.",
            ));
        }
        if (this.pendingCapability.has(request.requestId)) {
            return Promise.reject(new BoardCapabilityTransportError(
                "rejected",
                `Capability request ${request.requestId} was dispatched twice.`,
            ));
        }
        const generation = this.generation;
        const initial = this.initialIntentIds.delete(request.requestId);
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.settleCapability(request.requestId, new BoardCapabilityTransportError(
                    "timeout",
                    "The capability request deadline elapsed.",
                ), true);
            }, Math.max(0, request.deadlineAt - Date.now()));
            this.pendingCapability.set(request.requestId, {
                resolve,
                reject,
                timer,
                generation,
                iframe: frame,
                contentWindow,
            });
            if (initial) return;
            const message: BoardCapabilityIntentRequestMsg = {
                __persephone: "capabilities:intent",
                requestId: request.requestId,
                id: request.id,
                ...(request.version === undefined ? {} : { version: request.version }),
                payload: request.payload,
            };
            try {
                contentWindow.postMessage(message, `board://${host}`);
            } catch (error: unknown) {
                this.settleCapability(request.requestId, new BoardCapabilityTransportError(
                    isDataCloneError(error) ? "rejected" : "crashed",
                    errMessage(
                        error,
                        isDataCloneError(error)
                            ? "The capability payload could not be cloned."
                            : "The board frame is unavailable.",
                    ),
                ), false);
            }
        });
    };

    private readonly cancelCapabilityIntent = (requestId: string): void => {
        const pending = this.pendingCapability.get(requestId);
        try {
            if (pending) {
                pending.contentWindow.postMessage(
                    { __persephone: "capabilities:intent:cancel", requestId } as BoardCapabilityIntentCancelMsg,
                    this.host ? `board://${this.host}` : "*",
                );
            }
        } catch {
            // Cancellation is deliberately best-effort during teardown.
        }
        if (pending) {
            this.settleCapability(requestId, new BoardCapabilityTransportError(
                "cancelled",
                "The capability request was cancelled.",
            ), false);
        }
    };

    private handleCapabilityResult(message: BoardCapabilityIntentResultMsg, frame: HTMLIFrameElement): void {
        const pending = this.pendingCapability.get(message.requestId);
        if (!pending || pending.generation !== this.generation || pending.iframe !== frame
            || pending.contentWindow !== frame.contentWindow) return;
        if (message.error) {
            this.settleCapability(message.requestId, new BoardCapabilityTransportError(
                isCapabilityErrorCode(message.error.code) ? message.error.code : "rejected",
                message.error.message,
            ), false);
        } else {
            this.settleCapability(message.requestId, undefined, false, message.result);
        }
    }

    private settleCapability(
        requestId: string,
        error: BoardCapabilityTransportError | undefined,
        sendCancel: boolean,
        result?: unknown,
    ): void {
        const pending = this.pendingCapability.get(requestId);
        if (!pending) return;
        this.pendingCapability.delete(requestId);
        clearTimeout(pending.timer);
        if (sendCancel) {
            try {
                pending.contentWindow.postMessage(
                    { __persephone: "capabilities:intent:cancel", requestId } as BoardCapabilityIntentCancelMsg,
                    this.host ? `board://${this.host}` : "*",
                );
            } catch {
                // Teardown may have already removed the content window.
            }
        }
        if (error) pending.reject(error);
        else pending.resolve(result);
    }

    private rejectPendingCapability(
        code: CapabilityErrorCode,
        message: string,
        sendCancel: boolean,
    ): void {
        for (const requestId of [...this.pendingCapability.keys()]) {
            this.settleCapability(requestId, new BoardCapabilityTransportError(code, message), sendCancel);
        }
    }

    private unregisterCapabilityFrame(): void {
        if (!this.capabilityFrame) return;
        unregisterBoardCapabilityFrame(this.capabilityFrame.pageId, this.capabilityFrame);
        this.capabilityFrame = undefined;
    }

    private readonly handleFrameError = (): void => {
        if (this.isMain) this.props.model.clearToolbarTextForFrame(this.generation);
        this.rejectPendingCapability("crashed", "The board frame failed to load.", false);
        this.unregisterCapabilityFrame();
    };

    private async resolveCapabilityList(
        message: BoardCapabilityListRequestMsg,
        frame: HTMLIFrameElement,
        host: string,
    ): Promise<void> {
        let reply: BoardCapabilityListResultMsg;
        try {
            if (!isBoardPermitted(this.props.boardRoot)) {
                throw new BoardCapabilityTransportError(
                    "untrusted",
                    "The board is no longer trusted.",
                );
            }
            reply = { __persephone: "capabilities:list:result", reqId: message.reqId, result: app.capabilities.list() };
        } catch (error: unknown) {
            reply = {
                __persephone: "capabilities:list:result",
                reqId: message.reqId,
                error: capabilityError(error),
            };
        }
        if (!this.live || frame !== this.iframe || !frame.contentWindow) return;
        try { frame.contentWindow.postMessage(reply, `board://${host}`); } catch { /* frame teardown */ }
    }

    private async resolveCapabilityInvoke(
        message: BoardCapabilityInvokeRequestMsg,
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
        host: string,
    ): Promise<void> {
        let reply: BoardCapabilityInvokeResultMsg;
        try {
            if (!isBoardPermitted(this.props.boardRoot)) {
                throw new BoardCapabilityTransportError(
                    "untrusted",
                    "The board is no longer trusted.",
                );
            }
            const result = await app.capabilities.invoke(message.id, message.payload, {
                ...(message.version === undefined ? {} : { version: message.version }),
                pageId: model.page?.id,
                deadlineMs: message.deadlineMs,
            });
            // The public capability result carries its page id inside the declared result.
            // Board-originated calls retain the bridge's top-level pageId/result envelope.
            // Conversion failures have no page id, so they remain a plain public result.
            const publicResult = result as { pageId?: unknown } | null | undefined;
            const hasPageId = !!publicResult && typeof publicResult === "object"
                && typeof publicResult.pageId === "string";
            if (hasPageId) {
                const { pageId, ...handlerResult } = publicResult as Record<string, unknown>;
                const hasHandlerResult = Object.keys(handlerResult).length > 0;
                reply = {
                    __persephone: "capabilities:invoke:result",
                    reqId: message.reqId,
                    pageId: pageId as string,
                    ...(hasHandlerResult ? { result: handlerResult } : {}),
                };
            } else {
                reply = { __persephone: "capabilities:invoke:result", reqId: message.reqId, result };
            }
        } catch (error: unknown) {
            reply = {
                __persephone: "capabilities:invoke:result",
                reqId: message.reqId,
                error: capabilityError(error),
            };
        }
        if (!this.live || frame !== this.iframe || !frame.contentWindow) return;
        try { frame.contentWindow.postMessage(reply, `board://${host}`); } catch { /* frame teardown */ }
    }

    private async resolveFilePath(
        reqId: number,
        model: BoardEditorModel,
        host: string,
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        let reply: { path?: string; error?: string };
        try {
            reply = { path: await model.ensureContentPath() };
        } catch (error: unknown) {
            const message = errMessage(error);
            if (isProviderResolutionError(error)) ui.notify(message, "error");
            reply = { error: message };
        }
        if (!this.live || generation !== this.generation || this.iframe !== frame || !frame.contentWindow) return;
        const message: BoardFilePathResultMsg = {
            __persephone: "filePath:result", reqId, path: reply.path, error: reply.error,
        };
        frame.contentWindow.postMessage(message, `board://${host}`);
    }

    private resolveNavigationReturnUrl(
        request: BoardNavigationCreateReturnUrlMsg,
        model: BoardEditorModel,
        host: string,
        frame: HTMLIFrameElement,
    ): void {
        const generation = this.generation;
        let reply: BoardNavigationReturnUrlResultMsg;
        try {
            if (!isBoardPermitted(this.props.boardRoot)) {
                throw new Error("This board is not trusted.");
            }
            if (model.frames.get(this.tabId) !== frame || !frame.contentWindow) {
                throw new Error("The board frame is unavailable.");
            }
            const url = boardNavigationReturnService.createBoardClaim({
                pageId: model.page?.id,
                model,
                frame,
                tabId: this.tabId,
                targetOrigin: `board://${host}`,
                generation,
                currentGeneration: () => this.generation,
                isCurrent: () => this.live && this.iframe === frame && this.generation === generation,
            });
            reply = { __persephone: "navigation:returnUrl", reqId: request.reqId, url };
        } catch (error: unknown) {
            reply = {
                __persephone: "navigation:returnUrl",
                reqId: request.reqId,
                error: errMessage(error, "The navigation return URL could not be created."),
            };
        }
        if (!this.live || this.iframe !== frame || !frame.contentWindow) return;
        try {
            frame.contentWindow.postMessage(reply, `board://${host}`);
        } catch {
            // The frame may have been replaced while the reply was being posted.
        }
    }

    /**
     * `persephone.openContent(...)` (US-1404) — create an in-memory page in another editor and hand
     * the board back its page id. Trust is re-checked here, like every board-initiated effect, so
     * revoking trust blocks an already-mounted board. Synchronous work, but the reply is posted the
     * same way as the other request/reply resolvers.
     */
    private resolveOpenContent(
        reqId: number,
        request: BoardOpenContentRequest | undefined,
        host: string,
        frame: HTMLIFrameElement,
    ): void {
        const generation = this.generation;
        const reply = isBoardPermitted(this.props.boardRoot)
            ? resolveBoardOpenContent(request)
            : { error: "This board is not trusted." };
        if (!this.live || generation !== this.generation || this.iframe !== frame || !frame.contentWindow) return;
        const message: BoardOpenContentResultMsg = {
            __persephone: "openContent:result", reqId, pageId: reply.pageId, error: reply.error,
        };
        frame.contentWindow.postMessage(message, `board://${host}`);
    }

    private async resolveVariable(
        reqId: number,
        method: "get" | "set" | "list" | "show",
        args: unknown[],
        model: BoardEditorModel,
        host: string,
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        let reply: { result?: unknown; error?: string };
        try {
            const namespace = await resolveBoardNamespace(this.props.boardRoot);
            reply = await resolveBoardVarRequest(namespace, method, args);
        } catch (error) {
            reply = { error: errMessage(error) };
        }
        if (!this.live || generation !== this.generation || this.iframe !== frame || !frame.contentWindow) return;
        const message: BoardVarResultMsg = {
            __persephone: "var:result", reqId, result: reply.result, error: reply.error,
        };
        frame.contentWindow.postMessage(message, `board://${host}`);
    }

    private focusFrame(): void {
        if (!isFocusInSidebar()) this.iframe?.contentWindow?.focus();
    }

    private appendLog(level: string, message: string): void {
        void fs.append(fpJoin(this.props.boardRoot, "ui.log"), this.logLine(level, message)).catch(() => {});
    }

    private logLine(level: string, message: string): string {
        return `[${new Date().toISOString()}] [${level}] ${message}\n`;
    }

    private closePendingPort(): void {
        this.pendingPort?.close();
        this.pendingPort = null;
    }
}

function isSchemaMajorOne(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Math.floor(value) === 1;
}

function isAiVisionShape(value: unknown): value is IAiVisionShape {
    if (!value || typeof value !== "object") return false;
    const shape = value as { schemaVersion?: unknown; root?: unknown };
    if (!isSchemaMajorOne(shape.schemaVersion) || !shape.root || typeof shape.root !== "object") return false;
    const root = shape.root as { kind?: unknown; summary?: unknown; members?: unknown };
    return typeof root.kind === "string" && typeof root.summary === "string" && Array.isArray(root.members);
}

function warnUnknownAiVisionViews(
    shape: IAiVisionShape,
    model: BoardEditorModel,
    warning: (message: string) => void,
): void {
    const knownViews = new Set((model.state.get().secondaryViewDefs ?? []).map((view) => view.id));
    const visited = new Set<object>();
    const visit = (node: IAiVisionShape["root"]): void => {
        if (visited.has(node)) return;
        visited.add(node);
        for (const element of node.elements ?? []) {
            const view = (element as IAiElementWithView).view;
            if (view !== undefined && (typeof view !== "string" || (view !== "main" && !knownViews.has(view)))) {
                warning(`Unknown AiVision element view ${JSON.stringify(view)} for ${JSON.stringify(element.name)}.`);
            }
        }
        for (const member of node.members) {
            if (member.node) visit(member.node);
            if (member.item) visit(member.item);
        }
        if (node.item) visit(node.item);
    };
    visit(shape.root);
}

interface IAiElementWithView {
    readonly view?: unknown;
}

function isCapabilityErrorCode(value: string): value is CapabilityErrorCode {
    return value === "no-handler" || value === "untrusted" || value === "handler-closed"
        || value === "crashed" || value === "cancelled" || value === "timeout"
        || value === "cycle" || value === "payload-too-large" || value === "busy"
        || value === "rejected";
}

function capabilityError(error: unknown): { code: string; message: string } {
    const value = error as { code?: unknown } | null;
    const code = typeof value?.code === "string" ? value.code : "rejected";
    return { code, message: errMessage(error, "The capability request failed.") };
}
