import { isBoardSettingValue } from "./shared/board/board-settings-declarations";
import { isCapabilityErrorCode, type CapabilityErrorCode } from "./shared/capability-constants";
import { formatMessage } from "./shared/i18n/format-message";
import { ENGLISH_BOARD_HOST_TEXT } from "./shared/board/host-text";
import { validateBoardPageStateKey, validateBoardPageStateValue } from "./shared/board/page-state-validation";
import { PLATFORM_AUDIO_CAPABILITY_ID } from "./shared/capability-constants";
import { createCapabilityProxy } from "./shared/capability-client";
import { PendingRequests } from "./shared/pending-requests";
import { fromWireError } from "./shared/wire-error";
/**
 * Board bridge shim — the successor to `preload-board.ts`.
 *
 * Unlike a webview preload, this runs in a PLAIN BROWSER context inside the board
 * `<iframe>` (no Node, no Electron, no `ipcRenderer`). The `board://` handler inlines
 * its built output (`board-shim.js`) into served board HTML `<head>`, BEFORE any
 * author script, so `window.persephone` exists synchronously when the board runs.
 *
 * Transport: a `MessageChannelMain` port minted per board in main and transferred
 * into this frame by the host renderer (the one-time handshake). Until the port
 * arrives, port-dependent calls QUEUE; on connect they FLUSH. Thereafter the board
 * talks DIRECTLY to a main-process handler over the duplex port — request/reply
 * (dialogs, readFile/writeFile, openRawLink), fire-and-forget (notify), streaming
 * `execute()` (stdout/stderr/exit/error + stdin/kill), and a main→board theme push.
 *
 * The `window.persephone` surface is byte-for-byte the same as the old preload so
 * board authors see no difference. Build: a standalone browser IIFE (no runtime
 * imports beyond dependency-free modules — the `RunnerChannel` string enum, the
 * `errMessage` helper and the shared `execute()` handle). Built as
 * `format: "iife"` by scripts/build-prod.mjs and scripts/dev.mjs.
 */
import {
    RunnerChannel,
    type IExecuteHandle,
    type IExecuteOptions,
    type RunnerInboundChannel,
    type RunnerInboundMsg,
} from "./ipc/runner-channels";
import { createExecuteHandle } from "./shared/execute-handle";
import { BOARD_BRIDGE_VERSION } from "./shared/board-bridge-version";
import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "./ipc/module-service-channels";
import { createServiceChannel, domPort, type ServiceChannel, type ServiceChannelKind } from "./shared/service-channel";
import type { BoardSourceContext } from "./shared/board-source-context";
import { NO_REPLY, type BoardFetchHead, type BoardFetchInit, type BoardOpenContentRequest, type BoardToHostEvents } from "./ipc/board-bridge/frame-protocol";
import type { BoardBootContext, BoardHostTextId, BoardThemePalette } from "./ipc/board-bridge/boot";
import type { BoardJsonValue, BoardFireMethod, BoardOpenRawLinkOptions, BoardJobInfo, BoardRpcMethod, BoardToMain, BoardWatchOptions, MainToBoard } from "./ipc/board-bridge/port-protocol";
import type { BoardToolbarControlType } from "./ipc/board-bridge/ui-catalog";
import type { BoardServiceStatus } from "./ipc/module-service-channels";
import { BOARD_DIALOG_MAX_BYTES, BOARD_DIALOG_PATH, boardPipePagePath } from "./ipc/board-bridge/origin-routes";
import type { BoardDialogKind, BoardDialogXhrRequest } from "./ipc/board-bridge/origin-routes";
import type { PathWatchBatch } from "./ipc/api-types";
import type { IntentEnvelope, CapabilityClientInvoke, CapabilityClientOptions, CapabilityClientResult, CapabilityProvider } from "./ipc/capability-bus-channels";
import { AI_VISION_SCHEMA_VERSION, expose } from "ai-vision/remote";
import { createElements as createDomElements, highlightElement } from "ai-vision/dom";
import type {
    IAiElementDeclaration,
    IAiHostSignal,
    IAiRemoteRequest,
    IAiRemoteResponse,
    IAiVisionShape,
} from "ai-vision";
import type { IAiVisionRemote } from "ai-vision/remote";
import { installBoardDiagnostics } from "./board-console-mirror";
import { installBoardContextMenu } from "./board-context-menu";
import { HostFrameChannel } from "./board-host-frame-channel";
import { errMessage } from "./shared/utils";
import type { ThemeDefinition, ThemeDraft, ContrastReport, CustomThemeFile, CustomThemeBase } from "./renderer/api/types/themes";

function boardDialog(type: BoardDialogKind, message: string, defaultPrompt = ""): unknown {
    try {
        const identity = new URL(location.href);
        const body: BoardDialogXhrRequest = { type, message, defaultPrompt, url: location.href, nonce: identity.searchParams.get("v"), view: identity.searchParams.get("view") ?? "main" };
        const payload = JSON.stringify(body);
        if (new TextEncoder().encode(payload).length > BOARD_DIALOG_MAX_BYTES) return null;
        const request = new XMLHttpRequest();
        request.open("POST", `${location.protocol}//${location.host}${BOARD_DIALOG_PATH}`, false);
        request.setRequestHeader("Content-Type", "application/json");
        request.send(payload);
        return request.status === 200 ? JSON.parse(request.responseText) : null;
    } catch {
        return null;
    }
}

window.alert = (message?: unknown): void => { boardDialog("alert", String(message ?? "")); };
window.confirm = (message?: string): boolean => boardDialog("confirm", String(message ?? "")) === true;
window.prompt = (message?: string, defaultValue?: string): string | null => {
    const result = boardDialog("prompt", String(message ?? ""), String(defaultValue ?? ""));
    return typeof result === "string" ? result : null;
};

type BoardThemes = {
    list(): Promise<ThemeDefinition[]>;
    get(id: string): Promise<ThemeDefinition | null>;
    current(): Promise<ThemeDefinition>;
    derive(base: CustomThemeBase, isDark?: boolean | null): Promise<ThemeDefinition>;
    contrast(input: ThemeDefinition | CustomThemeFile | ThemeDraft): Promise<ContrastReport>;
    fork(id: string): Promise<ThemeDraft>;
    file(id: string): Promise<CustomThemeFile | null>;
    save(draft: ThemeDraft): Promise<CustomThemeFile>;
    rename(id: string, name: string): Promise<CustomThemeFile>;
    delete(id: string): Promise<void>;
    apply(id: string): Promise<void>;
    preview(draft: ThemeDraft): Promise<ThemeDefinition>;
    endPreview(): Promise<void>;
};

function cloneBoardJson<T>(value: T): T {
    const seen = new Set<object>();
    const validate = (item: unknown): void => {
        if (item === null || typeof item === "string" || typeof item === "boolean") return;
        if (typeof item === "number" && Number.isFinite(item)) return;
        if (typeof item !== "object" || seen.has(item)) throw new Error("persephone.themes accepts JSON values only.");
        seen.add(item);
        if (Array.isArray(item)) {
            for (let index = 0; index < item.length; index++) {
                if (!Object.prototype.hasOwnProperty.call(item, index)) throw new Error("persephone.themes accepts JSON arrays only.");
                validate(item[index]);
            }
            if (Reflect.ownKeys(item).some((key) => key !== "length" && (typeof key !== "string" || !/^\d+$/.test(key)))) {
                throw new Error("persephone.themes accepts JSON arrays only.");
            }
        }
        else {
            const prototype = Object.getPrototypeOf(item);
            if (prototype !== Object.prototype && prototype !== null) throw new Error("persephone.themes accepts plain JSON objects only.");
            for (const key of Reflect.ownKeys(item)) {
                if (typeof key !== "string") throw new Error("persephone.themes accepts plain JSON objects only.");
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("persephone.themes accepts plain JSON objects only.");
                validate(descriptor.value);
            }
        }
        seen.delete(item);
    };
    validate(value);
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("persephone.themes accepts JSON values only.");
    return JSON.parse(encoded) as T;
}

function boardThemeCall<T>(method: string, args: unknown[] = []): Promise<T> {
    let safeArgs: unknown[];
    try { safeArgs = cloneBoardJson(args); }
    catch (error: unknown) { return Promise.reject(error); }
    return call(`themes.${method}`, { args: safeArgs }).then((result) => cloneBoardJson(result) as T);
}

function createBoardThemes(): BoardThemes {
    return {
        list: () => boardThemeCall("list"),
        get: (id) => boardThemeCall("get", [id]),
        current: () => boardThemeCall("current"),
        derive: (base: CustomThemeBase, isDark?: boolean | null) => boardThemeCall("derive", isDark === undefined ? [base] : [base, isDark]),
        contrast: (input) => boardThemeCall<ContrastReport>("contrast", [input]),
        fork: (id) => boardThemeCall("fork", [id]),
        file: (id) => boardThemeCall("file", [id]),
        save: (draft: ThemeDraft) => boardThemeCall("save", [draft]),
        rename: (id, name) => boardThemeCall("rename", [id, name]),
        delete: (id) => boardThemeCall("delete", [id]),
        apply: (id) => boardThemeCall("apply", [id]),
        preview: (draft: ThemeDraft) => boardThemeCall("preview", [draft]),
        endPreview: () => boardThemeCall("endPreview"),
    };
}

class ProviderRegistrationServiceOnlyError extends Error {
    readonly code = "provider-registration-service-only";

    constructor() {
        super("persephone.providers.register() is available only in the board module service.");
        this.name = "ProviderRegistrationServiceOnlyError";
    }
}

// ── Boot context (injected synchronously before this script) ─────────────────

const boot: BoardBootContext =
    (window as unknown as { __persephoneBoot?: BoardBootContext }).__persephoneBoot ?? {
        theme: { id: "", isDark: true, vars: {} },
        tokens: {},
        i18n: { locale: { code: "en" }, tables: [{}, {}, {}] },
        hostText: {} as BoardBootContext["hostText"],
        hostOrigin: "",
    };

function resolveBoardHostText(id: BoardHostTextId, params?: { error?: string }): string {
    const template = boot.hostText[id] || ENGLISH_BOARD_HOST_TEXT[id];
    return params?.error === undefined ? template : template.replace(/\{error\}/g, params.error);
}
const boardLocale = Object.freeze({ code: boot.i18n.locale.code });
const boardMessageTables = boot.i18n.tables;
let boardPluralRules: Intl.PluralRules;
try {
    boardPluralRules = new Intl.PluralRules(boardLocale.code);
} catch {
    boardPluralRules = new Intl.PluralRules("en");
}

function translateBoardMessage(key: string, params?: Record<string, unknown>): string {
    let message: string | Partial<Record<"zero" | "one" | "two" | "few" | "many" | "other", string>> | undefined;
    for (const table of boardMessageTables) {
        if (Object.prototype.hasOwnProperty.call(table, key)) {
            message = table[key];
            if (message !== undefined) break;
        }
    }
    if (message === undefined) return key;
    return formatMessage(message, undefined, params, count => boardPluralRules.select(count)) ?? key;
}

function hasBoardMessage(key: string): boolean {
    return boardMessageTables.some((table) => Object.prototype.hasOwnProperty.call(table, key));
}

// Origin-locking is only reliable for an http(s) dev host. In production the host
// window is loaded from `file://`, and the file origin is serialized inconsistently
// across boundaries: the main process bakes `new URL(file://…).origin` === "null"
// into `boot.hostOrigin`, while the board frame sees the host's `event.origin` as
// "file://" — so a strict `event.origin === boot.hostOrigin` check can never pass,
// and "file://"/"null" are not usable postMessage `targetOrigin`s anyway. So enforce
// origin-locking ONLY for an http(s) host; for a file:// (or unknown) host drop it:
// the load-bearing inbound gate is `event.source === window.parent`, and the
// outbound host-frame pings (non-sensitive, and re-validated by the host on board
// origin + source frame) target `"*"`.
const hostOriginStrict = /^https?:\/\//i.test(boot.hostOrigin);
const hostPostTarget = hostOriginStrict ? boot.hostOrigin : "*";
let hostRequestId = Math.floor(Math.random() * 0x80000000);
const hostFrame = new HostFrameChannel({
    targetOrigin: hostPostTarget,
    acceptOrigin: hostOriginStrict ? boot.hostOrigin : undefined,
    nextId: () => ++hostRequestId,
});

