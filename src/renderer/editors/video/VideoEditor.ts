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
import { app } from "../../api/app";
import { pagesModel } from "../../api/pages";
import { fpBasename, fpDirname, fpNormalizeForCompare, isPlainLocalPath } from "../../core/utils/file-path";
import { errMessage } from "../../../shared/utils";
import { pipeFromLink, pipeFromPersistedSource, UnresolvableLinkError } from "../../content/rebuild-pipe";
import { reportProviderError, watchSourceRecovery } from "../../content/source-recovery";
import { isProviderResolutionError } from "../../content/registry";
import type { VideoStreamSessionConfig } from "../../../ipc/api-param-types";

// ── State ────────────────────────────────────────────────────────────────────

export interface VideoEditorState extends EditorStateBase {
    /** State-type discriminator. */
    type: "videoPage";
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

/** Last mute state within this window session — remembered across video player
 *  instances. Module-scoped (preserved from legacy `VideoPlayerEditor.tsx:48`). */
let sessionMuted = false;

type VideoSourceKind = "hls" | "http" | "local-file" | "pipe";

function sourceKind(url: string, format: VideoFormat): VideoSourceKind {
    if (format === "m3u8") return "hls";
    if (/^https?:\/\//i.test(url)) return "http";
    if (isPlainLocalPath(url)) return "local-file";
    return "pipe";
}

export const getDefaultVideoEditorState = (): VideoEditorState => ({
    id: crypto.randomUUID(),
    title: englishMessage("editors.videoPlayer"),
    modified: false,
    type: "videoPage",
    editor: "video-view",
    url: "",
    inputText: "",
    format: "mp4",
    playerState: "stopped",
    pageMuted: sessionMuted,
    parsedRequest: null,
    streamUrl: "",
    reloadKey: 0,
});

// ── Model ────────────────────────────────────────────────────────────────────

export class VideoEditor extends EditorModel<VideoEditorState> {
    /** Editor identity. Matches `EditorDescriptor.editorId`. */
    readonly editorId = "video-view";

    noLanguage = true;
    skipSave = true;
    private mediaElement: HTMLMediaElement | null = null;
    private activeSessionId: string | undefined;
    private activeSessionResourceId: string | undefined;
    private sourceRequestId = 0;
    private recoveryWatch: (() => void) | undefined;
    private inFlightSource: { url: string; promise: Promise<void> } | undefined;

    constructor(state: TComponentState<VideoEditorState>) {
        super(state);
        this.getIconElement = () => PlayerIcon.createElement({ color: DEFAULT_BROWSER_COLOR });
    }

    /** The active media element handed off by the mounted player view. */
    get activeMediaElement(): HTMLMediaElement | null {
        return this.mediaElement;
    }

    get isTemporaryRecording(): boolean {
        const filePath = this.filePath;
        if (!filePath) return false;
        return fpNormalizeForCompare(fpDirname(filePath)) === fpNormalizeForCompare(app.fs.resolveDataPath("recordings"))
            && /^persephone-recording-[0-9a-f-]{36}\.(?:mp4|webm)$/i.test(fpBasename(filePath));
    }

    saveTemporaryRecording = async (): Promise<void> => {
        if (!this.isTemporaryRecording || !this.filePath) throw new Error("This video is not an unsaved recording.");
        const sourcePath = this.filePath;
        const extension = fpBasename(sourcePath).toLowerCase().endsWith(".mp4") ? "mp4" : "webm";
        const destination = await app.fs.showSaveDialog({
            title: t("editors.saveRecordingAs"),
            defaultPath: `Persephone Recording.${extension}`,
            filters: [{ name: "Video", extensions: ["mp4", "webm"] }],
        });
        if (!destination) return;
        await app.fs.copyFile(sourcePath, destination);
        await this.submitUrl(destination);
        this.state.update((state) => { state.filePath = destination; });
        await app.fs.delete(sourcePath);
        const { windowRecording } = await import("../../api/window-recording");
        windowRecording.clearLast(sourcePath);
    };

    discardTemporaryRecording = async (): Promise<void> => {
        if (!this.isTemporaryRecording || !this.filePath) throw new Error("This video is not an unsaved recording.");
        await app.fs.delete(this.filePath);
        const { windowRecording } = await import("../../api/window-recording");
        windowRecording.clearLast(this.filePath);
        const page = this.page ? pagesModel.query.findPage(this.page.id) : undefined;
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
    override findCompatibleEditors(): string[] {
        return this.filePath ? [this.editorId] : [];
    }

    /** The same source was opened onto this page again. A pipe-backed source that failed gets
     *  a fresh pipe session, so reopening its link recovers the page (US-1528). A failed
     *  stream response reaches the media element as "unsupported format", so that state
     *  retries too. A playing page and HTTP/local sources are left as they are. */
    override onReopen(freshPipe?: IContentPipe): boolean {
        const { url, format, playerState } = this.state.get();
        if (!freshPipe || !this.page || sourceKind(url, format) !== "pipe"
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

    private deleteActiveSession = async (): Promise<void> => {
        const sessionId = this.activeSessionId;
        const resourceId = this.activeSessionResourceId;
        this.activeSessionId = undefined;
        this.activeSessionResourceId = undefined;
        try {
            if (sessionId) await api.deleteVideoStreamSession(sessionId);
        } finally {
            if (resourceId) {
                const { invalidateBoardPipeResource } = await import("../board/board-pipe-handler");
                invalidateBoardPipeResource(resourceId);
            }
        }
    };

    private invalidateResource = async (resourceId: string | undefined): Promise<void> => {
        if (!resourceId) return;
        const { invalidateBoardPipeResource } = await import("../board/board-pipe-handler");
        invalidateBoardPipeResource(resourceId);
    };

    private ensurePipeForSource = async (
        url: string,
        requestId: number,
        rebuild = false,
    ): Promise<IContentPipe | undefined> => {
        if (this.pipe) return this.pipe;
        const pipe = rebuild
            ? await pipeFromLink(url, { unknownScheme: "reject" })
            : await pipeFromPersistedSource(this.state.get().sourceLink, url, { unknownScheme: "reject" });
        if (requestId !== this.sourceRequestId) {
            pipe.dispose();
            return undefined;
        }
        this.pipe = pipe;
        return pipe;
    };

    private installRecoveryWatch(pipe: IContentPipe, requestId: number): void {
        this.recoveryWatch?.();
        this.recoveryWatch = watchSourceRecovery(pipe, () => {
            const { url, format, playerState } = this.state.get();
            if (requestId !== this.sourceRequestId || sourceKind(url, format) !== "pipe"
                || (playerState !== "error" && playerState !== "unsupported format")) return;
            void this.startSource(url, this.state.get().parsedRequest, { force: true });
        });
    }

    private startSource = (
        url: string,
        parsedRequest: ParsedHttpRequest | null,
        options: { freshPipe?: IContentPipe; force?: boolean; rebuildPipe?: boolean } = {},
    ): Promise<void> => {
        if (this.inFlightSource?.url === url && !options.freshPipe) return this.inFlightSource.promise;
        const { format, streamUrl, playerState } = this.state.get();
        if (!options.force && streamUrl
            && playerState !== "error" && playerState !== "unsupported format") return Promise.resolve();
        const kind = sourceKind(url, format);
        const requestId = ++this.sourceRequestId;
        this.recoveryWatch?.();
        this.recoveryWatch = undefined;
        this.state.update((state) => {
            state.playerState = "loading";
            state.streamUrl = kind === "hls" ? url : "";
        });

        const promise = (async () => {
            let resourceId: string | undefined;
            try {
                await this.deleteActiveSession();
                if (requestId !== this.sourceRequestId) {
                    options.freshPipe?.dispose();
                    return;
                }
                if (options.freshPipe) {
                    const oldPipe = this.pipe;
                    if (oldPipe && oldPipe !== options.freshPipe) oldPipe.dispose();
                    this.pipe = options.freshPipe;
                } else if (options.rebuildPipe) {
                    this.pipe?.dispose();
                    this.pipe = null;
                }
                if (kind === "hls") return;
                let config: VideoStreamSessionConfig;
                if (kind === "http") {
                    config = { url, headers: parsedRequest?.headers, pageId: this.page?.id };
                } else if (kind === "local-file") {
                    config = { filePath: url, pageId: this.page?.id };
                } else {
                    const pipe = await this.ensurePipeForSource(url, requestId, options.rebuildPipe);
                    if (!pipe || requestId !== this.sourceRequestId) return;
                    await pipe.stat();
                    if (requestId !== this.sourceRequestId) return;
                    resourceId = `video-${crypto.randomUUID()}`;
                    const { registerVideoSessionResource } = await import("../board/board-pipe-handler");
                    registerVideoSessionResource(resourceId, pipe);
                    config = { pipe: true, pipeResourceId: resourceId, pageId: this.page?.id };
                    this.installRecoveryWatch(pipe, requestId);
                }
                const session = await api.createVideoStreamSession(config, settings.get("video-stream.port"));
                if (requestId !== this.sourceRequestId) {
                    await api.deleteVideoStreamSession(session.sessionId);
                    await this.invalidateResource(resourceId);
                    return;
                }
                this.activeSessionId = session.sessionId;
                this.activeSessionResourceId = resourceId;
                this.state.update((state) => {
                    if (requestId === this.sourceRequestId && state.url === url) state.streamUrl = session.streamingUrl;
                });
            } catch (error: unknown) {
                await this.invalidateResource(resourceId);
                if (requestId !== this.sourceRequestId) return;
                if (options.freshPipe && this.pipe !== options.freshPipe) {
                    this.pipe?.dispose();
                    this.pipe = options.freshPipe;
                }
                if (kind === "http" || kind === "local-file") {
                    this.state.update((state) => { state.streamUrl = url; });
                    return;
                }
                if (isProviderResolutionError(error)) {
                    reportProviderError(error);
                    if (this.pipe) this.installRecoveryWatch(this.pipe, requestId);
                } else if (error instanceof UnresolvableLinkError && error.scheme && !error.registered) {
                    ui.notify(
                        `This page was opened from a "${error.scheme}:" link, and the board that `
                        + "provides it is missing or untrusted. Reinstall or trust that board to restore it.",
                        "error",
                    );
                }
                this.state.update((state) => { state.playerState = "error"; });
            }
        })().finally(() => {
            if (this.inFlightSource?.promise === promise) this.inFlightSource = undefined;
        });
        this.inFlightSource = { url, promise };
        return promise;
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
        // Dispose runs when the page is closed or navigated away — not on app quit, window
        // close or a cross-window tab move — so an unsaved recording is deleted here, while a
        // restored page keeps its file. Startup cleanup still removes leftovers after 7 days.
        const unsavedRecording = this.isTemporaryRecording ? this.filePath : undefined;
        this.mediaElement = null;
        // Invalidate in-flight starts before awaiting their IPC creation; each stale request
        // will then delete and invalidate only the session/resource it created.
        this.sourceRequestId++;
        this.recoveryWatch?.();
        this.recoveryWatch = undefined;
        const pipe = this.pipe;
        this.pipe = null;
        try {
            await this.deleteActiveSession();
        } finally {
            if (pipe) pipe.dispose();
            this.state.update((s) => { s.streamUrl = ""; });
            await super.dispose();
            if (unsavedRecording) await this.deleteUnsavedRecording(unsavedRecording);
        }
    }

    private async deleteUnsavedRecording(filePath: string): Promise<void> {
        // A duplicated tab may still be playing the same recording.
        const target = fpNormalizeForCompare(filePath);
        const stillOpen = pagesModel.state.get().pages.some((page) => page.editors.some((editor) =>
            editor !== this && editor instanceof VideoEditor && editor.filePath !== undefined
            && fpNormalizeForCompare(editor.filePath) === target));
        if (stillOpen) return;
        try {
            if (await app.fs.exists(filePath)) await app.fs.delete(filePath);
            const { windowRecording } = await import("../../api/window-recording");
            windowRecording.clearLast(filePath);
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
