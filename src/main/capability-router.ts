import { PLATFORM_AUDIO_CAPABILITY_ID, isCapabilityErrorCode } from "../shared/capability-constants";
import { capabilityRegistry, type CapabilityRegistration } from "./capability-registry";
import { randomUUID } from "node:crypto";
import { MAX_INTENT_DEPTH, MAX_INTENT_PAYLOAD_BYTES, MAX_OUTSTANDING_INTENTS_PER_HANDLER } from "../shared/capability-limits";
import type { CapabilityCallerIdentity, CapabilityJson } from "../shared/capability-contract";
import type { CapabilityInvocationWireContext } from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import type { ServiceChannel } from "../shared/service-channel";
import type { WebContents } from "electron";
import type { ChannelDelivery } from "./channel-delivery";
import { app, BrowserWindow } from "electron";
import { guardedIpcOn } from "./ipc-sender-guard";
import { openWindows } from "./open-windows";
import { EventEndpoint } from "../ipc/api-types";
import type { BoundOpenDispatch, BoundOpenSettlement, CapabilityOutcome, CapabilityKey, CapabilityProvider } from "../ipc/capability-bus-channels";
import { BoardRoot } from "../shared/board/board-root";
import { boardRootDigest } from "./board-root-hashes";
import { codedError } from "../shared/coded-error";
import { onWebContentsGone } from "./webcontents-lifetime";
import { PendingRequests } from "../shared/pending-requests";

export type CapabilityCaller = { kind: "platform" | "agent" } | { kind: "board-page" | "board-service"; provider: string };
export interface CapabilityOptions { version?: number; provider?: string; filter?: { mime?: string; representation?: string } }
export interface BoundCapability { caller: CapabilityCaller; registration: CapabilityRegistration; filter?: CapabilityOptions["filter"] }
export interface CapabilityCallContext {
    signal?: AbortSignal;
    chain?: readonly string[];
    depth?: number;
    deadlineAt?: number;
    owner?: WebContents;
    target?: WebContents;
    parentRequestId?: string;
    originatingWindowId?: number;
    caller?: CapabilityCallerIdentity;
    invocation?: MainCapabilityInvocationContext;
    channelDelivery?: ChannelDelivery;
}

export interface MainCapabilityInvocationContext {
    readonly caller: CapabilityCallerIdentity;
    readonly owner: { kind: "window"; webContents: WebContents } | { kind: "service"; boardRoot: string };
    readonly signal: AbortSignal;
    readonly chain: readonly string[];
    readonly depth: number;
    readonly originatingWindowId?: number;
    readonly controller: AbortController;
    readonly requestId?: string;
    readonly parentRequestId?: string;
    readonly dispose: () => void;
}

function checkedJson(value: unknown): CapabilityJson {
    const ancestors = new Set<object>();
    const visit = (item: unknown): void => {
        if (item === null || typeof item === "string" || typeof item === "boolean") return;
        if (typeof item === "number" && Number.isFinite(item)) return;
        if (typeof item !== "object" || item === null || ancestors.has(item)) throw codedError("rejected", "Value must be JSON.");
        if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw codedError("rejected", "Value must be JSON.");
        ancestors.add(item);
        if (Array.isArray(item)) {
            for (let index = 0; index < item.length; index++) {
                if (!Object.hasOwn(item, index)) throw codedError("rejected", "Value must be JSON.");
                visit(item[index]);
            }
        } else for (const child of Object.values(item)) visit(child);
        ancestors.delete(item);
    };
    try {
        visit(value);
        const serialized = JSON.stringify(value);
        if (Buffer.byteLength(serialized, "utf8") > MAX_INTENT_PAYLOAD_BYTES) throw codedError("payload-too-large");
        return JSON.parse(serialized) as CapabilityJson;
    } catch (error) {
        if ((error as { code?: string })?.code === "payload-too-large") throw error;
        throw codedError("rejected", "Value must be JSON.");
    }
}

class CapabilityRouter {
    private preferences: Record<string, string> = {};
    private readonly handlerCounts = new Map<string, number>();
    private readonly openRequests = new PendingRequests<unknown, { target: WebContents }, string>({
        nextId: () => randomUUID(),
        timeoutError: () => codedError("timeout"),
        abortError: (reason) => reason ?? codedError("cancelled"),
    });
    private readonly invocationContexts = new Map<string, MainCapabilityInvocationContext>();

