import { BOARD_HOST_TEXT_CATALOG } from "../../../../shared/board/host-text";
import { BoardRoot } from "../../../../shared/board/board-root";
import { BoardGrant } from "../../../../shared/board/board-grant";
import type { BoardSourceContext } from "../../../../shared/board-source-context";
import { errMessage } from "../../../../shared/utils";
import {
    frameEvent,
    type BoardPortInitMsg,
    type HostToBoardEnvelope,
} from "../../../../ipc/board-bridge/frame-protocol";
import type { BoardHostText } from "../../../../ipc/board-bridge/boot";
import { BOARD_CDP_TAB, type BoardLogLevel } from "../../../../ipc/api-types";
import { api } from "../../../../ipc/renderer/api";
import { boardRegistry } from "../../../api/boards/board-registry";
import { readBoardManifest } from "../../../api/boards/board-manifest-io";
import { loadBoardI18n } from "../../../api/boards/board-i18n";
import { refreshBoardDisplayText } from "../../../api/boards/board-display-text";
import { boardNavigationReturnService } from "../../../api/board-navigation-return";
import { boardCapabilityDispatcher } from "../../../api/capabilities/BoardCapabilityDispatcher";
import { CapabilityError } from "../../../api/capability-error";
import { settings } from "../../../api/settings";
import { ListenerList } from "../../../core/state/listener-list";
import { isPlainLocalPath } from "../../../core/utils/file-path";
import { computeBoardThemePalette, BOARD_TOKEN_VARS } from "../board-theme";
import { boardSecondaryPanelId } from "../board-secondary";
import type { BoardEditorModel } from "../BoardEditorModel";
import { grantBoardSourceReads } from "../model/BoardSourceInbox";
import { t } from "../../../../shared/i18n/t";

export type BoardFrameRetireReason = "reload" | "grant-change" | "load-error" | "permission-lost" | "dispose";

export interface BoardFrameRetirement {
    readonly reason: BoardFrameRetireReason;
    readonly generation: number;
    readonly frame: HTMLIFrameElement | undefined;
    readonly hadLoaded: boolean;
}

export interface BoardFrameStamp {
    readonly host: string;
    readonly generation: number;
    readonly frame: HTMLIFrameElement;
    readonly contentWindow: Window;
}

export interface BoardFrameOrigin {
    readonly generation: number;
    readonly frame?: HTMLIFrameElement
}

export interface BoardFrameSessionOptions {
    readonly model: BoardEditorModel;
    readonly boardRoot: string;
    readonly entry: string;
    readonly view: string;
    readonly isMain: boolean;
    readonly mountFrame: (iframe: HTMLIFrameElement, generation: number) => void;
    readonly pageVisible: () => boolean;
}

const RETIRE_POLICY: Record<BoardFrameRetireReason, { readonly removesFrame: boolean }> = {
    reload: { removesFrame: false },
    "load-error": { removesFrame: false },
    "grant-change": { removesFrame: true },
    "permission-lost": { removesFrame: true },
    dispose: { removesFrame: true },
};

type RetireListener = (retirement: BoardFrameRetirement) => void;
type FrameListener = (generation: number, frame: HTMLIFrameElement) => void;

function reportListenerError(error: unknown): void {
    console.error("Board frame lifecycle listener failed:", error);

}

export class BoardFrameSession {
    readonly boardId = `board_${Math.random().toString(36).slice(2)}`;
    readonly tabId: string;
    readonly isMain: boolean;
    private readonly model: BoardEditorModel;
    private readonly boardRoot: string;
    private readonly entry: string;
    private readonly view: string;
    private readonly options: BoardFrameSessionOptions;
    private alive = true;
    private boardHost: string | null = null;
    private registeredHost: string | null = null;
    private iframeGrant: BoardGrant | undefined;
    private iframe: HTMLIFrameElement | undefined;
    private frameLoaded = false;
    private pendingPort: MessagePort | null = null;
    private token = "";
    private frameGeneration = 0;
    private portDeliveryUnsubscribe: (() => void) | undefined;
    private serviceChannelUnsubscribe: (() => void) | undefined;
    private registryUnsubscribe: (() => void) | undefined;
    private readonly retireListeners = new ListenerList<RetireListener>();
    private readonly loadedListeners = new ListenerList<FrameListener>();
    private readonly deliveredListeners = new ListenerList<FrameListener>();
    private readonly registrationFailedListeners = new ListenerList<(generation: number, message: string) => void>();

