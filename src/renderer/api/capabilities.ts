import { serialize } from "node:v8";
import { MAX_SERVICE_CHANNEL_IN_FLIGHT, MAX_SERVICE_CHANNEL_MESSAGE_BYTES } from "../../shared/capability-limits";
import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../ipc/module-service-channels";
import { api } from "../../ipc/renderer/api";
import { createCapabilityProxy } from "../../shared/capability-client";
import { errMessage } from "../../shared/utils";
import { t } from "../../shared/i18n/t";
import type {
    CapabilityChannel,
    CapabilityChannelReason,
    CapabilityHandlerFilter,
    CapabilityId,
    CapabilityInfo,
    CapabilityInvokeOptions,
    CapabilityPageResult,
    CertificateViewPayload,
    DiagramEditResult,
    ContentRepresentation,
    ICapabilities,
    ImageEditPayload,
    ThemeEditPayload,
} from "./types/capabilities";
import { editorRegistry, type EditorCapabilityDeclaration } from "../editors/base/editorRegistry";
import type { EditorView } from "../../shared/types";
import type {
    CapabilityClientOptions,
    CapabilityClientResult,
    CapabilityOutcome,
    CapabilityRegistration,
    BoundOpenDispatch,
    BoundOpenSettlement,
} from "../../ipc/capability-bus-channels";
import { CapabilityError, capabilityBus } from "./capability-bus";
import { validateCertificateViewPayload } from "./certificate-view";
import { validateThemeEditPayload } from "./theme-edit";
import { EventEndpoint } from "../../ipc/api-types";
import { boardCapabilityTransport } from "./board-capability-transport";

type CapabilityHandler = (payload: unknown) => Promise<CapabilityPageResult>;

const builtinHandlers = new Map<string, Map<string, CapabilityHandler>>();
let platformCandidatesSeeded = false;
type CapabilityIndex = Awaited<ReturnType<typeof api.getCapabilityIndex>>;
let mainIndexSnapshot: CapabilityIndex | undefined;
let latestRevision = -1;
let indexInitialization: Promise<void> | undefined;

export function initializeCapabilityIndex(): Promise<void> {
    if (indexInitialization) return indexInitialization;
    const accept = (snapshot: CapabilityIndex) => {
        if (!mainIndexSnapshot || snapshot.revision >= mainIndexSnapshot.revision) mainIndexSnapshot = snapshot;
        latestRevision = Math.max(latestRevision, snapshot.revision);
    };
    let fetching: Promise<void> | undefined;
    const refresh = (): Promise<void> => {
        if (!fetching) fetching = (async () => {
            do { accept(await api.getCapabilityIndex()); } while (mainIndexSnapshot!.revision < latestRevision);
        })().finally(() => { fetching = undefined; });
        return fetching;
    };
    api.onCapabilityIndexSnapshot((snapshot) => { accept(snapshot); if (snapshot.revision < latestRevision) void refresh(); });
    api.onCapabilityIndexChanged((revision) => { latestRevision = Math.max(latestRevision, revision); if (!mainIndexSnapshot || mainIndexSnapshot.revision < latestRevision) void refresh(); });
    indexInitialization = refresh();
    return indexInitialization;
}

function capabilityKey(id: CapabilityId, representation?: string): string {
    return `${id}:${representation ?? ""}`;
}

