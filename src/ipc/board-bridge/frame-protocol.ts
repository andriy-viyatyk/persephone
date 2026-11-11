/** Private request, response, and event envelopes for a board iframe and its host renderer. */
import type { IAiRemoteRequest, IAiRemoteResponse, IAiVisionShape } from "ai-vision";
import type { BoardSourceContext } from "../../shared/board-source-context";
import type { RequestId } from "../../shared/pending-requests";
import type { WireError } from "../../shared/wire-error";
import type { IntentEnvelope } from "../capability-bus-channels";
import type { BoardToMainEvents, MainToBoardEvents } from "./port-protocol";
import type {
    BoardToolbarControlType,
    BoardToolbarControlDescriptor,
    BoardToolbarControlPatch,
    BoardStatusBarItem,
    BoardStatusBarPatch,
} from "./ui-catalog";

/** `persephone.openContent(...)` creates an in-memory untitled page in the board's window. */
export interface BoardOpenContentRequest {
    editor?: string;
    language?: string;
    title?: string;
    content?: string;
}

/** Host init handshake; the transferred port is in `event.ports[0]`. */
export interface BoardPortInitMsg {
    __persephoneInit: true;
    pageId?: string;
    pageVisible: boolean;
    voiceTypingAutoStopSilenceMs: number;
    intent?: IntentEnvelope;
    pipeUrlEnabled?: boolean;
    busy?: boolean;
    filePath?: string;
    sourceUrl?: string;
    sourceContext?: BoardSourceContext;
    initialSourcePrivateSession?: boolean;
    folderPath?: string;
    contentHost?: boolean;
    materialize?: boolean;
}

/** Supported options forwarded by the board-frame fetch bridge. */
export interface BoardFetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    timeout?: number;
    maxRedirects?: number;
    rejectUnauthorized?: boolean;
    tor?: boolean;
    proxy?: string;
}

export interface BoardFileIconsResult { urls: string[]; icons: Record<string, number> }
export interface BoardContentOpenResult { url: string; size: number; contentType: string }
export interface BoardFetchHead { status: number; statusText: string; headers: [string, string][]; hasBody: boolean }

export type NoPayload = Record<string, never>;
export interface FrameMethod<P, R> { params: P; result: R }

export interface BoardToHostRequests {
    filePath: FrameMethod<NoPayload, string | undefined>;
    fileIcons: FrameMethod<{ names: string[] }, BoardFileIconsResult>;
    contentOpen: FrameMethod<{ link: string; timeoutMs?: number }, BoardContentOpenResult>;
    openContent: FrameMethod<{ request: BoardOpenContentRequest }, string>;
    "var.get": FrameMethod<{ name: string; env?: string }, string | undefined>;
    "var.set": FrameMethod<{ name: string; value: string; env?: string }, void>;
    "var.list": FrameMethod<{ env?: string }, string[]>;
    "var.show": FrameMethod<NoPayload, void>;
    "settings.get": FrameMethod<{ id: string }, string | number | boolean>;
    "pageState.get": FrameMethod<{ key: string }, string | undefined>;
    "pageState.set": FrameMethod<{ key: string; value: string }, void>;
    "pageState.remove": FrameMethod<{ key: string }, void>;
    "source.navigate": FrameMethod<{ href: string }, void>;
    "navigation.createReturnUrl": FrameMethod<NoPayload, string>;
    "capabilities.invoke": FrameMethod<
        { id: string; version?: number; payload: unknown; deadlineMs?: number },
        { pageId?: string; result?: unknown }
    >;
    fetch: FrameMethod<{ url: string; init: BoardFetchInit }, BoardFetchHead>;
}

export interface HostToBoardRequests {
    save: FrameMethod<{ discard?: boolean }, { success: boolean; error?: string }>;
    "aiVision.request": FrameMethod<{ request: IAiRemoteRequest }, IAiRemoteResponse>;
    "capabilities.intent": FrameMethod<IntentEnvelope, { result?: unknown; discardPage?: boolean }>;
}

export interface BoardToHostEvents {
    interact: NoPayload;
    error: { message: string };
    log: { level: "warn" | "error"; message: string };
    busy: { busy: boolean };
    working: { working: boolean };
    "modified.set": { modified: boolean };
    "muted.set": { muted: boolean | null };
    saveHandler: { handlerId: number; registered: boolean };
    "content.set": { content: string };
    "content.save": NoPayload;
    "state.set": { state: Record<string, unknown> };
    "state.merge": { partial: Record<string, unknown> };
    "state.init": { defaults: Record<string, unknown>; restorableKeys?: string[] };
    "secondaryViews.set": { views: Array<{ id: string; html?: string; title?: string }> };
    "statusText.set": { statusText: string };
    "toolbar.setText": { toolbarText: string };
    "toolbar.set": { controls: readonly BoardToolbarControlDescriptor[] };
    "toolbar.update": { controls: readonly BoardToolbarControlPatch[] };
    "statusBar.set": { items: readonly BoardStatusBarItem[] };
    "statusBar.update": { items: readonly BoardStatusBarPatch[] };
    "theme.cycle": { direction: 1 | -1 };
    "aiVision.register": { schemaVersion: number; shape: IAiVisionShape; reason?: "register" | "refresh" };
    "aiVision.notify": { text: string };
    "fetch.pull": { id: number };
    "fetch.abort": { id: number };
}

