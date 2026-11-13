import { EditorId } from "../../../shared/editor-ids";
import { englishMessage, t } from "../../../shared/i18n/t";
import { TComponentState } from "../../core/state/state";
import {
    EditorModel,
    type EditorStateBase,
    type RestoreData,
} from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import type { IContentPipe } from "../../api/types/io.pipe";
import { PlayerIcon } from "../../theme/icons";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { parseHttpRequest } from "../../core/utils/curl-parser";
import { detectVideoFormat } from "./video-types";
import type { VideoFormat, PlayerState } from "./video-types";
import { api } from "../../../ipc/renderer/api";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { pages } from "../../api/pages";
import { fpNormalizeForCompare } from "../../core/utils/file-path";
import { errMessage } from "../../../shared/utils";
import { REOPEN_TRAIT } from "../base/editor-traits";
import {
    deleteTemporary,
    discard as discardRecording,
    isTemporaryRecording as isTemporaryRecordingPath,
    saveAs as saveRecordingAs,
} from "../../api/window-recording";
import { videoSessionStore } from "../../api/video-session-store";
import { VideoStreamSession } from "./VideoStreamSession";
import type { VideoStreamStartOptions } from "./VideoStreamSession";

// ── State ────────────────────────────────────────────────────────────────────

export interface VideoEditorState extends EditorStateBase {
    /** State-type discriminator. */
    /** Raw video URL as entered by user (file path or HTTP URL). */
    url: string;
    /** Raw text as typed by user (may be a cURL command). */
    inputText: string;
    /** Detected video format based on URL. */
    format: VideoFormat;
    /** Current player lifecycle state. */
    playerState: PlayerState;
    /** Whether the player is muted. Consumed by PageTab for the mute button. */
    pageMuted: boolean;
    /** Parsed HTTP request from cURL input. Null for plain URLs. */
    parsedRequest: ParsedHttpRequest | null;
    /**
     * Resolved streaming server URL ready for VPlayer to play.
     * Empty string while being resolved or when no video is loaded.
     * Transient — not persisted across app restarts.
     */
    streamUrl: string;
    /** Transient retry signal for reloading a source whose URL did not change. */
    reloadKey: number;
}

export const getDefaultVideoEditorState = (): VideoEditorState => ({
    id: crypto.randomUUID(),
    title: englishMessage("editors.videoPlayer"),
    modified: false,
    editor: EditorId.videoView,
    url: "",
    inputText: "",
    format: "mp4",
    playerState: "stopped",
    pageMuted: videoSessionStore.muted,
    parsedRequest: null,
    streamUrl: "",
    reloadKey: 0,
});

// ── Model ────────────────────────────────────────────────────────────────────

export class VideoEditor extends EditorModel<VideoEditorState> {
    /** Editor identity. Matches `EditorDescriptor.editorId`. */
    readonly editorId = EditorId.videoView;

    noLanguage = true;
    skipSave = true;
    private mediaElement: HTMLMediaElement | null = null;
    private readonly streamSession: VideoStreamSession;

    constructor(state: TComponentState<VideoEditorState>) {
        super(state);
        this.streamSession = new VideoStreamSession({
            getSourceState: () => {
                const { url, format, parsedRequest, playerState, streamUrl } = this.state.get();
                return { url, format, parsedRequest, playerState, streamUrl };
            },
            getPipe: () => this.pipe,
            setPipe: (pipe) => { this.pipe = pipe; },
            getPageId: () => this.page?.id,
            getSourceLink: () => this.sourceLink,
            setLoading: (streamUrl) => this.state.update((current) => {
                current.playerState = "loading";
                current.streamUrl = streamUrl;
            }),
            setStreamUrl: (streamUrl) => this.state.update((current) => { current.streamUrl = streamUrl; }),
            setPlayerState: (playerState) => this.state.update((current) => { current.playerState = playerState; }),
        });
        this.traits.add(REOPEN_TRAIT, { onReopen: (pipe) => this.reopen(pipe) });
        this.getIconElement = () => PlayerIcon.createElement({ color: DEFAULT_BROWSER_COLOR });
    }

    /** The active media element handed off by the mounted player view. */
    get activeMediaElement(): HTMLMediaElement | null {
        return this.mediaElement;
    }

