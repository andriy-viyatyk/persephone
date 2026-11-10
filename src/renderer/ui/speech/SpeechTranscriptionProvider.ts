import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../../ipc/module-service-channels";
import { api } from "../../../ipc/renderer/api";
import type { BoardServiceProvider } from "../../../ipc/board-bridge-channels";
import { serviceChannelPorts } from "../../api/service-channel-ports";
import { openDomServiceChannel } from "../../../shared/service-channel-node";

const DESCRIBE_TIMEOUT_MS = 4000;

export class SpeechTranscriptionProvider {
    private readonly describeCache = new Map<string, string[]>();
    private disposed = false;

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
        const port = await serviceChannelPorts.claim(channelId, { timeoutMs: SERVICE_CHANNEL_OPEN_TIMEOUT_MS, timeoutError: () => new Error("The speech provider channel did not open.") });
        if (this.disposed) { port.close(); return undefined; }
        const channel = openDomServiceChannel(port, "service");
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
        this.disposed = true;
    }
}