    constructor(options: BoardFrameSessionOptions) {
        this.options = options;
        this.model = options.model;
        this.boardRoot = options.boardRoot;
        this.entry = options.entry;
        this.view = options.view;
        this.isMain = options.isMain;
        this.tabId = this.isMain ? BOARD_CDP_TAB : boardSecondaryPanelId(this.view);
    }

    get isAlive(): boolean {
        return this.alive;
    }
    get host(): string | null {
        return this.boardHost;
    }
    get frame(): HTMLIFrameElement | undefined {
        return this.iframe;
    }
    get generation(): number {
        return this.frameGeneration;
    }
    get hostedPathToken(): string {
        return this.token;
    }

    async start(): Promise<void> {
        this.registryUnsubscribe = boardRegistry.subscribe((change) => {
            if (change.keys.includes(BoardRoot.from(this.boardRoot).key)) void this.applyGrant();
        });
        const manifest = await readBoardManifest(this.boardRoot);
        const boardI18n = await loadBoardI18n(this.boardRoot, manifest?.languages);
        if (manifest) refreshBoardDisplayText(this.boardRoot, boardI18n.context);
        const hostText = Object.fromEntries(
            Object.entries(BOARD_HOST_TEXT_CATALOG).map(([id, entry]) => [id, t(entry.key)]),
        ) as BoardHostText;
        const host = await api.registerBoard(
            this.boardRoot,
            computeBoardThemePalette(),
            BOARD_TOKEN_VARS,
            boardI18n.context,
            hostText,
        );
        if (!this.alive) {
            void api.unregisterBoard(host);
            return;
        }
        this.registeredHost = host;
        this.boardHost = host;
        if (this.isMain) {
            void api.appendBoardLog(this.boardRoot, "info", "----- board loaded -----").catch(() => { });
            for (const warning of boardI18n.warnings) this.log("warn", warning);
        }
        this.portDeliveryUnsubscribe = api.onBoardPort((boardId, port) => {
            // This is global: filter ownership before liveness so a disposed view only closes its own port.
            if (boardId !== this.boardId) return;
            if (!this.alive) {
                port.close();
                return;
            }
            this.closePendingPort();
            this.pendingPort = port;
            void this.transferPort();
        });
        this.serviceChannelUnsubscribe = api.onBoardServiceChannel((target, channelId, port) => {
            if (target.kind !== "board-frame" || target.boardId !== this.boardId) return;
            if (!this.alive) {
                port.close();
                return;
            }
            if (!this.post(frameEvent("service.channelPort", { channelId }), [port])) port.close();
        });
        await this.createFrame();
    }

    current(): BoardFrameStamp | undefined {
        const host = this.boardHost;
        const frame = this.iframe;
        if (!this.alive || !host || !frame || !this.model.frameRegistry.isCurrentFrame(this.tabId, frame)) {
            return undefined;
        }
        const contentWindow = frame.contentWindow;
        return contentWindow ? { host, generation: this.frameGeneration, frame, contentWindow } : undefined;
    }

    identify(event: MessageEvent): BoardFrameStamp | undefined {
        const host = this.boardHost;
        const frame = this.iframe;
        if (!this.alive || !host || !frame || event.origin !== `board://${host}`
            || event.source !== frame.contentWindow) return undefined;
        const contentWindow = frame.contentWindow;
        return contentWindow ? { host, generation: this.frameGeneration, frame, contentWindow } : undefined;
    }

    isCurrent(generation: number, frame: HTMLIFrameElement): boolean {
        return this.alive && frame === this.iframe && generation === this.frameGeneration
            && this.model.frameRegistry.isCurrentFrame(this.tabId, frame);
    }