// ── View role ────────────────────────────────────────────────────────────────
// Which view this frame renders: "main" for the board's main iframe, or a declared
// secondary view's id. Delivered synchronously via the iframe src's `view=` query param
// (read here before any author script), so a single HTML file can branch on
// `persephone.view` to render every view. Absent → "main" (a plainly-loaded board).
let viewRole = "main";
try {
    const v = new URLSearchParams(location.search).get("view");
    if (v) viewRole = v;
} catch {
    // location unavailable — keep "main"
}

/** CSS-variable prefix of the graph color family. */
const P_GRAPH_PREFIX = "--p-graph-";

/** Derive `palette.graph` from the `--p-graph-*` entries of `vars`: the CSS suffix, camelCased
 *  (`--p-graph-node-default` → `nodeDefault`). A `<canvas>` cannot consume `var(...)`, so a board
 *  drawing a graph reads concrete values here; the CSS family stays the single source of truth, and
 *  a token added to it later shows up with no shim change. */
function withGraphPalette(palette: BoardThemePalette): BoardThemePalette {
    const graph: Record<string, string> = {};
    for (const [name, value] of Object.entries(palette.vars || {})) {
        if (!name.startsWith(P_GRAPH_PREFIX)) continue;
        const key = name
            .slice(P_GRAPH_PREFIX.length)
            .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        graph[key] = value;
    }
    return { ...palette, graph };
}

let currentTheme: BoardThemePalette = withGraphPalette(boot.theme);
const tokens: Record<string, string> = boot.tokens;
const themeCbs: Array<(t: BoardThemePalette) => void> = [];

// ── Busy flag ────────────────────────────────────────────────────────────────
// `null` until known: the handshake init message carries the host-side value (a
// re-created busy board reads `true`); a local `setBoardBusy` call sets it
// immediately and wins over a later-arriving init. `getBoardBusy()` awaits the
// handshake when called before either happened.

let busyState: boolean | null = null;
const busyResolvers: Array<(b: boolean) => void> = [];

function settleBusy(value: boolean): void {
    busyState = value;
    for (const r of busyResolvers) r(value);
    busyResolvers.length = 0;
}

// ── filePath ────────────────────────────────────────────────────────────────
// The file a custom-editor board edits, carried at the handshake. `getFilePath()` awaits
// the handshake; a plain board settles to `undefined`. A separate `settled` flag (not a
// null sentinel like busy) because `undefined` is itself a valid settled value.

let filePathSettled = false;
let filePathValue: string | undefined;
const filePathResolvers: Array<(p: string | undefined) => void> = [];
let sourceUrlSettled = false;
let sourceUrlValue: string | undefined;
let initialSourcePrivateSession = false;
let initialSourceContext: BoardSourceContext | undefined;
let pageVisible = false;
const pageVisibilityCbs = new Set<(visible: boolean) => void>();
let voiceTypingAutoStopSilenceMs = 0;
const voiceTypingAutoStopCbs = new Set<(milliseconds: number) => void>();
const sourceUrlResolvers: Array<(url: string | undefined) => void> = [];
interface PersephoneSourceOpenEvent {
    readonly url: string;
    readonly sourceUrl: string;
    readonly privateSession?: boolean;
    readonly context?: BoardSourceContext;
}
const sourceOpenCallbacks = new Set<(event: PersephoneSourceOpenEvent) => void>();
const watchCallbacks = new Map<number, (batch: PathWatchBatch) => void>();
let watchIdCounter = 0;
const pendingSourceOpenEvents: Array<{
    sourceUrl: string;
    privateSession?: boolean;
    context?: BoardSourceContext;
}> = [];
let folderPathValue: string | undefined;
let pipePageId: string | undefined;
let pipeUrlEnabled = false;

// True when the handshake `filePath` is NOT directly readable — its real source is an archive entry
// or an `http(s)` URL. `getFilePath()` then resolves through the frame request channel, so the
// board always receives a readable LOCAL path (Persephone materializes the source into a cache
// file). The resolved path is memoized below, so repeated calls cost one request.
let filePathNeedsMaterialize = false;
let materializedPath: string | undefined;
let materializedPromise: Promise<string | undefined> | null = null;

function settleFilePath(value: string | undefined): void {
    filePathSettled = true;
    filePathValue = value;
    for (const r of filePathResolvers) r(value);
    filePathResolvers.length = 0;
}

function settleSourceUrl(value: string | undefined): void {
    sourceUrlSettled = true;
    sourceUrlValue = value;
    for (const r of sourceUrlResolvers) r(value);
    sourceUrlResolvers.length = 0;
}

function deliverSourceOpen(
    sourceUrl: string,
    privateSession?: boolean,
    context?: BoardSourceContext,
): void {
    const event: PersephoneSourceOpenEvent = {
        url: sourceUrl,
        sourceUrl,
        ...(privateSession ? { privateSession: true } : {}),
        ...(context ? { context } : {}),
    };
    for (const callback of [...sourceOpenCallbacks]) {
        try {
            callback(event);
        } catch (error: unknown) {
            console.error("persephone.source.onOpen callback error:", errMessage(error));
        }
    }
}

function onSourceOpen(callback: (event: PersephoneSourceOpenEvent) => void): () => void {
    sourceOpenCallbacks.add(callback);
    while (pendingSourceOpenEvents.length > 0) {
        const pending = pendingSourceOpenEvents.shift();
        if (pending !== undefined) deliverSourceOpen(pending.sourceUrl, pending.privateSession, pending.context);
    }
    return () => sourceOpenCallbacks.delete(callback);
}

/** Resolves once the host handshake has landed (every handshake settles the file path,
 *  plain boards included) — the point where `hostEnabled` is authoritative. Lets the
 *  `host.*` API be called at ANY time: it awaits this gate internally instead of
 *  rejecting/no-oping when invoked before the handshake. */
function whenHandshake(): Promise<void> {
    if (filePathSettled) return Promise.resolve();
    return new Promise<void>((resolve) => filePathResolvers.push(() => resolve()));
}

// ── Host content ────────────────────────────────────────────────────────────
// Content-host boards read Persephone-owned content pushed as `host:content`. A snapshot lands
// after the frame loads, then on every change. `getContent()` awaits the first snapshot (settle-
// once + await-any-time, like getFilePath); `onContentChange` fires on each subsequent push.
// `hostEnabled` is set from the handshake — false on a plain board, where getContent rejects.

let hostEnabled = false;
let hostContentSettled = false;
let hostContent = "";
let hostLanguage: string | undefined;
const hostContentResolvers: Array<(c: string) => void> = [];
const hostChangeCbs: Array<(content: string, language?: string) => void> = [];

function settleHostContent(content: string, language: string | undefined): void {
    hostContent = content;
    hostLanguage = language;
    if (!hostContentSettled) {
        hostContentSettled = true;
        for (const r of hostContentResolvers) r(content);
        hostContentResolvers.length = 0;
    }
    for (const cb of hostChangeCbs) {
        try {
            cb(content, language);
        } catch (e) {
            console.error("persephone.host.onContentChange callback error:", e);
        }
    }
}

// ── Shared state ────────────────────────────────────────────────────────────
// A pure replica of the Persephone-side shared state, updated ONLY by seq-stamped
// `state:sync` pushes. `get()` settles on the first snapshot (await any time), `onChange`
// fires on each subsequent one. Writes (init/set/merge) post to the host and come back
// as a push — onChange is the shared-state source of truth.

let sharedStateSettled = false;
let sharedState: Record<string, unknown> = {};
let sharedStateSeq = -1; // seed arrives at seq 0
const sharedStateResolvers: Array<(s: Record<string, unknown>) => void> = [];
const sharedStateCbs: Array<(s: Record<string, unknown>) => void> = [];

function applyStateSync(state: Record<string, unknown>, seq: number): void {
    if (seq <= sharedStateSeq) return; // stale / out-of-order — ignore
    sharedStateSeq = seq;
    sharedState = state;
    if (!sharedStateSettled) {
        sharedStateSettled = true;
        for (const r of sharedStateResolvers) r(state);
        sharedStateResolvers.length = 0;
    }
    for (const cb of sharedStateCbs) {
        try {
            cb(state);
        } catch (e) {
            console.error("persephone.state.onChange callback error:", e);
        }
    }
}

// ── Port plumbing (queue-then-flush) ─────────────────────────────────────────

let port: MessagePort | null = null;
/** Outgoing messages queued until the port connects, then flushed in order. */
const sendQueue: BoardToMain[] = [];
/** Pending request/reply promises keyed by rpc id. */
const pendingRpc = new PendingRequests<unknown>();
const channelPortWaiters = new Map<string, { resolve: (port: MessagePort) => void; reject: (error: Error) => void }>();
const earlyChannelPorts = new Map<string, MessagePort>();
const activeServiceChannels = new Set<ServiceChannel>();
const pendingCalls = new PendingRequests<unknown>({ timeoutError: () => new Error("persephone.call() timed out.") });
// This is only a dead-port guard. It must exceed every host-side call limit, including the
// public boards.callTimeoutMs maximum, so the host remains the single policy owner.
const BOARD_CALL_DEAD_PORT_GUARD_MS = 2_147_000_000;

let aiVisionRemote: IAiVisionRemote | null = null;
let aiVisionGeneration = 0;
type BoardElementDeclaration = IAiElementDeclaration & { readonly view?: string };
type BoardElementProvider = (name: string) => { value: unknown } | undefined;

interface BoardElementsRegistry {
    readonly declarations: readonly BoardElementDeclaration[];
    readonly provide: BoardElementProvider;
}

let boardElementsRegistry: BoardElementsRegistry | undefined;

function registerFrameElements(
    declarations: readonly BoardElementDeclaration[],
    provide: BoardElementProvider,
): void {
    const names = new Set<string>();
    for (const declaration of declarations) {
        if (names.has(declaration.name)) {
            throw new Error(`Duplicate AiVision element name ${JSON.stringify(declaration.name)}.`);
        }
        names.add(declaration.name);
    }
    if (boardElementsRegistry) {
        throw new Error("Only one complete AiVision element declaration set may be registered per frame.");
    }
    boardElementsRegistry = {
        declarations: declarations.map((declaration) => ({ ...declaration })),
        provide,
    };
}

function decorateAiVisionShape(shape: IAiVisionShape): IAiVisionShape {
    const registry = boardElementsRegistry;
    if (!registry) return shape;
    const viewByName = new Map(registry.declarations.map((declaration) => [declaration.name, declaration.view]));
    const decorateNode = (node: IAiVisionShape["root"]): IAiVisionShape["root"] => ({
        ...node,
        ...(node.elements
            ? {
                elements: node.elements.map((element) => {
                    const view = viewByName.get(element.name);
                    return view === undefined ? element : { ...element, view };
                }),
            }
            : {}),
        members: node.members.map((member) => ({
            ...member,
            ...(member.node ? { node: decorateNode(member.node) } : {}),
            ...(member.item ? { item: decorateNode(member.item) } : {}),
        })),
        ...(node.item ? { item: decorateNode(node.item) } : {}),
    });
    return { ...shape, root: decorateNode(shape.root) };
}

function createBoardElements(declarations: readonly BoardElementDeclaration[]) {
    const result = createDomElements(declarations, highlightElement);
    registerFrameElements(declarations, result.provide);
    return result;
}

