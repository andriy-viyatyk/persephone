import { pagesModel } from "../../../api/pages";
import { BoardCapabilityFrameAdapter } from "../../../api/capabilities/board-capability-frame-adapter";
import { CapabilityError } from "../../../api/capability-error";
import type { BoardEditorModel } from "../BoardEditorModel";
import type { ToolbarAction } from "../chrome/board-chrome-protocol";
import { BoardFrameEndpoint, postBoardFrameEvent } from "./BoardFrameEndpoint";
import { BoardFrameSession } from "./BoardFrameSession";
import { RETIRE_MESSAGES } from "./board-frame-retire-messages";
import { BoardHostRouter } from "./board-host-router";
import { BoardHostEvents } from "./board-host-events";
import { FetchBridgeHandler } from "./fetch-bridge-handler";
import { NotifyBridge } from "./notify-bridge";
import { AiVisionBridge } from "./ai-vision-bridge";
import { ChromeBridge } from "./chrome-bridge";
import { SettingsAndVarsBridge } from "./settings-and-vars-bridge";
import { SourceBridge } from "./source-bridge";
import { PageStateBridge } from "./page-state-bridge";
import { ContentOpenBridge } from "./content-open-bridge";
import { SharedStateBridge } from "./shared-state-bridge";
import { ContentHostBridge } from "./content-host-bridge";

export interface BoardFrameCompositionOptions {
    model: BoardEditorModel;
    boardRoot: string;
    isMain: boolean;
    focusFrame: () => void;
    getPageVisibility: () => boolean;
}

