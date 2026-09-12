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
    BoardFilePathResultMsg,
    BoardHostContentMsg,
    BoardOpenContentRequest,
    BoardOpenContentResultMsg,
    BoardPortInitMsg,
    BoardStateSyncMsg,
    BoardToHostMsg,
    BoardVarResultMsg,
} from "../../../ipc/board-bridge-channels";
import { resolveBoardNamespace, resolveBoardVarRequest } from "../../api/board-vars";
import { resolveBoardOpenContent } from "./board-open-content";
import { cycleAppTheme } from "../../api/cycle-app-theme";
import { BOARD_CDP_TAB } from "../../../ipc/api-types";
import { BOARD_TOKEN_VARS, computeBoardThemePalette, ensureBoardThemeSubscription } from "./board-theme";
import { boardSecondaryPanelId } from "./board-secondary";
import type { BoardEditorModel } from "./BoardEditorModel";
import type { BoardContentEditorModel } from "./BoardContentEditorModel";
import type { IAiRemoteRequest, IAiRemoteResponse, IAiVisionShape } from "ai-vision";
import { boardTrust } from "../../api/board-trust";
import { errMessage } from "../../../shared/utils";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import "../../uikit/Panel/Panel.css";
import { logBoardReloaded, logRemoteNotify, logShapeChanged } from "../../scripting/ai-vision/event-log";

export interface BoardWebviewProps {
    model: BoardEditorModel;
    boardRoot: string;
    entry?: string;
    view?: string;
    isMain?: boolean;
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
        this.ownSubscription(boardTrust.subscribePaths(() => {
            if (!boardTrust.isTrusted(this.props.boardRoot)) {
                this.rejectPendingAiVision(new Error("The board is no longer trusted."));
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
        this.generation++;
        this.rejectPendingAiVision(new Error("Board frame was replaced."));
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
        const init: BoardPortInitMsg = {
            __persephoneInit: true,
            busy: !!this.props.model.state.get().busy,
            filePath,
            contentHost: !!this.props.model.contentHost,
            materialize: !!filePath && !isPlainLocalPath(filePath),
        };
        frame.contentWindow?.postMessage(init, `board://${host}`, [port]);
        this.pendingPort = null;
    }

    private readonly handleLoad = (): void => {
        const host = this.host;
        const frame = this.iframe;
        if (!this.live || !host || !frame) return;
        const generation = this.generation;
        const model = this.props.model;
        void api.requestBoardPort(this.boardId, host, model.id);
        void api.registerBoardFrame(model.id, host, this.boardId, this.tabId).then(() => {
            if (this.live && generation === this.generation) model.markFrameLoaded(this.tabId);
            else if (model.frames.get(this.tabId) === frame) {
                void api.unregisterBoardFrame(model.id, this.tabId, this.boardId);
            }
        });

        const contentHost = model.contentHost;
        const win = frame.contentWindow;
        if (contentHost && win) {
            const { content, language } = contentHost.state.get();
            this.lastBoardContent = undefined;
            const message: BoardHostContentMsg = { __persephone: "host:content", content, language };
            win.postMessage(message, `board://${host}`);
        }
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
        const data = event.data as BoardToHostMsg | BoardAiVisionRegistrationMsg | BoardAiVisionNotifyMsg | BoardAiVisionResultMsg | undefined;
        if (!data?.__persephone || event.origin !== `board://${host}`
            || event.source !== frame.contentWindow) return;

        const model = this.props.model;
        const legacy = data as BoardToHostMsg & {
            message?: string; level?: string; busy?: boolean; content?: string;
            state?: Record<string, unknown>; partial?: Record<string, unknown>;
            defaults?: Record<string, unknown>; restorableKeys?: string[]; views?: unknown;
            statusText?: string; direction?: 1 | -1; reqId?: number;
            varMethod?: "get" | "set" | "list" | "show"; varArgs?: unknown[];
            openContent?: BoardOpenContentRequest;
        };
        switch (data.__persephone) {
            case "board:interact":
                document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
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
            case "board:setStatusText":
                if (this.isMain) model.setStatusText(typeof legacy.statusText === "string" ? legacy.statusText : "");
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
            case "board:filePath":
                if (typeof legacy.reqId === "number") void this.resolveFilePath(legacy.reqId, model, host, frame);
                break;
            case "board:openContent":
                if (typeof legacy.reqId === "number") {
                    this.resolveOpenContent(legacy.reqId, legacy.openContent, host, frame);
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

    private handleAiVisionRegistration(
        message: BoardAiVisionRegistrationMsg,
        model: BoardEditorModel,
        frame: HTMLIFrameElement,
    ): void {
        if (!this.isMain || model.frames.get(BOARD_CDP_TAB) !== frame
            || !boardTrust.isTrusted(this.props.boardRoot)
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
            || !boardTrust.isTrusted(this.props.boardRoot)
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
            || !boardTrust.isTrusted(this.props.boardRoot)) {
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
        } catch (error) {
            reply = { error: errMessage(error) };
        }
        if (!this.live || generation !== this.generation || this.iframe !== frame || !frame.contentWindow) return;
        const message: BoardFilePathResultMsg = {
            __persephone: "filePath:result", reqId, path: reply.path, error: reply.error,
        };
        frame.contentWindow.postMessage(message, `board://${host}`);
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
        const reply = boardTrust.isTrusted(this.props.boardRoot)
            ? resolveBoardOpenContent(request)
            : { error: "This board is not trusted." };
        if (!frame.contentWindow) return;
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