function handleLocalAiVisionRequest(request: IAiRemoteRequest): Promise<IAiRemoteResponse> {
    const registry = boardElementsRegistry;
    if (!registry || request.path !== "") {
        return Promise.resolve({ ok: false, error: "The board has no unambiguous root element provider." });
    }
    try {
        if (request.action === "ai:elements") {
            const provided = registry.provide("elements");
            if (!provided) throw new Error("AiVision elements are not available on the board root.");
            return Promise.resolve({ ok: true, result: provided.value });
        }
        if (request.action === "ai:highlight") {
            const provided = registry.provide("highlight");
            if (!provided || typeof provided.value !== "function") {
                throw new Error("AiVision highlight is not available on the board root.");
            }
            return Promise.resolve(provided.value(request.name ?? "", request.message))
                .then((result) => ({ ok: true, result }));
        }
        return Promise.resolve({ ok: false, error: `Unsupported local AiVision action ${request.action}.` });
    } catch (error) {
        return Promise.reject(error);
    }
}
/** Per-job runner routers (an execute handle registers/unregisters its jobId). */
const runnerHandlers = new Map<
    string,
    (channel: RunnerInboundChannel, msg: RunnerInboundMsg) => void
>();

const settingsChangeCbs = new Set<(change: { id: string; value: string | number | boolean }) => void>();
let saveHandlerId = 0;
const saveHandlers = new Map<number, () => void | boolean | Promise<void | boolean>>();
const discardHandlers = new Set<() => void | Promise<void>>();

function activeSaveRegistration(): { id: number; handler: () => void | boolean | Promise<void | boolean> } | undefined {
    const entry = [...saveHandlers.entries()].at(-1);
    return entry ? { id: entry[0], handler: entry[1] } : undefined;
}

hostFrame.handle("save", async ({ discard }) => {
    if (discard === true) {
        await Promise.allSettled([...discardHandlers].map((handler) => Promise.resolve().then(handler)));
        return { success: true };
    }
    const registration = activeSaveRegistration();
    if (!registration) return { success: false, error: "The board has no active Save handler." };
    try {
        const result = await registration.handler();
        const current = activeSaveRegistration();
        return current?.id === registration.id
            ? { success: result !== false }
            : { success: false, error: "The board's Save handler changed while it was saving." };
    } catch (error: unknown) {
        return { success: false, error: errMessage(error, "The board failed to save its changes.") };
    }
});
hostFrame.on("save.handlerSync", () => {
    const active = activeSaveRegistration();
    if (active) hostFrame.emit("saveHandler", { handlerId: active.id, registered: true });
});

hostFrame.handle("aiVision.request", async ({ request }) => {
    const remote = aiVisionRemote;
    const generation = aiVisionGeneration;
    const isLocalElementAction = viewRole !== "main" && (request.action === "ai:elements" || request.action === "ai:highlight");
    try {
        const response = isLocalElementAction ? await handleLocalAiVisionRequest(request)
            : remote ? await remote.handle(request)
                : { ok: false as const, error: "The board has not exposed an AiVision root." };
        if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return NO_REPLY;
        return response;
    } catch (error: unknown) {
        if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return NO_REPLY;
        return { ok: false, error: errMessage(error, "The AiVision request failed.") };
    }
});

hostFrame.handle("capabilities.intent", (params, context) => {
    if (typeof context.id !== "string" || typeof params.id !== "string") throw new Error("Malformed capability intent request.");
    if (activeIntent && !activeIntent.settled && !activeIntent.cancelled && activeIntent.requestId !== context.id) {
        return Promise.reject(Object.assign(new Error("The board is already serving a capability request."), { code: "rejected" }));
    }
    if (activeIntent?.requestId === context.id && activeIntent.delivered) return NO_REPLY;
    activeIntent = makeIntentContext({
        id: params.id,
        ...(typeof params.version === "number" ? { version: params.version } : {}),
        requestId: context.id,
        payload: params.payload,
    });
    deliverIntent();
    return activeIntent.outcome;
});

interface BoardFetchInitInput extends Omit<BoardFetchInit, "body"> {
    body?: string | ArrayBuffer | ArrayBufferView | Blob;
    signal?: AbortSignal;
}
interface PendingBoardFetch {
    fail: (error: Error) => void;
    controller?: ReadableStreamDefaultController<Uint8Array>;
    pullResolve?: (chunk: { id: number; chunk?: ArrayBuffer; done: boolean }) => void;
    signal?: AbortSignal;
    abortListener?: () => void;
}
const fetchStreams = new Map<number, PendingBoardFetch>();

function abortError(): DOMException { return new DOMException("The fetch was aborted.", "AbortError"); }

function removeBoardFetchAbortListener(pending: PendingBoardFetch): void {
    if (pending.signal && pending.abortListener) pending.signal.removeEventListener("abort", pending.abortListener);
}

function failPendingBoardFetches(error: Error): void {
    hostFrame.failPending("fetch", error);
    for (const [reqId, pending] of fetchStreams) {
        fetchStreams.delete(reqId);
        removeBoardFetchAbortListener(pending);
        try { pending.controller?.error(error); } catch { /* stream already closed */ }
        pending.pullResolve?.({ id: reqId, done: true });
    }
}

