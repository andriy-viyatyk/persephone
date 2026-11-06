import { api } from "../../../ipc/renderer/api";
import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../../ipc/module-service-channels";
import type { BoardServiceProvider } from "../../../ipc/board-bridge-channels";
import type { ServiceChannelCloseReason } from "../../../ipc/module-service-channels";
import { AgentSessionChannel, agentError, APPROVAL_DENIAL } from "./AgentSessionChannel";
import type { AgentSessionEvent, AgentSessionStarted } from "./AgentSessionChannel";

const RESPONSE_TIMEOUT_MS = 10000;
export interface AgentSessionDescription extends AgentSessionEvent { type: "description"; contractVersion: 1 }
export interface AgentSessionOpenOptions { model: string; cwd: string; effort?: string; instructions?: string; resume?: string; engine?: string }
export interface AgentSessionCallbacks {
    onEvent(event: AgentSessionEvent): void;
    onClose?(reason: ServiceChannelCloseReason): void;
    onError?(error: AgentSessionEvent): void;
}
function eventValue(value: unknown): AgentSessionEvent | undefined {
    if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") return undefined;
    return value as AgentSessionEvent;
}
function providerError(event: AgentSessionEvent): Error {
    return agentError(typeof event.code === "string" ? event.code : "service-error", typeof event.message === "string" ? event.message : "Agent provider failed.");
}

/** A live session retains only the current turn, never the transcript. */
export class AgentSession {
    public started?: AgentSessionStarted;
    private channel?: AgentSessionChannel;
    private closed?: ServiceChannelCloseReason;
    private closing = false;
    private turn?: { started: boolean; resolve(event: AgentSessionEvent): void; reject(error: Error): void };
    private startResolve?: (value: AgentSessionStarted) => void;
    private startReject?: (error: Error) => void;
    private startTimer?: ReturnType<typeof setTimeout>;
    public readonly ready: Promise<AgentSessionStarted>;

