import type { BoardCapabilityFrameAdapter } from "../../../api/capabilities/board-capability-frame-adapter";
import type { ContentHostBridge } from "./content-host-bridge";
import type { ContentOpenBridge } from "./content-open-bridge";
import type { SettingsAndVarsBridge } from "./settings-and-vars-bridge";
import type { PageStateBridge } from "./page-state-bridge";
import type { SourceBridge } from "./source-bridge";
import type { FetchBridgeHandler } from "./fetch-bridge-handler";
import type { BoardHostEvents } from "./board-host-events";
import type { ChromeBridge } from "./chrome-bridge";
import type { SharedStateBridge } from "./shared-state-bridge";
import type { AiVisionBridge } from "./ai-vision-bridge";
import type { NotifyBridge } from "./notify-bridge";
import { codedError } from "../../../../shared/coded-error";
import type {
    BoardToHostEvents,
    BoardToHostRequests,
    RequestParams,
    RequestResult,
} from "../../../../ipc/board-bridge/frame-protocol";
import { NO_REPLY } from "../../../../ipc/board-bridge/frame-protocol";
import type { BoardEditorModel } from "../BoardEditorModel";
import { boardRegistry } from "../../../api/boards/board-registry";
import { BoardFrameEndpoint, type BoardFrameRequestContext } from "./BoardFrameEndpoint";
import { BoardFrameSession, type BoardFrameStamp } from "./BoardFrameSession";

export type BoardMainFrameGate = {
    readonly kind: "main" | "mainTrusted" | "mainTrustedText" | "trusted";
    readonly rejectionLog?: string;
};

export interface BoardMessageContext {
    readonly model: BoardEditorModel;
    readonly host: string;
    readonly frame: HTMLIFrameElement;
    readonly generation: number;
    readonly requestId?: string | number;
}

export type BoardRequestHandlers = {
    [Method in keyof BoardToHostRequests]: {
        readonly gate?: BoardMainFrameGate;
        readonly handle: (
            params: RequestParams<BoardToHostRequests, Method>,
            context: BoardMessageContext,
        ) =>
            | RequestResult<BoardToHostRequests, Method>
            | Promise<RequestResult<BoardToHostRequests, Method>>
            | typeof NO_REPLY
            | Promise<RequestResult<BoardToHostRequests, Method> | typeof NO_REPLY>;
        readonly undelivered?: (value: RequestResult<BoardToHostRequests, Method>, context: BoardMessageContext) => void;
    };
};
export type BoardEventHandlers = {
    [Name in keyof BoardToHostEvents]: {
        readonly gate?: BoardMainFrameGate;
        readonly reject?: (payload: BoardToHostEvents[Name], context: BoardMessageContext) => void;
        readonly handle: (payload: BoardToHostEvents[Name], context: BoardMessageContext) => void;
    };
};
interface HandlerEntry {
    readonly gate?: BoardMainFrameGate;
    readonly handle: (payload: unknown, context: BoardMessageContext) => unknown;
    readonly undelivered?: (value: unknown, context: BoardMessageContext) => void;
}
interface EventHandlerEntry {
    readonly gate?: BoardMainFrameGate;
    readonly reject?: (payload: unknown, context: BoardMessageContext) => void;
    readonly handle: (payload: unknown, context: BoardMessageContext) => void;
}

export const BOARD_MESSAGE_GATES = {
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
    statusBarItems: {
        kind: "mainTrusted",
        rejectionLog: "Ignored board status-bar items from a non-main or unavailable frame.",
    },
    statusBarUpdate: {
        kind: "mainTrusted",
        rejectionLog: "Ignored board status-bar update from a non-main or unavailable frame.",
    },
    aiVision: {
        kind: "mainTrusted",
        rejectionLog: "Ignored invalid or untrusted AiVision registration.",
    },
    aiNotify: {
        kind: "mainTrustedText",
    },
} satisfies Record<string, BoardMainFrameGate>;

function request<M extends keyof BoardToHostRequests>(
    _method: M,
    gate: BoardMainFrameGate | undefined,
    entry: BoardRequestHandlers[M],
): BoardRequestHandlers[M] {
    return { ...entry, gate };
}

