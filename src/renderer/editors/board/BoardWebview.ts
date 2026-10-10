import color from "../../theme/color";
import { api } from "../../../ipc/renderer/api";
import { fpNormalizeForCompare, isPlainLocalPath } from "../../core/utils/file-path";
import { pagesModel } from "../../api/pages";
import { isFocusInSidebar } from "../../core/utils/focus-utils";
import type {
    BoardFetchRequestMsg,
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
    BoardContentOpenRequestMsg,
    BoardContentOpenResultMsg,
    BoardFileIconsResultMsg,
    BoardFilePathResultMsg,
    BoardHostContentMsg,
    BoardSourceOpenedMsg,
    BoardOpenContentRequest,
    BoardOpenContentResultMsg,
    BoardPageStateGetRequestMsg,
    BoardPageStateSetRequestMsg,
    BoardPageStateRemoveRequestMsg,
    BoardNavigationCreateReturnUrlMsg,
    BoardNavigationReturnUrlResultMsg,
    BoardPortInitMsg,
    BoardStateSyncMsg,
    BoardSettingsChangedMsg,
    BoardSettingsResultMsg,
    BoardToolbarControlEventMsg,
    BoardToolbarControlPatch,
    BoardStatusBarActionMsg,
    BoardStatusBarPatch,
    BoardToHostMsg,
    BoardHostFrameMsg,
    BoardSaveResultMsg,
    BoardVarResultMsg,
} from "../../../ipc/board-bridge-channels";
import { isCapabilityErrorCode, type CapabilityErrorCode, type CapabilityOutcome, type IntentRequest } from "../../../ipc/capability-bus-channels";
import { resolveBoardNamespace } from "../../api/board-namespace";
import { resolveBoardVarRequest } from "../../api/board-vars/board-vars-bridge";
import { t } from "../../../shared/i18n/t";
import {
    resolveBoardSettingsRequest,
    subscribeBoardSettings,
} from "../../api/board-settings/board-settings-bridge";
import { resolveBoardOpenContent } from "./board-open-content";
import { BoardFetchBridge } from "./board-fetch";
import { resolveBoardFileIcons } from "./board-file-icons";
import { cycleAppTheme } from "../../api/cycle-app-theme";
import { BOARD_CDP_TAB, type BoardLogLevel } from "../../../ipc/api-types";
import { BOARD_TOKEN_VARS, computeBoardThemePalette, ensureBoardThemeSubscription } from "./board-theme";
import { boardSecondaryPanelId } from "./board-secondary";
import type { BoardEditorModel } from "./BoardEditorModel";
import type { BoardContentEditorModel } from "./BoardContentEditorModel";
import type { IAiRemoteRequest, IAiRemoteResponse, IAiVisionShape } from "ai-vision";
import { isBoardPermitted, subscribeBoardPermission } from "./board-access";
import { boardTrust, pathCovers } from "../../api/board-trust";
import type { NormalizedBoardPermissions } from "../../../shared/board-manifest-utils";
import { boardPermissionError } from "../../../shared/board-manifest-utils";
import { getPreviewGeneration } from "../../theme/themes";
import { errMessage } from "../../../shared/utils";
import { CapabilityError } from "../../api/capability-bus";
import { invokeCapabilityOutcome } from "../../api/capabilities";
import { ui } from "../../api/ui";
import { isProviderResolutionError } from "../../content/registry";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { dismissOverlays } from "../../uikit/shared/overlayLayer";
import "../../uikit/Panel/Panel.css";
import { logBoardReloaded, logRemoteNotify, logShapeChanged } from "../../scripting/ai-vision/event-log";
import {
    registerBoardCapabilityFrame,
    unregisterBoardCapabilityFrame,
    markBoardCapabilityFrameReady,
    failBoardCapabilityFrame,
    takeInitialIntent,
    type BoardCapabilityFrame,
} from "../../api/board-capability-transport";
import { app } from "../../api/app";
import { boardNavigationReturnService } from "../../api/board-navigation-return";
import {
    normalizeToolbarControlPatches,
    normalizeToolbarControlSet,
    type ToolbarAction,
} from "./BoardToolbarControls";
import { normalizeBoardStatusBarPatches, normalizeBoardStatusBarSet } from "./BoardStatusBarItems";

export interface BoardWebviewProps {
    model: BoardEditorModel;
    boardRoot: string;
    entry?: string;
    view?: string;
    isMain?: boolean;
    onToolbarSet?: (controls: readonly import("../../../ipc/board-bridge-channels").BoardToolbarControlDescriptor[], frameGeneration: number, warning: (message: string) => void) => void;
    onToolbarUpdate?: (patches: readonly BoardToolbarControlPatch[], warning: (message: string) => void) => void;
    onToolbarClear?: (frameGeneration: number) => void;
    onStatusBarSet?: (items: readonly import("../../../ipc/board-bridge-channels").BoardStatusBarItem[], frameGeneration: number, warning: (message: string) => void) => void;
    onStatusBarUpdate?: (patches: readonly BoardStatusBarPatch[], frameGeneration: number, warning: (message: string) => void) => void;
    onStatusBarClear?: (frameGeneration: number) => void;
}

type BoardToHostType = BoardToHostMsg["__persephone"];
type BoardToHostVariant<Type extends BoardToHostType> = Extract<BoardToHostMsg, { __persephone: Type }>;

type BoardMainFrameGate = {
    readonly kind: "main" | "mainTrusted" | "mainTrustedText" | "trusted";
    readonly rejectionLog?: string;
};

interface BoardMessageContext {
    readonly model: BoardEditorModel;
    readonly host: string;
    readonly frame: HTMLIFrameElement;
    readonly generation: number;
}

type BoardMessageHandlers = {
    [Type in BoardToHostType]: {
        readonly gate?: BoardMainFrameGate;
        readonly handle: (message: BoardToHostVariant<Type>, context: BoardMessageContext) => void;
    };
};

