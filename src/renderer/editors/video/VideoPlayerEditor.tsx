import { createElement, ReactNode } from "react";
import styled from "@emotion/styled";
import { IEditorState, EditorType } from "../../../shared/types";
import { getDefaultEditorModelState, EditorModel, PageToolbar } from "../base";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { TextAreaField } from "../../components/basic/TextAreaField";
import color from "../../theme/color";
import { PlayerIcon, VlcIcon } from "../../theme/icons";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { parseHttpRequest } from "../../core/utils/curl-parser";
import { detectVideoFormat } from "./video-types";
import type { VideoFormat, PlayerState } from "./video-types";
import { VPlayer } from "./VPlayer";
import { api } from "../../../ipc/renderer/api";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";

// ── State ────────────────────────────────────────────────────────────────────

export interface VideoEditorState extends IEditorState {
    /** Raw video URL as entered by user (file path or HTTP URL). */
    url: string;
    /** Raw text as typed by user (may be a cURL command). */
    inputText: string;
    /** Detected video format based on URL. */
    format: VideoFormat;
    /** Current player lifecycle state. */
    playerState: PlayerState;
    /** Whether the player is muted. Used by PageTab for the mute button. */
    pageMuted: boolean;
    /** Parsed HTTP request from cURL input. Null for plain URLs. Set in US-414. */
    parsedRequest: ParsedHttpRequest | null;
    /**
     * Resolved streaming server URL ready for VPlayer to play.
     * Empty string while being resolved or when no video is loaded.
     * Transient — not persisted across app restarts.
     */
    streamUrl: string;
}

/** Last mute state within this window session — remembered across video player instances. */
let sessionMuted = false;

const getDefaultVideoEditorState = (): VideoEditorState => ({
    ...getDefaultEditorModelState(),
    type: "videoPage" as const,
    title: "Video Player",
    editor: "video-view",
    url: "",
    inputText: "",
    format: "mp4",
    playerState: "stopped",
    pageMuted: sessionMuted,
    parsedRequest: null,
    streamUrl: "",
});

// ── Model ────────────────────────────────────────────────────────────────────

export class VideoEditorModel extends EditorModel<VideoEditorState, void> {
    noLanguage = true;
    skipSave = true;

    getIcon = (): ReactNode => {
        return createElement(PlayerIcon, { color: DEFAULT_BROWSER_COLOR });
    };

    /** Update raw input text as user types. */
    setInputText = (text: string) => {
        this.state.update((s) => { s.inputText = text; });
    };

    /**
     * Resolve a raw URL/path to a streaming server URL for smooth playback.
     * M3U8 sources are returned as-is (hls.js handles them natively).
     * All other sources (MP4, local files) are proxied through the local
     * streaming server, which provides HTTP range request support.
     */
    private resolveStreamUrl = async (
        url: string,
        format: VideoFormat,
        parsedRequest: ParsedHttpRequest | null,
    ): Promise<string> => {
        if (format === "m3u8") return url;
        try {
            const isHttpUrl = url.startsWith("http://") || url.startsWith("https://");
            const sessionConfig = isHttpUrl
                ? { url, headers: parsedRequest?.headers, pageId: this.page?.id }
                : { filePath: url, pageId: this.page?.id };
            const { streamingUrl } = await api.createVideoStreamSession(
                sessionConfig,
                settings.get("video-stream.port"),
            );
            return streamingUrl;
        } catch {
            return url; // fallback to direct URL if streaming server fails
        }
    };

    /** Submit input text as a video URL. Resolves stream URL before VPlayer loads. */
    submitUrl = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const parsed = parseHttpRequest(trimmed);
        const resolvedUrl = parsed ? parsed.url : trimmed;
        const format = detectVideoFormat(resolvedUrl);

        this.state.update((s) => {
            s.inputText = trimmed;
            s.url = resolvedUrl;
            s.format = format;
            s.parsedRequest = parsed ?? null;
            s.playerState = "loading";
            s.streamUrl = format === "m3u8" ? resolvedUrl : "";
        });

        if (format !== "m3u8") {
            const streamUrl = await this.resolveStreamUrl(resolvedUrl, format, parsed ?? null);
            // Only update if URL hasn't changed while resolving
            this.state.update((s) => {
                if (s.url === resolvedUrl) {
                    s.streamUrl = streamUrl;
                }
            });
        }
    };

    /** Called after model creation when opening a file — resolves stream URL for immediate playback. */
    async restore(): Promise<void> {
        const { url, format, parsedRequest, playerState } = this.state.get();
        if (url && playerState === "loading") {
            const streamUrl = await this.resolveStreamUrl(url, format, parsedRequest);
            this.state.update((s) => {
                if (s.url === url) {
                    s.streamUrl = streamUrl;
                }
            });
        }
    }

    /** Called by VPlayer (US-413) when player state changes. */
    onPlayerStateChange = (playerState: PlayerState, _error?: unknown) => {
        this.state.update((s) => { s.playerState = playerState; });
    };

    /** Called by VPlayer (US-413) when muted state changes. */
    onMutedChange = (muted: boolean) => {
        sessionMuted = muted;
        this.state.update((s) => { s.pageMuted = muted; });
    };

    /** Toggle mute — called by PageTab mute button. */
    toggleMuteAll = () => {
        const newMuted = !this.state.get().pageMuted;
        sessionMuted = newMuted;
        this.state.update((s) => { s.pageMuted = newMuted; });
    };

    /** Clean up streaming server sessions when the editor tab is closed. */
    async dispose(): Promise<void> {
        const pageId = this.page?.id;
        if (pageId) {
            await api.deleteVideoStreamSessionsByPage(pageId);
        }
        await super.dispose();
    }

    /** Open the current video in VLC. Uses the local streaming server for HTTP sources. */
    openInVlc = async () => {
        const { url, format, parsedRequest } = this.state.get();
        if (!url) return;

        try {
            let vlcUrl = url;

            if (format !== "m3u8") {
                const isHttpUrl = url.startsWith("http://") || url.startsWith("https://");
                const sessionConfig = isHttpUrl
                    ? { url, headers: parsedRequest?.headers, pageId: this.page?.id }
                    : { filePath: url, pageId: this.page?.id };
                const { streamingUrl } = await api.createVideoStreamSession(
                    sessionConfig,
                    settings.get("video-stream.port"),
                );
                vlcUrl = streamingUrl;
            }

            await api.openInVlc(vlcUrl, settings.get("vlc-path"));
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            ui.textDialog({ title: "VLC Error", text: message, readOnly: true });
        }
    };

    applyRestoreData(data: Partial<VideoEditorState>): void {
        super.applyRestoreData(data);
        const fields: (keyof VideoEditorState)[] = [
            "url", "inputText", "format", "playerState", "pageMuted", "parsedRequest",
        ];
        this.state.update((s) => {
            for (const key of fields) {
                if (key in data) {
                    (s as Record<string, unknown>)[key] = data[key as keyof VideoEditorState];
                }
            }
            // Don't restore transient states — reset to stopped
            if (s.playerState === "loading" || s.playerState === "playing") {
                s.playerState = "stopped";
            }
        });
    }
}