    play(): Promise<void> {
        const media = this.mediaElement;
        if (!media) return Promise.reject(this.missingMediaError());
        return media.play();
    }

    pause(): void {
        this.requireMediaElement().pause();
    }

    seek(time: number): void {
        this.requireMediaElement().currentTime = time;
    }

    private requireMediaElement(): HTMLMediaElement {
        const media = this.mediaElement;
        if (!media) throw this.missingMediaError();
        return media;
    }

    private missingMediaError(): Error {
        return new Error("Media action requires a mounted media element");
    }

    get isTemporaryRecording(): boolean {
        return this.filePath ? isTemporaryRecordingPath(this.filePath) : false;
    }

    saveTemporaryRecording = async (): Promise<void> => {
        if (!this.isTemporaryRecording || !this.filePath) throw new Error("This video is not an unsaved recording.");
        const sourcePath = this.filePath;
        const destination = await saveRecordingAs(sourcePath);
        if (!destination) return;
        await this.submitUrl(destination);
        this.state.update((state) => { state.filePath = destination; });
        await deleteTemporary(sourcePath);
    };

    discardTemporaryRecording = async (): Promise<void> => {
        if (!this.isTemporaryRecording || !this.filePath) throw new Error("This video is not an unsaved recording.");
        await discardRecording(this.filePath);
        const page = this.page ? pages.query.findPage(this.page.id) : undefined;
        await page?.close();
    };

    /** Keep facade reads attached to the media element owned by this page. */
    setMediaElement = (element: HTMLMediaElement | null): void => {
        this.mediaElement = element;
    };

    override setPage(page: Parameters<EditorModel["setPage"]>[0]): void {
        super.setPage(page);
        if (!page) return;
        const { url, parsedRequest } = this.state.get();
        if (url) void this.startSource(url, parsedRequest);
    }

    /** Lists itself so the editor switch renders once a board for the file is installed, or the
     *  catalog offers one through "+" (an audio file and the Audio Player). Alone it is a
     *  single-entry list, which the switch hides. */
    /** The same source was opened onto this page again. A pipe-backed source that failed gets
     * a fresh pipe session, so reopening its link recovers the page. A failed
     *  stream response reaches the media element as "unsupported format", so that state
     *  retries too. A playing page and HTTP/local sources are left as they are. */
    private reopen(freshPipe?: IContentPipe): boolean {
        const { url, format, playerState } = this.state.get();
        if (!freshPipe || !this.page || !this.streamSession.isPipeSource(url, format)
            || (playerState !== "error" && playerState !== "unsupported format")) return false;
        void this.startSource(url, this.state.get().parsedRequest, {
            freshPipe,
            force: true,
        });
        return true;
    }

    /** Update raw input text as user types. */
    setInputText = (text: string) => {
        this.state.update((s) => { s.inputText = text; });
    };

    private startSource = (
        url: string,
        parsedRequest: ParsedHttpRequest | null,
        options: VideoStreamStartOptions = {},
    ): Promise<string | undefined> => {
        const { format } = this.state.get();
        return this.streamSession.start({ url, format, parsedRequest }, options);
    };

