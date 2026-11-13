import { api } from "../../../ipc/renderer/api";
import type { VideoStreamSessionConfig } from "../../../ipc/api-param-types";
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { isPlainLocalPath } from "../../core/utils/file-path";
import type { StoredLinkData } from "../../api/types/io.link-data";
import { pipeFromLink, pipeFromPersistedSource, UnresolvableLinkError } from "../../content/rebuild-pipe";
import { isProviderResolutionError } from "../../content/registry";
import { registerPipeResource, unregisterPipeResource } from "../../content/pipe-resource-server";
import { reportProviderError } from "../../content/source-recovery";
import { watchPipeSource } from "../../content/source-watch";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import type { IContentPipe } from "../../api/types/io.pipe";
import type { PlayerState, VideoFormat } from "./video-types";

type VideoSourceKind = "hls" | "http" | "local-file" | "pipe";

export interface VideoStreamSourceState {
    url: string;
    format: VideoFormat;
    parsedRequest: ParsedHttpRequest | null;
    playerState: PlayerState;
    streamUrl: string;
}

export interface VideoStreamSessionHost {
    getSourceState(): VideoStreamSourceState;
    getPipe(): IContentPipe | null;
    setPipe(pipe: IContentPipe | null): void;
    getPageId(): string | undefined;
    getSourceLink(): StoredLinkData | undefined;
    setLoading(streamUrl: string): void;
    setStreamUrl(streamUrl: string): void;
    setPlayerState(playerState: PlayerState): void;
}

export interface VideoStreamSource {
    url: string;
    format: VideoFormat;
    parsedRequest: ParsedHttpRequest | null;
}

export interface VideoStreamStartOptions {
    force?: boolean;
    freshPipe?: IContentPipe;
    rebuildPipe?: boolean;
}

