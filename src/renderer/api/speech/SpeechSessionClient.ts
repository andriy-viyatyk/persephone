import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../../ipc/module-service-channels";
import { api } from "../../../ipc/renderer/api";
import type { ServiceChannel } from "../../../shared/service-channel";
import { openDomServiceChannel } from "../../../shared/service-channel-node";
import { serviceChannelPorts } from "../service-channel-ports";

export interface SpeechSessionCallbacks {
    onStatus?: (event: { state?: string }) => void;
    onDraft?: (event: { text: string; utterance?: string | number }) => void;
    onSegment?: (event: { text: string; utterance?: unknown; startMs?: number; endMs?: number }) => void;
    onResult?: (event: { text?: string }) => void;
    onError?: (event: { code?: string; message?: string }) => void;
    onClose?: (event: { code: string; message: string }) => void;
}

export interface SpeechSessionClientOptions extends SpeechSessionCallbacks {
    provider: string;
    live: boolean;
    translate: boolean;
    isCurrent: () => boolean;
    timeoutError: () => Error;
}

export class SpeechSessionClient {
    private channel: ServiceChannel | undefined;
    private cancelled = false;
    public readonly accepted: Promise<void>;
    private resolveAccepted: () => void = () => {};
    private rejectAccepted: (error: Error) => void = () => {};
    private acceptanceSettled = false;

    public constructor(private readonly options: SpeechSessionClientOptions) {
        this.accepted = new Promise<void>((resolve, reject) => {
            this.resolveAccepted = resolve;
            this.rejectAccepted = reject;
        });
    }

    public async open(): Promise<void> {
        const { provider, live, translate, isCurrent } = this.options;
        const channelId = await api.connectHostServiceChannel({
            interfaceId: "speech.transcribe",
            provider,
            version: 1,
            openMessage: {
                type: "transcribe",
                format: { encoding: "pcm-s16le", sampleRate: 16_000, channels: 1 },
                ...(translate ? { translate: true } : {}),
                ...(live ? { live: true } : {}),
            },
        });
        if (!this.isCurrent(isCurrent)) return;
        const port = await serviceChannelPorts.claim(channelId, {
            timeoutMs: SERVICE_CHANNEL_OPEN_TIMEOUT_MS,
            timeoutError: this.options.timeoutError,
        });
        if (!this.isCurrent(isCurrent)) { port.close(); return; }
        const channel = openDomServiceChannel(port, "service");
        this.channel = channel;
        channel.onMessage((message) => this.receive(message));
        channel.onClose((reason) => {
            if (!this.acceptanceSettled) {
                this.acceptanceSettled = true;
                this.rejectAccepted(Object.assign(new Error(reason.message), { code: reason.code }));
            }
            this.options.onClose?.({ code: reason.code, message: reason.message });
        });
    }

    public sendAudio(data: ArrayBuffer): Promise<void> {
        return this.send({ type: "audio", data });
    }

    public end(): void {
        this.channel?.send({ type: "end" });
    }

    public cancel(code = "cancelled", message = "Cancelled"): void {
        this.cancelled = true;
        try { this.channel?.send({ type: "cancel" }); } catch { /* channel may already be closed */ }
        this.channel?.close({ code, message });
    }

    public close(): void {
        this.channel?.close();
    }

    private async send(message: { type: "audio"; data: ArrayBuffer }): Promise<void> {
        const channel = this.channel;
        if (!channel) return;
        if (!channel.writable) await channel.whenWritable();
        if (!this.cancelled) channel.send(message);
    }

    private receive(message: unknown): void {
        if (!message || typeof message !== "object") return;
        const value = message as { type?: unknown; state?: unknown; text?: unknown; utterance?: unknown; startMs?: unknown; endMs?: unknown; code?: unknown; message?: unknown };
        if (value.type === "status") {
            const state = typeof value.state === "string" ? value.state : undefined;
            if (state === "listening" && !this.acceptanceSettled) {
                this.acceptanceSettled = true;
                this.resolveAccepted();
            }
            this.options.onStatus?.({ state });
        } else if (value.type === "draft" && typeof value.text === "string") {
            this.options.onDraft?.({ text: value.text, utterance: typeof value.utterance === "string" || typeof value.utterance === "number" ? value.utterance : undefined });
        } else if (value.type === "segment" && typeof value.text === "string") {
            this.options.onSegment?.({
                text: value.text,
                utterance: value.utterance,
                startMs: typeof value.startMs === "number" ? value.startMs : undefined,
                endMs: typeof value.endMs === "number" ? value.endMs : undefined,
            });
        } else if (value.type === "result") {
            this.options.onResult?.({ text: typeof value.text === "string" ? value.text : undefined });
        } else if (value.type === "error") {
            const event = {
                code: typeof value.code === "string" ? value.code : undefined,
                message: typeof value.message === "string" ? value.message : undefined,
            };
            if (!this.acceptanceSettled) {
                this.acceptanceSettled = true;
                this.rejectAccepted(Object.assign(new Error(event.message ?? ""), { code: event.code }));
            }
            this.options.onError?.(event);
        }
    }

    private isCurrent(check: () => boolean): boolean {
        return !this.cancelled && check();
    }
}