    constructor() {
        guardedIpcOn(EventEndpoint.eCapabilityOpenResult, (event, settlement: BoundOpenSettlement) => {
            if (!settlement || typeof settlement.requestId !== "string") return;
            const accepted = (meta: { target: WebContents }) => meta.target === event.sender;
            if (settlement.error) {
                const code = isCapabilityErrorCode(settlement.error.code) ? settlement.error.code : "rejected";
                this.openRequests.fail(settlement.requestId, codedError(code, typeof settlement.error.message === "string" ? settlement.error.message : code), accepted);
            } else this.openRequests.settle(settlement.requestId, settlement.result, accepted);
        });
    }

    setPreferences(value: Record<string, string>): void { this.preferences = { ...value }; }

    /** Build a trusted context, or inherit its lifecycle and ancestry from an active service call. */
    createInvocationContext(bound: BoundCapability, input: Omit<CapabilityCallContext, "invocation"> = {}): MainCapabilityInvocationContext {
        if (input.parentRequestId) {
            const parent = this.invocationContexts.get(input.parentRequestId);
            if (!parent) throw codedError("cancelled", "The parent capability request is no longer active.");
            const owner = bound.caller.kind === "board-service"
                ? { kind: "service" as const, boardRoot: capabilityRegistry.board(bound.caller.provider)?.boardRoot ?? bound.caller.provider }
                : input.owner ? { kind: "window" as const, webContents: input.owner } : parent.owner;
            const caller = input.caller ?? (parent.owner.kind === "service"
                ? this.identityForServiceRoot(parent.owner.boardRoot)
                : parent.caller);
            const controller = new AbortController();
            const abort = () => controller.abort(parent.signal.reason ?? input.signal?.reason ?? codedError("cancelled"));
            input.signal?.addEventListener("abort", abort, { once: true });
            parent.signal.addEventListener("abort", abort, { once: true });
            if (parent.signal.aborted || input.signal?.aborted) abort();
            return { caller, owner, signal: controller.signal, controller, chain: [...parent.chain], depth: parent.depth,
                originatingWindowId: parent.originatingWindowId, requestId: parent.requestId,
                dispose: () => { parent.signal.removeEventListener("abort", abort); input.signal?.removeEventListener("abort", abort); } };
        }
        const caller = input.caller ?? this.callerIdentity(bound.caller);
        const target = input.owner ?? input.target;
        let owner: MainCapabilityInvocationContext["owner"];
        if (bound.caller.kind === "board-service") {
            owner = { kind: "service", boardRoot: capabilityRegistry.board(bound.caller.provider)?.boardRoot ?? bound.caller.provider };
        } else if (target) owner = { kind: "window", webContents: target };
        else if ("provider" in bound.caller) owner = { kind: "service", boardRoot: capabilityRegistry.board(bound.caller.provider)?.boardRoot ?? bound.caller.provider };
        else throw codedError("no-handler", "A target renderer is required.");
        const controller = new AbortController();
        const abort = () => controller.abort(input.signal?.reason ?? codedError("cancelled"));
        input.signal?.addEventListener("abort", abort, { once: true });
        if (input.signal?.aborted) abort();
        const ownerContents = owner.kind === "window" ? owner.webContents : undefined;
        const ownerClosed = () => controller.abort(codedError("cancelled"));
        const stopWatchingOwner = ownerContents ? onWebContentsGone(ownerContents, ownerClosed) : undefined;
        const ancestry = input.chain ?? [];
        const depth = input.depth ?? ancestry.length;
        if (depth > MAX_INTENT_DEPTH) throw codedError("cycle");
        const originatingWindowId = input.originatingWindowId
            ?? (target && BrowserWindow.fromWebContents(target)?.id)
            ?? ("provider" in bound.caller ? undefined : undefined);
        return { caller, owner, signal: controller.signal, controller, chain: [...ancestry], depth, originatingWindowId, dispose: () => {
            input.signal?.removeEventListener("abort", abort);
            stopWatchingOwner?.();
        } };
    }