function sourceKind(url: string, format: VideoFormat): VideoSourceKind {
    if (format === "m3u8") return "hls";
    if (/^https?:\/\//i.test(url)) return "http";
    if (isPlainLocalPath(url)) return "local-file";
    return "pipe";
}

export class VideoStreamSession {
    private activeSessionId: string | undefined;
    private activeSessionResourceId: string | undefined;
    private sourceRequestId = 0;
    private recoveryWatch: (() => void) | undefined;
    private inFlightSource: { url: string; promise: Promise<string | undefined> } | undefined;

    constructor(private readonly host: VideoStreamSessionHost) {}

    isPipeSource(url: string, format: VideoFormat): boolean {
        return sourceKind(url, format) === "pipe";
    }

    start(source: VideoStreamSource, options: VideoStreamStartOptions = {}): Promise<string | undefined> {
        const { url, format, parsedRequest } = source;
        if (this.inFlightSource?.url === url && !options.freshPipe) return this.inFlightSource.promise;
        const { streamUrl, playerState } = this.host.getSourceState();
        if (!options.force && streamUrl
            && playerState !== "error" && playerState !== "unsupported format") return Promise.resolve(undefined);
        const kind = sourceKind(url, format);
        const requestId = ++this.sourceRequestId;
        this.recoveryWatch?.();
        this.recoveryWatch = undefined;
        this.host.setLoading(kind === "hls" ? url : "");

        const promise = (async (): Promise<string | undefined> => {
            let resourceId: string | undefined;
            try {
                await this.deleteActiveSession();
                if (requestId !== this.sourceRequestId) {
                    options.freshPipe?.dispose();
                    return undefined;
                }
                if (options.freshPipe) {
                    const oldPipe = this.host.getPipe();
                    if (oldPipe && oldPipe !== options.freshPipe) oldPipe.dispose();
                    this.host.setPipe(options.freshPipe);
                } else if (options.rebuildPipe) {
                    this.host.getPipe()?.dispose();
                    this.host.setPipe(null);
                }
                if (kind === "hls") return undefined;
                let config: VideoStreamSessionConfig;
                if (kind === "http") {
                    config = { url, headers: parsedRequest?.headers, pageId: this.host.getPageId() };
                } else if (kind === "local-file") {
                    config = { filePath: url, pageId: this.host.getPageId() };
                } else {
                    const pipe = await this.ensurePipeForSource(url, requestId, options.rebuildPipe);
                    if (!pipe || requestId !== this.sourceRequestId) return undefined;
                    await pipe.stat();
                    if (requestId !== this.sourceRequestId) return undefined;
                    resourceId = `video-${crypto.randomUUID()}`;
                    registerPipeResource(resourceId, pipe, { kind: "video-session" });
                    config = { pipe: true, pipeResourceId: resourceId, pageId: this.host.getPageId() };
                    this.installRecoveryWatch(pipe, requestId);
                }
                const session = await api.createVideoStreamSession(config, settings.get("video-stream.port"));
                if (requestId !== this.sourceRequestId) {
                    await api.deleteVideoStreamSession(session.sessionId);
                    await this.invalidateResource(resourceId);
                    return undefined;
                }
                this.activeSessionId = session.sessionId;
                this.activeSessionResourceId = resourceId;
                const current = this.host.getSourceState();
                if (requestId === this.sourceRequestId && current.url === url) this.host.setStreamUrl(session.streamingUrl);
                return session.streamingUrl;
            } catch (error: unknown) {
                await this.invalidateResource(resourceId);
                if (requestId !== this.sourceRequestId) return undefined;
                if (options.freshPipe && this.host.getPipe() !== options.freshPipe) {
                    this.host.getPipe()?.dispose();
                    this.host.setPipe(options.freshPipe);
                }
                if (kind === "http" || kind === "local-file") {
                    this.host.setStreamUrl(url);
                    return undefined;
                }
                if (isProviderResolutionError(error)) {
                    reportProviderError(error);
                    const pipe = this.host.getPipe();
                    if (pipe) this.installRecoveryWatch(pipe, requestId);
                } else if (error instanceof UnresolvableLinkError && error.scheme && !error.registered) {
                    ui.notify(
                        `This page was opened from a "${error.scheme}:" link, and the board that `
                        + "provides it is missing or untrusted. Reinstall or trust that board to restore it.",
                        "error",
                    );
                }
                this.host.setPlayerState("error");
                return undefined;
            }
        })().finally(() => {
            if (this.inFlightSource?.promise === promise) this.inFlightSource = undefined;
        });
        this.inFlightSource = { url, promise };
        return promise;
    }

    async dispose(): Promise<void> {
        this.sourceRequestId++;
        this.recoveryWatch?.();
        this.recoveryWatch = undefined;
        const pipe = this.host.getPipe();
        this.host.setPipe(null);
        try {
            await this.deleteActiveSession();
        } finally {
            pipe?.dispose();
            this.host.setStreamUrl("");
        }
    }

    private deleteActiveSession = async (): Promise<void> => {
        const sessionId = this.activeSessionId;
        const resourceId = this.activeSessionResourceId;
        this.activeSessionId = undefined;
        this.activeSessionResourceId = undefined;
        try {
            if (sessionId) await api.deleteVideoStreamSession(sessionId);
        } finally {
            if (resourceId) unregisterPipeResource(resourceId);
        }
    };

    private invalidateResource = async (resourceId: string | undefined): Promise<void> => {
        if (resourceId) unregisterPipeResource(resourceId);
    };

    private ensurePipeForSource = async (
        url: string,
        requestId: number,
        rebuild = false,
    ): Promise<IContentPipe | undefined> => {
        const currentPipe = this.host.getPipe();
        if (currentPipe) return currentPipe;
        const pipe = rebuild
            ? await pipeFromLink(url, { unknownScheme: "reject" })
            : await pipeFromPersistedSource(this.host.getSourceLink(), url, { unknownScheme: "reject" });
        if (requestId !== this.sourceRequestId) {
            pipe.dispose();
            return undefined;
        }
        this.host.setPipe(pipe);
        return pipe;
    };

    private installRecoveryWatch(pipe: IContentPipe, requestId: number): void {
        this.recoveryWatch?.();
        this.recoveryWatch = watchPipeSource(pipe, { onRecovered: () => {
            const { url, format, parsedRequest, playerState } = this.host.getSourceState();
            if (requestId !== this.sourceRequestId || sourceKind(url, format) !== "pipe"
                || (playerState !== "error" && playerState !== "unsupported format")) return;
            void this.start({ url, format, parsedRequest }, { force: true });
        } });
    }
}