    public constructor(private readonly callbacks: AgentSessionCallbacks) {
        this.ready = new Promise((resolve, reject) => { this.startResolve = resolve; this.startReject = reject; });
        this.startTimer = setTimeout(() => this.fail(agentError("timeout", "Agent session start timed out.")), RESPONSE_TIMEOUT_MS);
    }
    public get lowerThanFullAuto(): boolean { return !!this.started && this.started.permissionMode !== "full-auto"; }
    public attach(port: MessagePort): void {
        if (this.closed) { port.close(); return; }
        this.channel = new AgentSessionChannel(port, (value) => this.receive(value), (reason) => this.finish(reason));
    }
    public async send(text: string): Promise<AgentSessionEvent> {
        if (!this.started || this.closed || this.closing || !this.channel) throw agentError("channel-closed", "Agent session is not open.");
        if (this.turn) throw agentError("busy", "An agent turn is already running.");
        const result = new Promise<AgentSessionEvent>((resolve, reject) => { this.turn = { started: false, resolve, reject }; });
        void result.catch((): undefined => undefined);
        try { await this.channel.send({ type: "send", text }); }
        catch (error) { this.turn?.reject(error instanceof Error ? error : agentError("service-error", "Sending the turn failed.")); this.turn = undefined; }
        return result;
    }
    public async interrupt(): Promise<void> {
        if (this.closed || this.closing || !this.channel) throw agentError("channel-closed", "Agent session is not open.");
        if (this.turn) await this.channel.send({ type: "interrupt" });
    }
    public async close(): Promise<void> {
        if (this.closed || this.closing) return;
        this.closing = true;
        try {
            if (this.channel) {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        this.channel.send({ type: "close" }),
                        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(agentError("timeout", "Agent session close timed out.")), SERVICE_CHANNEL_OPEN_TIMEOUT_MS); }),
                    ]);
                } finally { if (timer) clearTimeout(timer); }
            }
        }
        finally { if (this.channel) this.channel.close(); else this.finish({ code: "channel-closed", message: "Agent session closed." }); }
    }
    public dispose(): void { this.channel?.close(); if (!this.closed) this.finish({ code: "channel-closed", message: "Agent session disposed." }); }
    private receive(value: unknown): void {
        const event = eventValue(value);
        if (!event || this.closed) return;
        if (event.type === "session-started" && !this.started) {
            if (event.contractVersion !== 1 || typeof event.sessionId !== "string" || !event.sessionId || typeof event.model !== "string" || !["read-only", "ask", "auto-edit", "full-auto"].includes(String(event.permissionMode))) {
                this.fail(agentError("protocol-error", "Invalid agent session start.")); return;
            }
            this.started = event as AgentSessionStarted;
            if (this.startTimer) clearTimeout(this.startTimer);
            this.startResolve?.(this.started); this.startResolve = undefined; this.startReject = undefined;
        }
        if (event.type === "approval-request") {
            if (typeof event.requestId !== "string" || !event.requestId) { this.fail(agentError("protocol-error", "Invalid approval request.")); return; }
            void this.channel!.send({ type: "approval-response", requestId: event.requestId, decision: "deny", message: APPROVAL_DENIAL }).catch((error: unknown) => this.fail(error instanceof Error ? error : agentError("service-error", "Approval denial failed.")));
        }
        if (event.type === "turn-started" && this.turn) this.turn.started = true;
        try { this.callbacks.onEvent(event); } catch (error) { this.fail(error instanceof Error ? error : agentError("service-error", "Agent event consumer failed.")); return; }
        if (event.type === "error") {
            try { this.callbacks.onError?.(event); } catch { /* consumer callback */ }
            if (event.fatal === true || !this.started) { this.fail(providerError(event)); return; }
            if (this.turn && (!this.turn.started || event.code === "busy" || event.code === "limit-reached")) { this.turn.reject(providerError(event)); this.turn = undefined; }
        }
        if (event.type === "turn-ended" && this.turn) { this.turn.resolve(event); this.turn = undefined; }
    }
    private fail(error: Error): void {
        this.startReject?.(error); this.startReject = undefined; this.startResolve = undefined;
        this.turn?.reject(error); this.turn = undefined;
        const reason = { code: (error as Error & { code?: string }).code ?? "service-error", message: error.message };
        if (this.channel) this.channel.close(reason); else this.finish(reason);
    }
    private finish(reason: ServiceChannelCloseReason): void {
        if (this.closed) return;
        this.closed = reason;
        if (this.startTimer) clearTimeout(this.startTimer);
        const error = agentError(reason.code, reason.message);
        this.startReject?.(error); this.startReject = undefined; this.startResolve = undefined;
        this.turn?.reject(error); this.turn = undefined;
        try { this.callbacks.onClose?.(reason); } catch { /* consumer callback */ }
    }
}

