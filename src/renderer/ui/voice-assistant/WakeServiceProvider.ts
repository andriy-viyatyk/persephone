import { api } from "../../../ipc/renderer/api";
import type { BoardServiceProvider } from "../../../ipc/board-bridge-channels";
import { createSpeechServiceChannel, type SpeechServiceChannel } from "../speech/SpeechServiceChannel";
import type { WakeEvent } from "./VoiceAssistantTypes";
import { CHANNEL_OPEN_TIMEOUT_MS } from "./voice-assistant-constants";

export interface WakeDescription { type: "description"; local: boolean; features: string[]; defaultThreshold: number; maxEnrollMs: number }
export interface WakeEnrollment { type: "enrolled"; sampleId: string; quality: { accepted: boolean; reason?: string }; match: number | null }
export interface WakePhrase { phrase: string; kind: "wake" | "stop"; person: string; samples: { sampleId: string }[] }
export interface WakeListenHandle {
    readonly writable: boolean;
    send(data: ArrayBuffer): void;
    whenWritable(): Promise<void>;
    onEvent(callback: (event: WakeEvent) => void): () => void;
    onClose(callback: (reason: { code: string; message: string }) => void): () => void;
    close(): void;
}

const format = { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 } as const;
const pendingPorts = new Map<string, MessagePort>();
const portWaiters = new Map<string, (port: MessagePort) => void>();
let users = 0;
let unsubscribe: (() => void) | undefined;

function error(code: string, message: string): Error { return Object.assign(new Error(message), { code }); }

/** A provider instance owns its channels; dispose it when its consumer closes. */
export class WakeServiceProvider {
    private readonly channels = new Set<SpeechServiceChannel>();
    private disposed = false;
    private local = false;

    public constructor(private readonly provider: BoardServiceProvider) {
        users++;
        unsubscribe ??= api.onBoardServiceChannel((boardId, channelId, port) => {
            if (!boardId.startsWith("speech-wake:")) return;
            const waiter = portWaiters.get(channelId);
            if (waiter) { portWaiters.delete(channelId); waiter(port); }
            else pendingPorts.set(channelId, port);
        });
    }

    public static async listProviders(): Promise<BoardServiceProvider[]> {
        return (await api.getBoardServiceProviders("speech.wake")).filter((provider) => provider.version === 1);
    }

    public async describe(): Promise<WakeDescription> {
        this.local = false;
        const result = await this.request<WakeDescription>({ type: "describe" }, "description");
        if (result.local !== true) throw error("provider-not-local", "The wake provider is not local.");
        if (!Array.isArray(result.features) || !Number.isFinite(result.defaultThreshold) || !Number.isFinite(result.maxEnrollMs) || result.maxEnrollMs <= 0) throw error("invalid-response", "Invalid wake provider description.");
        this.local = true;
        return result;
    }

    public async enroll(pcm: ArrayBuffer, options: { phrase: string; kind: "wake" | "stop"; person: string }): Promise<WakeEnrollment> {
        this.requireLocal();
        const channel = await this.open({ type: "enroll", ...options, format });
        const result = this.receive<WakeEnrollment>(channel, "enrolled");
        void result.catch(() => {});
        try {
            await channel.whenWritable();
            channel.send({ type: "audio", data: pcm });
            await channel.whenWritable();
            channel.send({ type: "end" });
            return await result;
        } finally { channel.close(); }
    }

    public async list(): Promise<WakePhrase[]> {
        this.requireLocal();
        const result = await this.request<{ type: "enrollments"; phrases: WakePhrase[] }>({ type: "list" }, "enrollments");
        if (!Array.isArray(result.phrases)) throw error("invalid-response", "Invalid wake enrollment list.");
        return result.phrases;
    }

    public async delete(sampleId: string): Promise<number> {
        this.requireLocal();
        const result = await this.request<{ type: "deleted"; count: number }>({ type: "delete", target: { sampleId } }, "deleted");
        return result.count;
    }