function event<E extends keyof BoardToHostEvents>(
    _name: E,
    gate: BoardMainFrameGate | undefined,
    entry: BoardEventHandlers[E],
): BoardEventHandlers[E] {
    return { ...entry, gate };
}

export interface BoardHostFeatures {
    capability: BoardCapabilityFrameAdapter;
    contentHostBridge: ContentHostBridge;
    contentOpenBridge: ContentOpenBridge;
    settingsBridge: SettingsAndVarsBridge;
    pageStateBridge: PageStateBridge;
    sourceBridge: SourceBridge;
    fetchHandler: FetchBridgeHandler;
    hostEvents: BoardHostEvents;
    chromeBridge: ChromeBridge;
    sharedStateBridge: SharedStateBridge;
    aiVisionBridge: AiVisionBridge;
    notifyBridge: NotifyBridge;
}

export class BoardHostRouter {
    private get requestHandlers(): BoardRequestHandlers {
        return {
            filePath: request(
                "filePath",
                { kind: "trusted" },
                {
                    handle: (params, context) => this.features.contentHostBridge.filePath(params, context),
                }
            ),
            fileIcons: request(
                "fileIcons",
                { kind: "trusted" },
                {
                    handle: (params) => this.features.contentHostBridge.fileIcons(params),
                }
            ),
            contentOpen: request(
                "contentOpen",
                { kind: "trusted" },
                {
                    handle: (params, context) => this.features.contentOpenBridge.open(params, context),
                    undelivered: (value, context) => this.features.contentOpenBridge.undelivered(value, context),
                }
            ),
            openContent: request(
                "openContent",
                { kind: "trusted" },
                {
                    handle: (params) => this.features.contentOpenBridge.openContent(params),
                }
            ),
            "var.get": request(
                "var.get",
                { kind: "trusted" },
                {
                    handle: ({ name, env }) => this.features.settingsBridge.runVar<string | undefined>("get", [name, env]),
                }
            ),
            "var.set": request(
                "var.set",
                { kind: "trusted" },
                {
                    handle: ({ name, value, env }) => this.features.settingsBridge.runVar<void>("set", [name, value, env]),
                }
            ),
            "var.list": request(
                "var.list",
                { kind: "trusted" },
                {
                    handle: ({ env }) => this.features.settingsBridge.runVar<string[]>("list", [env]),
                }
            ),
            "var.show": request(
                "var.show",
                { kind: "trusted" },
                {
                    handle: () => this.features.settingsBridge.runVar<void>("show", []),
                }
            ),
            "settings.get": request(
                "settings.get",
                { kind: "trusted" },
                {
                    handle: (params) => this.features.settingsBridge.getSetting(params),
                }
            ),
            "pageState.get": request(
                "pageState.get",
                {
                    kind: "trusted",
                    rejectionLog: "Ignored page-state request from an untrusted board.",
                },
                {
                    handle: (params) => this.features.pageStateBridge.get(params),
                }
            ),
            "pageState.set": request(
                "pageState.set",
                {
                    kind: "trusted",
                    rejectionLog: "Ignored page-state request from an untrusted board.",
                },
                {
                    handle: (params) => this.features.pageStateBridge.set(params),
                }
            ),
            "pageState.remove": request(
                "pageState.remove",
                {
                    kind: "trusted",
                    rejectionLog: "Ignored page-state request from an untrusted board.",
                },
                {
                    handle: (params) => this.features.pageStateBridge.remove(params),
                }
            ),
            "source.navigate": request(
                "source.navigate",
                {
                    kind: "mainTrusted",
                    rejectionLog: "Ignored source navigation from a secondary or unavailable board frame.",
                },
                {
                    handle: (params) => this.features.sourceBridge.navigate(params),
                }
            ),
            "navigation.createReturnUrl": request(
                "navigation.createReturnUrl",
                { kind: "trusted" },
                {
                    handle: (_params, context) => this.features.sourceBridge.createReturnUrl(context),
                }
            ),
            "capabilities.invoke": request(
                "capabilities.invoke",
                { kind: "trusted" },
                {
                    handle: (message) => this.features.capability.invoke(message),
                }
            ),
            fetch: request(
                "fetch",
                {
                    kind: "trusted",
                    rejectionLog: "persephone.fetch requires a trusted board",
                },
                {
                    handle: (params, context) => this.features.fetchHandler.start(params, context),
                    undelivered: (_head, context) => this.features.fetchHandler.abortContext(context),
                }
            ),
        } satisfies BoardRequestHandlers;
    }
    private get eventHandlers(): BoardEventHandlers {
        return {
            interact: event(
                "interact",
                undefined,
                {
                    handle: (_payload, context) => this.features.hostEvents.interact(context.frame),
                }
            ),
            error: event(
                "error",
                undefined,
                {
                    handle: (payload) => this.features.hostEvents.error(payload),
                }
            ),
            log: event(
                "log",
                undefined,
                {
                    handle: (payload) => this.features.hostEvents.log(payload),
                }
            ),
            busy: event(
                "busy",
                undefined,
                {
                    handle: (payload) => this.features.hostEvents.busy(payload),
                }
            ),
            working: event(
                "working",
                {
                    kind: "mainTrusted",
                    rejectionLog: "Ignored working state from a secondary or unavailable board frame.",
                },
                {
                    handle: (payload, context) => this.features.chromeBridge.working(payload, context),
                }
            ),
            "modified.set": event(
                "modified.set",
                {
                    kind: "mainTrusted",
                    rejectionLog: "Ignored dirty-state update from a secondary or unavailable board frame.",
                },
                {
                    handle: (payload, context) => this.features.chromeBridge.modified(payload, context),
                }
            ),
            "muted.set": event(
                "muted.set",
                {
                    kind: "mainTrusted",
                    rejectionLog: "Ignored tab mute state from a secondary or unavailable board frame.",
                },
                {
                    handle: (payload, context) => this.features.chromeBridge.muted(payload, context),
                }
            ),
            saveHandler: event(
                "saveHandler",
                {
                    kind: "mainTrusted",
                    rejectionLog: "Ignored Save handler registration from a secondary or unavailable board frame.",
                },
                {
                    handle: (payload, context) => this.features.chromeBridge.saveHandler(payload, context),
                }
            ),
            "content.set": event(
                "content.set",
                undefined,
                {
                    handle: (payload) => this.features.contentHostBridge.setContent(payload),
                }
            ),
            "content.save": event(
                "content.save",
                undefined,
                {
                    handle: () => this.features.contentHostBridge.saveContent(),
                }
            ),
            "state.set": event(
                "state.set",
                undefined,
                {
                    handle: (payload) => this.features.sharedStateBridge.set(payload),
                }
            ),
            "state.merge": event(
                "state.merge",
                undefined,
                {
                    handle: (payload) => this.features.sharedStateBridge.merge(payload),
                }
            ),
            "state.init": event(
                "state.init",
                undefined,
                {
                    handle: (payload) => this.features.sharedStateBridge.init(payload),
                }
            ),
            "secondaryViews.set": event(
                "secondaryViews.set",
                undefined,
                {
                    handle: (payload) => this.features.sharedStateBridge.setSecondaryViews(payload),
                }
            ),
            "statusText.set": event(
                "statusText.set",
                { kind: "main" },
                {
                    handle: (payload, context) => this.features.chromeBridge.statusText(payload, context),
                }
            ),
            "toolbar.setText": event(
                "toolbar.setText",
                BOARD_MESSAGE_GATES.toolbarText,
                {
                    handle: (payload, context) => this.features.chromeBridge.toolbarText(payload, context),
                }
            ),
            "toolbar.set": event(
                "toolbar.set",
                BOARD_MESSAGE_GATES.toolbarControls,
                {
                    handle: (payload, context) => this.features.chromeBridge.toolbarSet(payload, context),
                }
            ),
            "toolbar.update": event(
                "toolbar.update",
                BOARD_MESSAGE_GATES.toolbarUpdate,
                {
                    handle: (payload, context) => this.features.chromeBridge.toolbarUpdate(payload, context),
                }
            ),
            "statusBar.set": event(
                "statusBar.set",
                BOARD_MESSAGE_GATES.statusBarItems,
                {
                    handle: (payload, context) => this.features.chromeBridge.statusBarSet(payload, context),
                }
            ),
            "statusBar.update": event(
                "statusBar.update",
                BOARD_MESSAGE_GATES.statusBarUpdate,
                {
                    handle: (payload, context) => this.features.chromeBridge.statusBarUpdate(payload, context),
                }
            ),
            "theme.cycle": event(
                "theme.cycle",
                undefined,
                {
                    handle: (payload) => this.features.hostEvents.cycle(payload),
                }
            ),
            "aiVision.register": event(
                "aiVision.register",
                BOARD_MESSAGE_GATES.aiVision,
                {
                    handle: (payload, context) => this.features.aiVisionBridge.handleAiVisionRegistration(
                        payload,
                        context.model,
                        context.frame,
                        context.generation,
                    ),
                }
            ),
            "aiVision.notify": event(
                "aiVision.notify",
                BOARD_MESSAGE_GATES.aiNotify,
                {
                    handle: (payload, context) => this.features.notifyBridge.handleAiVisionNotify(payload, context.model),
                }
            ),
            "fetch.pull": event(
                "fetch.pull",
                {
                    kind: "trusted",
                    rejectionLog: "persephone.fetch requires a trusted board",
                },
                {
                    handle: (payload) => this.features.fetchHandler.pull(payload),
                    reject: (payload) => this.features.fetchHandler.reject(payload),
                }
            ),
            "fetch.abort": event(
                "fetch.abort",
                {
                    kind: "trusted",
                    rejectionLog: "persephone.fetch requires a trusted board",
                },
                {
                    handle: (payload) => this.features.fetchHandler.abort(payload),
                    reject: (payload) => this.features.fetchHandler.reject(payload),
                }
            ),
        } satisfies BoardEventHandlers;
    }
    constructor(
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
        private readonly model: BoardEditorModel,
        private readonly boardRoot: string,
        private readonly isMain: boolean,
        private readonly features: BoardHostFeatures,
    ) {
        this.bindRequestHandlers();

    }