/** Own one provider per renderer; dispose it when its session owner is torn down. */
export class AgentSessionProvider {
    private readonly ports = new Map<string, { port: MessagePort; timer: ReturnType<typeof setTimeout> }>();
    private readonly waiters = new Map<string, { resolve(port: MessagePort): void; reject(error: Error): void }>();
    private readonly sessions = new Set<AgentSession>();
    private readonly discoveries = new Set<AgentSessionChannel>();
    private readonly unsubscribe: () => void;
    private disposed = false;
    private connecting = 0;
    public constructor() {
        this.unsubscribe = api.onBoardServiceChannel((boardId, channelId, port) => {
            if (!boardId.startsWith("agent-session:")) return;
            if (this.disposed) { port.close(); return; }
            const waiter = this.waiters.get(channelId);
            if (waiter) { this.waiters.delete(channelId); waiter.resolve(port); return; }
            const previous = this.ports.get(channelId);
            if (previous) { clearTimeout(previous.timer); previous.port.close(); }
            const timer = setTimeout(() => { this.ports.delete(channelId); port.close(); }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
            this.ports.set(channelId, { port, timer });
        });
    }
    public async list(): Promise<BoardServiceProvider[]> {
        if (this.disposed) throw agentError("cancelled", "Agent session provider disposed.");
        return (await api.getBoardServiceProviders("agent.session")).filter((provider) => provider.version === 1);
    }
    public async describe(boardProvider: string, engine?: string): Promise<AgentSessionDescription> {
        const port = await this.connect(boardProvider, { type: "describe", ...(engine !== undefined ? { provider: engine } : {}) });
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error, description?: AgentSessionDescription): void => {
                if (settled) return;
                settled = true; clearTimeout(timer); this.discoveries.delete(channel); channel.close();
                if (error) reject(error); else resolve(description!);
            };
            const timer = setTimeout(() => finish(agentError("timeout", "Agent description timed out.")), RESPONSE_TIMEOUT_MS);
            const channel = new AgentSessionChannel(port, (value) => {
                const event = eventValue(value);
                if (event?.type === "error") finish(providerError(event));
                else if (event?.type === "description") {
                    if (event.contractVersion !== 1) finish(agentError("protocol-error", "Invalid agent description version."));
                    else finish(undefined, event as AgentSessionDescription);
                }
            }, (reason) => finish(agentError(reason.code, reason.message)));
            this.discoveries.add(channel);
        });
    }
    public async open(boardProvider: string, options: AgentSessionOpenOptions, callbacks: AgentSessionCallbacks): Promise<AgentSession> {
        const session = new AgentSession({ ...callbacks, onClose: (reason) => { this.sessions.delete(session); callbacks.onClose?.(reason); } });
        this.sessions.add(session);
        // Observe rejection immediately while connect is pending.
        const ready = session.ready.then((): undefined => undefined, (): undefined => undefined);
        try {
            const port = await this.connect(boardProvider, {
                type: "open", contractVersion: 1, model: options.model, cwd: options.cwd,
                permissionMode: "full-auto", mcp: { persephone: true },
                ...(options.engine !== undefined ? { provider: options.engine } : {}),
                ...(options.effort !== undefined ? { effort: options.effort } : {}),
                ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
                ...(options.resume !== undefined ? { resume: options.resume } : {}),
            });
            session.attach(port);
            await session.ready;
            return session;
        } catch (error) { session.dispose(); await ready; throw error; }
    }
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.sessions.forEach((session) => session.dispose());
        this.discoveries.forEach((channel) => channel.close({ code: "cancelled", message: "Agent session provider disposed." }));
        this.ports.forEach(({ port, timer }) => { clearTimeout(timer); port.close(); });
        this.ports.clear();
        this.waiters.forEach((waiter) => waiter.reject(agentError("cancelled", "Agent session provider disposed.")));
        this.waiters.clear();
        if (!this.connecting) this.unsubscribe();
    }
    private async connect(provider: string, openMessage: unknown): Promise<MessagePort> {
        if (this.disposed) throw agentError("cancelled", "Agent session provider disposed.");
        this.connecting++;
        try {
            const connection = api.connectHostServiceChannel({ interfaceId: "agent.session", provider, version: 1, openMessage });
            // A late connect result still gets its port closed by the expiring pending-port entry.
            const channelId = await this.timeout(connection, SERVICE_CHANNEL_OPEN_TIMEOUT_MS, "Agent channel connection timed out.");
            if (this.disposed) throw agentError("cancelled", "Agent session provider disposed.");
            const pending = this.ports.get(channelId);
            if (pending) { this.ports.delete(channelId); clearTimeout(pending.timer); return pending.port; }
            return await new Promise<MessagePort>((resolve, reject) => {
                const timer = setTimeout(() => { this.waiters.delete(channelId); reject(agentError("timeout", "Agent channel port timed out.")); }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
                this.waiters.set(channelId, { resolve: (port) => { clearTimeout(timer); resolve(port); }, reject: (error) => { clearTimeout(timer); reject(error); } });
            });
        } finally {
            this.connecting--;
            if (this.disposed && !this.connecting) this.unsubscribe();
        }
    }
    private timeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(agentError("timeout", message)), milliseconds);
            promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
        });
    }
}