    private callerIdentity(caller: CapabilityCaller): CapabilityCallerIdentity {
        if ("provider" in caller) {
            const board = capabilityRegistry.board(caller.provider);
            return { kind: caller.kind, id: board?.callerId ?? caller.provider, name: board?.boardName ?? "" };
        }
        return { kind: caller.kind, id: caller.kind === "agent" ? "agent" : "persephone", name: caller.kind === "agent" ? "agent" : "persephone" } as CapabilityCallerIdentity;
    }
    private identityForServiceRoot(boardRoot: string): CapabilityCallerIdentity {
        const provider = capabilityRegistry.snapshot().registrations.find((entry) => entry.origin === "board" && entry.provider === boardRootDigest(BoardRoot.from(boardRoot)))?.provider;
        const board = provider ? capabilityRegistry.board(provider) : undefined;
        return { kind: "board-service", id: board?.callerId ?? provider ?? boardRoot, name: board?.boardName ?? "" };
    }
    list(caller: CapabilityCaller): CapabilityRegistration[] {
        const board = "provider" in caller ? capabilityRegistry.board(caller.provider) : undefined;
        if ("provider" in caller && (!board || (caller.kind === "board-service" && !board.canStartService))) return [];
        return capabilityRegistry.snapshot().registrations.filter((entry) => {
            if (board && !board.uses?.some((use) => use.id === entry.id && use.version === entry.version)) return false;
            if (caller.kind === "agent" && !Object.values(entry.methods).some((method) => method.agent)) return false;
            return true;
        }).map((entry) => caller.kind === "agent" ? {
            ...entry, methods: Object.fromEntries(Object.entries(entry.methods).filter(([, method]) => method.agent)),
        } : entry);
    }
    providers(caller: CapabilityCaller, id: string): CapabilityRegistration[] { return this.list(caller).filter((entry) => entry.id === id); }
    resolve(caller: CapabilityCaller, id: string, options: CapabilityOptions = {}): BoundCapability | null {
        const visible = this.providers(caller, id);
        let candidates = visible.filter((entry) => entry.version === (options.version ?? 1)
            && (!options.filter?.mime || !entry.accepts || entry.accepts.includes(options.filter.mime))
            && (!options.filter?.representation || !entry.representation || entry.representation === options.filter.representation));
        if (options.provider) {
            const keys = new Set(visible.filter((entry) => entry.provider === options.provider || entry.name === options.provider).map((entry) => entry.provider));
            if (keys.size !== 1) return null;
            candidates = candidates.filter((entry) => keys.has(entry.provider));
        } else {
            const preferred = candidates.filter((entry) => entry.provider === this.preferences[id]);
            if (preferred.length) candidates = preferred;
        }
        candidates.sort((a, b) => b.priority - a.priority || Number(b.origin === "platform") - Number(a.origin === "platform"));
        const selected = candidates[0];
        const registration = selected && capabilityRegistry.snapshot().registrations.find((entry) => entry.handlerKey === selected.handlerKey && entry.provider === selected.provider);
        return registration ? { caller, registration, ...(options.filter ? { filter: { ...options.filter } } : {}) } : null;
    }
    resolveLegacy(id: string, options: { version?: number; filter?: CapabilityOptions["filter"] }): import("../ipc/capability-bus-channels").CapabilityRegistration | null {
        if (options.version !== undefined && !Number.isInteger(options.version)) return null;
        return capabilityRegistry.snapshot().legacyRegistrations.filter((entry) => entry.id === id
            && (options.version === undefined || entry.version === options.version)
            && (options.filter?.mime === undefined || entry.accepts === undefined || entry.accepts.includes(options.filter.mime))
            && (options.filter?.representation === undefined || entry.representation === undefined || entry.representation === options.filter.representation))
            .sort((a, b) => b.priority - a.priority || Number(b.origin === "platform") - Number(a.origin === "platform"))[0] ?? null;
    }
    bindKey(caller: CapabilityCaller, key: CapabilityKey, filter?: CapabilityOptions["filter"]): BoundCapability | null {
        if (!key || typeof key !== "object") return null;
        const registration = capabilityRegistry.snapshot().registrations.find((entry) => entry.id === key.id && entry.version === key.version && entry.provider === key.provider && entry.handlerKey === key.handlerKey);
        if (!registration) return null;
        if (filter && (typeof filter !== "object" || Array.isArray(filter)
            || filter.mime !== undefined && typeof filter.mime !== "string"
            || filter.representation !== undefined && typeof filter.representation !== "string")) throw codedError("rejected", "Invalid capability filter.");
        if (filter?.mime && registration.accepts && !registration.accepts.includes(filter.mime)
            || filter?.representation && registration.representation && registration.representation !== filter.representation) return null;
        return { caller, registration, ...(filter ? { filter: { ...filter } } : {}) };
    }
    private authorize(bound: BoundCapability, method: string): CapabilityRegistration {
        if ((bound.registration.origin === "board" && !capabilityRegistry.board(bound.registration.provider))
            || ("provider" in bound.caller && !capabilityRegistry.board(bound.caller.provider))) {
            throw codedError("untrusted", "Board trust was revoked.");
        }
        if ("provider" in bound.caller) {
            const board = capabilityRegistry.board(bound.caller.provider);
            if (!board?.uses?.some((use) => use.id === bound.registration.id && use.version === bound.registration.version)
                || (bound.caller.kind === "board-service" && !board.canStartService)) {
                throw codedError("permission-denied", "Capability permission denied.");
            }
        }
        if (bound.caller.kind === "agent" && !bound.registration.methods[method]?.agent) {
            throw codedError("permission-denied", "Capability permission denied.");
        }
        const current = capabilityRegistry.snapshot().registrations.find((entry) => entry.provider === bound.registration.provider && entry.handlerKey === bound.registration.handlerKey);
        if (!current || JSON.stringify(current) !== JSON.stringify(bound.registration) || !current.methods[method]) throw codedError("no-handler", "Capability handler unavailable.");
        return current;
    }
    async invoke(bound: BoundCapability, method: string, args: unknown[], context: CapabilityCallContext = {}): Promise<CapabilityJson | ServiceChannel | { channelId: string; onClose: (listener: () => void) => () => void }> {
        const registration = this.authorize(bound, method);
        const invocation = context.invocation ?? this.createInvocationContext(bound, context);
        context = { ...context, invocation, signal: invocation.signal, chain: invocation.chain, depth: invocation.depth,
            originatingWindowId: invocation.originatingWindowId,
            ...(invocation.owner.kind === "window" ? { owner: invocation.owner.webContents } : {}) };
        const declaration = registration.methods[method];
        if (declaration.kind === "channel") return this.invokeChannel(bound, method, args, context);
        if (declaration.kind === "open") return this.invokeOpen(bound, method, args, context);
        const mainOwnedAudio = registration.origin === "platform" && registration.id === PLATFORM_AUDIO_CAPABILITY_ID && registration.handlerKey === "audio";
        if (declaration.kind !== "call" || (registration.origin !== "board" && !mainOwnedAudio)) throw codedError("no-handler");
        if (!Array.isArray(args)) throw codedError("rejected", "Arguments must be an array.");
        const jsonArgs = checkedJson(args) as CapabilityJson[];
        const chain = invocation.chain;
        if (invocation.depth + 1 > MAX_INTENT_DEPTH || chain.includes(registration.handlerKey)) throw codedError("cycle");
        const count = this.handlerCounts.get(registration.handlerKey) ?? 0;
        if (count >= MAX_OUTSTANDING_INTENTS_PER_HANDLER) throw codedError("busy");
        const provider = capabilityRegistry.board(registration.provider);
        if (!provider && !mainOwnedAudio) throw codedError("untrusted");
        const caller = invocation.caller;
        const deadlineAt = Math.min(Date.now() + declaration.timeoutMs, context.deadlineAt ?? Infinity);
        if (deadlineAt <= Date.now()) throw codedError("timeout");
        if (context.signal?.aborted) throw codedError("cancelled");
        const controller = invocation.controller;
        const cancel = () => controller.abort(codedError("cancelled"));
        const timer = setTimeout(() => controller.abort(codedError("timeout")), Math.max(0, deadlineAt - Date.now()));
        if (context.signal !== controller.signal) context.signal?.addEventListener("abort", cancel, { once: true });
        this.handlerCounts.set(registration.handlerKey, count + 1);
        const removeListener = capabilityRegistry.onChange(() => {
            try { this.authorize(bound, method); }
            catch (error) { controller.abort(error); }
        });
        let rejectOnAbort: (() => void) | undefined;
        const interrupted = new Promise<never>((_resolve, reject) => {
            rejectOnAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
            if (controller.signal.aborted) rejectOnAbort();
        });
        try {
            const operation = (async () => {
                const { moduleServiceSupervisor } = await import("./module-service-supervisor");
                if (mainOwnedAudio) {
                    const untrackOwner = invocation.owner.kind === "service"
                        ? moduleServiceSupervisor.trackServiceOwner(invocation.owner.boardRoot, () => controller.abort(codedError("handler-closed")))
                        : undefined;
                    try {
                        const { audioService } = await import("./audio-service");
                        return await audioService.callDevices(bound, method, jsonArgs, invocation, () => { this.authorize(bound, method); });
                    } finally { untrackOwner?.(); invocation.dispose(); }
                }
                if (!provider) throw codedError("untrusted");
                const requestId = randomUUID();
                const callContext: MainCapabilityInvocationContext = {
                    caller,
                    owner: { kind: "service", boardRoot: provider.boardRoot },
                    signal: controller.signal,
                    controller,
                    chain: [...chain, registration.handlerKey],
                    depth: chain.length + 1,
                    ...(invocation.originatingWindowId !== undefined ? { originatingWindowId: invocation.originatingWindowId } : {}),
                    requestId,
                    dispose: () => undefined,
                };
                this.invocationContexts.set(requestId, callContext);
                const wireContext: CapabilityInvocationWireContext = {
                    requestId,
                    chain: [...chain, registration.handlerKey],
                    depth: invocation.depth + 1,
                    ...(invocation.originatingWindowId !== undefined ? { originatingWindowId: invocation.originatingWindowId } : {}),
                };
                const untrackOwner = invocation.owner.kind === "service"
                    ? moduleServiceSupervisor.trackServiceOwner(invocation.owner.boardRoot, () => controller.abort(codedError("handler-closed")))
                    : undefined;
                return moduleServiceSupervisor.callCapability(provider.boardRoot, {
                    kind: "capability-call", requestId, id: registration.id, version: registration.version,
                    method, args: jsonArgs, caller, deadlineAt,
                    context: wireContext,
                }, controller.signal, () => { this.authorize(bound, method); }).finally(() => {
                    untrackOwner?.();
                    this.invocationContexts.delete(requestId);
                    invocation.dispose();
                });
            })();
            const result = await Promise.race([operation, interrupted]);
            return checkedJson(result);
        } catch (error) {
            const code = (error as { code?: unknown } | null)?.code;
            if (typeof code === "string" && isCapabilityErrorCode(code)) throw codedError(code, errMessage(error, code));
            if (code === "service-exited" || code === "process-exit-before-ready" || code === "service-failed") throw codedError("crashed");
            if (code === "quit" || code === "service-not-declared") throw codedError("handler-closed");
            throw codedError("rejected", "Capability call failed.");
        } finally {
            clearTimeout(timer);
            if (rejectOnAbort) controller.signal.removeEventListener("abort", rejectOnAbort);
            if (context.signal !== controller.signal) context.signal?.removeEventListener("abort", cancel);
            removeListener();
            const remaining = (this.handlerCounts.get(registration.handlerKey) ?? 1) - 1;
            if (remaining) this.handlerCounts.set(registration.handlerKey, remaining); else this.handlerCounts.delete(registration.handlerKey);
        }
    }