    post(message: HostToBoardEnvelope, transfer?: Transferable[], from?: BoardFrameOrigin): boolean {
        const stamp = this.current();
        if (!stamp || (from && (from.generation !== stamp.generation
            || (from.frame && from.frame !== stamp.frame)))) return false;
        try {
            stamp.contentWindow.postMessage(message, `board://${stamp.host}`, transfer ?? []);
            return true;
        }
        catch {
            return false;
        }
    }

    log(level: BoardLogLevel, message: string): void {
        if (!this.isMain) return;
        void api.appendBoardLog(this.boardRoot, level, message).catch(() => { });
    }

    onRetire(cb: RetireListener): () => void {
        return this.retireListeners.add(cb);
    }
    onFrameLoaded(cb: FrameListener): () => void {
        return this.loadedListeners.add(cb);
    }
    onPortDelivered(cb: FrameListener): () => void {
        return this.deliveredListeners.add(cb);
    }
    onRegistrationFailed(cb: (generation: number, message: string) => void): () => void {
        return this.registrationFailedListeners.add(cb);
    }

    async retire(reason: BoardFrameRetireReason): Promise<void> {
        if (reason === "dispose") {
            if (!this.alive) return;
            this.alive = false;
        }
        const frame = this.iframe;
        const retirement: BoardFrameRetirement = {
            reason, generation: this.frameGeneration, frame, hadLoaded: this.frameLoaded,
        };
        const removesFrame = RETIRE_POLICY[reason].removesFrame;
        this.frameGeneration++;
        if (removesFrame) {
            this.iframe = undefined;
            this.frameLoaded = false;
        }
        this.retireListeners.dispatchSync((cb) => cb(retirement), reportListenerError);
        this.closePendingPort();
        if (frame) boardNavigationReturnService.releaseBoardFrame(this.model, frame, this.tabId);
        if (!removesFrame) return;
        const ownsFrame = !!frame && this.model.frameRegistry.isCurrentFrame(this.tabId, frame);
        if (frame) {
            frame.removeEventListener("load", this.handleLoad);
            frame.removeEventListener("error", this.handleFrameError);
            this.model.clearIframe(frame, this.tabId);
            frame.remove();
        }
        const ipc: Promise<unknown>[] = [api.disposeBoardPort(this.boardId)];
        if (ownsFrame) ipc.push(api.unregisterBoardFrame(this.model.id, this.tabId, this.boardId));
        if (reason === "dispose") {
            this.portDeliveryUnsubscribe?.();
            this.serviceChannelUnsubscribe?.();
            this.registryUnsubscribe?.();
            const registered = this.registeredHost;
            this.registeredHost = null;
            this.boardHost = null;
            if (registered) ipc.push(api.unregisterBoard(registered));
        }
        await Promise.allSettled(ipc);
    }

    private async createFrame(): Promise<void> {
        const host = this.boardHost;
        if (!host || this.iframe) return;
        const grant = boardRegistry.grant(this.boardRoot);
        if (!this.alive || host !== this.boardHost || !grant || this.iframe) return;
        const iframe = document.createElement("iframe");
        iframe.title = t("board.frameTitle");
        iframe.allow = grant.iframeFeatures().join("; ");
        this.iframeGrant = grant;
        this.iframe = iframe;
        this.frameLoaded = false;
        this.model.setIframe(iframe, this.tabId);
        await api.registerBoardFrame(
            this.model.id,
            host,
            this.boardId,
            this.tabId,
            this.model.title,
            this.model.page?.id,
        );
        if (!this.alive || this.boardHost !== host || this.iframe !== iframe) return;
        iframe.src = `board://${host}/${this.entry}?v=${this.boardId}&view=${encodeURIComponent(this.view)}`;
        iframe.addEventListener("load", this.handleLoad);
        iframe.addEventListener("error", this.handleFrameError);
        this.options.mountFrame(iframe, this.frameGeneration);
    }

    private async applyGrant(): Promise<void> {
        const grant = boardRegistry.grant(this.boardRoot);
        if (!this.alive || BoardGrant.same(grant, this.iframeGrant)) return;
        this.iframeGrant = grant;
        await this.retire(grant ? "grant-change" : "permission-lost");
        if (grant) await this.createFrame();
    }