const BOARD_MESSAGE_GATES = {
    toolbarControls: {
        kind: "mainTrusted",
        rejectionLog: "Ignored board toolbar controls from a non-main or unavailable frame.",
    },
    toolbarUpdate: {
        kind: "mainTrusted",
        rejectionLog: "Ignored board toolbar update from a non-main or unavailable frame.",
    },
    toolbarText: {
        kind: "mainTrusted",
        rejectionLog: "Ignored board toolbar text from a non-main or unavailable frame.",
    },
    statusBarItems: { kind: "mainTrusted", rejectionLog: "Ignored board status-bar items from a non-main or unavailable frame." },
    statusBarUpdate: { kind: "mainTrusted", rejectionLog: "Ignored board status-bar update from a non-main or unavailable frame." },
    aiVision: {
        kind: "mainTrusted",
        rejectionLog: "Ignored invalid or untrusted AiVision registration.",
    },
    aiNotify: { kind: "mainTrustedText" },
} satisfies Record<string, BoardMainFrameGate>;

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
    private fetchBridge = new BoardFetchBridge();
    private readonly tabId: string;
    private readonly isMain: boolean;
    private host: string | null = null;
    private registeredHost: string | null = null;
    private iframeGrant: NormalizedBoardPermissions | undefined;
    private iframe: HTMLIFrameElement | undefined;
    private pendingPort: MessagePort | null = null;
    private hostedPathToken = "";
    private lastBoardContent: string | undefined;
    private live = false;
    private generation = 0;
    private hasLoaded = false;
    private portDeliveryUnsubscribe: (() => void) | undefined;
    private contentHostUnsubscribe: (() => void) | undefined;
    private sharedStateUnsubscribe: (() => void) | undefined;
    private settingsUnsubscribe: (() => void) | undefined;
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
        reject: (error: CapabilityError) => void;
        generation: number;
        iframe: HTMLIFrameElement;
        contentWindow: Window;
    }>();
    private capabilityFrame: BoardCapabilityFrame | undefined;
    private readonly pendingContentOpen = new Set<AbortController>();
    private saveHandlerId: number | undefined;
    private nextSaveRequestId = 0;
    private readonly pendingSaveRequests = new Map<number, {
        generation: number;
        resolve: (result: { success: boolean; error?: string }) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    private readonly boardMessageHandlers: BoardMessageHandlers = {
        "board:interact": { handle: () => dismissOverlays() },
        "board:error": { handle: (message) => { if (message.message) this.appendLog("error", message.message); } },
        "board:log": {
            handle: (message) => {
                if (message.message) this.appendLog(message.level === "warn" ? "warn" : "error", message.message);
            },
        },
        "board:busy": { handle: (message, current) => current.model.setBusy(!!message.busy) },
        "board:setModified": {
            gate: { kind: "mainTrusted", rejectionLog: "Ignored dirty-state update from a secondary or unavailable board frame." },
            handle: (message, current) => current.model.setBoardModified(message.modified === true),
        },
        "board:saveHandler": {
            gate: { kind: "mainTrusted", rejectionLog: "Ignored Save handler registration from a secondary or unavailable board frame." },
            handle: (message, current) => {
                if (message.registered) {
                    this.saveHandlerId = message.handlerId;
                    current.model.setSaveRequestHandler(this.boardId, current.generation, message.handlerId, (discard) => this.requestSave(current.generation, discard));
                } else if (this.saveHandlerId === message.handlerId) {
                    this.saveHandlerId = undefined;
                    current.model.clearSaveRequestHandler(this.boardId, current.generation, message.handlerId);
                }
            },
        },
        "board:saveResult": { handle: (message, current) => this.resolveSaveRequest(message, current.generation) },
        "board:setContent": {
            handle: (message, current) => {
                const content = typeof message.content === "string" ? message.content : "";
                this.lastBoardContent = content;
                (current.model as BoardContentEditorModel).hostChangeContent?.(content);
            },
        },
        "board:save": { handle: (_message, current) => (current.model as BoardContentEditorModel).hostSave?.() },
        "board:setState": { handle: (message, current) => current.model.setSharedState(message.state ?? {}) },
        "board:mergeState": { handle: (message, current) => current.model.mergeSharedState(message.partial ?? {}) },
        "board:stateInit": {
            handle: (message, current) => current.model.initSharedState(message.defaults ?? {}, message.restorableKeys),
        },
        "board:setSecondaryViews": { handle: (message, current) => current.model.setSecondaryViews(message.views) },
        "board:setStatusText": {
            gate: { kind: "main" },
            handle: (message, current) => current.model.setStatusText(typeof message.statusText === "string" ? message.statusText : ""),
        },
        "board:setToolbarText": {
            gate: BOARD_MESSAGE_GATES.toolbarText,
            handle: (message, current) => current.model.setToolbarTextForFrame(
                current.generation,
                typeof message.toolbarText === "string" ? message.toolbarText : "",
            ),
        },
        "board:setToolbarControls": {
            gate: BOARD_MESSAGE_GATES.toolbarControls,
            handle: (message) => {
                const controls = normalizeToolbarControlSet(message.controls, (warning) => this.appendLog("warn", warning));
                this.props.onToolbarSet?.(controls, this.generation, (warning) => this.appendLog("warn", warning));
            },
        },
        "board:updateToolbarControls": {
            gate: BOARD_MESSAGE_GATES.toolbarUpdate,
            handle: (message) => {
                const patches = normalizeToolbarControlPatches(message.controls, (warning) => this.appendLog("warn", warning));
                this.props.onToolbarUpdate?.(patches, (warning) => this.appendLog("warn", warning));
            },
        },
        "board:setStatusBarItems": {
            gate: BOARD_MESSAGE_GATES.statusBarItems,
            handle: (message, current) => {
                const items = normalizeBoardStatusBarSet(message.items, (warning) => this.appendLog("warn", warning));
                this.props.onStatusBarSet?.(items, current.generation, (warning) => this.appendLog("warn", warning));
            },
        },
        "board:updateStatusBarItems": {
            gate: BOARD_MESSAGE_GATES.statusBarUpdate,
            handle: (message, current) => {
                const patches = normalizeBoardStatusBarPatches(message.items, (warning) => this.appendLog("warn", warning));
                this.props.onStatusBarUpdate?.(patches, current.generation, (warning) => this.appendLog("warn", warning));
            },
        },
        "board:cycleTheme": { handle: (message) => cycleAppTheme(message.direction === 1 ? 1 : -1) },
        "board:aiVision": {
            gate: BOARD_MESSAGE_GATES.aiVision,
            handle: (message, current) => this.handleAiVisionRegistration(message, current.model, current.frame),
        },
        "board:aiNotify": {
            gate: BOARD_MESSAGE_GATES.aiNotify,
            handle: (message, current) => this.handleAiVisionNotify(message, current.model),
        },
        "board:aiResult": { handle: (message, current) => this.handleAiVisionResult(message, current.frame) },
        "capabilities:intent:result": { handle: (message, current) => this.handleCapabilityResult(message, current.frame) },
        "board:capabilities:list": { handle: (message, current) => { void this.resolveCapabilityList(message, current.frame); } },
        "board:capabilities:invoke": {
            handle: (message, current) => { void this.resolveCapabilityInvoke(message, current.model, current.frame); },
        },
        "board:filePath": {
            handle: (message, current) => {
                if (typeof message.reqId === "number") void this.resolveFilePath(message.reqId, current.model, current.frame);
            },
        },
        "board:fileIcons": {
            handle: (message, current) => {
                if (typeof message.reqId === "number") {
                    void this.resolveFileIcons(message.reqId, message.names, current.frame);
                }
            },
        },
        "board:openContent": {
            handle: (message, current) => {
                if (typeof message.reqId === "number") {
                    this.resolveOpenContent(message.reqId, message.openContent, current.frame);
                }
            },
        },
        "board:pageState:get": {
            gate: { kind: "trusted", rejectionLog: "Ignored page-state request from an untrusted board." },
            handle: (message, current) => { void this.resolvePageStateGet(message, current); },
        },
        "board:pageState:set": {
            gate: { kind: "trusted", rejectionLog: "Ignored page-state request from an untrusted board." },
            handle: (message, current) => { void this.resolvePageStateSet(message, current); },
        },
        "board:pageState:remove": {
            gate: { kind: "trusted", rejectionLog: "Ignored page-state request from an untrusted board." },
            handle: (message, current) => { void this.resolvePageStateRemove(message, current); },
        },
        "board:contentOpen": {
            handle: (message, current) => {
                if (typeof message.reqId === "number") {
                    void this.resolveContentOpen(message, current.model, current.host, current.frame);
                }
            },
        },
        "navigation:createReturnUrl": {
            handle: (message, current) => {
                if (typeof message.reqId === "number") {
                    this.resolveNavigationReturnUrl(message, current.model, current.host, current.frame);
                }
            },
        },
        "board:var": {
            handle: (message, current) => {
                if (typeof message.reqId !== "number") return;
                void this.resolveVariable(
                    message.reqId,
                    message.varMethod,
                    Array.isArray(message.varArgs) ? message.varArgs : [],
                    current.frame,
                );
            },
        },
        "board:settings": {
            handle: (message, current) => {
                if (typeof message.reqId !== "number") return;
                void this.resolveSettings(
                    message.reqId,
                    message.settingsMethod ?? "get",
                    Array.isArray(message.settingsArgs) ? message.settingsArgs : [],
                    current.frame,
                );
            },
        },
        "board:fetch": {
            gate: { kind: "trusted", rejectionLog: "persephone.fetch requires a trusted board" },
            handle: (message, current) => this.fetchBridge.start(
                message as BoardFetchRequestMsg,
                this.props.boardRoot,
                current.frame,
                current.generation,
                (frame, generation, reply, transfer) => this.replyToFrame(frame, generation, reply, transfer),
            ),
        },
        "board:fetch:pull": {
            gate: { kind: "trusted", rejectionLog: "persephone.fetch requires a trusted board" },
            handle: (message) => { if (typeof message.reqId === "number") void this.fetchBridge.pull(message.reqId); },
        },
        "board:fetch:abort": {
            gate: { kind: "trusted", rejectionLog: "persephone.fetch requires a trusted board" },
            handle: (message) => { if (typeof message.reqId === "number") this.fetchBridge.abort(message.reqId); },
        },
    };

    private dispatchBoardMessage<Type extends BoardToHostType>(
        type: Type,
        message: BoardToHostVariant<Type>,
        context: BoardMessageContext,
    ): void {
        const entry = this.boardMessageHandlers[type];
        if (entry.gate) {
            const gate = entry.gate;
            const gatePassed = gate.kind === "trusted"
                ? isBoardPermitted(this.props.boardRoot)
                : gate.kind === "main"
                ? this.isMain
                : this.isMain
                    && this.props.model.frames.get(BOARD_CDP_TAB) === context.frame
                    && isBoardPermitted(this.props.boardRoot)
                    && (gate.kind !== "mainTrustedText"
                        || ("text" in message && typeof message.text === "string"));
            if (!gatePassed) {
                if (gate.rejectionLog) this.appendLog("warn", gate.rejectionLog);
                if ("reqId" in message && typeof message.reqId === "number") {
                    const error = "This board is no longer trusted.";
                    const reply: BoardHostFrameMsg | undefined = type === "board:pageState:get"
                        ? { __persephone: "pageState:get:result", reqId: message.reqId, error }
                        : type === "board:pageState:set"
                        ? { __persephone: "pageState:set:result", reqId: message.reqId, error }
                        : type === "board:pageState:remove"
                        ? { __persephone: "pageState:remove:result", reqId: message.reqId, error }
                        : undefined;
                    if (reply) this.replyToFrame(context.frame, context.generation, reply);
                }
                return;
            }
        }
        entry.handle(message, context);
    }

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
        window.addEventListener("message", this.handleMessage);
        this.ownSubscription(() => window.removeEventListener("message", this.handleMessage));
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
        this.ownSubscription(boardTrust.subscribeGrants((changedRoots) => {
            const boardKey = fpNormalizeForCompare(this.props.boardRoot);
            if (!changedRoots.some((root) => pathCovers(root, boardKey) || pathCovers(boardKey, root))) return;
            void this.refreshIframeGrant();
        }));
        this.ownSubscription(subscribeBoardPermission(() => {
            if (!isBoardPermitted(this.props.boardRoot)) {
                this.props.model.clearStatusBarItemsForFrame(this.generation);
                this.props.onStatusBarClear?.(this.generation);
                this.fetchBridge.dispose();
                this.rejectPendingAiVision(new Error("The board is no longer trusted."));
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
        void this.endOwnedThemePreview();
        const retiredGeneration = this.generation;
        if (this.isMain) this.props.model.clearSaveRequestHandler(this.boardId, retiredGeneration);
        this.saveHandlerId = undefined;
        this.rejectSaveRequests(retiredGeneration, "The board frame was replaced.");
        this.props.model.clearToolbarControlsForFrame(retiredGeneration);
        this.props.model.clearStatusBarItemsForFrame(retiredGeneration);
        if (this.isMain) this.props.model.clearToolbarTextForFrame(retiredGeneration);
        this.props.onToolbarClear?.(retiredGeneration);
        this.props.onStatusBarClear?.(retiredGeneration);
        this.generation++;
        this.fetchBridge.dispose();
        this.abortPendingContentOpen();
        this.props.model.releaseContentResources(this.tabId, retiredGeneration);
        this.rejectPendingAiVision(new Error("Board frame was replaced."));
        this.rejectPendingCapability("handler-closed", "The board frame was replaced.");
        this.unregisterCapabilityFrame();
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
        this.settingsUnsubscribe?.();
        this.settingsUnsubscribe = undefined;
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
            void api.appendBoardLog(boardRoot, "info", "----- board loaded -----").catch(() => {});
        }
        this.registeredHost = h;
        this.host = h;
        await this.createIframe();
        this.startHostResources();
    }

    private async createIframe(): Promise<void> {
        const host = this.host;
        if (!host || this.iframe) return;
        const grant = await boardTrust.getGrantedPermissions(this.props.boardRoot);
        if (!this.live || host !== this.host || !grant || this.iframe) return;
        const { entry = "index.html", view = "main" } = this.props;
        const iframe = document.createElement("iframe");
        iframe.title = t("board.frameTitle");
        iframe.allow = iframeFeaturesForGrant(grant).join("; ");
        this.iframeGrant = grant;
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
        this.root.append(iframe);
    }

    private async refreshIframeGrant(): Promise<void> {
        const grant = await boardTrust.getGrantedPermissions(this.props.boardRoot);
        if (!this.live || JSON.stringify(grant) === JSON.stringify(this.iframeGrant)) return;
        const iframe = this.iframe;
        this.iframe = undefined;
        this.iframeGrant = grant;
        if (this.isMain) this.props.model.clearSaveRequestHandler(this.boardId, this.generation);
        this.saveHandlerId = undefined;
        this.rejectSaveRequests(this.generation, "The board permissions changed while it was saving.");
        this.generation++;
        this.fetchBridge.dispose();
        this.fetchBridge = new BoardFetchBridge();
        this.abortPendingContentOpen();
        this.rejectPendingAiVision(new Error("Board permissions changed."));
        this.rejectPendingCapability("handler-closed", "Board permissions changed.");
        this.unregisterCapabilityFrame();
        this.closePendingPort();
        await api.disposeBoardPort(this.boardId);
        if (iframe) {
            boardNavigationReturnService.releaseBoardFrame(this.props.model, iframe, this.tabId);
            const ownsFrame = this.props.model.frames.get(this.tabId) === iframe;
            this.props.model.clearIframe(iframe, this.tabId);
            this.props.model.releaseContentResources(this.tabId, this.generation - 1);
            if (ownsFrame) await api.unregisterBoardFrame(this.props.model.id, this.tabId, this.boardId);
            iframe.remove();
        }
        if (grant) await this.createIframe();
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
        this.ownSubscription(model.onPendingSourceUrl(() => this.flushPendingSourceUrls()));
        this.ownSubscription(() => {
            this.settingsUnsubscribe?.();
            this.settingsUnsubscribe = undefined;
        });
        this.installSettingsSubscription();
    }

    private installSettingsSubscription(): void {
        this.settingsUnsubscribe?.();
        const frame = this.iframe;
        const host = this.host;
        const generation = this.generation;
        const model = this.props.model;
        if (!frame || !host) return;
        this.settingsUnsubscribe = subscribeBoardSettings(this.props.boardRoot, (change) => {
            if (!this.live || !this.host || this.generation !== generation
                || this.iframe !== frame || model.frames.get(this.tabId) !== frame
                || !frame.contentWindow) return;
            const message: BoardSettingsChangedMsg = {
                __persephone: "settings:changed",
                id: change.id,
                value: change.value,
            };
            try {
                frame.contentWindow.postMessage(message, `board://${host}`);
            } catch {
                // The frame may be replaced while the change is posted.
            }
        });
    }

    private transferPort(): void {
        const host = this.host;
        const frame = this.iframe;
        const port = this.pendingPort;
        if (!this.live || !host || !frame || !port) return;
        const filePath = this.props.model.currentFilePath();
        const sourceUrl = this.props.model.currentSourceUrl();
        const pageId = this.props.model.page?.id;
        const pipeUrlEnabled = this.props.model.pipeUrlEnabled;
        if (pageId) void api.registerBoardPipePage(pageId, host, this.props.boardRoot, this.props.model.pipeUrlEnabled);
        const initialIntent = pageId ? takeInitialIntent(pageId) : undefined;
        const init: BoardPortInitMsg = {
            __persephoneInit: true,
            busy: !!this.props.model.state.get().busy,
            pageId,
            pipeUrlEnabled,
            filePath,
            sourceUrl,
            ...(this.props.model.isInitialSourcePrivateSession() ? { initialSourcePrivateSession: true } : {}),
            folderPath: this.props.model.folderPath,
            contentHost: !!this.props.model.contentHost,
            materialize: !!filePath && !isPlainLocalPath(filePath) && !this.props.model.isStreamHost,
            ...(initialIntent ? { intent: initialIntent } : {}),
        };
        const contentWindow = frame.contentWindow;
        if (!contentWindow) return;
        try {
            contentWindow.postMessage(init, `board://${host}`, [port]);
            this.pendingPort = null;
            if (this.capabilityFrame && this.capabilityFrame.generation === this.generation) {
                this.capabilityFrame.ready = true;
                markBoardCapabilityFrameReady(this.capabilityFrame.pageId, this.generation);
            }
            this.flushPendingSourceUrls();
        } catch (error: unknown) {
            failBoardCapabilityFrame(
                pageId ?? "",
                this.generation,
                new CapabilityError("crashed", errMessage(error, "The board handshake failed.")),
            );
            this.closePendingPort();
        }
    }

    private readonly handleLoad = (): void => {
        const host = this.host;
        const frame = this.iframe;
        if (!this.live || !host || !frame) return;
        if (this.hasLoaded) void this.endOwnedThemePreview();
        this.hasLoaded = true;
        const retiredGeneration = this.generation;
        if (this.isMain) this.props.model.clearSaveRequestHandler(this.boardId, retiredGeneration);
        this.saveHandlerId = undefined;
        this.rejectSaveRequests(retiredGeneration, "The board frame was reloaded.");
        this.props.model.clearToolbarControlsForFrame(retiredGeneration);
        this.props.model.clearStatusBarItemsForFrame(retiredGeneration);
        if (this.isMain) this.props.model.clearToolbarTextForFrame(retiredGeneration);
        this.props.onToolbarClear?.(retiredGeneration);
        this.props.onStatusBarClear?.(retiredGeneration);
        // The reloaded frame restarts its request ids, so its old fetches must not survive.
        this.fetchBridge.dispose();
        this.abortPendingContentOpen();
        this.props.model.releaseContentResources(this.tabId, retiredGeneration);
        boardNavigationReturnService.resetBoardFrame(this.props.model, frame, this.tabId);
        this.generation++;
        this.hostedPathToken = globalThis.crypto.randomUUID();
        this.installSettingsSubscription();
        this.props.model.setAiVisionTransport(this.tabId, frame, this.generation, this.requestAiVision);
        if (this.capabilityFrame?.iframe === frame) {
            this.rejectPendingCapability("crashed", "The board frame was reloaded.");
            this.unregisterCapabilityFrame();
        }
        const generation = this.generation;
        const model = this.props.model;
        if (this.isMain && model.page?.id && frame.contentWindow) {
            this.capabilityFrame = {
                boardRoot: this.props.boardRoot,
                pageId: model.page.id,
                generation,
                iframe: frame,
                contentWindow: frame.contentWindow,
                ready: false,
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
        if (this.isMain && win) {
            // A board registers its Save handler while its script runs, before this load event retires
            // the previous generation — ask the frame to announce it again under the current one.
            const sync: BoardHostFrameMsg = { __persephone: "board:saveHandlerSync" };
            win.postMessage(sync, `board://${host}`);
        }
        const currentFilePath = model.currentFilePath();
        const hostedLocalPath = currentFilePath && isPlainLocalPath(currentFilePath) ? currentFilePath : null;
        void api.requestBoardPort(this.boardId, host, model.id, hostedLocalPath, this.hostedPathToken);
        void api.registerBoardFrame(model.id, host, this.boardId, this.tabId).then(() => {
            if (this.live && generation === this.generation) model.markFrameLoaded(this.tabId);
            else if (model.frames.get(this.tabId) === frame) {
                void api.unregisterBoardFrame(model.id, this.tabId, this.boardId);
            }
        }).catch((error: unknown) => {
            if (this.live && generation === this.generation) {
                const message = errMessage(error, "The board frame failed to register.");
                this.rejectPendingCapability("crashed", message);
                if (model.page?.id) {
                    failBoardCapabilityFrame(model.page.id, generation, new CapabilityError("crashed", message));
                }
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
        this.flushPendingSourceUrls();
        if (this.isMain) this.focusFrame();
    };

    private async endOwnedThemePreview(): Promise<void> {
        const previewGeneration = this.props.model.takeBoardThemePreviewGeneration(this.boardId);
        if (previewGeneration === undefined || getPreviewGeneration() !== previewGeneration) return;
        try {
            await app.themes.endPreview();
        } catch (error) {
            this.appendLog("warn", `Could not restore the theme after board preview: ${errMessage(error)}`);
        }
    }

    /** Push queued runtime source identities to the live main board frame in FIFO order. */
    private flushPendingSourceUrls(): void {
        if (!this.isMain || !this.live || !this.host) return;
        const frame = this.iframe;
        const generation = this.generation;
        if (!frame?.contentWindow) return;

        while (true) {
            const pending = this.props.model.peekPendingSourceUrl();
            if (pending === undefined) return;
            if (!this.live || this.generation !== generation || this.iframe !== frame
                || this.props.model.frames.get(this.tabId) !== frame || !frame.contentWindow) return;
            const message: BoardSourceOpenedMsg = {
                __persephone: "source:opened",
                sourceUrl: pending.sourceUrl,
                ...(pending.privateSession ? { privateSession: true } : {}),
            };
            try {
                frame.contentWindow.postMessage(message, `board://${this.host}`);
            } catch {
                return;
            }
            if (!this.live || this.generation !== generation || this.iframe !== frame
                || this.props.model.frames.get(this.tabId) !== frame) return;
            this.props.model.consumePendingSourceUrl();
        }
    }

    private readonly handleMessage = (event: MessageEvent): void => {
        const host = this.host;
        const frame = this.iframe;
        if (!this.live || !host || !frame || event.origin !== `board://${host}`
            || event.source !== frame.contentWindow) return;

        const data = event.data as BoardHostFrameMsg | undefined;
        if (!data || typeof data !== "object" || !("__persephone" in data)) return;
        const discriminator = data.__persephone;
        if (typeof discriminator !== "string"
            || !Object.prototype.hasOwnProperty.call(this.boardMessageHandlers, discriminator)) return;

        const context: BoardMessageContext = {
            model: this.props.model,
            host,
            frame,
            generation: this.generation,
        };
        this.dispatchBoardMessage(discriminator as BoardToHostType, data as BoardToHostMsg, context);
    };

    private async resolvePageStateGet(message: BoardPageStateGetRequestMsg, context: BoardMessageContext): Promise<void> {
        let reply: BoardHostFrameMsg;
        try {
            const value = await context.model.getPageState(message.key);
            reply = { __persephone: "pageState:get:result", reqId: message.reqId, ...(value === undefined ? {} : { value }) };
        } catch (error: unknown) {
            reply = { __persephone: "pageState:get:result", reqId: message.reqId, error: errMessage(error, "Failed to read board page state.") };
        }
        this.replyToFrame(context.frame, context.generation, reply);
    }

    private async resolvePageStateSet(message: BoardPageStateSetRequestMsg, context: BoardMessageContext): Promise<void> {
        let reply: BoardHostFrameMsg;
        try {
            await context.model.setPageState(message.key, message.value);
            reply = { __persephone: "pageState:set:result", reqId: message.reqId };
        } catch (error: unknown) {
            reply = { __persephone: "pageState:set:result", reqId: message.reqId, error: errMessage(error, "Failed to write board page state.") };
        }
        this.replyToFrame(context.frame, context.generation, reply);
    }

    private async resolvePageStateRemove(message: BoardPageStateRemoveRequestMsg, context: BoardMessageContext): Promise<void> {
        let reply: BoardHostFrameMsg;
        try {
            await context.model.removePageState(message.key);
            reply = { __persephone: "pageState:remove:result", reqId: message.reqId };
        } catch (error: unknown) {
            reply = { __persephone: "pageState:remove:result", reqId: message.reqId, error: errMessage(error, "Failed to remove board page state.") };
        }
        this.replyToFrame(context.frame, context.generation, reply);
    }

    /** Deliver one catalog interaction to the current main board frame. */
    public sendStatusBarAction(event: { id: string }, generation: number): void {
        const host = this.host;
        const frame = this.iframe;
        const contentWindow = frame?.contentWindow;
        const model = this.props.model;
        if (!this.live || !this.isMain || generation !== this.generation || !host || !frame || !contentWindow
            || model.frames.get(BOARD_CDP_TAB) !== frame || !isBoardPermitted(this.props.boardRoot)) return;
        const message: BoardStatusBarActionMsg = { __persephone: "statusBar:action", id: event.id };
        try { contentWindow.postMessage(message, `board://${host}`); } catch { /* frame replaced */ }
    }

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
        if (!isAiVisionShape(message.shape)
            || !isSchemaMajorOne(message.schemaVersion)
            || !isSchemaMajorOne(message.shape.schemaVersion)) {
            const rejectionLog = BOARD_MESSAGE_GATES.aiVision.rejectionLog;
            if (rejectionLog) this.appendLog("warn", rejectionLog);
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
        // A refresh() that republishes an identical shape changes nothing the agent can see.
        const previousShape = model.getAiVisionRegistration()?.shape;
        const accepted = model.setAiVisionRegistration(
            message.shape,
            frame,
            this.generation,
            this.requestAiVision,
            (warning) => this.appendLog("warn", warning),
            reason,
        );
        const pageId = model.page?.id;
        if (accepted && pageId && reason === "refresh"
            && JSON.stringify(previousShape) !== JSON.stringify(message.shape)) logShapeChanged(pageId);
        if (accepted && reason === "register" && model.consumeReloadRegistration() && pageId) {
            logBoardReloaded(pageId);
        }
    }

    private handleAiVisionNotify(
        message: BoardAiVisionNotifyMsg,
        model: BoardEditorModel,
    ): void {
        if (typeof message.text !== "string") return;
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

    private readonly dispatchCapabilityIntent = (request: IntentRequest, initial = false): Promise<unknown> => {
        const host = this.host;
        const frame = this.iframe;
        const contentWindow = frame?.contentWindow;
        if (!this.live || !host || !frame || !contentWindow || !this.isMain
            || this.props.model.frames.get(BOARD_CDP_TAB) !== frame) {
            return Promise.reject(new CapabilityError(
                "handler-closed",
                "The board frame is unavailable or untrusted.",
            ));
        }
        const generation = this.generation;
        return new Promise<unknown>((resolve, reject) => {
            this.pendingCapability.set(request.requestId, {
                resolve,
                reject,
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
                this.settleCapability(request.requestId, new CapabilityError(
                    isDataCloneError(error) ? "rejected" : "crashed",
                    errMessage(
                        error,
                        isDataCloneError(error)
                            ? "The capability payload could not be cloned."
                            : "The board frame is unavailable.",
                    ),
                ));
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
        this.pendingCapability.delete(requestId);
    };

    private handleCapabilityResult(message: BoardCapabilityIntentResultMsg, frame: HTMLIFrameElement): void {
        const pending = this.pendingCapability.get(message.requestId);
        if (!pending || pending.generation !== this.generation || pending.iframe !== frame
            || pending.contentWindow !== frame.contentWindow) return;
        if (message.error) {
            this.settleCapability(message.requestId, new CapabilityError(
                message.error.code,
                message.error.message,
            ));
        } else {
            this.settleCapability(message.requestId, undefined, {
                ...(Object.prototype.hasOwnProperty.call(message, "result") ? { result: message.result } : {}),
                ...(message.discardPage === undefined ? {} : { discardPage: message.discardPage }),
            });
        }
    }

    private settleCapability(
        requestId: string,
        error: CapabilityError | undefined,
        result?: unknown,
    ): void {
        const pending = this.pendingCapability.get(requestId);
        if (!pending) return;
        this.pendingCapability.delete(requestId);
        if (error) pending.reject(error);
        else pending.resolve(result);
    }

    private rejectPendingCapability(
        code: CapabilityErrorCode,
        message: string,
    ): void {
        for (const requestId of [...this.pendingCapability.keys()]) {
            this.settleCapability(requestId, new CapabilityError(code, message));
        }
    }

    private unregisterCapabilityFrame(): void {
        if (!this.capabilityFrame) return;
        unregisterBoardCapabilityFrame(this.capabilityFrame.pageId, this.capabilityFrame);
        this.capabilityFrame = undefined;
    }

    private readonly handleFrameError = (): void => {
        if (this.isMain) {
            this.props.model.clearSaveRequestHandler(this.boardId, this.generation);
            this.saveHandlerId = undefined;
            this.rejectSaveRequests(this.generation, "The board frame failed to load.");
        }
        this.props.model.clearStatusBarItemsForFrame(this.generation);
        this.props.onStatusBarClear?.(this.generation);
        if (this.isMain) this.props.model.clearToolbarTextForFrame(this.generation);
        this.rejectPendingCapability("crashed", "The board frame failed to load.");
        const pageId = this.props.model.page?.id;
        if (pageId) {
            failBoardCapabilityFrame(pageId, this.generation, new CapabilityError("crashed", "The board frame failed to load."));
        }
        this.unregisterCapabilityFrame();
    };

    private abortPendingContentOpen(): void {
        for (const controller of this.pendingContentOpen) controller.abort();
        this.pendingContentOpen.clear();
    }

    private replyToFrame(frame: HTMLIFrameElement, generation: number, message: BoardHostFrameMsg,
        transfer?: Transferable[]): boolean {
        const host = this.host;
        const contentWindow = frame.contentWindow;
        if (!this.live || generation !== this.generation || this.iframe !== frame
            || this.props.model.frames.get(this.tabId) !== frame || !host || !contentWindow) return false;
        try {
            contentWindow.postMessage(message, `board://${host}`, transfer ?? []);
            return true;
        } catch {
            return false;
        }
    }

    private requestSave(generation: number, discard = false): Promise<{ success: boolean; error?: string }> {
        const frame = this.iframe;
        const contentWindow = frame?.contentWindow;
        const requestId = ++this.nextSaveRequestId;
        if (!this.live || !this.isMain || generation !== this.generation || !frame || !contentWindow
            || this.props.model.frames.get(BOARD_CDP_TAB) !== frame || this.saveHandlerId === undefined) {
            return Promise.resolve({ success: false, error: "The board has no live Save handler. Reload the board to restore it, or choose Don't Save." });
        }
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingSaveRequests.delete(requestId);
                resolve({ success: false, error: "The board did not finish saving within 30 seconds." });
            }, discard ? 3_000 : 30_000);
            this.pendingSaveRequests.set(requestId, { generation, resolve, timer });
            const request: BoardHostFrameMsg = { __persephone: "board:saveRequest", requestId, ...(discard ? { discard } : {}) };
            if (!this.replyToFrame(frame, generation, request)) {
                clearTimeout(timer);
                this.pendingSaveRequests.delete(requestId);
                resolve({ success: false, error: "The board frame is no longer available." });
            }
        });
    }

    private resolveSaveRequest(message: BoardSaveResultMsg, generation: number): void {
        const pending = this.pendingSaveRequests.get(message.requestId);
        if (!pending || pending.generation !== generation || generation !== this.generation) return;
        clearTimeout(pending.timer);
        this.pendingSaveRequests.delete(message.requestId);
        pending.resolve({ success: message.success === true, ...(message.error ? { error: message.error } : {}) });
    }

    private rejectSaveRequests(generation: number, error: string): void {
        for (const [requestId, pending] of this.pendingSaveRequests) {
            if (pending.generation !== generation) continue;
            clearTimeout(pending.timer);
            this.pendingSaveRequests.delete(requestId);
            pending.resolve({ success: false, error });
        }
    }

    private async resolveCapabilityList(
        message: BoardCapabilityListRequestMsg,
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        let reply: BoardCapabilityListResultMsg;
        try {
            if (!isBoardPermitted(this.props.boardRoot)) {
                throw new CapabilityError("untrusted", "The board is no longer trusted.");
            }
            if (!(await boardTrust.allows(this.props.boardRoot, "appScripting"))) throw boardPermissionError("appScripting");
            reply = { __persephone: "capabilities:list:result", reqId: message.reqId, result: app.capabilities.list() };
        } catch (error: unknown) {
            reply = {
                __persephone: "capabilities:list:result",
                reqId: message.reqId,
                error: capabilityError(error),
            };
        }
        this.replyToFrame(frame, generation, reply);
    }

    private async resolveCapabilityInvoke(
        message: BoardCapabilityInvokeRequestMsg,
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        let reply: BoardCapabilityInvokeResultMsg;
        try {
            if (!isBoardPermitted(this.props.boardRoot)) {
                throw new CapabilityError("untrusted", "The board is no longer trusted.");
            }
            const invocation = await invokeCapabilityOutcome(message.id, message.payload, {
                ...(message.version === undefined ? {} : { version: message.version }),
                pageId: model.page?.id,
                deadlineMs: message.deadlineMs,
            });
            const result = invocation.value;
            if (invocation.origin === "board") {
                const outcome = result as CapabilityOutcome;
                reply = {
                    __persephone: "capabilities:invoke:result",
                    reqId: message.reqId,
                    ...(typeof outcome.pageId === "string" ? { pageId: outcome.pageId } : {}),
                    ...(Object.prototype.hasOwnProperty.call(outcome, "result") ? { result: outcome.result } : {}),
                };
            } else {
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
            }
        } catch (error: unknown) {
            reply = {
                __persephone: "capabilities:invoke:result",
                reqId: message.reqId,
                error: capabilityError(error),
            };
        }
        this.replyToFrame(frame, generation, reply);
    }

    private async resolveFilePath(
        reqId: number,
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        const token = this.hostedPathToken;
        let reply: { path?: string; error?: string };
        try {
            reply = { path: await model.ensureContentPath() };
            if (!this.live || generation !== this.generation || this.iframe !== frame
                || model.frames.get(this.tabId) !== frame || token !== this.hostedPathToken) return;
            const updated = await api.updateBoardHostedPath(this.boardId, token, reply.path ?? null);
            if (!updated || !this.live || generation !== this.generation || this.iframe !== frame
                || model.frames.get(this.tabId) !== frame || token !== this.hostedPathToken) return;
        } catch (error: unknown) {
            const message = errMessage(error);
            if (isProviderResolutionError(error)) ui.notify(message, "error");
            reply = { error: message };
        }
        const message: BoardFilePathResultMsg = {
            __persephone: "filePath:result", reqId, path: reply.path, error: reply.error,
        };
        this.replyToFrame(frame, generation, message);
    }

    private async resolveFileIcons(
        reqId: number,
        names: unknown,
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        let message: BoardFileIconsResultMsg;
        try {
            if (!Array.isArray(names)) throw new Error("icons.forFiles() expects an array of file names.");
            const { urls, icons } = await resolveBoardFileIcons(names);
            message = { __persephone: "fileIcons:result", reqId, urls, icons };
        } catch (error: unknown) {
            message = { __persephone: "fileIcons:result", reqId, error: errMessage(error) };
        }
        this.replyToFrame(frame, generation, message);
    }

    private async resolveContentOpen(
        request: BoardContentOpenRequestMsg,
        model: BoardEditorModel,
        host: string,
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        const controller = new AbortController();
        this.pendingContentOpen.add(controller);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        let openedResourceId: string | undefined;

        let reply: BoardContentOpenResultMsg;
        try {
            if (!isBoardPermitted(this.props.boardRoot)) throw new Error("This board is not trusted.");
            const grant = await boardTrust.getGrantedPermissions(this.props.boardRoot);
            const network = grant?.kind === "legacy" ? "full" : grant?.flags.network ?? false;
            const appScripting = grant?.kind === "legacy" || (grant?.kind === "flags" && grant.flags.appScripting);
            if (/^https?:/i.test(request.link) && network === false) throw boardPermissionError("network");
            if (typeof request.link !== "string") throw new Error("content.open() requires a link string.");
            if (request.timeoutMs !== undefined
                && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0)) {
                throw new Error("content.open() timeoutMs must be a positive integer.");
            }
            if (request.timeoutMs !== undefined) {
                timer = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                }, request.timeoutMs);
            }
            if (model.frames.get(this.tabId) !== frame || !frame.contentWindow) {
                throw new Error("The board frame is unavailable.");
            }
            const mcpUrl = await api.getBoardMcpEndpoint();
            const info = await model.openContentResource(request.link, this.tabId, generation, controller.signal, {
                network, appScripting, mcpUrl, boardRoot: this.props.boardRoot,
            });
            openedResourceId = info.resourceId;
            if (controller.signal.aborted) {
                model.releaseContentResource(info.resourceId);
                throw new Error("The content resource request was cancelled.");
            }
            if (!this.live || generation !== this.generation || this.iframe !== frame
                || model.frames.get(this.tabId) !== frame || !frame.contentWindow) {
                model.releaseContentResource(info.resourceId);
                return;
            }
            try {
                await api.registerBoardPipeResource(info.resourceId, host, this.props.boardRoot, info.filePath);
            } catch (error: unknown) {
                model.releaseContentResource(info.resourceId);
                throw error;
            }
            if (!this.live || generation !== this.generation || this.iframe !== frame
                || model.frames.get(this.tabId) !== frame || !frame.contentWindow) {
                model.releaseContentResource(info.resourceId);
                return;
            }
            reply = {
                __persephone: "contentOpen:result",
                reqId: request.reqId,
                url: `board://${host}/__pipe/resource/${encodeURIComponent(info.resourceId)}`,
                size: info.size,
                contentType: info.contentType,
            };
        } catch (error: unknown) {
            reply = {
                __persephone: "contentOpen:result",
                reqId: request.reqId,
                error: timedOut
                    ? "content.open() timed out while resolving the resource."
                    : errMessage(error, "The content resource could not be opened."),
            };
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            this.pendingContentOpen.delete(controller);
        }
        if (!this.replyToFrame(frame, generation, reply) && openedResourceId) {
            model.releaseContentResource(openedResourceId);
        }
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
            if (!isBoardPermitted(this.props.boardRoot)) throw new Error("This board is not trusted.");
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
        this.replyToFrame(frame, generation, reply);
    }

    private resolveOpenContent(
        reqId: number,
        request: BoardOpenContentRequest | undefined,
        frame: HTMLIFrameElement,
    ): void {
        const generation = this.generation;
        const reply = isBoardPermitted(this.props.boardRoot)
            ? resolveBoardOpenContent(request)
            : { error: "This board is not trusted." };
        const message: BoardOpenContentResultMsg = {
            __persephone: "openContent:result", reqId, pageId: reply.pageId, error: reply.error,
        };
        this.replyToFrame(frame, generation, message);
    }

    private async resolveVariable(
        reqId: number,
        method: "get" | "set" | "list" | "show",
        args: unknown[],
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        let reply: { result?: unknown; error?: string };
        try {
            const namespace = await resolveBoardNamespace(this.props.boardRoot);
            reply = await resolveBoardVarRequest(namespace, method, args);
        } catch (error: unknown) {
            reply = { error: errMessage(error) };
        }
        const message: BoardVarResultMsg = {
            __persephone: "var:result", reqId, result: reply.result, error: reply.error,
        };
        this.replyToFrame(frame, generation, message);
    }

    private async resolveSettings(
        reqId: number,
        method: "get",
        args: unknown[],
        frame: HTMLIFrameElement,
    ): Promise<void> {
        const generation = this.generation;
        let reply: { result?: string | number | boolean; error?: string };
        try {
            reply = await resolveBoardSettingsRequest(this.props.boardRoot, method, args);
        } catch (error: unknown) {
            reply = { error: errMessage(error, "Failed to read board setting.") };
        }
        const message: BoardSettingsResultMsg = {
            __persephone: "settings:result",
            reqId,
            result: reply.result,
            error: reply.error,
        };
        this.replyToFrame(frame, generation, message);
    }

    private focusFrame(): void {
        if (!isFocusInSidebar()) this.iframe?.contentWindow?.focus();
    }

    private appendLog(level: BoardLogLevel, message: string): void {
        void api.appendBoardLog(this.props.boardRoot, level, message).catch(() => {});
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

function capabilityError(error: unknown): { code: CapabilityErrorCode; message: string } {
    const value = error as { code?: unknown } | null;
    const code = isCapabilityErrorCode(value?.code) ? value.code : "rejected";
    return { code, message: errMessage(error, "The capability request failed.") };
}

function iframeFeaturesForGrant(grant: NormalizedBoardPermissions): string[] {
    const features = ["clipboard-write"];
    if (grant.kind === "legacy") {
        features.push("clipboard-read");
        return features;
    }
    if (grant.flags.camera) features.push("camera");
    if (grant.flags.microphone) features.push("microphone");
    if (grant.flags.geolocation) features.push("geolocation");
    if (grant.flags.notifications) features.push("notifications");
    if (grant.flags.clipboardRead) features.push("clipboard-read");
    return features;
}