/** Owns feature lifetimes and routing for one board view. */
export class BoardFrameComposition {
    private readonly subscriptions: (() => void)[] = [];
    private readonly contentHostBridge: ContentHostBridge;
    private readonly sharedStateBridge: SharedStateBridge;
    private readonly sourceBridge: SourceBridge;
    private readonly settingsBridge: SettingsAndVarsBridge;
    private readonly chromeBridge: ChromeBridge;
    private readonly aiVisionBridge: AiVisionBridge;
    private readonly capability: BoardCapabilityFrameAdapter;
    private lastPageVisibility: boolean | undefined;
    private focusTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
        private readonly options: BoardFrameCompositionOptions,
    ) {
        const { model, boardRoot, isMain } = options;
        const hostEvents = new BoardHostEvents(model, session);
        if (isMain) {
            this.subscriptions.push(session.onRetire(({ generation }) => {
                model.setWorking(false);
                model.chrome.retireFrame({ token: session, generation });
            }));
        }
        const fetchHandler = new FetchBridgeHandler(boardRoot, session, endpoint);
        const aiVisionBridge = this.aiVisionBridge = new AiVisionBridge(boardRoot, session, endpoint);
        const chromeBridge = this.chromeBridge = new ChromeBridge(
            model,
            boardRoot,
            isMain,
            session,
            endpoint,
        );
        const settingsBridge = this.settingsBridge = new SettingsAndVarsBridge(boardRoot, session, endpoint);
        const sourceBridge = this.sourceBridge = new SourceBridge(model, boardRoot, isMain, session, endpoint);
        const pageStateBridge = new PageStateBridge(model);
        const contentOpenBridge = new ContentOpenBridge(model, boardRoot, session);
        const sharedStateBridge = this.sharedStateBridge = new SharedStateBridge(model, session, endpoint);
        const contentHostBridge = this.contentHostBridge = new ContentHostBridge(model, session, endpoint);
        const notifyBridge = new NotifyBridge();
        this.subscriptions.push(() => hostEvents.detach(), () => fetchHandler.detach(),
            () => settingsBridge.detach(), () => contentOpenBridge.detach());

        this.subscriptions.push(session.onFrameLoaded((generation, frame) => {
            settingsBridge.installBoardSettings();
            model.aiVision.attachTransport(session.tabId, {
                iframe: frame,
                generation,
                request: aiVisionBridge.requestAiVision,
            });
        }));
        this.subscriptions.push(session.onPortDelivered(() => settingsBridge.installHostSettingsPush()));
        const capability = new BoardCapabilityFrameAdapter(boardRoot, () => model.page?.id, isMain, {
            current: () => session.current(),
            requestIntent: (params, unavailable) => endpoint.request(
                "capabilities.intent",
                params,
                { unavailableError: unavailable },
            ),
            expectIntent: (id, unavailable) => endpoint.expect(
                "capabilities.intent",
                id,
                { unavailableError: unavailable },
            ),
            hasPending: (id) => endpoint.hasPending(id),
            cancelPending: (id, error) => endpoint.cancel(id, error),
            failIntents: (error) => endpoint.failPending("capabilities.intent", error),
            postCancel: (target, origin, requestId) => postBoardFrameEvent(
                target,
                origin,
                "capabilities.cancel",
                { requestId },
            ),
            onRetire: (listener) => session.onRetire((r) => listener(r.reason, r.generation)),
            onFrameLoaded: (listener) => session.onFrameLoaded(listener),
            onPortDelivered: (listener) => session.onPortDelivered(listener),
            onRegistrationFailed: (listener) => session.onRegistrationFailed(listener),
        }, (reason) => {
            const [code, text] = RETIRE_MESSAGES[reason].capability;
            return new CapabilityError(code, text);

        });
        this.capability = capability;
        this.subscriptions.push(session.onFrameLoaded(() => {
            contentHostBridge.sendInitialContent();
            if (isMain) endpoint.emit("save.handlerSync", {});
            sharedStateBridge.sendSnapshot();
            void sourceBridge.flushPendingSourceUrls();
            if (isMain) options.focusFrame();
        }));
        this.subscriptions.push(session.onPortDelivered(() => {
            void sourceBridge.flushPendingSourceUrls();

        }));
        new BoardHostRouter(
            session,
            endpoint,
            model,
            boardRoot,
            isMain,
            {
                capability,
                hostEvents,
                fetchHandler,
                aiVisionBridge,
                chromeBridge,
                settingsBridge,
                sourceBridge,
                pageStateBridge,
                contentOpenBridge,
                sharedStateBridge,
                contentHostBridge,
                notifyBridge,
            },
        );
    }

    async start(): Promise<void> {
        this.subscriptions.push(this.endpoint.listen());
        if (this.options.isMain) this.subscriptions.push(pagesModel.onFocus.subscribe((page) => {
            if (!this.session.isAlive || page !== this.options.model.page) return;
            if (this.focusTimer !== undefined) clearTimeout(this.focusTimer);
            this.focusTimer = setTimeout(() => {
                this.focusTimer = undefined;
                if (this.session.isAlive) this.options.focusFrame();
            }, 200);
        }));
        this.lastPageVisibility = this.options.getPageVisibility();
        this.subscriptions.push(pagesModel.state.subscribe(() => {
            const visible = this.options.getPageVisibility();
            if (this.lastPageVisibility === visible) return;
            this.lastPageVisibility = visible;
            this.endpoint.emit("page.visibility", { visible });
        }));
        await this.session.start();
        if (!this.session.isAlive) return;
        this.contentHostBridge.start();
        this.sharedStateBridge.start();
        this.sourceBridge.start();
        this.settingsBridge.installBoardSettings();
    }

    mountFrame(frame: HTMLIFrameElement, generation: number): void {
        this.options.model.aiVision.attachTransport(this.session.tabId, {
            iframe: frame,
            generation,
            request: this.aiVisionBridge.requestAiVision,
        });
    }
    sendToolbarControl(event: ToolbarAction): void {
        this.chromeBridge.sendToolbarControl(event);

    }
    sendStatusBarAction(event: { id: string }, generation: number): void {
        this.chromeBridge.sendStatusBarAction(event, generation);

    }
    dispose(): void {
        if (this.focusTimer !== undefined) clearTimeout(this.focusTimer);
        for (const unsubscribe of this.subscriptions) unsubscribe();
        this.capability.dispose();
        this.sourceBridge.dispose();
        this.contentHostBridge.dispose();
        this.sharedStateBridge.dispose();
        this.settingsBridge.dispose();
    }
}