function reportDuplicate(id: CapabilityId, representation: string | undefined): void {
    const name = representation ? `${id}/${representation}` : id;
    void import("./ui")
        .then(({ ui }) => ui.notify(
            t("api.duplicateCapabilityRegistration", { name }),
            "error",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report duplicate capability registration: ${errMessage(error)}`);
        });
}

function asRecord(payload: unknown, capability: CapabilityId): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError(`${capability} expects an object payload.`);
    }
    return payload as Record<string, unknown>;
}

function requiredString(
    payload: Record<string, unknown>,
    key: string,
    capability: CapabilityId,
): string {
    const value = payload[key];
    if (typeof value !== "string") {
        throw new TypeError(`${capability} expects a string ${key}.`);
    }
    return value;
}

function createPageHandler(
    editorId: string,
    capability: CapabilityId,
    representation?: ContentRepresentation,
): CapabilityHandler {
    return async (payload: unknown): Promise<CapabilityPageResult> => {
        const values = asRecord(payload, capability);
        const content = requiredString(values, "content", capability);
        const language = requiredString(values, "language", capability);
        const title = requiredString(values, "title", capability);
        if (capability === "content.view" && values.representation !== representation) {
            throw new TypeError(
                `content.view expects representation "${representation}" for this handler.`,
            );
        }

        const { pagesModel } = await import("./pages");
        const page = pagesModel.addEditorPage(editorId as EditorView, language, title, content);
        return { pageId: page.id };
    };
}

function createHandler(
    editorId: string,
    declaration: EditorCapabilityDeclaration,
): CapabilityHandler {
    return createPageHandler(editorId, declaration.id, declaration.representation);
}

export function seedPlatformCapabilities(): void {
    if (platformCandidatesSeeded) return;
    const definitions = editorRegistry.getAll();
    if (definitions.length === 0) return;

    for (const definition of definitions) {
        for (const declaration of definition.capabilities ?? []) {
            const key = capabilityKey(declaration.id, declaration.representation);
            const handlers = builtinHandlers.get(definition.id) ?? new Map<string, CapabilityHandler>();
            if (handlers.has(key)) {
                reportDuplicate(declaration.id, declaration.representation);
                continue;
            }
            handlers.set(key, createHandler(definition.id, declaration));
            builtinHandlers.set(definition.id, handlers);

        }
    }
    platformCandidatesSeeded = true;
}

function matchesFilter(registration: CapabilityRegistration, filter?: CapabilityHandlerFilter): boolean {
    if (filter?.representation !== undefined && registration.representation !== undefined
        && registration.representation !== filter.representation) return false;
    return filter?.mime === undefined || registration.accepts === undefined || registration.accepts.includes(filter.mime);
}

function copyInfo(registration: CapabilityRegistration): CapabilityInfo {
    const { boardName: _boardName, ...info } = registration;
    return { ...info, ...(registration.accepts !== undefined ? { accepts: [...registration.accepts] } : {}) };
}

function parseCapabilityId(id: string): { bareId?: string; version?: number; reason?: string } {
    const at = id.lastIndexOf("@");
    if (at < 0) return { bareId: id };
    if (at === 0 || id.indexOf("@") !== at) {
        return { reason: `No capability handler matches "${id}".` };
    }
    const bareId = id.slice(0, at);
    const version = Number(id.slice(at + 1));
    if (!bareId || !Number.isInteger(version)) {
        return { reason: `No capability handler matches "${id}".` };
    }
    return { bareId, version };
}

function noHandlerError(id: string, version?: number): CapabilityError {
    const suffix = version === undefined ? "" : ` at version ${version}`;
    return new CapabilityError("no-handler", `No capability handler matches "${id}"${suffix}.`);
}

function projectCapabilityOutcome(outcome: CapabilityOutcome): unknown {
    if (typeof outcome.pageId !== "string") return outcome.result;
    const result = outcome.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
        return { ...(result as Record<string, unknown>), pageId: outcome.pageId };
    }
    return { pageId: outcome.pageId };
}

function unwrapClientResult<T>(result: CapabilityClientResult<T>): T {
    if (result.ok === false) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
}

function createRendererCapabilityChannel(port: MessagePort): CapabilityChannel {
    const messages = new Set<(value: unknown) => void>();
    const closes = new Set<(reason: CapabilityChannelReason) => void>();
    const waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
    let reason: CapabilityChannelReason | undefined;
    let sent = 0, acknowledged = 0, received = 0;
    const finish = (next: CapabilityChannelReason) => {
        if (reason) return;
        reason = next; port.close();
        for (const waiter of waiters) waiter.reject(Object.assign(new Error(next.message), { code: next.code }));
        waiters.clear();
        for (const listener of closes) listener(next);
        closes.clear(); messages.clear();
    };
    port.onmessage = ({ data }) => {
        if (data?.kind === "ack" && Number.isSafeInteger(data.sequence)) {
            acknowledged = Math.max(acknowledged, Math.min(data.sequence, sent));
            for (const waiter of waiters) waiter.resolve();
            waiters.clear();
        } else if (data?.kind === "data" && data.sequence === received + 1) {
            received = data.sequence;
            for (const listener of messages) listener(data.value);
            port.postMessage({ kind: "ack", sequence: received });
        } else if (data?.kind === "close") finish(data.reason ?? { code: "channel-closed", message: "Channel closed." });
    };
    port.onmessageerror = () => finish({ code: "handler-closed", message: "Channel disconnected." });
    port.start();
    return {
        get writable() { return !reason && sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT; },
        send(value) {
            if (reason) throw Object.assign(new Error(reason.message), { code: reason.code });
            if (sent - acknowledged >= MAX_SERVICE_CHANNEL_IN_FLIGHT) throw Object.assign(new Error("Channel send window is full."), { code: "channel-backpressure" });
            let size: number;
            try { size = serialize(value).byteLength; } catch { throw Object.assign(new Error("Channel message is not cloneable."), { code: "rejected" }); }
            if (size > MAX_SERVICE_CHANNEL_MESSAGE_BYTES) throw Object.assign(new Error("Channel message is too large."), { code: "payload-too-large" });
            port.postMessage({ kind: "data", sequence: ++sent, value });
        },
        onMessage(listener) { messages.add(listener); return () => { messages.delete(listener); }; },
        onClose(listener) { if (reason) listener(reason); else closes.add(listener); return () => { closes.delete(listener); }; },
        close(next = { code: "channel-closed", message: "Channel closed." }) {
            if (reason) return;
            try { port.postMessage({ kind: "close", reason: next }); } catch { /* Peer exited. */ }
            finish(next);
        },
        whenWritable() {
            if (reason) return Promise.reject(Object.assign(new Error(reason.message), { code: reason.code }));
            if (sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT) return Promise.resolve();
            return new Promise<void>((resolve, reject) => { waiters.add({ resolve, reject }); });
        },
    };
}

async function openRendererCapabilityChannel(request: import("../../ipc/capability-bus-channels").CapabilityClientInvoke): Promise<CapabilityChannel> {
    let expected: string | undefined;
    const ports = new Map<string, MessagePort>();
    let resolvePort: ((port: MessagePort) => void) | undefined;
    const unsubscribe = api.onBoardServiceChannel((boardId, channelId, port) => {
        if (boardId !== `capability:${request.requestId}`) return;
        if (channelId === expected && resolvePort) resolvePort(port);
        else ports.set(channelId, port);
    });
    try {
        expected = unwrapClientResult(JSON.parse(await api.connectHostServiceChannel({ kind: "capability", request })) as CapabilityClientResult<string>);
        const port = ports.get(expected) ?? await new Promise<MessagePort>((resolve, reject) => {
            const timer = setTimeout(() => reject(Object.assign(new Error("Channel delivery timed out."), { code: "timeout" })), SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
            resolvePort = (value) => { clearTimeout(timer); resolve(value); };
        });
        ports.delete(expected);
        return createRendererCapabilityChannel(port);
    } finally { unsubscribe(); for (const port of ports.values()) port.close(); }
}

class Capabilities implements ICapabilities {
    async providers(id: string) { return unwrapClientResult(await api.capabilityProviders(id)); }

    async get(id: string, options?: CapabilityClientOptions) {
        const filter = options?.filter ? { ...options.filter } : undefined;
        const provider = unwrapClientResult(await api.capabilityGet(id, options));
        if (!provider) return null;
        const key = { id: provider.id, version: provider.version, provider: provider.provider, handlerKey: provider.handlerKey };
        const kinds = Object.fromEntries(Object.entries(provider.methods).map(([name, method]) => [name, method.kind]));
        return createCapabilityProxy(provider, async (method, args) => {
            const request = { requestId: crypto.randomUUID(), key, method, args, ...(filter ? { filter } : {}) };
            if (kinds[method] === "channel") return openRendererCapabilityChannel(request);
            return unwrapClientResult(await api.capabilityInvoke(request));
        });
    }

    invoke(id: "text.open", payload: { content: string; language: string; title: string }): Promise<CapabilityPageResult>;
    invoke(id: "content.view", payload: { representation: ContentRepresentation; content: string; language: string; title: string }): Promise<CapabilityPageResult>;
    invoke(id: "image.edit", payload: ImageEditPayload): Promise<CapabilityPageResult>;
    invoke(id: "diagram.edit", payload: { source: string; title: string }): Promise<DiagramEditResult>;
    invoke(id: "certificate.view", payload: CertificateViewPayload): Promise<unknown>;
    invoke(id: "theme.edit", payload: ThemeEditPayload, opts?: CapabilityInvokeOptions): Promise<unknown>;
    invoke(id: string, payload: unknown, opts?: CapabilityInvokeOptions): Promise<unknown>;
    async invoke(id: CapabilityId, payload: unknown, opts?: CapabilityInvokeOptions): Promise<unknown> {
        const invocation = await invokeCapabilityOutcome(id, payload, opts);
        // The one flattening: a board handler's outcome becomes the script-shaped result.
        return invocation.origin === "board" ? projectCapabilityOutcome(invocation.value) : invocation.value;
    }

    list(): readonly CapabilityInfo[] {
        return Object.freeze(
            (mainIndexSnapshot?.legacyRegistrations ?? []).map(copyInfo),
        );
    }

    handlers(id: string, filter?: CapabilityHandlerFilter): readonly CapabilityInfo[] {
        return Object.freeze((mainIndexSnapshot?.legacyRegistrations ?? []).filter((entry) => entry.id === id && matchesFilter(entry, filter))
            .sort((a, b) => b.priority - a.priority || Number(b.origin === "platform") - Number(a.origin === "platform")).map(copyInfo));
    }
}

export const capabilities = new Capabilities();

/** Accept only requests dispatched by main and settle them on the originating IPC channel. */
export function registerBoundOpenDispatch(): void {
    const active = new Map<string, CapabilityRegistration>();
    window.electron.ipcRenderer.on(EventEndpoint.eCapabilityOpenCancel, (value: unknown) => {
        if (typeof value !== "string") return;
        const registration = active.get(value);
        if (!registration) return;
        active.delete(value);
        if (registration.origin === "board") boardCapabilityTransport.cancel(registration, value);
    });
    window.electron.ipcRenderer.on(EventEndpoint.eCapabilityOpen, (value: unknown) => {
        const { registration, request } = value as BoundOpenDispatch;
        if (!registration || !request || active.has(request.requestId)) return;
        active.set(request.requestId, registration);
        void (async () => {
            if (registration.id === "certificate.view") validateCertificateViewPayload(request.payload);
            if (registration.id === "theme.edit") validateThemeEditPayload(request.payload);
            if (registration.headless) throw noHandlerError(registration.id, registration.version);
            if (registration.origin === "board") return await boardCapabilityTransport.dispatch(registration, request);
            seedPlatformCapabilities();
            const handler = builtinHandlers.get(registration.handlerKey)?.get(capabilityKey(registration.id, registration.representation));
            if (!handler) throw noHandlerError(registration.id, registration.version);
            const result = await handler(request.payload);
            return { pageId: result.pageId, result: null };
        })().then((result) => {
            if (!active.delete(request.requestId)) return;
            window.electron.ipcRenderer.sendMessage(EventEndpoint.eCapabilityOpenResult, { requestId: request.requestId, result } satisfies BoundOpenSettlement);
        }, (error: unknown) => {
            if (!active.delete(request.requestId)) return;
            const code = error instanceof CapabilityError ? error.code : "rejected";
            window.electron.ipcRenderer.sendMessage(EventEndpoint.eCapabilityOpenResult, { requestId: request.requestId, error: { code, message: errMessage(error) } } satisfies BoundOpenSettlement);
        });
    });
}

export type CapabilityInvocation =
    | { readonly origin: "board"; readonly value: CapabilityOutcome }
    | { readonly origin: "platform"; readonly value: unknown };

/** Resolve and run a capability, returning the handler's unflattened value. Board callers use
 *  this directly (a board-origin outcome reaches them untouched); `capabilities.invoke` flattens
 *  it once for scripts. */
export async function invokeCapabilityOutcome(
    id: string,
    payload: unknown,
    opts?: CapabilityInvokeOptions,
): Promise<CapabilityInvocation> {
    const parsed = parseCapabilityId(id);
    if (!parsed.bareId) throw noHandlerError(id);
    if (opts?.version !== undefined && parsed.version !== undefined && opts.version !== parsed.version) {
        throw noHandlerError(id, parsed.version);
    }
    const version = parsed.version ?? opts?.version;

    try {
        const values = parsed.bareId === "content.view"
            ? asRecord(payload, parsed.bareId)
            : undefined;
        if (parsed.bareId === "certificate.view") validateCertificateViewPayload(payload);
        if (parsed.bareId === "theme.edit") validateThemeEditPayload(payload);
        const representation = values?.representation;
        if (parsed.bareId === "content.view" && (
            typeof representation !== "string"
            || !representation.trim()
        )) {
            throw new TypeError("content.view expects a non-empty string representation.");
        }

        const filter = parsed.bareId === "content.view"
            ? { ...opts?.filter, representation: representation as string }
            : opts?.filter;
        const registration = unwrapClientResult(await api.capabilityLegacyResolve(parsed.bareId, { version, filter }));
        if (!registration) throw noHandlerError(id, version);
        if (registration.headless) throw noHandlerError(id, version);

        if (registration.origin === "platform") {
            seedPlatformCapabilities();
            const handler = builtinHandlers.get(registration.handlerKey)?.get(
                capabilityKey(registration.id, registration.representation),
            );
            if (!handler) throw noHandlerError(id, version);
            try {
                return { origin: "platform", value: await handler(payload) };
            } catch (error) {
                throw new CapabilityError(
                    "rejected",
                    errMessage(error, `Capability "${id}" was rejected.`),
                    undefined,
                    error,
                );
            }
        }

        const outcome = await capabilityBus.invoke(
            registration,
            payload,
            parsed.version === undefined ? opts : { ...opts, version: parsed.version },
        );
        return { origin: "board", value: outcome as CapabilityOutcome };
    } catch (error) {
        if (error instanceof CapabilityError) throw error;
        throw new CapabilityError(
            "rejected",
            errMessage(error, `Capability "${id}" was rejected.`),
            undefined,
            error,
        );
    }
}
