// hls.js's default export is also re-exported as a named `Hls`; the default is correct here.
// eslint-disable-next-line import-x/no-named-as-default
import Hls from "hls.js";
import type { HlsConfig } from "hls.js";
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import type { PlayerState, VideoFormat } from "./video-types";
import { createNodeFetchLoaderClass } from "./NodeFetchHlsLoader";
import "../../uikit/Panel/Panel.css";
import "./video-editor.css";

export interface VPlayerProps {
    src?: string;
    format?: VideoFormat;
    muted?: boolean;
    parsedRequest?: ParsedHttpRequest | null;
    reloadKey: number;
    onStateChange?: (state: PlayerState, error?: unknown) => void;
    onMutedChange?: (muted: boolean) => void;
    onMediaElementChange?: (element: HTMLMediaElement | null) => void;
}

/** "hls" plays through hls.js attached to the element; "native" sets `src` directly. Both use the
 *  browser's own media controls. */
type ActiveMode = "none" | "hls" | "native";

export class VPlayerView extends VanillaView<VPlayerProps> {
    private video!: HTMLVideoElement;
    private hls: Hls | null = null;
    private activeMode: ActiveMode = "none";
    private hlsSource = "";
    private hlsHeadersKey = "";
    private lastReloadKey = 0;

    public constructor(props: VPlayerProps) {
        super(props, createPanelElement({
            name: "vplayer-root",
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
        }));
    }

    protected onMount(): void {
        this.video = document.createElement("video");
        this.video.dataset.part = "video-media";
        this.video.controls = true;
        this.video.autoplay = true;
        this.video.preload = "auto";
        this.video.muted = this.props.muted ?? false;

        this.root.append(this.video);

        this.listen(this.video, "loadstart", () => {
            if (this.activeMode !== "none") this.props.onStateChange?.("loading");
        });
        this.listen(this.video, "playing", () => {
            if (this.activeMode !== "none") this.props.onStateChange?.("playing");
        });
        this.listen(this.video, "pause", () => {
            if (this.activeMode !== "none") this.props.onStateChange?.("paused");
        });
        this.listen(this.video, "volumechange", () => {
            if (this.activeMode !== "none") this.props.onMutedChange?.(this.video.muted);
        });
        this.listen(this.video, "error", () => {
            if (this.activeMode === "none") return;
            const error = this.video.error;
            if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                this.props.onStateChange?.("unsupported format", error);
            } else {
                this.props.onStateChange?.("error", error ?? undefined);
            }
        });

        this.own(() => this.disposeVideoAdapter());
        this.own(() => this.props.onMediaElementChange?.(null));
        this.props.onMediaElementChange?.(this.video);
        this.syncMode();
    }

    protected onUpdate(props: VPlayerProps): void {
        this.video.muted = props.muted ?? false;
        this.syncMode();
    }

    private syncMode(): void {
        const reloadChanged = this.props.reloadKey !== this.lastReloadKey;
        this.lastReloadKey = this.props.reloadKey;
        const source = this.props.src ?? "";
        const wantsHls = this.props.format === "m3u8" && Hls.isSupported();
        const nextMode: ActiveMode = !source ? "none" : wantsHls ? "hls" : "native";

        if (nextMode !== this.activeMode) {
            this.props.onMediaElementChange?.(null);
            this.disposeVideoAdapter();
            this.activeMode = nextMode;
            this.hlsSource = "";
            this.hlsHeadersKey = "";
        }

        this.video.hidden = nextMode !== "hls" && nextMode !== "native";

        if (nextMode === "hls" || nextMode === "native") {
            this.props.onMediaElementChange?.(this.video);
            this.video.className = "native";
            // Chromium draws an audio-only element with its grey pill-shaped bar; the CSS restyles it like video.
            this.video.toggleAttribute("data-audio-only", this.props.format === "audio");
            this.video.controls = true;
            this.video.autoplay = true;
            this.video.muted = this.props.muted ?? false;
            if (nextMode === "hls") {
                this.syncHlsSource(source, reloadChanged);
            } else if (this.video.getAttribute("src") !== source) {
                this.video.src = source;
            } else if (reloadChanged) {
                this.video.load();
            }
        } else {
            this.props.onMediaElementChange?.(null);
            this.video.removeAttribute("src");
        }
    }

    private syncHlsSource(source: string, forceReload: boolean): void {
        const headers = this.props.parsedRequest?.headers;
        const headersKey = headers ? JSON.stringify(headers) : "";
        if (!forceReload && this.hls && this.hlsSource === source && this.hlsHeadersKey === headersKey) return;

        this.hls?.destroy();
        this.hls = null;
        this.hlsSource = source;
        this.hlsHeadersKey = headersKey;

        const hlsConfig: Partial<HlsConfig> = {};
        if (headers && Object.keys(headers).length > 0) {
            hlsConfig.loader = createNodeFetchLoaderClass(headers);
        }
        const hls = new Hls(hlsConfig);
        this.hls = hls;
        hls.loadSource(source);
        hls.attachMedia(this.video);
    }

    private disposeVideoAdapter(): void {
        this.activeMode = "none";
        this.video?.pause();
        this.hls?.destroy();
        this.hls = null;
        this.hlsSource = "";
        this.hlsHeadersKey = "";
        this.video?.removeAttribute("src");
        this.video?.load();
    }
}
