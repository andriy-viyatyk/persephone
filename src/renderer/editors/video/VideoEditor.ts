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
import { detectVideoFormat, isAudioFile } from "./video-types";
import type { VideoFormat, PlayerState } from "./video-types";
import { api } from "../../../ipc/renderer/api";
import { settings } from "../../api/settings";
import { ui } from "../../api/ui";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import { fpDirname, isPlainLocalPath } from "../../core/utils/file-path";
import type { ITreeProvider, ILink } from "../../api/types/io.tree";
import { errMessage } from "../../../shared/utils";
import { afterPaint } from "../../core/utils/scheduling";
import type { EffectType } from "./effects/types";
import { pipeFromLink } from "../../content/rebuild-pipe";
import { isSchemeRegistered, schemeOf } from "../../content/scheme-registry";

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
}

/** Last mute state within this window session — remembered across video player
 *  instances. Module-scoped (preserved from legacy `VideoPlayerEditor.tsx:48`). */
let sessionMuted = false;

export const getDefaultVideoEditorState = (): VideoEditorState => ({
    id: crypto.randomUUID(),
    title: "Video Player",
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
});

// ── Model ────────────────────────────────────────────────────────────────────

export class VideoEditor extends EditorModel<VideoEditorState> {
    /** Editor identity. Matches `EditorDescriptor.editorId`. */
    readonly editorId = "video-view";

    noLanguage = true;
    skipSave = true;
    private mediaElement: HTMLMediaElement | null = null;
    private activeSessionId: string | undefined;
    private activeSessionPageId: string | undefined;
    private sourceRequestId = 0;

    constructor(state: TComponentState<VideoEditorState>) {
        super(state);
        this.getIconElement = () => PlayerIcon.createElement({ color: DEFAULT_BROWSER_COLOR });
    }

    /** The active media element handed off by the mounted player view. */
    get activeMediaElement(): HTMLMediaElement | null {
        return this.mediaElement;
    }

    /** Keep facade reads attached to the media element owned by this page. */
    setMediaElement = (element: HTMLMediaElement | null): void => {
        this.mediaElement = element;
    };