async function boardFetch(url: string, init: BoardFetchInitInput = {}): Promise<Response> {
    if (typeof url !== "string") return Promise.reject(new TypeError("persephone.fetch() requires a URL string."));
    const { signal, body, ...options } = init;
    if (signal?.aborted) return Promise.reject(abortError());
    let wireBody: string | ArrayBuffer | undefined;
    if (typeof body === "string") wireBody = body;
    else if (body instanceof Blob) wireBody = await body.arrayBuffer();
    else if (body instanceof ArrayBuffer) wireBody = body;
    else if (ArrayBuffer.isView(body)) wireBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    if (signal?.aborted) throw abortError();
    const { id, promise } = hostFrame.requestWithId("fetch", { url, init: { ...options, ...(wireBody === undefined ? {} : { body: wireBody }) } });
    const abort = (): void => {
        hostFrame.emit("fetch.abort", { id });
        hostFrame.cancel(id, abortError());
        fetchStreams.get(id)?.fail(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    let head: BoardFetchHead;
    try { head = await promise; }
    catch (error: unknown) { signal?.removeEventListener("abort", abort); throw error; }
    if (!head.hasBody) { signal?.removeEventListener("abort", abort); return new Response(null, { status: head.status, statusText: head.statusText, headers: head.headers }); }
    const pending: PendingBoardFetch = { fail: (error) => { try { pending.controller?.error(error); } catch { /* stream already closed */ } fetchStreams.delete(id); removeBoardFetchAbortListener(pending); pending.pullResolve?.({ id, done: true }); }, signal, abortListener: abort };
    fetchStreams.set(id, pending);
    const stream = new ReadableStream<Uint8Array>({
        start(controller) { pending.controller = controller; },
        async pull() {
            if (!fetchStreams.has(id)) return;
            const chunk = await new Promise<{ id: number; chunk?: ArrayBuffer; done: boolean }>((resolve) => {
                pending.pullResolve = resolve;
                hostFrame.emit("fetch.pull", { id });
            });
            pending.pullResolve = undefined;
            if (chunk.done) { fetchStreams.delete(id); removeBoardFetchAbortListener(pending); pending.controller?.close(); }
            else if (chunk.chunk) pending.controller?.enqueue(new Uint8Array(chunk.chunk));
        },
        cancel() { hostFrame.emit("fetch.abort", { id }); fetchStreams.delete(id); removeBoardFetchAbortListener(pending); },
    });
    return new Response(stream, { status: head.status, statusText: head.statusText, headers: head.headers });
}

hostFrame.on("fetch.chunk", (payload) => fetchStreams.get(payload.id)?.pullResolve?.(payload));
hostFrame.on("fetch.error", (payload) => {
    const pending = fetchStreams.get(payload.id);
    if (!pending) return;
    const error = new Error(payload.message);
    if (pending.signal && !pending.signal.aborted) pending.fail(error);
    else pending.fail(error);
});

function rejectPendingCapabilityRequests(error: BoardCapabilityError): void {
    hostFrame.failPending("capabilities.invoke", error);
}

/** Pending content-path and content.open calls use the shared host request channel. */
function filePathRpc(): Promise<string | undefined> {
    return hostFrame.request("filePath", {});
}

const fileIconCache = new Map<string, string>();
let fileIconCacheGeneration = 0;
const FILE_ICONS_BATCH = 500;

function fileIconsRpc(names: string[]): Promise<{ urls: string[]; icons: Record<string, number> }> {
    return hostFrame.request("fileIcons", { names });
}

function contentOpenRpc(
    link: string,
    timeoutMs?: number,
): Promise<{ url: string; size: number; contentType: string }> {
    return hostFrame.request("contentOpen", { link, ...(timeoutMs === undefined ? {} : { timeoutMs }) }).then((value) => {
        if (typeof value.url === "string" && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 && typeof value.contentType === "string") return value;
        throw new Error("Malformed persephone.content.open() response.");
    });
}

function settingsRpc(id: string): Promise<string | number | boolean> {
    return hostFrame.request("settings.get", { id }).then((value) => {
        if (isBoardSettingValue(value)) return value;
        throw new Error("Malformed persephone.settings.get() response.");
    });
}

async function iconsForFiles(names: unknown): Promise<Record<string, string>> {
    if (!Array.isArray(names)) throw new TypeError("persephone.icons.forFiles() expects an array of file names.");
    const wanted = [...new Set(names.filter((name): name is string => typeof name === "string" && name !== ""))];
    const found = new Map<string, string>();
    const missing: string[] = [];
    for (const name of wanted) {
        const url = fileIconCache.get(name);
        if (url) found.set(name, url);
        else missing.push(name);
    }
    // The host resolves at most FILE_ICONS_BATCH names per request.
    for (let start = 0; start < missing.length; start += FILE_ICONS_BATCH) {
        const generation = fileIconCacheGeneration;
        const reply = await fileIconsRpc(missing.slice(start, start + FILE_ICONS_BATCH));
        // A reply that crossed a theme change still answers this call, but stays out of the cache.
        const cacheable = generation === fileIconCacheGeneration;
        for (const [name, index] of Object.entries(reply.icons)) {
            const url = reply.urls[index];
            if (typeof url !== "string") continue;
            found.set(name, url);
            if (cacheable) fileIconCache.set(name, url);
        }
    }
    const result: Record<string, string> = {};
    for (const [name, url] of found) result[name] = url;
    return result;
}

/** The board-facing return event has no wire discriminator. */
interface PersephoneNavigationReturnEvent {
    readonly url: string;
    readonly query: Readonly<Record<string, readonly string[]>>;
    readonly hash: Readonly<Record<string, readonly string[]>>;
}

const navigationReturnCbs: Array<(event: PersephoneNavigationReturnEvent) => void> = [];
interface PersephoneToolbarActionEvent {
    readonly id: string;
    readonly type: BoardToolbarControlType;
    readonly value?: boolean | string;
}
const toolbarActionCbs = new Set<(event: PersephoneToolbarActionEvent) => void>();
const statusBarActionCbs = new Set<(event: { id: string }) => void>();
const muteToggleCbs = new Set<() => void>();

function navigationReturnUrlRpc(): Promise<string> {
    return hostFrame.request("navigation.createReturnUrl", {}).then((url) => {
        if (typeof url === "string") return url;
        throw new Error("Malformed navigation return URL response.");
    });
}

function onNavigationReturn(callback: (event: PersephoneNavigationReturnEvent) => void): () => void {
    navigationReturnCbs.push(callback);
    return () => {
        const index = navigationReturnCbs.indexOf(callback);
        if (index >= 0) navigationReturnCbs.splice(index, 1);
    };
}

function onToolbarAction(callback: (event: PersephoneToolbarActionEvent) => void): () => void {
    toolbarActionCbs.add(callback);
    return () => toolbarActionCbs.delete(callback);
}

function onStatusBarAction(callback: (event: { id: string }) => void): () => void {
    statusBarActionCbs.add(callback);
    return () => statusBarActionCbs.delete(callback);
}

type BoardIntentInit = IntentEnvelope;

interface BoardIntentContext extends BoardIntentInit {
    cancelled: boolean;
    settled: boolean;
    delivered: boolean;
    outcome: Promise<{ result?: unknown; discardPage?: boolean }>;
    finish(value: { result?: unknown; discardPage?: boolean }): void;
    fail(error: unknown): void;
    resolve(value: unknown, options?: { discardPage?: boolean }): void;
    reject(reason?: unknown): void;
}

class BoardCapabilityError extends Error {
    readonly code: CapabilityErrorCode;

    constructor(code: CapabilityErrorCode, message: string) {
        super(message);
        this.name = "BoardCapabilityError";
        this.code = code;
    }
}

let activeIntent: BoardIntentContext | undefined;
const intentHandlers: Array<(request: BoardIntentContext) => void> = [];

function settleIntent(
    intent: BoardIntentContext | undefined,
    error?: { code: CapabilityErrorCode; message: string },
    result?: unknown,
    discardPage?: boolean,
): void {
    if (!intent || intent.cancelled || intent.settled) return;
    intent.settled = true;
    if (error) intent.fail(Object.assign(new Error(error.message), { code: error.code }));
    else intent.finish({ result, ...(discardPage === undefined ? {} : { discardPage }) });
}

/** Build the context for one request. Shared by both delivery routes: the initial intent
 *  carried on `BoardPortInitMsg` (a page opened *for* the request) and the `capabilities:intent`
 *  message (a page that was already open and is being reused). */
function makeIntentContext(init: {
    id: string;
    version?: number;
    requestId: string;
    payload: unknown;
}): BoardIntentContext {
    let finishOutcome: (value: { result?: unknown; discardPage?: boolean }) => void = () => {};
    let failOutcome: (error: unknown) => void = () => {};
    const outcome = new Promise<{ result?: unknown; discardPage?: boolean }>((resolve, reject) => { finishOutcome = resolve; failOutcome = reject; });
    const context: BoardIntentContext = {
        id: init.id,
        ...(typeof init.version === "number" ? { version: init.version } : {}),
        requestId: init.requestId,
        payload: init.payload,
        cancelled: false,
        settled: false,
        delivered: false,
        outcome,
        finish: finishOutcome,
        fail: failOutcome,
        resolve: (value: unknown, options?: { discardPage?: boolean }) => {
            if (!context.cancelled) settleIntent(context, undefined, value, options?.discardPage);
        },
        reject: (reason?: unknown) => {
            if (!context.cancelled) {
                settleIntent(context, {
                    code: "rejected",
                    message: errMessage(reason, "The board rejected the request."),
                });
            }
        },
    };
    return context;
}

function deliverIntent(): void {
    const intent = activeIntent;
    if (!intent || intent.delivered || intentHandlers.length === 0) return;
    intent.delivered = true;
    for (const handler of intentHandlers) {
        try {
            handler(intent);
        } catch (error: unknown) {
            console.error("persephone.intent.onRequest callback error:", errMessage(error));
        }
    }
}

function capabilityErrorFromReply(error: { code?: unknown; message?: unknown } | string | undefined): BoardCapabilityError {
    const code = typeof error === "object" && error && isCapabilityErrorCode(error.code)
        ? error.code
        : "rejected";
    const message = typeof error === "string"
        ? error
        : typeof error?.message === "string" ? error.message : "The capability request failed.";
    return new BoardCapabilityError(code, message);
}

function capabilityInvokeRpc(
    id: string,
    payload: unknown,
    options?: { version?: number; deadlineMs?: number },
): Promise<unknown> {
    return hostFrame.request("capabilities.invoke", {
        id, ...(options?.version === undefined ? {} : { version: options.version }), payload,
        ...(options?.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    }, { postError: (error) => new BoardCapabilityError("rejected", errMessage(error, "Persephone host is unavailable.")) })
        .catch((error: unknown) => { throw capabilityErrorFromReply(error as { code?: unknown; message?: unknown }); });
}

/**
 * Ask the host page to create a new in-memory page in another editor and hand back its page id.
 *
 * SCOPE — this is a CREATE-ONLY verb, deliberately. It returns the id of a page the board itself
 * just made and exposes no handle to any page that already existed: it cannot read, enumerate,
 * navigate, close or mutate one. The request rides the page-scoped host-frame channel (the same one
 * `getFilePath()` and `var.*` use), so it is gated on the board's own origin + source frame and on a
 * live trust check, and the page lands in the board's own window. `persephone.call` therefore keeps
 * exactly the scoping it has today — this adds one constructor, not a page-model escape hatch.
 */
function openContentRpc(request: BoardOpenContentRequest): Promise<string> {
    return hostFrame.request("openContent", { request }).then((pageId) => {
        if (typeof pageId === "string") return pageId;
        throw new Error("Malformed persephone.openContent() response.");
    });
}

function post(msg: BoardToMain): void {
    if (port) port.postMessage(msg);
    else sendQueue.push(msg);
}

function rpc(method: BoardRpcMethod, args: unknown[]): Promise<unknown> {
    const { id, promise } = pendingRpc.create();
    try { post({ kind: "rpc", id, method, args }); }
    catch (error: unknown) { pendingRpc.fail(id, error); }
    return promise;
}

async function capabilityRpc<T>(method: BoardRpcMethod, args: unknown[]): Promise<T> {
    const result = await rpc(method, args) as CapabilityClientResult<T>;
    if (result.ok === false) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
}

async function getCapabilityRpc(id: string, options?: CapabilityClientOptions) {
    const provider = await capabilityRpc<CapabilityProvider | null>("capabilityGet", [id, options]);
    if (!provider) return null;
    return createCapabilityProxy(provider, async (method, args) => {
        const request: CapabilityClientInvoke = { requestId: crypto.randomUUID(), key: { id: provider.id, version: provider.version, provider: provider.provider, handlerKey: provider.handlerKey }, method, args, filter: options?.filter };
        const result = await capabilityRpc<unknown>("capabilityInvoke", [request]);
        if (provider.methods[method].kind === "channel") {
            let channel: ServiceChannel;
            try { channel = await waitForServiceChannel((result as { channelId: string }).channelId, "capability"); }
            catch (error) { void capabilityRpc("capabilityCancel", [request.requestId]).catch((): void => undefined); throw error; }
            if (id !== PLATFORM_AUDIO_CAPABILITY_ID || method !== "muteApp") return channel;
            let released = false;
            let pending: Promise<void> | undefined;
            channel.onClose(() => { released = true; });
            return { release: (): Promise<void> => {
                if (released) return Promise.resolve();
                return pending ??= new Promise<void>((resolve) => {
                    const done = (): void => { released = true; removeMessage(); removeClose(); resolve(); };
                    let removeClose = (): void => undefined;
                    const removeMessage = channel.onMessage((message) => { if ((message as { type?: string })?.type === "released") done(); });
                    removeClose = channel.onClose(done);
                    try { channel.send({ type: "release" }); } catch { done(); }
                });
            } };
        }
        return result;
    });
}

function waitForServiceChannel(channelId: string, kind: ServiceChannelKind): Promise<ServiceChannel> {
    return new Promise<ServiceChannel>((resolve, reject) => {
        const finish = (channelPort: MessagePort) => {
            const channel = createServiceChannel(domPort(channelPort), { kind });
            activeServiceChannels.add(channel);
            channel.onClose(() => activeServiceChannels.delete(channel));
            resolve(channel);
        };
        const earlyPort = earlyChannelPorts.get(channelId);
        if (earlyPort) { earlyChannelPorts.delete(channelId); finish(earlyPort); return; }
        const timer = setTimeout(() => {
            if (!channelPortWaiters.delete(channelId)) return;
            reject(Object.assign(new Error("The service channel did not reach this board page."), { code: "service-timeout" }));
        }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
        channelPortWaiters.set(channelId, {
            resolve: (channelPort) => { clearTimeout(timer); finish(channelPort); },
            reject: (error) => { clearTimeout(timer); reject(error); },
        });
    });
}

function openServiceChannel(openMessage: unknown): Promise<ServiceChannel> {
    try { structuredClone(openMessage); }
    catch (error) { return Promise.reject(Object.assign(new Error(errMessage(error, "Channel message is not structured-cloneable.")), { code: "rejected" })); }
    return rpc("serviceOpenChannel", [openMessage]).then((value) => waitForServiceChannel(String(value), "service"));
}

window.addEventListener("pagehide", () => {
    for (const channel of activeServiceChannels) channel.close({ code: "renderer-reloaded", message: "The board page closed or navigated away." });
    activeServiceChannels.clear();
    for (const pending of channelPortWaiters.values()) pending.reject(new Error("The board page closed before the channel opened."));
    channelPortWaiters.clear();
    for (const channelPort of earlyChannelPorts.values()) channelPort.close();
    earlyChannelPorts.clear();
});

hostFrame.on("service.channelPort", (payload, context) => {
    if (typeof payload.channelId !== "string" || !context.ports[0]) return;
    const waiter = channelPortWaiters.get(payload.channelId);
    if (waiter) { channelPortWaiters.delete(payload.channelId); waiter.resolve(context.ports[0]); }
    else earlyChannelPorts.set(payload.channelId, context.ports[0]);
});

function call(path: string, options?: { args?: unknown[]; value?: unknown; maxLength?: number; timeoutMs?: number }): Promise<unknown> {
    if (typeof path !== "string" || !path) return Promise.reject(new Error("persephone.call() needs a non-empty path."));
    if (options?.args !== undefined && !Array.isArray(options.args)) {
        return Promise.reject(new Error("persephone.call() options.args must be an array."));
    }
    if (options?.timeoutMs !== undefined && !isPositiveInteger(options.timeoutMs)) {
        return Promise.reject(new Error("persephone.call() options.timeoutMs must be a positive integer."));
    }
    const { id, promise } = pendingCalls.create(BOARD_CALL_DEAD_PORT_GUARD_MS);
    const request = {
        path,
        ...(options?.args !== undefined ? { args: options.args } : {}),
        ...(options && Object.prototype.hasOwnProperty.call(options, "value")
            ? { value: options.value }
            : {}),
        ...(options?.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    };
    try {
        post({ kind: "call", id, request });
    } catch (error) {
        pendingCalls.fail(id, new Error(errMessage(error, "Persephone host is unavailable.")));
    }
    return promise;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function postAiVisionRegistration(
    remote: IAiVisionRemote,
    reason: "register" | "refresh" = "register",
): void {
    if (viewRole !== "main") return;
    try {
        hostFrame.emit("aiVision.register", { schemaVersion: remote.schemaVersion, shape: decorateAiVisionShape(remote.describe()), reason });
    } catch {
        // The host frame may have gone away while the board is being replaced.
    }
}

function exposeAiVision(root: object): IAiVisionRemote {
    aiVisionRemote?.dispose();
    const generation = ++aiVisionGeneration;
    const remote = expose(root, {
        publish: false,
        onWarning: (message) => console.warn("[persephone.aiVision]", message),
        onHostSignal: (signal: IAiHostSignal) => {
            if (signal.type !== "notify" || viewRole !== "main"
                || aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
            try {
                hostFrame.emit("aiVision.notify", { text: signal.text });
            } catch {
                // The host frame may have gone away while the board is being replaced.
            }
        },
    });
    aiVisionRemote = remote;
    postAiVisionRegistration(remote);

    return {
        schemaVersion: remote.schemaVersion,
        get version(): number { return remote.version; },
        describe: () => decorateAiVisionShape(remote.describe()),
        handle: async (request: IAiRemoteRequest): Promise<IAiRemoteResponse> => {
            const response = await remote.handle(request);
            return aiVisionRemote === remote && aiVisionGeneration === generation
                ? response
                : { ok: false, error: "The AiVision remote has been replaced." };
        },
        refresh: () => {
            if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
            remote.refresh();
            postAiVisionRegistration(remote, "refresh");
        },
        notify: (text: string): void => {
            if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
            // The board notify transport owns delivery; this only delegates to ai-vision.
            remote.notify(text);
        },
        dispose: () => {
            if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
            remote.dispose();
            aiVisionRemote = null;
            aiVisionGeneration++;
        },
    };
}

function fire(method: BoardFireMethod, args: unknown[]): void {
    post({ kind: "fire", method, args });
}

function requestOpenRawLink(href: string, options?: BoardOpenRawLinkOptions): Promise<void> {
    const result = rpc("openRawLink", [href, options]) as Promise<void>;
    void result.catch(() => {});
    return result;
}

function applyVars(vars: Record<string, string>): void {
    const root = document?.documentElement;
    if (!root) return;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

function onPortMessage(data: MainToBoard): void {
    if (!data) return;
    if (data.kind === "rpc-result") {
        if (data.error != null) pendingRpc.fail(data.id, fromWireError(data.error));
        else pendingRpc.settle(data.id, data.result);
        return;
    }
    if (data.kind === "call-result") {
        if (typeof data.error === "string") {
            pendingCalls.fail(data.id, new Error(data.error));
        } else if (Object.prototype.hasOwnProperty.call(data, "result")) {
            pendingCalls.settle(data.id, data.result);
        } else {
            pendingCalls.fail(data.id, new Error("Malformed persephone.call() response."));
        }
        return;
    }
    if (data.kind === "watch") {
        const callback = watchCallbacks.get(data.watchId);
        if (!callback) return;
        try { callback(data.batch); }
        catch (error: unknown) { console.error("persephone.watch callback error:", errMessage(error)); }
        if (data.batch.ended) watchCallbacks.delete(data.watchId);
        return;
    }
    if (data.kind === "runner") {
        const jobId = (data.msg as { jobId: string }).jobId;
        const h = runnerHandlers.get(jobId);
        if (h) h(data.channel, data.msg);
        return;
    }
    if (data.kind === "theme") {
        fileIconCache.clear();
        fileIconCacheGeneration++;
        currentTheme = withGraphPalette(data.palette);
        applyVars(currentTheme.vars);
        for (const cb of themeCbs) {
            try {
                cb(currentTheme);
            } catch (e) {
                console.error("persephone.onThemeChange callback error:", e);
            }
        }
    }
}

function attachPort(p: MessagePort): void {
    if (port === p) return; // already connected (ignore a duplicate handshake)
    if (port) {
        port.close();
        const bridgeReplaced = new Error("Persephone bridge was replaced.");
        pendingRpc.failAll(bridgeReplaced);
        watchCallbacks.clear();
        failPendingBoardFetches(new Error("Persephone bridge was replaced."));
        pendingCalls.failAll(bridgeReplaced);
        const capabilityBridgeReplaced = new BoardCapabilityError(
            "handler-closed",
            "Persephone bridge was replaced.",
        );
        rejectPendingCapabilityRequests(capabilityBridgeReplaced);
    }
    port = p;
    p.onmessage = (ev: MessageEvent) => onPortMessage(ev.data as MainToBoard);
    p.onmessageerror = () => failPendingBoardFetches(new Error("Persephone bridge is unavailable."));
    // Flush queued outgoing messages in order.
    for (const msg of sendQueue) p.postMessage(msg);
    sendQueue.length = 0;
    // Tell main the bridge is live so its handshake watchdog stands
    // down. A board that paints but never reaches here is reported as "bridge dead".
    p.postMessage({ kind: "connected" } as BoardToMain);
}

// One-time handshake: accept the transferred port only from the host renderer
// parent frame. `event.source === window.parent` is the load-bearing check;
// the origin check is belt-and-suspenders, enforced only for a strict (http[s])
// host — a file:// host's cross-origin `event.origin` is the opaque "null" and
// would never match the baked "file://" (see `hostOriginStrict` above).
hostFrame.listen();

hostFrame.onInit((data, ports) => {
    // Busy flag carried at handshake. A local setBoardBusy call that
    // already ran wins (busyState !== null) — the init value is then stale.
    if (busyState === null) settleBusy(!!data.busy);
    // filePath carried at handshake. Every handshake settles it — a plain board
    // carries `undefined`, so `getFilePath()` still resolves (to undefined).
    if (!filePathSettled) {
        // Non-local source flag — read BEFORE settling, since settling releases waiting
        // `getFilePath()` calls and they branch on it.
        filePathNeedsMaterialize = !!data.materialize;
        folderPathValue = typeof data.folderPath === "string" ? data.folderPath : undefined;
        settleFilePath(data.filePath);
    }
    // sourceUrl carried at handshake. Every handshake settles it — a plain board carries
    // `undefined`, so `getSourceUrl()` still resolves (to undefined).
    if (!sourceUrlSettled) {
        initialSourcePrivateSession = data.initialSourcePrivateSession === true;
        initialSourceContext = data.sourceContext;
        settleSourceUrl(data.sourceUrl);
    }
    if (typeof data.pageVisible === "boolean") setPageVisibility(data.pageVisible);
    setVoiceTypingAutoStopSilence(data.voiceTypingAutoStopSilenceMs);
    // Content-host flag gates the persephone.host content API.
    if (data.contentHost) hostEnabled = true;
    pipePageId = typeof data.pageId === "string" ? data.pageId : undefined;
    pipeUrlEnabled = data.pipeUrlEnabled === true;
    if (!activeIntent && data.intent && typeof data.intent.id === "string"
        && typeof data.intent.requestId === "string") {
        activeIntent = makeIntentContext({
            id: data.intent.id,
            ...(typeof data.intent.version === "number" ? { version: data.intent.version } : {}),
            requestId: data.intent.requestId,
            payload: data.intent.payload,
        });
        hostFrame.answer(data.intent.requestId, activeIntent.outcome);
        deliverIntent();
    }
    const p = ports[0];
    if (p) attachPort(p);
});

hostFrame.on("voiceTyping.autoStopSilenceChanged", (data) => {
    setVoiceTypingAutoStopSilence(data.milliseconds);
});

function setVoiceTypingAutoStopSilence(value: unknown): void {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0
        || value === voiceTypingAutoStopSilenceMs) return;
    voiceTypingAutoStopSilenceMs = value;
    for (const callback of voiceTypingAutoStopCbs) {
        try { callback(value); }
        catch (error: unknown) { console.error("persephone.voiceTyping.onAutoStopSilenceChange callback error:", errMessage(error)); }
    }
}

// Runtime source identities arrive independently of the initial source handshake. This listener
// is installed before board application code runs, so events posted while the board is loading are
// retained until `source.onOpen()` subscribes.
hostFrame.on("source.opened", (data) => {
    if (typeof data.sourceUrl !== "string") return;
    const pending = {
        sourceUrl: data.sourceUrl,
        ...(data.privateSession === true ? { privateSession: true } : {}),
        ...(data.context ? { context: data.context } : {}),
    };
    if (sourceOpenCallbacks.size === 0) pendingSourceOpenEvents.push(pending);
    else deliverSourceOpen(pending.sourceUrl, pending.privateSession, pending.context);
});

    // Board settings change push — effective values include the declaration default.
hostFrame.on("settings.changed", (data) => {
    if (typeof data.id !== "string" || data.id.trim().length === 0
        || !isBoardSettingValue(data.value)) return;
    const change = { id: data.id, value: data.value };
    for (const callback of settingsChangeCbs) {
        try {
            callback(change);
        } catch (error: unknown) {
            console.error("persephone.settings.onChange callback error:", errMessage(error));
        }
    }
});

hostFrame.on("toolbar.control", (data) => {
    if (typeof data.id !== "string" || !data.id
        || (data.type !== "button" && data.type !== "toggle" && data.type !== "menu"
            && data.type !== "select" && data.type !== "segmented" && data.type !== "input"
            && data.type !== "breadcrumb")
        || (data.value !== undefined && typeof data.value !== "boolean" && typeof data.value !== "string")) return;
    const value = data.type === "button" ? undefined : data.value;
    const publicEvent: PersephoneToolbarActionEvent = {
        id: data.id,
        type: data.type,
        ...(value !== undefined ? { value } : {}),
    };
    for (const callback of toolbarActionCbs) {
        try {
            callback(publicEvent);
        } catch (error: unknown) {
            console.error("persephone.toolbar.onAction callback error:", error);
        }
    }
});

hostFrame.on("statusBar.action", (data) => {
    if (typeof data.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(data.id)) return;
    for (const callback of statusBarActionCbs) {
        try { callback({ id: data.id }); }
        catch (error: unknown) { console.error("persephone.statusBar.onAction callback error:", error); }
    }
});

hostFrame.on("page.muteToggle", () => {
    for (const callback of muteToggleCbs) {
        try { callback(); }
        catch (error: unknown) { console.error("persephone.page.onMuteToggle callback error:", error); }
    }
});

hostFrame.on("page.visibility", (data) => {
    if (typeof data.visible !== "boolean") return;
    setPageVisibility(data.visible);
});

function setPageVisibility(visible: boolean): void {
    if (pageVisible === visible) return;
    pageVisible = visible;
    for (const callback of pageVisibilityCbs) {
        try { callback(visible); }
        catch (error: unknown) { console.error("persephone.page.onVisibilityChange callback error:", error); }
    }
}

// Capability request delivered to an ALREADY-OPEN board page — renderer → board.
// The initial request of a page arrives on `BoardPortInitMsg` instead, because the page is
// created for it; every later request reuses this frame and arrives here. Without this
// handler a reused handler page silently receives nothing and every such call hangs to its
// deadline, which is exactly how it shipped before being caught in live testing.
// Capability cancel/list/invoke results — renderer → board over window.postMessage.
// Same source and origin gate as the handshake.
hostFrame.on("capabilities.cancel", (data) => {
    if (typeof data.requestId !== "string") return;
    if (activeIntent?.requestId === data.requestId) activeIntent.cancelled = true;
});

// Host content push — renderer → board over window.postMessage. Same trust gate as the
// handshake: source must be the host parent frame; origin enforced only for a strict http(s) host.
// A SEPARATE listener because the handshake listener above early-returns non-`__persephoneInit`.
hostFrame.on("host.content", (data) => {
    settleHostContent(data.content, data.language);
});

// Shared-state push — renderer → board. Same trust gate as host:content.
hostFrame.on("state.sync", (data) => {
    applyStateSync(data.state ?? {}, typeof data.seq === "number" ? data.seq : 0);
});

// Host-initiated AiVision leaf request. The remote generation is captured before the await so a
// board that replaces its exposed root cannot send an old result into the host's new registration.
hostFrame.on("navigation.return", (data) => {
    if (typeof data.url !== "string" || !data.query || !data.hash) return;
    // Hand the board the documented shape only. Forwarding the raw message would leak
    // the internal `__persephone` discriminator into the public event object.
    const returnEvent: PersephoneNavigationReturnEvent = {
        url: data.url,
        query: data.query,
        hash: data.hash,
    };
    for (const callback of navigationReturnCbs) {
        try {
            callback(returnEvent);
        } catch (error: unknown) {
            console.error("persephone.navigation.onReturn callback error:", error);
        }
    }
});

// Automatic save — a content-host board saves through Persephone's pipe on
// Ctrl/Cmd+S with zero board code. `window` bubble phase, so a board handler on document/an element
// runs FIRST and can opt out via preventDefault(). Harmless on a plain board (main ignores it).
window.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        if (e.defaultPrevented) return; // the board claimed it — stand down
        e.preventDefault();
        try {
            hostFrame.emit("content.save", {});
        } catch {
            // parent gone — nothing to save
        }
    }
});

// App theme shortcuts (Ctrl+Alt+[ / Ctrl+Alt+]) — the host's global KeyboardService listens on
// the HOST document, which a cross-origin board frame's keydown never reaches (SOP). Board authors
// switch themes constantly while testing a board, so forward the two theme keys to the host the
// same way Ctrl+S is forwarded: `window` bubble phase, `defaultPrevented` opt-out.
window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!e.ctrlKey || !e.altKey) return;
    if (e.code !== "BracketRight" && e.code !== "BracketLeft") return;
    if (e.defaultPrevented) return; // the board claimed it — stand down
    e.preventDefault();
    try {
        hostFrame.emit("theme.cycle", { direction: e.code === "BracketRight" ? 1 : -1 });
    } catch {
        // parent gone — nothing to theme
    }
});

// External-link routing — a board frame lives on a locked-down `board://` origin.
// A plain `<a href="http(s)://…">` (e.g. a hyperlink inside a rendered .docx) would navigate
// the FRAME itself to that URL, which the host renderer's frame-src CSP blocks (ERR_BLOCKED_BY_CSP)
// — leaving the board blank (white screen). The main-process `will-frame-navigate` guard can't
// help here: the renderer's CSP cancels the navigation before it reaches the browser process.
// So intercept anchor activations at the DOM level, BEFORE any navigation starts, and route the
// URL through Persephone's normal openRawLink flow instead — the link opens in a Persephone page /
// the browser. In-board navigation (board://<host>/…, including `#fragment` links, which resolve
// against the board origin) is left untouched. Bubble phase + a `defaultPrevented` check so a
// board that wants to handle its own links can opt out via `preventDefault()`.
function routeExternalLinkClick(e: MouseEvent): void {
    if (e.defaultPrevented) return; // the board claimed it — stand down
    const target = e.target as Element | null;
    const anchor = target && target.closest ? target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    // `anchor.href` is the RESOLVED absolute URL — relative paths and `#fragments` resolve
    // against the board:// document, so they start with `board://` and are left to navigate
    // in-frame as normal. `javascript:` runs script, not a navigation — leave it alone too.
    const href = anchor.href;
    if (!href || href.startsWith("board://") || href.startsWith("javascript:")) return;
    e.preventDefault();
    void requestOpenRawLink(href);
}
window.addEventListener("click", routeExternalLinkClick);
window.addEventListener("auxclick", (e: MouseEvent) => {
    // Middle-click on a link also navigates in a plain browser context — route it too.
    if (e.button === 1) routeExternalLinkClick(e);
});

installBoardContextMenu({ fire, rpc, hostText: resolveBoardHostText });

// Host-overlay dismissal: a cross-origin board's inner clicks
// don't bubble to the host, so an open Persephone menu/popover/command-palette wouldn't
// close when the user clicks into the board. Post a capture-phase interaction ping to
// the host frame (this is the board→host-frame channel — NOT the board↔main port);
// the host replays it as a `document` pointerdown through `dismissOverlays()`, the same
// helper its webview guest and HTML iframe use. Capture phase so it fires even when the
// board already has focus.
window.addEventListener(
    "pointerdown",
    () => {
        hostFrame.emit("interact", {});
    },
    true,
);

installBoardDiagnostics((name, payload) => hostFrame.emit(name, payload));

// ── execute() handle (state machine shared with renderer/api/proc.ts) ────────

let idCounter = 0;

/** Build an execute handle over the board's port: the runner-message router keyed
 *  by jobId (registered synchronously, before start is posted, so output is never
 *  missed) plus the `post` envelope every runner message travels in. */
function createHandle(
    command: string,
    options?: IExecuteOptions,
    extra?: { node?: boolean; args?: string[] },
): IExecuteHandle {
    const jobId = `b_${++idCounter}_${Date.now()}`;
    return createExecuteHandle(
        {
            jobId,
            label: "persephone.execute",
            send: (channel, msg) => post({ kind: "runner", channel, msg }),
            subscribe: (deliver) => {
                runnerHandlers.set(jobId, deliver);
                return () => runnerHandlers.delete(jobId);
            },
        },
        // Default cwd is filled by main from the board registry; an explicit opts.cwd
        // (forwarded here) overrides it there.
        { command, opts: options, ...extra },
    );
}

// ── The `persephone` bridge (same surface as the old preload) ─────────────────

(window as unknown as { persephone: unknown }).persephone = {
    // Bridge API version — bumped when the `persephone.*` surface gains something.
    // 1.2.0: programmatic AiVision calls; 1.3.0 adds remote trees;
    // 1.4.0 adds the host-frame AiVision notify bridge; 1.5.0 adds `openContent()`,
    // the `--p-graph-*` family + `getTheme().graph`, and manifest `contentMasks`;
    // 1.6.0 adds the bridge contract declarations for service and storage;
    // 1.7.0 adds board capability declarations and the renderer-local capability bus;
    // 1.8.0 adds intent delivery and board-to-board capability invocation;
    // 1.9.0 adds renderer-owned navigation return URLs.
    // 1.10.0 adds the host-rendered board toolbar catalog.
    // 1.11.0 adds transient board-settable page-toolbar text.
    // 1.12.0 adds `clipboard.writeImage` / `clipboard.writeText`.
    // 1.13.0 adds renderer-owned `settings.get()` and `settings.onChange()`.
    // 1.14.0 adds `getSourceUrl` for non-materializing source identity handoff.
    // 1.15.0 adds explicit board service stopping through the main supervisor.
    // 1.16.0 adds a read-only board service status query.
    // 1.17.0 adds runtime source-open events through `source.onOpen()`.
    // 1.18.0 adds persephone.icons.forFiles().
    // 1.26.0 adds live board service provider status subscriptions.
    // 1.27.0 adds the transient host-rendered board footer status-bar catalog.
    // 1.39.0 adds authorized, classified file and folder watches.
    // 1.28.0 adds the `segmented` board toolbar control.
    // 1.37.0 adds initial and runtime source-panel snapshots to `source`.
    // 1.36.0 adds registration-time `locale` and board-pack `i18n.t()` / `has()`.
    // 1.35.0 adds the themes bridge, the plain-page unsaved-changes protocol,
    //   text toolbar buttons (a labelled button/menu) and `placement: "board-menu"`.
    // 1.34.0 adds page-scoped board UI state in the host cache, and fixes
    //   persephone.fetch() response bodies, which never arrived since 1.25.0 because the shim did
    // not request chunks. A board that reads response bodies needs 1.34.0.
    version: BOARD_BRIDGE_VERSION,
    locale: boardLocale,
    i18n: {
        t: translateBoardMessage,
        has: hasBoardMessage,
    },

    /** Lifecycle state for this board's own page (main frame only). */
    page: {
        /** Whether this page is active or shown beside the active page. */
        get visible(): boolean { return pageVisible; },
        setModified(modified: boolean): void {
            hostFrame.emit("modified.set", { modified: modified === true });
        },
        /** Show the page tab's mute button in this state, like the Video Player's; `null` removes it.
         *  Call it again whenever the board's own mute changes so the tab stays in step. */
        setMuted(muted: boolean | null): void {
            hostFrame.emit("muted.set", { muted: muted === null ? null : muted === true });
        },
        /** Run when the user clicks the page tab's mute button; flip the mute and call setMuted. */
        onMuteToggle(callback: () => void): () => void {
            if (typeof callback !== "function") throw new TypeError("persephone.page.onMuteToggle expects a function.");
            muteToggleCbs.add(callback);
            return () => { muteToggleCbs.delete(callback); };
        },
        /** Subscribe to page visibility; calls immediately with the current value. */
        onVisibilityChange(callback: (visible: boolean) => void): () => void {
            if (typeof callback !== "function") throw new TypeError("persephone.page.onVisibilityChange expects a function.");
            pageVisibilityCbs.add(callback);
            try { callback(pageVisible); }
            catch (error: unknown) { console.error("persephone.page.onVisibilityChange callback error:", error); }
            return () => { pageVisibilityCbs.delete(callback); };
        },
    },

    /** Shared app preference for voice typing and boards that take dictation. */
    voiceTyping: {
        get autoStopSilenceMs(): number { return voiceTypingAutoStopSilenceMs; },
        onAutoStopSilenceChange(callback: (milliseconds: number) => void): () => void {
            if (typeof callback !== "function") throw new TypeError("persephone.voiceTyping.onAutoStopSilenceChange expects a function.");
            voiceTypingAutoStopCbs.add(callback);
            try { callback(voiceTypingAutoStopSilenceMs); }
            catch (error: unknown) { console.error("persephone.voiceTyping.onAutoStopSilenceChange callback error:", errMessage(error)); }
            return () => { voiceTypingAutoStopCbs.delete(callback); };
        },
    },

    /** Run when the user chooses Don't Save, before the frame is torn down (3-second budget). Use it to
     *  drop drafts kept in pageState for app restarts. Requires an onSaveRequest registration. */
    onDiscardRequest(handler: () => void | Promise<void>): () => void {
        if (typeof handler !== "function") throw new TypeError("persephone.onDiscardRequest expects a function.");
        discardHandlers.add(handler);
        return () => { discardHandlers.delete(handler); };
    },

    /** Register the current frame's asynchronous Save action. The latest active registration wins. */
    onSaveRequest(handler: () => void | boolean | Promise<void | boolean>): () => void {
        if (typeof handler !== "function") throw new TypeError("persephone.onSaveRequest expects a function.");
        const id = ++saveHandlerId;
        saveHandlers.set(id, handler);
        hostFrame.emit("saveHandler", { handlerId: id, registered: true });
        return () => {
            if (!saveHandlers.has(id)) return;
            const wasActive = activeSaveRegistration()?.id === id;
            saveHandlers.delete(id);
            hostFrame.emit("saveHandler", { handlerId: id, registered: false });
            const active = activeSaveRegistration();
            if (wasActive && active) {
                hostFrame.emit("saveHandler", { handlerId: active.id, registered: true });
            }
        };
    },

    /** Promise-based bridge to app.themes; requires the themes board permission. */
    themes: createBoardThemes(),

    icons: {
        /** Persephone's icon for each file name, as a `data:` URL for `<img src>`, keyed by the
         *  names passed in. The icon depends only on the name. Single-colour icons use the
         *  current theme's icon colour, so request again from `onThemeChange`. */
        forFiles: iconsForFiles,
    },

    /** Mint a nonce-scoped return URL and receive matching query/hash navigations. */
    navigation: {
        createReturnUrl(): Promise<string> {
            return navigationReturnUrlRpc();
        },
        onReturn: onNavigationReturn,
    },

    aiVision: {
        schemaVersion: AI_VISION_SCHEMA_VERSION,
        expose: exposeAiVision,
        createElements: createBoardElements,
    },

    /** This frame's view role: "main" for the board's main view, or the id of a
     *  declared secondary view. Branch on it to render every view from one HTML file. */
    view: viewRole,

    /** Replace this board's full set of secondary (sidebar) views at runtime.
     *  Each view: `{ id, html?, title? }` — `html` defaults to the main entry, so one file
     *  can serve every view (branch on `persephone.view`). `[]` removes them all. Available
     *  on every frame (main + secondary); the change is authoritative on the Persephone side. */
    setSecondaryViews(views: Array<{ id: string; html?: string; title?: string }>): void {
        try {
            hostFrame.emit("secondaryViews.set", { views: Array.isArray(views) ? views : [] });
        } catch {
            // parent gone
        }
    },

    toolbar: {
        set(controls: BoardToHostEvents["toolbar.set"]["controls"]): void {
            hostFrame.emit("toolbar.set", { controls: Array.isArray(controls) ? controls as BoardToHostEvents["toolbar.set"]["controls"] : [] });
        },
        update(partial: BoardToHostEvents["toolbar.update"]["controls"]): void {
            hostFrame.emit("toolbar.update", { controls: Array.isArray(partial) ? partial as BoardToHostEvents["toolbar.update"]["controls"] : [] });
        },
        /** Set transient text in the main page toolbar; `""` clears it. The slot has no
         *  fallback — it is blank until a board fills it. */
        setText(text: string): void {
            hostFrame.emit("toolbar.setText", { toolbarText: typeof text === "string" ? text : String(text ?? "") });
        },
        onAction: onToolbarAction,
    },

    statusBar: {
        set(items: BoardToHostEvents["statusBar.set"]["items"]): void {
            hostFrame.emit("statusBar.set", { items: Array.isArray(items) ? items : [] });
        },
        update(id: string, patch: Omit<BoardToHostEvents["statusBar.update"]["items"][number], "id">): void {
            hostFrame.emit("statusBar.update", { items: [{ id, ...patch }] });
        },
        onAction: onStatusBarAction,
    },

    /** Set the text shown in the board's footer status area — the same footer that shows the
     *  provider/encoding for content-host boards (e.g. a Todo board's "N items" count). Called
     *  from the board's MAIN view; a visual no-op for plain (non-content-host) boards, which have
     *  no footer. Pass `""` to clear. */
    setStatusText(text: string): void {
        try {
            hostFrame.emit("statusText.set", { statusText: typeof text === "string" ? text : String(text ?? "") });
        } catch {
            // parent gone
        }
    },

    execute(command: string, options?: IExecuteOptions): IExecuteHandle {
        return createHandle(command, options);
    },

    /** Resolve a page-scoped path in Persephone's bounded AiVision object model. */
    call,

    /** Run a Node script on Persephone's bundled runtime — no Node install needed.
     *  `script` is resolved against the board folder when relative. Same handle
     *  contract as execute(); `shell` is ignored (always argv, no shell). */
    executeNode(script: string, args?: string[], options?: IExecuteOptions): IExecuteHandle {
        const { shell: _shell, ...opts } = options ?? {};
        return createHandle(script, opts, { node: true, args });
    },

    openRawLink(href: string, options?: BoardOpenRawLinkOptions): Promise<void> {
        return requestOpenRawLink(href, options);
    },

    openContent(options: {
        editor: string;
        language?: string;
        title?: string;
        content?: string;
    }): Promise<string> {
        if (!options || typeof options !== "object") {
            return Promise.reject(
                new Error('openContent() expects an options object, e.g. { editor: "md-view" }.'),
            );
        }
        return openContentRpc({
            editor: options.editor,
            language: options.language,
            title: options.title,
            content: options.content,
        });
    },

    content: {
        open(link: string, options?: { timeoutMs?: number }): Promise<{ url: string; size: number; contentType: string }> {
            if (typeof link !== "string") {
                return Promise.reject(new Error("content.open() requires a link string."));
            }
            if (options !== undefined && (!options || typeof options !== "object")) {
                return Promise.reject(new Error("content.open() options must be an object."));
            }
            const timeoutMs = options?.timeoutMs;
            if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
                return Promise.reject(new Error("content.open() timeoutMs must be a positive integer."));
            }
            return whenHandshake().then(() => contentOpenRpc(link, timeoutMs));
        },
    },

    /** The one capability request currently delivered to this board, if any. */
    intent: {
        get(): BoardIntentContext | undefined {
            return activeIntent;
        },
        onRequest(callback: (request: BoardIntentContext) => void): () => void {
            intentHandlers.push(callback);
            deliverIntent();
            return () => {
                const index = intentHandlers.indexOf(callback);
                if (index >= 0) intentHandlers.splice(index, 1);
            };
        },
        resolve(value: unknown, options?: { discardPage?: boolean }): void {
            activeIntent?.resolve(value, options);
        },
        reject(reason?: unknown): void {
            activeIntent?.reject(reason);
        },
    },

    getCapability: getCapabilityRpc,

    /** Discover granted providers and invoke legacy capability handlers. */
    capabilities: {
        list(): Promise<unknown> {
            return capabilityRpc("capabilityList", []);
        },
        providers(id: string): Promise<CapabilityProvider[]> { return capabilityRpc("capabilityProviders", [id]); },
        invoke(
            id: string,
            payload: unknown,
            options?: { version?: number; deadlineMs?: number },
        ): Promise<unknown> {
            if (typeof id !== "string" || !id) {
                return Promise.reject(new BoardCapabilityError("rejected", "Capability id must not be empty."));
            }
            return capabilityInvokeRpc(id, payload, options);
        },
    },

    notify(message: string, type?: "info" | "success" | "warning" | "error", options?: { persistent?: boolean }): void {
        if (type === "error") console.error("[board]", message);
        fire("notify", [message, type, options?.persistent === true]);
    },

    /** Board module service protocol. Calls cross the bridge to the main-owned service supervisor. */
    service: {
        /** Request the trusted board module service. The service starts lazily on first use. */
        request(message: unknown): Promise<unknown> {
            return rpc("serviceRequest", [message]);
        },
        /** Open a long-lived two-way channel to this board's lazily started service. */
        openChannel(openMessage: unknown): Promise<ServiceChannel> {
            return openServiceChannel(openMessage);
        },
        /** Read this board's service lifecycle without starting it. Resolves to undefined when
         * there is no supervisor record for the board. */
        status(): Promise<BoardServiceStatus | undefined> {
            return rpc("serviceStatus", []) as Promise<BoardServiceStatus | undefined>;
        },
        /** Stop this board's service without starting it when it is not already running. */
        stop(): Promise<void> {
            return rpc("serviceStop", []) as Promise<void>;
        },
    },

    /** Cross-board service interfaces declared by this consumer board's trusted `uses` grant. */
    services: {
        list(interfaceId: string): Promise<Array<{ provider: string; title: string; version: number; boardName: string }>> {
            return rpc("servicesList", [interfaceId]) as Promise<Array<{ provider: string; title: string; version: number; boardName: string }>>;
        },
        connect(interfaceId: string, selector: { provider: string; version: number }, openMessage?: unknown): Promise<ServiceChannel> {
            try { structuredClone(openMessage); }
            catch (error) { return Promise.reject(Object.assign(new Error(errMessage(error, "Channel message is not structured-cloneable.")), { code: "rejected" })); }
            return rpc("servicesConnect", [interfaceId, selector, openMessage]).then((value) => waitForServiceChannel(String(value), "service"));
        },
    },

    /** Provider registration is intentionally service-only: implementations retain functions and
     * must outlive any board frame. */
    providers: {
        register(_type: string, _implementation: unknown): never {
            throw new ProviderRegistrationServiceOnlyError();
        },
    },

    /** Main-owned per-board JSON storage. Every call crosses the bridge; there is no local cache. */
    storage: {
        get(key: string): Promise<BoardJsonValue | undefined> {
            return rpc("storageGet", [key]) as Promise<BoardJsonValue | undefined>;
        },
        set(key: string, value: BoardJsonValue): Promise<void> {
            return rpc("storageSet", [key, value]) as Promise<void>;
        },
        delete(key: string): Promise<boolean> {
            return rpc("storageDelete", [key]) as Promise<boolean>;
        },
        keys(): Promise<string[]> {
            return rpc("storageKeys", []) as Promise<string[]>;
        },
    },

    /** Page-scoped opaque string values, stored in the host cache and removed with this page. */
    pageState: {
        get(key: string): Promise<string | undefined> {
            try { validateBoardPageStateKey(key); } catch (error: unknown) { return Promise.reject(error); }
            return hostFrame.request("pageState.get", { key }).then((value) => {
                if (value !== undefined && typeof value !== "string") throw new Error("Malformed persephone.pageState.get() response.");
                return value;
            });
        },
        set(key: string, value: string): Promise<void> {
            try {
                validateBoardPageStateKey(key);
                validateBoardPageStateValue(value);
            } catch (error: unknown) {
                return Promise.reject(error);
            }
            return hostFrame.request("pageState.set", { key, value });
        },
        remove(key: string): Promise<void> {
            try { validateBoardPageStateKey(key); } catch (error: unknown) { return Promise.reject(error); }
            return hostFrame.request("pageState.remove", { key });
        },
    },

    /** Write to the OS clipboard through the privileged side (bridge API 1.12.0).
     *  Use this rather than `navigator.clipboard`: a board frame is not the focused
     *  document when the click that triggered the copy landed on Persephone's own
     *  toolbar, and `navigator.clipboard` rejects with "Document is not focused". */
    clipboard: {
        /** Put an image on the clipboard from its encoded bytes (PNG, JPEG, …). */
        writeImage(data: Uint8Array | ArrayBuffer): Promise<void> {
            return rpc("clipboardWriteImage", [data]) as Promise<void>;
        },
        writeText(text: string): Promise<void> {
            return rpc("clipboardWriteText", [text]) as Promise<void>;
        },
    },

    openFileDialog(params?: unknown): Promise<string[] | undefined> {
        return rpc("openFileDialog", [params ?? {}]) as Promise<string[] | undefined>;
    },

    saveFileDialog(params?: unknown): Promise<string | undefined> {
        return rpc("saveFileDialog", [params ?? {}]) as Promise<string | undefined>;
    },

    openFolderDialog(params?: unknown): Promise<string[] | undefined> {
        return rpc("openFolderDialog", [params ?? {}]) as Promise<string[] | undefined>;
    },

    listFolder(path: string, options?: unknown): Promise<unknown> {
        return rpc("listFolder", [path, options ?? {}]);
    },
    /** Watch an authorized file or folder. The callback stays in this frame; only classified
     * batches cross the bridge. Call the returned disposer to stop receiving changes. */
    watch(path: string, callback: (batch: PathWatchBatch) => void, options?: BoardWatchOptions): Promise<() => void> {
        if (typeof callback !== "function") {
            return Promise.reject(Object.assign(new Error("persephone.watch() needs a callback function."), { code: "invalid-argument" }));
        }
        if (watchIdCounter >= Number.MAX_SAFE_INTEGER) return Promise.reject(new Error("persephone.watch() exhausted its local watch ids."));
        const watchId = ++watchIdCounter;
        watchCallbacks.set(watchId, callback);
        return rpc("watch", [watchId, path, options]).then(() => {
            let disposed = false;
            return () => {
                if (disposed) return;
                disposed = true;
                watchCallbacks.delete(watchId);
                void rpc("unwatch", [watchId]).catch((error: unknown) => {
                    console.warn("persephone.watch disposer failed:", errMessage(error));
                });
            };
        }, (error: unknown) => {
            watchCallbacks.delete(watchId);
            throw error;
        });
    },
    rememberFolder(path: string): Promise<boolean> { return rpc("rememberFolder", [path]) as Promise<boolean>; },
    rememberFile(path: string): Promise<boolean> { return rpc("rememberFile", [path]) as Promise<boolean>; },
    getFileAccess(path: string): Promise<{ read: boolean; write: boolean }> {
        return rpc("getFileAccess", [path]) as Promise<{ read: boolean; write: boolean }>;
    },

    /** Read a file. `encoding` picks what you get back: "utf8" (default) or "base64" give
     *  a string, "binary" gives a `Uint8Array` of the bytes — no base64 round-trip, which
     *  is both faster and the only way to read a file over ~400 MB (base64 of one exceeds
     *  V8's max string length). "binary" needs bridge API 1.1.0 / app 4.0.21: declare it
     *  with `minAppVersion` in board-manifest.json. */
    readFile(
        path: string,
        options?: { encoding?: "utf8" | "base64" | "binary" },
    ): Promise<string | Uint8Array> {
        return rpc("readFile", [path, options?.encoding]) as Promise<string | Uint8Array>;
    },

    /** Write a file. With `encoding: "binary"`, `data` is a `Uint8Array` (or ArrayBuffer);
     *  otherwise it is a string, interpreted as "utf8" (default) or "base64". */
    writeFile(
        path: string,
        data: string | Uint8Array | ArrayBuffer,
        options?: { encoding?: "utf8" | "base64" | "binary" },
    ): Promise<void> {
        return rpc("writeFile", [path, data, options?.encoding]) as Promise<void>;
    },

    /** Move a file to the OS Recycle Bin (bridge 1.41.0). Authorized like `writeFile`; rejects
     *  for a missing path or a folder. */
    trashFile(path: string): Promise<void> {
        return rpc("trashFile", [path]) as Promise<void>;
    },

    /** Register a TypeScript project folder (bridge 1.47.0) so Monaco pages editing its `.ts` files get
     *  project-aware IntelliSense. Authorized like `listFolder`; needs a `tsconfig.json` in `root`. */
    registerTypeScriptProject(root: string): Promise<void> {
        return rpc("registerTypeScriptProject", [root]) as Promise<void>;
    },

    /** Drop this frame's registration of a TypeScript project folder (bridge 1.47.0). */
    unregisterTypeScriptProject(root: string): Promise<void> {
        return rpc("unregisterTypeScriptProject", [root]) as Promise<void>;
    },

    /** Open a board folder this board can list; the target uses the normal user trust flow (bridge 1.48.0). */
    openBoard(folder: string): Promise<void> {
        return rpc("openBoard", [folder]) as Promise<void>;
    },

    // ── Busy / surviving jobs ────────────────────────────────────────────────

    /** Declare that this board's spawned processes must outlive the board itself.
     *  While busy, navigating the page away (or reloading the board) destroys the
     *  board but KEEPS its processes running; closing the page/tab (or quitting
     *  the app) still kills them. Call with `false` when the processes stopped. */
    setBoardBusy(busy: boolean): void {
        settleBusy(!!busy);
            try {
                hostFrame.emit("busy", { busy: !!busy });
            } catch {
            // parent gone — nothing to inform
        }
    },

    /** Declare transient visual activity on this page's tab; this does not retain the board or its processes. */
    setWorking(working: boolean): void {
        try {
            hostFrame.emit("working", { working: !!working });
        } catch {
            // parent gone — nothing to inform
        }
    },

    /** The board's current busy flag — carried across reloads. A re-created board
     *  reads `true` when it went busy before unloading: re-enter "running" mode
     *  (see `getJobs()`), or call `setBoardBusy(false)` if nothing lives anymore. */
    getBoardBusy(): Promise<boolean> {
        if (busyState !== null) return Promise.resolve(busyState);
        return new Promise<boolean>((resolve) => busyResolvers.push(resolve));
    },

    /** The absolute path of the file this board edits as a custom editor, or
     *  `undefined` for a board opened plainly. Resolves when the host handshake lands, so it
     *  is safe to await at any time. Read/write the file with `persephone.readFile`/`writeFile`.
     *
     *  Always a readable LOCAL path. When the file's real source is an archive entry
     *  (`archive.zip!doc.pdf`) or an `http(s)` URL, Persephone materializes it into a temp file and
     *  returns THAT path — so a board never handles non-local sources itself, and this call may take
     *  as long as the download. Requires `"editorSources": "any"` in the board manifest; without it
     *  such files are never routed to the board at all. REJECTS when the source cannot be read
     *  (missing archive entry, HTTP failure), so handle rejection — it is not the same as the
     *  `undefined` a plainly-opened board gets. */
    async getFilePath(): Promise<string | undefined> {
        await whenHandshake();
        if (!filePathNeedsMaterialize) return filePathValue;
        // Non-local source: resolve through the renderer, once. Concurrent callers share the
        // in-flight request; a failure clears it so a later call can retry.
        if (materializedPath) return materializedPath;
        if (!materializedPromise) {
            materializedPromise = filePathRpc().then(
                (p) => { materializedPath = p; return p; },
                (e) => { materializedPromise = null; throw e; },
            );
        }
        return materializedPromise;
    },

    /** The raw persisted source identity for this board, or `undefined` for a plain board.
     *  Unlike `getFilePath()`, this never materializes a non-local source or returns a cache path.
     *  Pair it with `source.initialSourcePrivateSession` for the initial privacy status. */
    getSourceUrl(): Promise<string | undefined> {
        if (sourceUrlSettled) return Promise.resolve(sourceUrlValue);
        return new Promise<string | undefined>((resolve) => sourceUrlResolvers.push(resolve));
    },

    /** Runtime source identities delivered to this frame after the initial open. The host only
     * persists the initial source through `getSourceUrl()`; boards that need later sources after
     * restart must persist their accepted hrefs through `persephone.state.init`. */
    source: {
        get initialSourceContext(): BoardSourceContext | undefined {
            return initialSourceContext;
        },
        get initialSourcePrivateSession(): boolean {
            return initialSourcePrivateSession;
        },
        navigate(href: string): Promise<void> {
            if (typeof href !== "string" || !href) {
                return Promise.reject(new TypeError("persephone.source.navigate() requires a non-empty href."));
            }
            return hostFrame.request("source.navigate", { href });
        },
        onOpen: onSourceOpen,
    },

    /** The absolute folder claimed by this board, or undefined for plain/file-only boards. */
    async getFolderPath(): Promise<string | undefined> {
        await whenHandshake();
        return folderPathValue;
    },

    /** Content-host bridge. Meaningful only when this board is a content-host editor
     *  (manifest `editorKind: "content-host"`); on a plain board `getContent`/`getLanguage` reject.
     *  Safe to call at ANY time — each method awaits the handshake internally before deciding,
     *  so boot ordering never matters (no ready-gate needed by the board). */
    host: {
        /** Origin-local URL for the platform-owned pipe. Available to content-host and
         * stream-host pages; plain boards reject rather than touching a cache path. */
        async streamUrl(): Promise<string> {
            await whenHandshake();
            if (!pipeUrlEnabled) {
                throw new Error("persephone.host.streamUrl is unavailable on this board");
            }
            if (!pipePageId) {
                throw new Error("Persephone did not provide a page id for streamUrl()");
            }
            return new URL(boardPipePagePath(pipePageId), location.origin).toString();
        },

        /** Current content — resolves to the first pushed snapshot (await any time). */
        async getContent(): Promise<string> {
            await whenHandshake();
            if (!hostEnabled) {
                throw new Error("persephone.host is available only for content-host boards");
            }
            if (hostContentSettled) return hostContent;
            return new Promise<string>((resolve) => hostContentResolvers.push(resolve));
        },

        /** Set content + mark the file modified (schedules the autosave cache). */
        setContent(content: string): void {
            // Keep the local replica in sync with our own write: the renderer echo-guard never
            // pushes it back, so without this a read-after-write would return the stale
            // pre-write value. Does NOT fire onContentChange (a frame never re-renders from
            // its own write); the OTHER frame still receives the change from the renderer.
            hostContent = content;
            if (!hostContentSettled) {
                hostContentSettled = true;
                for (const r of hostContentResolvers) r(content);
                hostContentResolvers.length = 0;
            }
            try {
                hostFrame.emit("content.set", { content });
            } catch {
                // parent gone
            }
        },

        /** Fire on each external content change (reload, other-view edit, host transfer). Returns an
         *  unsubscribe. The board's OWN setContent does NOT re-fire this (renderer-side echo-guard).
         *  Registers at any time — before the handshake too; on a plain (non-content-host) board no
         *  push ever arrives, so the callback simply never fires. */
        onContentChange(cb: (content: string, language?: string) => void): () => void {
            hostChangeCbs.push(cb);
            return () => {
                const i = hostChangeCbs.indexOf(cb);
                if (i >= 0) hostChangeCbs.splice(i, 1);
            };
        },

        /** Monaco language id of the current content (e.g. "xml", "json"), or undefined. */
        async getLanguage(): Promise<string | undefined> {
            await whenHandshake();
            if (!hostEnabled) {
                throw new Error("persephone.host is available only for content-host boards");
            }
            if (hostContentSettled) return hostLanguage;
            return new Promise<string | undefined>((resolve) =>
                hostContentResolvers.push(() => resolve(hostLanguage)),
            );
        },

        /** Save through Persephone's pipe (encryption / cache / dirty-clear). Optional — Ctrl+S
         *  already saves automatically (CH3). */
        save(): void {
            try {
                hostFrame.emit("content.save", {});
            } catch {
                // parent gone
            }
        },
    },

    /** Shared-state channel — available on EVERY board frame (main + secondary),
     *  authoritative on the Persephone side. `get()`/`onChange` read the replica; `init`/`set`/
     *  `merge` post to the host and return void (the change arrives via `onChange`). */
    state: {
        /** Declare defaults (fill-missing — restored values win) + which keys persist across
         *  restart/reload (opt-in). Typically called once by the main view at boot. */
        init(defaults: Record<string, unknown>, options?: { restorableKeys?: string[] }): void {
            try {
                hostFrame.emit("state.init", { defaults: defaults ?? {}, restorableKeys: options?.restorableKeys });
            } catch {
                // parent gone
            }
        },

        /** Current shared state — resolves to the first synced snapshot (await any time). */
        get(): Promise<Record<string, unknown>> {
            if (sharedStateSettled) return Promise.resolve(sharedState);
            return new Promise<Record<string, unknown>>((resolve) => sharedStateResolvers.push(resolve));
        },

        /** Replace the whole shared state. */
        set(next: Record<string, unknown>): void {
            try {
                hostFrame.emit("state.set", { state: next ?? {} });
            } catch {
                // parent gone
            }
        },

        /** Shallow-merge keys into the shared state. */
        merge(partial: Record<string, unknown>): void {
            try {
                hostFrame.emit("state.merge", { partial: partial ?? {} });
            } catch {
                // parent gone
            }
        },

        /** Fire on every shared-state change (from any frame). Returns an unsubscribe. */
        onChange(cb: (state: Record<string, unknown>) => void): () => void {
            sharedStateCbs.push(cb);
            return () => {
                const i = sharedStateCbs.indexOf(cb);
                if (i >= 0) sharedStateCbs.splice(i, 1);
            };
        },
    },

    /** Board environment variables. Reads/writes ONLY this board's namespace
     *  (resolved host-side from the board's identity — a board cannot name another's). All
     *  reject when the store is not configured (and the user declines to create it), locked
     *  (encrypted + cancelled/wrong password), or on a store error — handle rejection. */
    var: {
        /** A single value (the `default` profile when `env` is omitted), or undefined if unset. */
        get(name: string, env?: string): Promise<string | undefined> {
            return hostFrame.request("var.get", { name, ...(env === undefined ? {} : { env }) });
        },
        /** Write a value into this board's namespace (re-encrypts on save if the file is encrypted). */
        set(name: string, value: string, env?: string): Promise<void> {
            return hostFrame.request("var.set", { name, value, ...(env === undefined ? {} : { env }) });
        },
        /** This board's key names in a profile (NOT values). */
        list(env?: string): Promise<string[]> {
            return hostFrame.request("var.list", env === undefined ? {} : { env });
        },
        /** Open the Environment Variables editor, scoped to this board's namespace. */
        show(): Promise<void> {
            return hostFrame.request("var.show", {});
        },
    },

    /** Renderer-owned user settings. Reads and change notifications are scoped to this board;
     *  defaults are resolved at read time, and the board cannot write the stored value. */
    settings: {
        /** Read this board's declared setting, or its current manifest default when unset. */
        get(id: string): Promise<string | number | boolean> {
            return settingsRpc(id);
        },
        /** Receive effective values after a user changes or resets this board's setting. */
        onChange(callback: (change: { id: string; value: string | number | boolean }) => void): () => void {
            settingsChangeCbs.add(callback);
            return () => settingsChangeCbs.delete(callback);
        },
    },

    /** Fetch through the host renderer, optionally using its Tor daemon or a named proxy. */
    fetch(url: string, init?: BoardFetchInitInput): Promise<Response> {
        return boardFetch(url, init);
    },

    /** List this board's LIVE jobs — including ones that survived a previous
     *  board lifetime (busy retention). Each entry is a control-only handle:
     *  `kill`/`write`/`endStdin` work, but there is no stdout/stderr/exit
     *  streaming for surviving jobs (their output went to the previous board).
     *  Re-associate by `name` (from `execute(cmd, { name })`). */
    async getJobs(): Promise<Array<BoardJobInfo & {
        kill(signal?: string): void;
        write(data: string | Uint8Array): void;
        endStdin(): void;
    }>> {
        const jobs = (await rpc("getJobs", [])) as BoardJobInfo[];
        return (jobs ?? []).map((j) => ({
            ...j,
            kill(signal?: string): void {
                post({ kind: "runner", channel: RunnerChannel.kill, msg: { jobId: j.jobId, signal } });
            },
            write(data: string | Uint8Array): void {
                post({ kind: "runner", channel: RunnerChannel.stdin, msg: { jobId: j.jobId, data } });
            },
            endStdin(): void {
                post({ kind: "runner", channel: RunnerChannel.endStdin, msg: { jobId: j.jobId } });
            },
        }));
    },

    get theme(): BoardThemePalette {
        return currentTheme;
    },

    getTheme(): BoardThemePalette {
        return currentTheme;
    },

    tokens: Object.freeze({ ...tokens }),

    getTokens(): Record<string, string> {
        return tokens;
    },

    onThemeChange(cb: (theme: BoardThemePalette) => void): () => void {
        themeCbs.push(cb);
        try {
            cb(currentTheme);
        } catch (e) {
            console.error("persephone.onThemeChange callback error:", e);
        }
        return () => {
            const i = themeCbs.indexOf(cb);
            if (i >= 0) themeCbs.splice(i, 1);
        };
    },
};