    /** Submit input text as a video URL. Resolves stream URL before VPlayer loads. */
    submitUrl = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const parsed = parseHttpRequest(trimmed);
        await this.submitRequest(parsed ?? { url: trimmed, method: "GET", headers: {}, body: "" }, trimmed, !!parsed);
    };

    /** Submit a structured request that the caller has already validated. */
    submitValidatedRequest = async (request: ParsedHttpRequest): Promise<void> => {
        await this.submitRequest(request, request.url, true);
    };

    private submitRequest = async (request: ParsedHttpRequest, trimmed: string, hasRequest: boolean): Promise<void> => {
        const parsed = hasRequest ? request : null;
        const resolvedUrl = request.url;
        const format = detectVideoFormat(resolvedUrl);
        this.state.update((s) => {
            s.inputText = trimmed;
            s.url = resolvedUrl;
            s.format = format;
            s.parsedRequest = parsed ?? null;
            s.playerState = "loading";
            s.streamUrl = format === "m3u8" ? resolvedUrl : "";
            s.reloadKey++;
        });
        await this.startSource(resolvedUrl, parsed ?? null, { force: true, rebuildPipe: true });
    };

    /** Called after model creation when opening a file — resolves stream URL for immediate playback. */
    async restore(): Promise<void> {
        await super.restore();
        const { url, parsedRequest } = this.state.get();
        if (url) await this.startSource(url, parsedRequest);
    }

    /** Called by VPlayer when player state changes. (VPlayer's
     *  `onStateChange` may pass an error arg; it's unused here.) */
    onPlayerStateChange = (playerState: PlayerState) => {
        this.state.update((s) => { s.playerState = playerState; });
    };

    /** Called by VPlayer when muted state changes. */
    onMutedChange = (muted: boolean) => {
        videoSessionStore.setMuted(muted);
        this.state.update((s) => { s.pageMuted = muted; });
    };

    /** Toggle mute — called by PageTab mute button. */
    toggleMuteAll = () => {
        const newMuted = !this.state.get().pageMuted;
        videoSessionStore.setMuted(newMuted);
        this.state.update((s) => { s.pageMuted = newMuted; });
    };


    /** Clean up streaming server sessions when the editor tab is closed. */
    async dispose(): Promise<void> {
        // Dispose runs when the page is closed or navigated away — not on app quit, window
        // close or a cross-window tab move — so an unsaved recording is deleted here, while a
        // restored page keeps its file. Startup cleanup still removes leftovers after 7 days.
        const unsavedRecording = this.isTemporaryRecording ? this.filePath : undefined;
        this.mediaElement = null;
        try {
            await this.streamSession.dispose();
        } finally {
            await super.dispose();
            if (unsavedRecording) await this.deleteUnsavedRecording(unsavedRecording);
        }
    }

    private async deleteUnsavedRecording(filePath: string): Promise<void> {
        // A duplicated tab may still be playing the same recording.
        const target = fpNormalizeForCompare(filePath);
        const stillOpen = pages.state.get().pages.some((page) => page.editors.some((editor) =>
            editor !== this && editor instanceof VideoEditor && editor.filePath !== undefined
            && fpNormalizeForCompare(editor.filePath) === target));
        if (stillOpen) return;
        try {
            await deleteTemporary(filePath);
        } catch { /* Best effort: the seven-day startup cleanup removes anything left behind. */ }
    }

    /** Open the current video in VLC. Uses the local streaming server for HTTP sources. */
    openInVlc = async () => {
        const { url, format, streamUrl } = this.state.get();
        if (!url) return;

        try {
            const vlcUrl = format === "m3u8" ? url : streamUrl;
            if (!vlcUrl) return;
            await api.openInVlc(vlcUrl, settings.get("vlc-path"));
        } catch (e: unknown) {
            const message = errMessage(e);
            ui.textDialog({ title: t("editors.vlcError"), text: message, readOnly: true });
        }
    };

    /** Surface the t("editors.fileExplorer") nav button through PageToolbar's
     *  NavPanelButton. Returning `{ pipe: null, filePath }` gates on
     *  `canOpenNavigator(null, filePath)` — equivalent to the legacy
     *  `(canOpenNavigator(...) || filePath)` inline gate. */
    getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
        return { pipe: null, filePath: this.state.get().filePath ?? null };
    }

    applyRestoreData(data: RestoreData<VideoEditorState>): void {
        super.applyRestoreData(data);
        const fields: (keyof VideoEditorState)[] = [
            "url", "inputText", "format", "playerState", "pageMuted", "parsedRequest",
        ];
        this.state.update((s) => {
            for (const key of fields) {
                if (key in data) {
                    (s as unknown as Record<string, unknown>)[key] =
                        (data as unknown as Record<string, unknown>)[key as string];
                }
            }
            // Don't restore transient states — reset to stopped
            if (s.playerState === "loading" || s.playerState === "playing") {
                s.playerState = "stopped";
            }
        });
    }

    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        const { reloadKey: _reloadKey, ...persistedState } = s;
        // streamUrl is transient (ephemeral streaming session) — never persist.
        // Reset transient playback state so the descriptor never carries
        // "loading"/"playing" (mirrors applyRestoreData + the legacy
        // newEditorModelFromState `streamUrl: ""` reset).
        const playerState =
            s.playerState === "loading" || s.playerState === "playing"
                ? "stopped"
                : s.playerState;
        return {
            editorId: this.editorId,
            id: s.id,
            state: {
                ...persistedState,
                playerState,
                streamUrl: "",
            } as unknown as Record<string, unknown>,
        };
    }
}
