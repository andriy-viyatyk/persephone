import { api } from "../../../ipc/renderer/api";
import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../../ipc/module-service-channels";
import type { BoardServiceProvider } from "../../../ipc/board-bridge-channels";
import { createSpeechServiceChannel, type SpeechServiceChannel } from "./SpeechServiceChannel";

const DESCRIBE_TIMEOUT_MS = 4000;

export class SpeechTranscriptionProvider {
    private readonly describeCache = new Map<string, string[]>();
    private readonly pendingPorts = new Map<string, MessagePort>();
    private readonly portWaiters = new Map<string, (port: MessagePort) => void>();
    private readonly unsubscribe: () => void;

    public constructor() {
        this.unsubscribe = api.onBoardServiceChannel((boardId, channelId, port) => {
            if (!boardId.startsWith("voice-typing:")) return;
            const waiter = this.portWaiters.get(channelId);
            if (waiter) { this.portWaiters.delete(channelId); waiter(port); }
            else this.pendingPorts.set(channelId, port);
        });
    }

    public async list(): Promise<BoardServiceProvider[]> {
        return (await api.getBoardServiceProviders("speech.transcribe")).filter((provider) => provider.version === 1);
    }

    public async supportsLive(provider: BoardServiceProvider): Promise<boolean | undefined> {
        const features = await this.describeFeatures(provider);
        return features?.includes("live");
    }

    public async describeFeatures(provider: BoardServiceProvider, refresh = false): Promise<string[] | undefined> {
        const key = `${provider.provider}@${provider.version}`;
        const cached = this.describeCache.get(key);
        if (!refresh && cached !== undefined) return cached;
        const channelId = await api.connectHostServiceChannel({ interfaceId: "speech.transcribe", provider: provider.provider, version: 1, openMessage: { type: "describe" } });
        const port = await this.waitForPort(channelId);
        const channel = createSpeechServiceChannel(port);
        try {
            const features = await new Promise<string[] | undefined>((resolve) => {
                let settled = false;
                const finish = (value: string[] | undefined): void => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(value);
                };
                const timer = setTimeout(() => finish(undefined), DESCRIBE_TIMEOUT_MS);
                channel.onMessage((message) => {
                    if (!message || typeof message !== "object") return;
                    const description = message as { type?: unknown; features?: unknown };
                    if (description.type === "description") finish(Array.isArray(description.features)
                        ? description.features.filter((feature): feature is string => typeof feature === "string")
                        : []);
                });
                channel.onClose(() => finish(undefined));
            });
            if (features !== undefined) this.describeCache.set(key, features);
            return features;
        } finally {
            channel.close();
        }
    }

    public dispose(): void {
        this.unsubscribe();
        this.pendingPorts.forEach((port) => port.close());
        this.pendingPorts.clear();
        this.portWaiters.clear();
    }

    private async waitForPort(channelId: string): Promise<MessagePort> {
        const pending = this.pendingPorts.get(channelId);
        if (pending) { this.pendingPorts.delete(channelId); return pending; }
        return new Promise<MessagePort>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.portWaiters.delete(channelId);
                reject(new Error("The speech provider channel did not open."));
            }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
            this.portWaiters.set(channelId, (port) => { clearTimeout(timeout); resolve(port); });
        });
    }
}

export type { SpeechServiceChannel };
