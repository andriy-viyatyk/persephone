import { MAX_SERVICE_CHANNEL_IN_FLIGHT, SERVICE_CHANNEL_ACK_BATCH, SERVICE_CHANNEL_ACK_DELAY_MS } from "../../../ipc/module-service-channels";
import type { ServiceChannelCloseReason } from "../../../ipc/module-service-channels";

export interface AgentSessionEvent { type: string; [key: string]: unknown }
export type AgentPermissionMode = "read-only" | "ask" | "auto-edit" | "full-auto";
export interface AgentSessionStarted extends AgentSessionEvent {
    type: "session-started"; contractVersion: 1; sessionId: string; model: string;
    permissionMode: AgentPermissionMode; mcp?: unknown;
}
export interface AgentSessionApprovalRequest extends AgentSessionEvent { type: "approval-request"; requestId: string; kind: string; summary: string; detail: string }
export interface AgentSessionErrorEvent extends AgentSessionEvent { type: "error"; code: string; message: string; fatal: boolean }
export interface AgentSessionTurnEnded extends AgentSessionEvent { type: "turn-ended"; reason: string; usage?: unknown }
export const APPROVAL_DENIAL = "Interactive approvals are unavailable for this session.";
export function agentError(code: string, message: string): Error { return Object.assign(new Error(message), { code }); }

/** Ordered service-channel wire transport. Handlers are installed before the port starts. */
export class AgentSessionChannel {
    private sent = 0;
    private acknowledged = 0;
    private received = 0;
    private acked = 0;
    private ackTimer?: ReturnType<typeof setTimeout>;
    private reason?: ServiceChannelCloseReason;
    private readonly waiters = new Set<{ resolve(): void; reject(error: Error): void }>();
    private sendQueue: Promise<void> = Promise.resolve();

    public constructor(private readonly port: MessagePort, private readonly onEvent: (event: unknown) => void,
        private readonly onClose: (reason: ServiceChannelCloseReason) => void) {
        port.onmessage = (event: MessageEvent<{ kind?: string; sequence?: number; value?: unknown; reason?: ServiceChannelCloseReason }>) => {
            const data = event.data;
            if (data?.kind === "ack" && Number.isSafeInteger(data.sequence)) {
                this.acknowledged = Math.max(this.acknowledged, Math.min(data.sequence!, this.sent));
                this.waiters.forEach((waiter) => waiter.resolve());
                this.waiters.clear();
            } else if (data?.kind === "data" && data.sequence === this.received + 1) {
                this.received = data.sequence;
                try { this.onEvent(data.value); } finally { this.scheduleAck(); }
            } else if (data?.kind === "close") this.finish(data.reason ?? { code: "service-exited", message: "Agent session disconnected." });
        };
        port.onmessageerror = () => this.finish({ code: "service-error", message: "Invalid agent session channel message." });
        port.start();
    }

    public get writable(): boolean { return !this.reason && this.sent - this.acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT; }
    public whenWritable(): Promise<void> {
        if (this.reason) return Promise.reject(agentError(this.reason.code, this.reason.message));
        if (this.writable) return Promise.resolve();
        return new Promise((resolve, reject) => this.waiters.add({ resolve, reject }));
    }
    public send(message: unknown): Promise<void> {
        const operation = this.sendQueue.then(async () => {
            await this.whenWritable();
            if (this.reason) throw agentError(this.reason.code, this.reason.message);
            this.port.postMessage({ kind: "data", sequence: this.sent + 1, value: message });
            this.sent++;
        });
        this.sendQueue = operation.catch((): undefined => undefined);
        return operation;
    }
    public close(reason: ServiceChannelCloseReason = { code: "channel-closed", message: "Agent session closed." }): void {
        if (this.reason) return;
        try { this.port.postMessage({ kind: "close", reason }); } catch { /* already disconnected */ }
        this.finish(reason);
    }
    private scheduleAck(): void {
        const acknowledge = (): void => {
            this.ackTimer = undefined;
            if (this.reason || this.received <= this.acked) return;
            this.acked = this.received;
            try { this.port.postMessage({ kind: "ack", sequence: this.acked }); }
            catch { this.finish({ code: "service-exited", message: "Agent session disconnected." }); }
        };
        if (this.received - this.acked >= SERVICE_CHANNEL_ACK_BATCH) {
            if (this.ackTimer) clearTimeout(this.ackTimer);
            acknowledge();
        } else if (!this.ackTimer) this.ackTimer = setTimeout(acknowledge, SERVICE_CHANNEL_ACK_DELAY_MS);
    }
    private finish(reason: ServiceChannelCloseReason): void {
        if (this.reason) return;
        this.reason = reason;
        if (this.ackTimer) clearTimeout(this.ackTimer);
        this.port.onmessage = null;
        this.port.onmessageerror = null;
        this.port.close();
        this.waiters.forEach((waiter) => waiter.reject(agentError(reason.code, reason.message)));
        this.waiters.clear();
        this.onClose(reason);
    }
}