    override setPage(page: Parameters<EditorModel["setPage"]>[0]): void {
        super.setPage(page);
        if (!page) return;
        const { url, format, parsedRequest, streamUrl } = this.state.get();
        if (!url || streamUrl || format === "m3u8"
            || /^https?:\/\//i.test(url) || isPlainLocalPath(url) || !this.pipe) return;

        const sourceRequestId = ++this.sourceRequestId;
        void this.resolveStreamUrl(url, format, parsedRequest, sourceRequestId).then(
            ({ streamingUrl }) => {
                this.state.update((s) => {
                    if (s.url === url && sourceRequestId === this.sourceRequestId) {
                        s.streamUrl = streamingUrl;
                    }
                });
            },
            () => {
                this.state.update((s) => {
                    if (s.url === url && sourceRequestId === this.sourceRequestId) {
                        s.playerState = "error";
                    }
                });
            },
        );
    }

    /** The same source was opened onto this page again. A pipe-backed source that failed gets
     *  a fresh pipe session, so reopening its link recovers the page (US-1528). A failed
     *  stream response reaches the media element as "unsupported format", so that state
     *  retries too. A playing page and HTTP/local sources are left as they are. */
    override onReopen(): void {
        const { url, format, parsedRequest, playerState } = this.state.get();
        if ((playerState !== "error" && playerState !== "unsupported format") || !url || !this.page || format === "m3u8"
            || /^https?:\/\//i.test(url) || isPlainLocalPath(url)) return;

        const sourceRequestId = ++this.sourceRequestId;
        this.state.update((s) => {
            s.playerState = "loading";
            s.streamUrl = "";
        });
        void (async () => {
            await this.ensurePipeForSource(url);
            return this.resolveStreamUrl(url, format, parsedRequest, sourceRequestId);
        })().then(
            ({ streamingUrl }) => {
                this.state.update((s) => {
                    if (s.url === url && sourceRequestId === this.sourceRequestId) {
                        s.streamUrl = streamingUrl;
                    }
                });
            },
            () => {
                this.state.update((s) => {
                    if (s.url === url && sourceRequestId === this.sourceRequestId) {
                        s.playerState = "error";
                    }
                });
            },
        );
    }

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
    private ensurePipeForSource = async (url: string): Promise<IContentPipe> => {
        if (this.pipe) return this.pipe;
        const sourceLink = this.state.get().sourceLink;
        const pipe = await pipeFromLink(sourceLink?.href ?? url);
        this.pipe = pipe;
        return pipe;
    };

    private deleteActiveSession = async (): Promise<void> => {
        const sessionId = this.activeSessionId;
        this.activeSessionId = undefined;
        this.activeSessionPageId = undefined;
        if (sessionId) await api.deleteVideoStreamSession(sessionId);
    };

    private resolveStreamUrl = async (
        url: string,
        format: VideoFormat,
        parsedRequest: ParsedHttpRequest | null,
        sourceRequestId: number,
    ): Promise<{ streamingUrl: string }> => {
        if (sourceRequestId !== this.sourceRequestId) return { streamingUrl: "" };
        await this.deleteActiveSession();
        if (format === "m3u8") return { streamingUrl: url };
        const isHttpUrl = /^https?:\/\//i.test(url);
        const isPlainLocalFile = isPlainLocalPath(url);
        try {
            const page = this.page;
            const pageId = page?.id;
            const sessionConfig = isHttpUrl
                ? { url, headers: parsedRequest?.headers, pageId }
                : isPlainLocalFile
                    ? { filePath: url, pageId }
                    : this.pipe && pageId
                        ? { pipe: true as const, pageId }
                        : null;
            if (!sessionConfig) {
                throw new Error("The video source has no live content pipe.");
            }
            if ("pipe" in sessionConfig) {
                // Main accepts a pipe session only from the page's owning renderer, and a
                // restored page's editors run before the page is registered (US-1528).
                if (!page?.ensurePipeOwner) {
                    throw new Error("The video page cannot own a media pipe.");
                }
                await page.ensurePipeOwner();
                if (sourceRequestId !== this.sourceRequestId) return { streamingUrl: "" };
            }
            const session = await api.createVideoStreamSession(
                sessionConfig,
                settings.get("video-stream.port"),
            );
            if (sourceRequestId !== this.sourceRequestId) {
                await api.deleteVideoStreamSession(session.sessionId);
                return { streamingUrl: "" };
            }
            this.activeSessionId = session.sessionId;
            this.activeSessionPageId = pageId;
            return { streamingUrl: session.streamingUrl };
        } catch (error: unknown) {
            if (!isHttpUrl && !isPlainLocalFile) throw error;
            return { streamingUrl: url }; // fallback to direct URL for local/HTTP sources
        }
    };

    /** Submit input text as a video URL. Resolves stream URL before VPlayer loads. */
    submitUrl = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const sourceRequestId = ++this.sourceRequestId;
        const parsed = parseHttpRequest(trimmed);
        const resolvedUrl = parsed ? parsed.url : trimmed;
        const format = detectVideoFormat(resolvedUrl);
        await this.deleteActiveSession();

        this.state.update((s) => {
            s.inputText = trimmed;
            s.url = resolvedUrl;
            s.format = format;
            s.parsedRequest = parsed ?? null;
            s.playerState = "loading";
            s.streamUrl = format === "m3u8" ? resolvedUrl : "";
        });

        if (format !== "m3u8") {
            const { streamingUrl } = await this.resolveStreamUrl(
                resolvedUrl,
                format,
                parsed ?? null,
                sourceRequestId,
            );
            // Only update if URL hasn't changed while resolving
            this.state.update((s) => {
                if (s.url === resolvedUrl && sourceRequestId === this.sourceRequestId) {
                    s.streamUrl = streamingUrl;
                }
            });
        }
    };

    /** Called after model creation when opening a file — resolves stream URL for immediate playback. */
    async restore(): Promise<void> {
        await super.restore();
        const { url, format, parsedRequest } = this.state.get();
        const sourceRequestId = ++this.sourceRequestId;
        if (url) {
            const isPipeSource = format !== "m3u8"
                && !/^https?:\/\//i.test(url)
                && !isPlainLocalPath(url);
            if (isPipeSource) {
                if (!this.pipe) {
                    try {
                        await this.ensurePipeForSource(url);
                    } catch (error: unknown) {
                        // A persisted link whose scheme is no longer REGISTERED means the board
                        // that owned it is gone — uninstalled or untrusted — and no amount of
                        // retrying rebuilds it. Keep the page with a legible state instead of
                        // dropping it. Deliberately keyed on registration and not on the scheme's
                        // name: core must not know which board claims `torrent:`. A link whose
                        // scheme IS registered failed for some other reason and still throws.
                        const persistedLink = this.state.get().sourceLink?.href;
                        const scheme = schemeOf(persistedLink);
                        if (scheme && !isSchemeRegistered(scheme)) {
                            this.state.update((s) => { s.playerState = "error"; });
                            ui.notify(
                                `This page was opened from a "${scheme}:" link, and the board that `
                                + "provides it is missing or untrusted. Reinstall or trust that "
                                + "board to restore it.",
                                "error",
                            );
                            return;
                        }
                        throw error;
                    }
                }
                if (!this.page) return;
            }
            const { streamingUrl } = await this.resolveStreamUrl(url, format, parsedRequest, sourceRequestId);
            this.state.update((s) => {
                if (s.url === url && sourceRequestId === this.sourceRequestId) {
                    s.streamUrl = streamingUrl;
                }
            });
        }
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

    // ── Next track / shuffle ──────────────────────────────────────

    /** Whether shuffle mode is enabled (persisted in app.settings). */
    get shuffle(): boolean {
        return settings.get("audio-shuffle") === true;
    }

    /** Toggle shuffle mode. */
    toggleShuffle = () => {
        settings.set("audio-shuffle", !this.shuffle);
    };

    /** Whether the shared audio visualizer uses bars, circular, or no effect. */
    get visualizerEffect(): EffectType {
        const effect = settings.get("visualizer-effect");
        return effect === "circular" || effect === "none" ? effect : "bars";
    }

    /** Set the shared audio visualizer effect. */
    setVisualizerEffect = (effect: EffectType): void => {
        settings.set("visualizer-effect", effect);
    };

    /** Whether the player can potentially play a next track (has a source provider). */
    get canPlayNext(): boolean {
        const sourceId = this.state.get().sourceLink?.sourceId;
        return sourceId === "explorer" || sourceId === "link-category" || sourceId === "link-tag";
    }

    /**
     * Find the ITreeProvider that provided the currently playing track.
     * Scans page.panelEditors[] matching sourceLink.sourceId.
     */
    private findSourceProvider(): ITreeProvider | null {
        const page = this.page;
        if (!page) return null;
        const sourceId = this.state.get().sourceLink?.sourceId;
        if (!sourceId) return null;

        for (const editor of page.panelEditors) {
            if (!("treeProvider" in editor)) continue;
            const tp = (editor as any).treeProvider as ITreeProvider | null; // eslint-disable-line @typescript-eslint/no-explicit-any
            if (sourceId === "explorer" && tp?.type === "file") return tp;
            if ((sourceId === "link-category" || sourceId === "link-tag") && tp?.type === "link") return tp;
        }
        return null;
    }

    /**
     * List audio files in the same directory/category as the current track.
     * Returns the list and the index of the current track within it.
     */
    private async getSiblingTracks(): Promise<{ items: ILink[]; currentIndex: number } | null> {
        const provider = this.findSourceProvider();
        if (!provider) return null;

        const { sourceLink, url } = this.state.get();
        const sourceId = sourceLink?.sourceId;

        // Tag-based listing: getTagItems handles both specific tag and "All" (empty = no filter)
        if (sourceId === "link-tag" && provider.getTagItems) {
            const tag = sourceLink?.selectedTag ?? "";
            const allItems = provider.getTagItems(tag);
            const audioItems = allItems.filter((item) => !item.isDirectory && isAudioFile(item.href));
            if (audioItems.length === 0) return null;
            const currentHref = (url || sourceLink?.href || "").toLowerCase();
            const currentIndex = audioItems.findIndex((item) => item.href.toLowerCase() === currentHref);
            return { items: audioItems, currentIndex };
        }

        let parentPath: string;
        if (provider.type === "file") {
            parentPath = fpDirname(url || sourceLink?.href || "");
            if (!parentPath) return null;
        } else {
            parentPath = sourceLink?.category ?? provider.rootPath;
        }

        const allItems = await provider.list(parentPath);
        const audioItems = allItems.filter((item) => !item.isDirectory && isAudioFile(item.href));
        if (audioItems.length === 0) return null;

        const currentHref = (url || sourceLink?.href || "").toLowerCase();
        const currentIndex = audioItems.findIndex((item) => item.href.toLowerCase() === currentHref);

        return { items: audioItems, currentIndex };
    }

    /**
     * Play the next (or random) track from the source provider.
     *
     * An arrow property, like every other handler this editor hands to its
     * view: `VideoView` passes it unbound as both `onNext` and `onEnded`, and
     * a prototype method loses its receiver there (US-1190).
     */
    playNext = async (): Promise<void> => {
        const result = await this.getSiblingTracks();
        if (!result || result.items.length <= 1) return;

        const { items, currentIndex } = result;
        let nextIndex: number;

        if (this.shuffle) {
            nextIndex = this.getShuffleBagNext(items, currentIndex);
        } else {
            nextIndex = currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;
        }

        const nextItem = items[nextIndex];
        this.navigateToTrack(nextItem);
    }

    /** Navigate to a new track via the openRawLink pipeline. */
    private navigateToTrack(item: ILink): void {
        const provider = this.findSourceProvider();
        if (!provider) return;

        const sourceId = this.state.get().sourceLink?.sourceId;
        const pageId = this.page?.id;
        const navUrl = provider.getNavigationUrl(item);

        // Update the source panel's selection highlight.
        // Explorer uses synchronous selectionState (works before navigation).
        // Link panels use selectByHref → vm.selectLink which must run AFTER navigation
        // completes, otherwise the openRawLink pipeline's synchronous state changes
        // cause the navigation update and selection update to observe different selectedLinkId snapshots.
        if (this.page) {
            for (const editor of this.page.panelEditors) {
                if (!("treeProvider" in editor)) continue;
                const tp = (editor as any).treeProvider; // eslint-disable-line @typescript-eslint/no-explicit-any
                if (sourceId === "explorer" && tp?.type === "file" && "selectionState" in editor) {
                    (editor as any).selectionState.set({ selectedHref: item.href }); // eslint-disable-line @typescript-eslint/no-explicit-any
                }
            }
        }

        const page = this.page;
        const itemHref = item.href;
        app.events.openRawLink.sendAsync(
            createLinkData(navUrl, {
                pageId,
                sourceId,
                category: item.category,
                selectedTag: sourceId === "link-tag"
                    ? this.state.get().sourceLink?.selectedTag
                    : undefined,
                target: item.target || undefined,
                title: item.title,
            }),
        ).then(() => {
            // Update link panel selection AFTER navigation completes, so the navigation's own
            // state changes have reached the DOM before this second update lands.
            //
            // Owned by nobody on purpose. The navigation above REPLACES this editor: the page
            // adopts a fresh VideoEditor for the next track and this instance is detached
            // (`this.page` becomes null) and then disposed, all before this callback would run.
            // So anything editor-scoped here is dead on arrival — `this.schedule.raf` is
            // cancelled by (and throws on) disposal, and a `this.page !== page` guard can never
            // pass. That is what stopped the Collections/Tags highlight following the track from
            // one auto-advance to the next (US-1288). The callback closes over everything it
            // needs, touches no editor state, and re-reads `page.panelEditors` — which is empty
            // once the page is gone — so it is safe to outlive the editor that scheduled it.
            afterPaint(() => {
                if (!page) return;
                for (const editor of page.panelEditors) {
                    if (!("treeProvider" in editor) || !("selectByHref" in editor)) continue;
                    const tp = (editor as any).treeProvider; // eslint-disable-line @typescript-eslint/no-explicit-any
                    if ((sourceId === "link-category" || sourceId === "link-tag") && tp?.type === "link") {
                        (editor as any).selectByHref(itemHref); // eslint-disable-line @typescript-eslint/no-explicit-any
                    }
                }
            });
        });
    }

    /**
     * Pick the next index from a shuffle bag stored in page transient state.
     * The bag is a shuffled array of indices. When exhausted, it reshuffles.
     */
    private getShuffleBagNext(items: ILink[], currentIndex: number): number {
        const page = this.page;
        if (!page) return 0;

        const key = "audio-shuffle-bag";
        let bag = page.getTransient<number[]>(key);

        // Invalidate bag if track count changed
        if (bag && bag.length > items.length) bag = null;

        if (!bag || bag.length === 0) {
            bag = Array.from({ length: items.length }, (_, i) => i)
                .filter((i) => i !== currentIndex);
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [bag[i], bag[j]] = [bag[j], bag[i]];
            }
        }

        const nextIndex = bag.shift() ?? 0;
        page.setTransient(key, bag);
        return nextIndex;
    }

    /** Clean up streaming server sessions when the editor tab is closed. */
    async dispose(): Promise<void> {
        this.mediaElement = null;
        this.sourceRequestId++;
        const sessionId = this.activeSessionId;
        const pageId = this.activeSessionPageId ?? this.page?.id;
        this.activeSessionId = undefined;
        this.activeSessionPageId = undefined;
        const pipe = this.pipe;
        this.pipe = null;
        await Promise.all([
            sessionId ? api.deleteVideoStreamSession(sessionId) : Promise.resolve(),
            pageId ? api.deleteVideoStreamSessionsByPage(pageId) : Promise.resolve(),
        ]);
        if (pipe) {
            pipe.dispose();
        }
        this.state.update((s) => { s.streamUrl = ""; });
        await super.dispose();
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
            ui.textDialog({ title: "VLC Error", text: message, readOnly: true });
        }
    };

    /** Surface the "File Explorer" nav button through PageToolbar's
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
                ...s,
                playerState,
                streamUrl: "",
            } as unknown as Record<string, unknown>,
        };
    }
}