    public async listen(threshold?: number): Promise<WakeListenHandle> {
        this.requireLocal();
        const channel = await this.open({ type: "listen", format, ...(threshold === undefined ? {} : { threshold }) });
        const listeners = new Set<(event: WakeEvent) => void>();
        const queued: WakeEvent[] = [];
        channel.onMessage((message) => {
            if (!message || typeof message !== "object") return;
            const value = message as Record<string, unknown>;
            if (value.type === "error") {
                channel.close({ code: typeof value.code === "string" ? value.code : "provider-failed", message: typeof value.message === "string" ? value.message : "Wake provider failed." });
            } else if ((value.type === "wake" || value.type === "stop") && typeof value.phrase === "string" && typeof value.person === "string" && typeof value.score === "number" && Number.isFinite(value.score) && typeof value.time === "number" && Number.isFinite(value.time) && (value.start === undefined || (typeof value.start === "number" && Number.isFinite(value.start)))) {
                const event = value as unknown as WakeEvent;
                if (listeners.size) listeners.forEach((listener) => listener(event));
                else {
                    if (queued.length >= 32) queued.shift();
                    queued.push(event);
                }
            }
        });
        return {
            get writable() { return channel.writable; },
            send(data) { channel.send({ type: "audio", data }); },
            whenWritable: () => channel.whenWritable(),
            onEvent(callback) { listeners.add(callback); queued.splice(0).forEach(callback); return () => { listeners.delete(callback); }; },
            onClose: (callback) => channel.onClose(callback),
            close: () => channel.close(),
        };
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.channels.forEach((channel) => channel.close());
        if (--users === 0) {
            unsubscribe?.(); unsubscribe = undefined;
            pendingPorts.forEach((port) => port.close()); pendingPorts.clear();
        }
    }

    private requireLocal(): void {
        if (!this.local) throw error("provider-not-described", "Describe a local wake provider before use.");
    }

    private async request<T>(open: object, responseType: string): Promise<T> {
        const channel = await this.open(open);
        try { return await this.receive<T>(channel, responseType); }
        finally { channel.close(); }
    }

    private receive<T>(channel: SpeechServiceChannel, responseType: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const finish = (action: () => void): void => { if (settled) return; settled = true; clearTimeout(timer); action(); };
            const timer = setTimeout(() => finish(() => reject(error("timeout", "The wake provider did not respond."))), CHANNEL_OPEN_TIMEOUT_MS);
            channel.onMessage((message) => {
                if (!message || typeof message !== "object") return;
                const value = message as { type?: string; code?: string; message?: string };
                if (value.type === responseType) finish(() => resolve(message as T));
                else if (value.type === "error") finish(() => reject(error(value.code ?? "provider-failed", value.message ?? "Wake provider failed.")));
            });
            channel.onClose((reason) => finish(() => reject(error(reason.code, reason.message))));
        });
    }

    private async open(openMessage: object): Promise<SpeechServiceChannel> {
        if (this.disposed) throw error("channel-closed", "The wake provider was disposed.");
        const channelId = await api.connectHostServiceChannel({ interfaceId: "speech.wake", provider: this.provider.provider, version: 1, openMessage });
        const port = await new Promise<MessagePort>((resolve, reject) => {
            const pending = pendingPorts.get(channelId);
            if (pending) { pendingPorts.delete(channelId); resolve(pending); return; }
            const timer = setTimeout(() => { portWaiters.delete(channelId); reject(error("timeout", "The wake provider channel did not open.")); }, CHANNEL_OPEN_TIMEOUT_MS);
            portWaiters.set(channelId, (value) => { clearTimeout(timer); resolve(value); });
        });
        if (this.disposed) { port.close(); throw error("channel-closed", "The wake provider was disposed."); }
        const channel = createSpeechServiceChannel(port);
        this.channels.add(channel);
        channel.onClose(() => this.channels.delete(channel));
        return channel;
    }
}