// TextAreaField wrapper — auto-grow, max 3 lines visible
const UrlInputArea = styled(TextAreaField)`
    flex: 1;
    min-height: 28px;
    max-height: 72px;
    overflow-y: auto;
    font-size: 12px;
    line-height: 20px;
    resize: none;
`;

// ── Styled components ────────────────────────────────────────────────────────

const VideoEditorRoot = styled.div`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${color.background.dark};
    overflow: hidden;

    & .video-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
    }

    & .state-badge {
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 12px;
        border-radius: 4px;
        background: ${color.background.light};
        color: ${color.text.light};
        font-size: 12px;
        pointer-events: none;
    }

    & .placeholder-text {
        color: ${color.text.light};
        font-size: 13px;
    }

    & .vlc-button {
        position: absolute;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 16px;
        border-radius: 4px;
        border: 1px solid ${color.border.default};
        background: ${color.background.light};
        color: ${color.text.default};
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
        & svg {
            color: ${color.misc.vlc};
            width: 18px;
            height: 18px;
            flex-shrink: 0;
        }
        &:hover {
            background: ${color.background.default};
            border-color: ${color.border.active};
        }
    }
`;

// ── Component ────────────────────────────────────────────────────────────────

interface VideoPlayerEditorProps {
    model: VideoEditorModel;
}

function VideoPlayerEditor({ model }: VideoPlayerEditorProps) {
    const url = model.state.use((s) => s.url);
    const streamUrl = model.state.use((s) => s.streamUrl);
    const inputText = model.state.use((s) => s.inputText);
    const format = model.state.use((s) => s.format);
    const muted = model.state.use((s) => s.pageMuted);
    const parsedRequest = model.state.use((s) => s.parsedRequest);
    const playerState = model.state.use((s) => s.playerState);
    const showBadge = playerState !== "playing" && playerState !== "paused" && playerState !== "stopped";
    const showVlcButton = url && !["loading", "playing", "stopped"].includes(playerState);

    return (
        <VideoEditorRoot>
            <PageToolbar borderBottom>
                <UrlInputArea
                    value={inputText}
                    onChange={model.setInputText}
                    placeholder="Enter video URL or paste cURL command... (Enter to play, Shift+Enter for new line)"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            model.submitUrl(inputText);
                        }
                    }}
                />
            </PageToolbar>
            <div className="video-area">
                {url && (
                    <VPlayer
                        src={streamUrl}
                        format={format}
                        muted={muted}
                        parsedRequest={parsedRequest}
                        onStateChange={model.onPlayerStateChange}
                        onMutedChange={model.onMutedChange}
                    />
                )}
                {!url && (
                    <span className="placeholder-text">Enter a video URL above to start playing</span>
                )}
                {showBadge && (
                    <div className="state-badge">{playerState}</div>
                )}
                {showVlcButton && (
                    <button className="vlc-button" onClick={model.openInVlc}>
                        <VlcIcon />
                        Open in VLC
                    </button>
                )}
            </div>
        </VideoEditorRoot>
    );
}

// ── Editor Module ────────────────────────────────────────────────────────────

const videoEditorModule: EditorModule = {
    Editor: VideoPlayerEditor,
    newEditorModel: async (filePath?: string) => {
        const initialState = getDefaultVideoEditorState();
        if (filePath) {
            initialState.inputText = filePath;
            initialState.url = filePath;
            initialState.format = detectVideoFormat(filePath);
            initialState.playerState = "loading";
        }
        return new VideoEditorModel(new TComponentState(initialState));
    },
    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType === "videoPage") {
            return new VideoEditorModel(
                new TComponentState(getDefaultVideoEditorState()),
            );
        }
        return null;
    },
    newEditorModelFromState: async (state: Partial<IEditorState>) => {
        const initialState: VideoEditorState = {
            ...getDefaultVideoEditorState(),
            ...state,
            streamUrl: "", // always reset — streaming sessions are ephemeral
        };
        return new VideoEditorModel(new TComponentState(initialState));
    },
};

export default videoEditorModule;
export { VideoPlayerEditor };
export type { VideoPlayerEditorProps };