export interface HostToBoardEvents {
    "host.content": { content: string; language?: string };
    "source.opened": { sourceUrl: string; privateSession?: boolean; context?: BoardSourceContext };
    "state.sync": { state: Record<string, unknown>; seq: number };
    "settings.changed": { id: string; value: string | number | boolean };
    "voiceTyping.autoStopSilenceChanged": { milliseconds: number };
    "toolbar.control": { id: string; type: BoardToolbarControlType; value?: boolean | string };
    "statusBar.action": { id: string };
    "page.muteToggle": NoPayload;
    "page.visibility": { visible: boolean };
    "navigation.return": {
        url: string;
        query: Readonly<Record<string, readonly string[]>>;
        hash: Readonly<Record<string, readonly string[]>>;
    };
    "save.handlerSync": NoPayload;
    "capabilities.cancel": { requestId: string };
    "service.channelPort": { channelId: string };
    "fetch.chunk": { id: number; chunk?: ArrayBuffer; done: boolean };
    "fetch.error": { id: number; message: string };
}

export type RequestParams<Map, M extends keyof Map> = Map[M] extends FrameMethod<infer P, unknown> ? P : never;
export type RequestResult<Map, M extends keyof Map> = Map[M] extends FrameMethod<unknown, infer R> ? R : never;
type TypedEnvelope<Requests, Events> =
    | {
        [M in keyof Requests & string]: {
            __persephone: "req";
            id: RequestId;
            method: M;
            params: RequestParams<Requests, M>;
        };
    }[keyof Requests & string]
    | { __persephone: "res"; id: RequestId; ok: true; value: unknown }
    | { __persephone: "res"; id: RequestId; ok: false; error: WireError }
    | { [E in keyof Events & string]: { __persephone: "evt"; name: E; payload: Events[E] } }[keyof Events & string];

export type HostToBoardEnvelope = TypedEnvelope<HostToBoardRequests, HostToBoardEvents>;
export type BoardToHostEnvelope = TypedEnvelope<BoardToHostRequests, BoardToHostEvents>;
export type FrameRequestEnvelope = { __persephone: "req"; id: RequestId; method: string; params: unknown };
export type FrameResponseEnvelope =
    | { __persephone: "res"; id: RequestId; ok: true; value: unknown }
    | { __persephone: "res"; id: RequestId; ok: false; error: WireError };
export type FrameEventEnvelope = { __persephone: "evt"; name: string; payload: unknown };
export type FrameEnvelope = FrameRequestEnvelope | FrameResponseEnvelope | FrameEventEnvelope;

export function frameRequest<M extends string>(id: RequestId, method: M, params: unknown): FrameRequestEnvelope {
    return { __persephone: "req", id, method, params };
}
export function frameResponse(
    id: RequestId,
    outcome: { ok: true; value: unknown } | { ok: false; error: WireError },
): FrameResponseEnvelope {
    return { __persephone: "res", id, ...outcome };
}
export function frameEvent<E extends keyof HostToBoardEvents>(
    name: E,
    payload: HostToBoardEvents[E],
): Extract<HostToBoardEnvelope, { __persephone: "evt"; name: E }>;
export function frameEvent<E extends keyof BoardToHostEvents>(
    name: E,
    payload: BoardToHostEvents[E],
): Extract<BoardToHostEnvelope, { __persephone: "evt"; name: E }>;
export function frameEvent<E extends keyof BoardToMainEvents>(
    name: E,
    payload: BoardToMainEvents[E],
): { __persephone: "evt"; name: E; payload: BoardToMainEvents[E] };
export function frameEvent<E extends keyof MainToBoardEvents>(
    name: E,
    payload: MainToBoardEvents[E],
): { __persephone: "evt"; name: E; payload: MainToBoardEvents[E] };
export function frameEvent<Events extends Record<string, unknown>, E extends keyof Events & string>(
    name: E,
    payload: Events[E],
): { __persephone: "evt"; name: E; payload: Events[E] };
export function frameEvent(name: string, payload: unknown): FrameEventEnvelope;
export function frameEvent(name: string, payload: unknown): FrameEventEnvelope { return { __persephone: "evt", name, payload }; }

/** Structural envelope parse. Call only after the sender source and origin are gated. */
export function readFrameEnvelope(data: unknown): FrameEnvelope | undefined {
    if (typeof data !== "object" || data === null) return undefined;
    const value = data as Record<string, unknown>;
    if (
        value.__persephone === "req" &&
        (typeof value.id === "string" || typeof value.id === "number") &&
        typeof value.method === "string" &&
        Object.prototype.hasOwnProperty.call(value, "params")
    ) {
        return { __persephone: "req", id: value.id, method: value.method, params: value.params };
    }
    if (value.__persephone === "res" && (typeof value.id === "string" || typeof value.id === "number") && typeof value.ok === "boolean") {
        if (value.ok === true && Object.prototype.hasOwnProperty.call(value, "value")) return { __persephone: "res", id: value.id, ok: true, value: value.value };
        if (typeof value.error === "object" && value.error !== null) {
            return { __persephone: "res", id: value.id, ok: false, error: value.error as WireError };
        }
    }
    if (value.__persephone === "evt" && typeof value.name === "string" && Object.prototype.hasOwnProperty.call(value, "payload")) {
        return { __persephone: "evt", name: value.name, payload: value.payload };
    }
    return undefined;
}

export function isBoardPortInit(data: unknown): data is BoardPortInitMsg {
    return typeof data === "object" && data !== null && (data as { __persephoneInit?: unknown }).__persephoneInit === true;
}

/** Board-to-host events deferred until the shim's own document load has fired. */
export const BOARD_TO_HOST_EVENTS_AFTER_LOAD: ReadonlySet<keyof BoardToHostEvents> =
    new Set(["toolbar.set", "toolbar.update", "toolbar.setText", "statusBar.set", "statusBar.update"]);

/** Return from a request handler to suppress its response. */
export const NO_REPLY: unique symbol = Symbol("persephone.frame.no-reply");