    private async invokeOpen(bound: BoundCapability, method: string, args: unknown[], context: CapabilityCallContext): Promise<CapabilityJson> {
        const registration = this.authorize(bound, method);
        if (!Array.isArray(args) || args.length !== 1) throw codedError("rejected");
        const payload = checkedJson(args[0]);
        const values = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : undefined;
        const representation = values?.representation ?? (registration.id === "content.view" ? undefined : bound.filter?.representation);
        const mime = typeof values?.mimeType === "string" ? values.mimeType : typeof values?.mime === "string" ? values.mime : bound.filter?.mime;
        if ((registration.id === "content.view" && (typeof representation !== "string" || !representation.trim()))
            || (typeof representation === "string" && registration.representation !== undefined && registration.representation !== representation)
            || (typeof mime === "string" && registration.accepts !== undefined && !registration.accepts.includes(mime))
            || (bound.filter?.representation && representation && bound.filter.representation !== representation)
            || (bound.filter?.mime && mime && bound.filter.mime !== mime) || registration.headless) throw codedError("no-handler");
        const invocation = context.invocation as MainCapabilityInvocationContext;
        const chain = invocation.chain;
        if (invocation.depth + 1 > MAX_INTENT_DEPTH || chain.includes(registration.handlerKey)) throw codedError("cycle");
        const count = this.handlerCounts.get(registration.handlerKey) ?? 0;
        if (count >= MAX_OUTSTANDING_INTENTS_PER_HANDLER) throw codedError("busy");
        const target = context.target ?? context.owner
            ?? (invocation.originatingWindowId !== undefined ? openWindows.getRendererByWindowId(invocation.originatingWindowId) : undefined)
            ?? (bound.caller.kind === "board-service" ? openWindows.getLastFocusedNormalRenderer() : undefined);
        const window = target && !target.isDestroyed() ? BrowserWindow.fromWebContents(target) : null;
        const windowData = window ? openWindows.findWindowDataByWindow(window) : undefined;
        if (!target || !windowData?.rendererReady) throw codedError("no-handler");
        const board = registration.origin === "board" ? capabilityRegistry.board(registration.provider) : undefined;
        if (registration.origin === "board" && !board) throw codedError("untrusted");
        const deadlineAt = Math.min(Date.now() + registration.methods[method].timeoutMs, context.deadlineAt ?? Infinity);
        if (deadlineAt <= Date.now()) throw codedError("timeout");
        if (context.signal?.aborted || context.owner?.isDestroyed()) throw codedError("cancelled");
        const { moduleServiceSupervisor } = await import("./module-service-supervisor");
        const { id: requestId, promise } = this.openRequests.create(Math.max(0, deadlineAt - Date.now()), context.signal, { meta: { target } });
        const dispatch: BoundOpenDispatch = {
            registration: { id: registration.id, version: registration.version, priority: registration.priority,
                handlerKey: registration.handlerKey, origin: registration.origin,
                ...(board ? { boardRoot: board.boardRoot, boardName: board.boardName } : {}),
                ...(registration.representation !== undefined ? { representation: registration.representation } : {}),
                ...(registration.alwaysOpensNewPage !== undefined ? { alwaysOpensNewPage: registration.alwaysOpensNewPage } : {}) },
            request: { requestId, id: registration.id, version: registration.version, payload, chain: [...chain], depth: invocation.depth, deadlineAt },
        };
        const untrackOwner = invocation.owner.kind === "service"
            ? moduleServiceSupervisor.trackServiceOwner(invocation.owner.boardRoot, () => invocation.controller.abort(codedError("handler-closed")))
            : undefined;
        this.handlerCounts.set(registration.handlerKey, count + 1);
        const cancel = () => this.openRequests.fail(requestId, context.signal?.reason ?? codedError("cancelled"));
        const closed = () => this.openRequests.fail(requestId, codedError("handler-closed"));
        const crashed = () => this.openRequests.fail(requestId, codedError("crashed"));
        const unsubscribe = capabilityRegistry.onChange(() => { try { this.authorize(bound, method); } catch (error) { this.openRequests.fail(requestId, error); } });
        const stopTarget = onWebContentsGone(target, (event) => (event === "destroyed" ? closed() : crashed()));
        const stopOwner = context.owner !== target && context.owner ? onWebContentsGone(context.owner, cancel) : undefined;
        app.once("before-quit", cancel);
        try {
            try { this.authorize(bound, method); target.send(EventEndpoint.eCapabilityOpen, dispatch); }
            catch (error) { this.openRequests.fail(requestId, error); }
            let outcome: CapabilityOutcome | undefined;
            try { outcome = await promise as CapabilityOutcome | undefined; }
            catch (error) {
                try { if (!target.isDestroyed()) target.send(EventEndpoint.eCapabilityOpenCancel, requestId); } catch { /* Renderer exited. */ }
                throw error;
            }
            return checkedJson({ ...(typeof outcome?.pageId === "string" ? { pageId: outcome.pageId } : {}), result: outcome?.result ?? null });
        } finally {
            unsubscribe();
            stopTarget();
            stopOwner?.();
            app.removeListener("before-quit", cancel);
            untrackOwner?.();
            invocation.dispose();
            const remaining = (this.handlerCounts.get(registration.handlerKey) ?? 1) - 1;
            if (remaining) this.handlerCounts.set(registration.handlerKey, remaining); else this.handlerCounts.delete(registration.handlerKey);
        }
    }

