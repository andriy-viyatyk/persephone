import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../../ipc/module-service-channels";
import { openDomServiceChannel } from "../../../shared/service-channel-node";
import type { ServiceChannel } from "../../../shared/service-channel";
import { api } from "../../../ipc/renderer/api";
import { createCapabilityProxy } from "../../../shared/capability-client";
import { errMessage } from "../../../shared/utils";
import { codedError } from "../../../shared/coded-error";
import type {
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
} from "../types/capabilities";
import type {
    CapabilityClientInvoke,
    CapabilityClientOptions,
    CapabilityClientResult,
    CapabilityOutcome,
    CapabilityRegistration,
} from "../../../ipc/capability-bus-channels";
import { CapabilityError, noHandlerError, toCapabilityError } from "../capability-error";
import { serviceChannelPorts } from "../service-channel-ports";
import { CapabilityIndexMirror } from "./capability-index";
import { boardCapabilityDispatcher } from "./BoardCapabilityDispatcher";
import { pages } from "../pages";
import { contentViewRepresentation } from "./platform-payload-validators";

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

function outcomeFrom(value: CapabilityOutcome | null): CapabilityOutcome {
    if (!value || typeof value !== "object") return {};
    return {
        ...(typeof value.pageId === "string" ? { pageId: value.pageId } : {}),
        ...(value.result !== null && value.result !== undefined ? { result: value.result } : {}),
    };
}

function withNoHandlerMessage(error: CapabilityError, id: string, version?: number): CapabilityError {
    return error.code === "no-handler" ? noHandlerError(id, version) : error;
}

function logCancelFailure(error: unknown): void {
    console.error(`Failed to cancel capability invocation: ${errMessage(error)}`);
}

function watchCaller(opts: CapabilityInvokeOptions | undefined, cancel: () => void): () => void {
    const stops: Array<() => void> = [];
    if (opts?.signal) {
        if (opts.signal.aborted) cancel();
        else {
            opts.signal.addEventListener("abort", cancel, { once: true });
            stops.push(() => opts.signal?.removeEventListener("abort", cancel));
        }
    }
    const page = opts?.pageId ? pages.query.findPage(opts.pageId) : undefined;
    if (page) stops.push(page.disposed.subscribe(cancel));
    return () => stops.forEach((stop) => stop());
}

async function openRendererCapabilityChannel(request: CapabilityClientInvoke): Promise<ServiceChannel> {
    const channelId = unwrapClientResult(JSON.parse(await api.connectHostServiceChannel({ kind: "capability", request })) as CapabilityClientResult<string>);
    const port = await serviceChannelPorts.claim(channelId, {
        timeoutMs: SERVICE_CHANNEL_OPEN_TIMEOUT_MS,
        timeoutError: () => codedError("timeout", "Channel delivery timed out."),
    });
    return openDomServiceChannel(port, "capability");
}

export class CapabilitiesClient implements ICapabilities {
    private readonly index = new CapabilityIndexMirror();

    /** First pull of main's capability index; `list()` and `handlers()` read it synchronously afterwards. */
    loadIndex(): Promise<void> { return this.index.load(); }

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
        return projectCapabilityOutcome(await this.invokeOutcome(id, payload, opts));
    }

    list(): readonly CapabilityInfo[] {
        return Object.freeze(this.index.registrations().map(copyInfo));
    }

    handlers(id: string, filter?: CapabilityHandlerFilter): readonly CapabilityInfo[] {
        return Object.freeze(this.index.registrations().filter((entry) => entry.id === id && matchesFilter(entry, filter))
            .sort((a, b) => b.priority - a.priority || Number(b.origin === "platform") - Number(a.origin === "platform")).map(copyInfo));
    }

    /** Resolve and invoke an open through main, retaining the outcome for board and script callers. */
    async invokeOutcome(
        id: string,
        payload: unknown,
        opts?: CapabilityInvokeOptions,
    ): Promise<CapabilityOutcome> {
        const parsed = parseCapabilityId(id);
        if (!parsed.bareId) throw noHandlerError(id);
        if (opts?.version !== undefined && parsed.version !== undefined && opts.version !== parsed.version) {
            throw noHandlerError(id, parsed.version);
        }
        const version = parsed.version ?? opts?.version;

        const controller = new AbortController();
        const stopWatching = watchCaller(opts, () => controller.abort());
        try {
            const filter = parsed.bareId === "content.view"
                ? { ...opts?.filter, representation: contentViewRepresentation(payload) }
                : opts?.filter;
            const provider = unwrapClientResult(await api.capabilityGet(parsed.bareId, {
                forOpen: true,
                ...(version !== undefined ? { version } : {}),
                ...(filter ? { filter } : {}),
            }));
            if (!provider) throw noHandlerError(id, version);
            if (controller.signal.aborted) throw new CapabilityError("cancelled", "Capability invocation was cancelled.");
            const requestId = crypto.randomUUID();
            controller.signal.addEventListener("abort", () => {
                void api.capabilityCancel(requestId).catch(logCancelFailure);
            }, { once: true });
            const parentRequestId = opts?.pageId ? boardCapabilityDispatcher.activeRequestForPage(opts.pageId) : undefined;
            const key = { id: provider.id, version: provider.version, provider: provider.provider, handlerKey: provider.handlerKey };
            const outcome = unwrapClientResult(await api.capabilityInvoke(
                { requestId, key, method: "open", args: [payload], ...(filter ? { filter } : {}) },
                { ...(parentRequestId ? { parentRequestId } : {}), ...(opts?.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}) },
            ));
            return outcomeFrom(outcome as CapabilityOutcome | null);
        } catch (error) {
            throw withNoHandlerMessage(toCapabilityError(error, `Capability "${id}" was rejected.`), id, version);
        } finally { stopWatching(); }
    }
}

export const capabilities = new CapabilitiesClient();