    private bindRequestHandlers(): void {
        const requests = this.requestHandlers;
        const events = this.eventHandlers;
        for (const method of Object.keys(requests) as (keyof BoardToHostRequests)[]) {
            const entry = requests[method] as unknown as HandlerEntry;
            this.endpoint.handle(method as never, ((params: unknown, stamp: BoardFrameRequestContext) => {
                if (!this.session.isCurrent(stamp.generation, stamp.frame)) return NO_REPLY;
                const context = this.requestContext(stamp, stamp.id);
                if (!this.passesGate(entry.gate, params, context)) {
                    if (entry.gate?.rejectionLog) this.session.log("warn", entry.gate.rejectionLog);
                    throw codedError("untrusted", "This board is no longer trusted.");
                }
                return entry.handle(params, context);
            }) as never, {
                undelivered: ((value: unknown, stamp: BoardFrameRequestContext) =>
                    entry.undelivered?.(value, this.requestContext(stamp, stamp.id))) as never,
            });
        }
        for (const name of Object.keys(events) as (keyof BoardToHostEvents)[]) {
            const entry = events[name] as unknown as EventHandlerEntry;
            this.endpoint.on(name as never, ((payload: unknown, stamp: BoardFrameStamp) => {
                if (!this.session.isCurrent(stamp.generation, stamp.frame)) return;
                const context = this.requestContext(stamp);
                if (!this.passesGate(entry.gate, payload, context)) {
                    if (entry.gate?.rejectionLog) this.session.log("warn", entry.gate.rejectionLog);
                    entry.reject?.(payload, context);
                    return;
                }
                entry.handle(payload, context);
            }) as never);
        }
    }

    private passesGate(gate: BoardMainFrameGate | undefined, payload: unknown, context: BoardMessageContext): boolean {
        if (!gate) return true;
        if (gate.kind === "trusted") return boardRegistry.isPermitted(this.boardRoot);
        if (gate.kind === "main") return this.isMain;
        return this.isMain && this.session.isCurrent(context.generation, context.frame)
            && boardRegistry.isPermitted(this.boardRoot)
            && (gate.kind !== "mainTrustedText" || typeof (payload as { text?: unknown }).text === "string");
    }

    private requestContext(stamp: BoardFrameStamp, requestId?: string | number): BoardMessageContext {
        return { model: this.model, host: stamp.host, frame: stamp.frame, generation: stamp.generation, requestId };
    }

}