    private async invokeChannel(bound: BoundCapability, method: string, args: unknown[], context: CapabilityCallContext) {
        const registration = this.authorize(bound, method);
        if (bound.caller.kind === "agent") throw codedError("permission-denied");
        const mainOwnedAudio = registration.origin === "platform" && registration.id === PLATFORM_AUDIO_CAPABILITY_ID && registration.handlerKey === "audio";
        if ((!mainOwnedAudio && registration.origin !== "board") || !Array.isArray(args) || args.length > 1) throw codedError("rejected");
        if (mainOwnedAudio && method === "muteApp" && args.length !== 0) throw codedError("rejected");
        const argument = args.length ? checkedJson(args[0]) : {};
        if (!argument || typeof argument !== "object" || Array.isArray(argument) || Object.hasOwn(argument, "type")) throw codedError("rejected");
        const invocation = context.invocation as MainCapabilityInvocationContext;
        const chain = invocation.chain;
        if (invocation.depth + 1 > MAX_INTENT_DEPTH || chain.includes(registration.handlerKey)) throw codedError("cycle");
        const provider = registration.origin === "board" ? capabilityRegistry.board(registration.provider) : undefined;
        if (registration.origin === "board" && !provider) throw codedError("untrusted");
        const consumer = "provider" in bound.caller ? capabilityRegistry.board(bound.caller.provider) : undefined;
        const caller = invocation.caller;
        const owner = "provider" in bound.caller ? `${bound.caller.kind}:${bound.caller.provider}` : "platform";
        const controller = invocation.controller;
        const abort = () => controller.abort(codedError("cancelled"));
        const deadlineAt = Math.min(Date.now() + registration.methods[method].timeoutMs, context.deadlineAt ?? Infinity);
        if (deadlineAt <= Date.now()) throw codedError("timeout");
        if (context.signal?.aborted || context.owner?.isDestroyed()) throw codedError("cancelled");
        const timer = setTimeout(() => controller.abort(codedError("timeout")), deadlineAt - Date.now());
        if (context.signal !== controller.signal) context.signal?.addEventListener("abort", abort, { once: true });
        const stopOwner = context.owner ? onWebContentsGone(context.owner, abort) : undefined;
        const unsubscribe = capabilityRegistry.onChange(() => {
            try { this.authorize(bound, method); } catch (error) { controller.abort(error); }
        });
        const cleanup = () => {
            unsubscribe();
            invocation.dispose();
            if (context.signal !== controller.signal) context.signal?.removeEventListener("abort", abort);
            stopOwner?.();
        };
        try {
            const opening = mainOwnedAudio
                ? (await import("./audio-service")).audioService.openCapabilityChannel(
                    bound, method, argument as Record<string, unknown>, invocation, context.channelDelivery,
                    () => { this.authorize(bound, method); },
                )
                : (await import("./module-service-supervisor")).moduleServiceSupervisor.openCapabilityChannel(provider!.boardRoot, owner,
                    bound.caller.kind === "board-service" ? consumer?.boardRoot : undefined, { ...argument, type: method },
                    { interface: { id: registration.id, version: registration.version }, caller }, controller.signal,
                    () => { this.authorize(bound, method); }, context.channelDelivery);
            const interrupted = new Promise<never>((_resolve, reject) => {
                if (controller.signal.aborted) reject(controller.signal.reason);
                else controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
            });
            const channel = await Promise.race([opening, interrupted]);
            channel.onClose(cleanup);
            return channel;
        } catch (error) {
            cleanup();
            const code = (error as { code?: unknown } | null)?.code;
            if (typeof code === "string" && isCapabilityErrorCode(code)) throw codedError(code, errMessage(error, code));
            throw codedError("handler-closed", errMessage(error, "Channel establishment failed."));
        } finally { clearTimeout(timer); }
    }
}
export const capabilityRouter = new CapabilityRouter();

/** Strip internal registration data before crossing a client boundary. */
export function publicCapabilityProvider(registration: CapabilityRegistration): CapabilityProvider {
    const { id, version, provider, handlerKey, name, origin, title, priority, accepts, representation, methods } = registration;
    return { id, version, provider, handlerKey, name, origin, priority, methods,
        ...(title !== undefined ? { title } : {}), ...(accepts !== undefined ? { accepts } : {}),
        ...(representation !== undefined ? { representation } : {}) };
}