    private readonly handleLoad = (): void => {
        const host = this.boardHost;
        const frame = this.iframe;
        if (!this.alive || !host || !frame) return;
        void this.retire("reload");
        this.frameLoaded = true;
        this.token = globalThis.crypto.randomUUID();
        const generation = this.frameGeneration;
        const model = this.model;
        const currentFilePath = model.currentFilePath();
        const hostedLocalPath = currentFilePath && isPlainLocalPath(currentFilePath) ? currentFilePath : null;
        void api.requestBoardPort(this.boardId, host, model.id, hostedLocalPath, this.token);
        void api.registerBoardFrame(model.id, host, this.boardId, this.tabId, model.title, model.page?.id).then(() => {
            if (this.isCurrent(generation, frame)) model.frameRegistry.markLoaded(this.tabId);
            else if (model.frameRegistry.isCurrentFrame(this.tabId, frame)) {
                void api.unregisterBoardFrame(model.id, this.tabId, this.boardId);
            }
        }).catch((error: unknown) => {
            if (this.isCurrent(generation, frame)) this.registrationFailedListeners.dispatchSync(
                (cb) => cb(generation, errMessage(error, "The board frame failed to register.")), reportListenerError);
        });
        this.loadedListeners.dispatchSync((cb) => cb(generation, frame), reportListenerError);
    };

    private readonly handleFrameError = (): void => {
        if (this.alive) void this.retire("load-error");

    };

    private async transferPort(): Promise<void> {
        const host = this.boardHost;
        const frame = this.iframe;
        const port = this.pendingPort;
        if (!this.alive || !host || !frame || !port) return;
        const filePath = this.model.currentFilePath();
        const sourceUrl = this.model.sourceInbox.currentSourceUrl();
        const pageId = this.model.page?.id;
        const pipeUrlEnabled = this.model.pipeUrlEnabled;
        if (pageId) void api.registerBoardPipePage(pageId, host, this.boardRoot, this.model.pipeUrlEnabled);
        const initialIntent = pageId && this.isMain ? boardCapabilityDispatcher.takeInitialIntent(pageId) : undefined;
        const init: BoardPortInitMsg = {
            __persephoneInit: true, busy: !!this.model.state.get().busy, pageId, pipeUrlEnabled, filePath, sourceUrl,
            sourceContext: this.model.initialSourceContext(), pageVisible: this.options.pageVisible(),
            voiceTypingAutoStopSilenceMs: settings.get("voice-typing.auto-stop-silence-ms") as number,
            ...(this.model.sourceInbox.isInitialPrivateSession() ? { initialSourcePrivateSession: true } : {}),
            folderPath: this.model.folderPath, contentHost: !!this.model.contentHost,
            materialize: !!filePath && !isPlainLocalPath(filePath) && !this.model.isStreamHost,
            ...(initialIntent ? { intent: initialIntent } : {}),
        };
        const contentWindow = frame.contentWindow;
        if (!contentWindow) return;
        try {
            await grantBoardSourceReads(
                this.boardRoot,
                sourceUrl,
                init.sourceContext as BoardSourceContext | undefined,
            );
            if (!this.alive || this.pendingPort !== port || !frame.contentWindow) return;
            init.pageVisible = this.options.pageVisible();
            init.voiceTypingAutoStopSilenceMs = settings.get("voice-typing.auto-stop-silence-ms") as number;
            contentWindow.postMessage(init, `board://${host}`, [port]);
            this.pendingPort = null;
            this.deliveredListeners.dispatchSync((cb) => cb(this.frameGeneration, frame), reportListenerError);
        } catch (error: unknown) {
            boardCapabilityDispatcher.failFrame(pageId ?? "", this.frameGeneration,
                new CapabilityError("crashed", errMessage(error, "The board handshake failed.")));
            this.closePendingPort();
        }
    }

    private closePendingPort(): void {
        if (!this.pendingPort) return;
        this.pendingPort.close();
        this.pendingPort = null;
    }
}
