import { withEditorGuideHelp } from "./editor-guide-help";
import type { IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import { ui } from "../../api/ui";
import type { VideoEditor } from "../../editors/video/VideoEditor";
import { createElements } from "ai-vision/dom";
import { activatePageAndWaitForLayout, pageScopeSelector } from "../ai-vision/page-elements";

const VIDEO_ELEMENTS = [
    { name: "video-url-input", purpose: "Enter a video URL, local source, or cURL request.", where: "top of the Video toolbar" },
    { name: "video-open-vlc", purpose: "Open the current source in VLC when browser playback is unavailable.", where: "below the video player, when VLC fallback is available" },
] as const;

const VIDEO_EDITOR_MEMBERS: readonly IAiMember[] = [
    { name: "id", kind: "property", summary: "The concrete current editor id." },
    { name: "name", kind: "property", summary: "The editor's registry display name." },
    { name: "source", kind: "property", summary: "The raw submitted source URL or path, or undefined before a source is submitted." },
    { name: "format", kind: "property", summary: "The detected source format: mp4, m3u8, or audio." },
    { name: "playerState", kind: "property", summary: "The current player lifecycle state, including loading, unsupported format, and error." },
    { name: "pageMuted", kind: "property", summary: "The model's persistent page/session mute state." },
    { name: "mediaMounted", kind: "property", summary: "Whether this page currently has a mounted active video or audio element." },
    { name: "duration", kind: "property", summary: "The live media duration in seconds, or undefined before mount, metadata, or for a non-finite duration." },
    { name: "currentTime", kind: "property", summary: "The live media current time in seconds, or undefined before mount." },
    { name: "paused", kind: "property", summary: "Whether the live media element is paused, or undefined before mount." },
    { name: "volume", kind: "property", summary: "The live media volume from 0 to 1, or undefined before mount." },
    { name: "muted", kind: "property", summary: "Whether the live media element is muted, or undefined before mount." },
    { name: "playbackRate", kind: "property", summary: "The live media playback rate, or undefined before mount." },
    { name: "submitUrl", kind: "method", signature: "submitUrl(text: string): Promise<void>", summary: "Submit a URL, local source, or cURL request and load it as the new source.", caution: "replaces the current source and starts loading a new one" },
    { name: "play", kind: "method", signature: "play(): Promise<void>", summary: "Start playback on the mounted active media element; may start playback from a page that is not on screen.", caution: "changes audible playback and may affect an open page that is not on screen" },
    { name: "pause", kind: "method", signature: "pause(): void", summary: "Pause playback on the mounted active media element.", caution: "changes audible playback" },
    { name: "seek", kind: "method", signature: "seek(time: number): void", summary: "Set the current time on the mounted active media element; may affect a page that is not on screen.", caution: "changes audible playback and may affect an open page that is not on screen" },
    { name: "toggleMute", kind: "method", signature: "toggleMute(): void", summary: "Toggle the page/session mute state for audio playback.", caution: "changes audible playback" },
    { name: "openInVlc", kind: "method", signature: "openInVlc(): Promise<void>", summary: "Open the current source in the external VLC player.", caution: "launches an external player" },
];

const VIDEO_EDITOR_HELP = `Access via pages[i].editor after narrowing editor.id to "video-view".
Read-mostly video and audio facade with source/model state and live HTMLMediaElement values. source,
format, playerState, and pageMuted are model values; live duration, currentTime, paused, volume, muted,
and playbackRate are synchronous browser
values from the active media element. They return undefined before the view hands off a media element
and after it is cleared, and duration is undefined before finite metadata is available. mediaMounted
is the corresponding null check. Model-backed actions do not require a mounted media element;
play() rejects and pause()/seek() throw "Media action requires a mounted media element" when none is
available.

elements is the page-scoped curated inventory of video-url-input and video-open-vlc. VLC controls are
conditional; hidden controls remain in the inventory with visible: false. Native/video.js controls,
structural roots, status labels, transient
menus, tracks, and subtitles are not surfaced. The page-tab popup menu owns standard Pin, Close,
Duplicate, and Open in New Window actions. There is no video-specific onGetMenuItems contribution;
the base content-host menu remains page-owned. VLC failures open the read-only VLC Error text
dialog.

The facade never activates or switches pages for commands, so play() and seek() can affect audible
playback on an open page that is not on screen; their
caution metadata calls this out. Reading properties and elements does not activate a page, while
highlight activates the owning page and waits for its layout before drawing.`;

/** Safe read-mostly facade around VideoEditor for script access. */
export class VideoEditorFacade implements IAiVisible {
    constructor(private readonly editor: VideoEditor, readonly id: string, readonly name: string) {}

    get aiVision(): IAiVisionDescriptor {
        const pageId = this.editor.page?.id;
        const elements = createElements(VIDEO_ELEMENTS, ui.highlightElement.bind(ui), {
            scopeSelector: pageId ? pageScopeSelector(pageId) : undefined,
            beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
        });
        return {
            kind: "VideoEditor",
            summary: "Read-mostly video and audio facade with live playback properties when media is mounted.",
            members: [...VIDEO_EDITOR_MEMBERS, ...elements.members],
            help: withEditorGuideHelp(this.id, VIDEO_EDITOR_HELP),
            elements: VIDEO_ELEMENTS,
            provide: elements.provide,
            summarize: () => ({
                kind: "VideoEditor",
                id: this.id,
                name: this.name,
                source: this.source,
                format: this.format,
                playerState: this.playerState,
                mediaMounted: this.mediaMounted,
            }),
        };
    }

    get source(): string | undefined {
        return this.editor.state.get().url || undefined;
    }

    get format(): "mp4" | "m3u8" | "audio" {
        return this.editor.state.get().format;
    }

    get playerState(): "stopped" | "loading" | "playing" | "paused" | "unsupported format" | "error" {
        return this.editor.state.get().playerState;
    }

    get pageMuted(): boolean {
        return this.editor.state.get().pageMuted;
    }

    get mediaMounted(): boolean {
        return this.editor.activeMediaElement !== null;
    }

    get duration(): number | undefined {
        const media = this.editor.activeMediaElement;
        if (!media || !Number.isFinite(media.duration)) return undefined;
        return media.duration;
    }

    get currentTime(): number | undefined {
        return this.editor.activeMediaElement?.currentTime;
    }

    get paused(): boolean | undefined {
        return this.editor.activeMediaElement?.paused;
    }

    get volume(): number | undefined {
        return this.editor.activeMediaElement?.volume;
    }

    get muted(): boolean | undefined {
        return this.editor.activeMediaElement?.muted;
    }

    get playbackRate(): number | undefined {
        return this.editor.activeMediaElement?.playbackRate;
    }

    submitUrl(text: string): Promise<void> {
        if (!text.trim()) {
            throw new Error("Video editor action unavailable: submitUrl requires a non-empty URL, path, or cURL request.");
        }
        return this.editor.submitUrl(text);
    }

    play(): Promise<void> {
        const media = this.editor.activeMediaElement;
        if (!media) return Promise.reject(this.missingMediaError());
        return media.play();
    }

    pause(): void {
        this.requireMediaElement().pause();
    }

    seek(time: number): void {
        const media = this.requireMediaElement();
        media.currentTime = time;
    }

    toggleMute(): void {
        this.editor.toggleMuteAll();
    }

    openInVlc(): Promise<void> {
        if (!this.source) {
            throw new Error("Video editor action unavailable: openInVlc requires a submitted URL.");
        }
        return this.editor.openInVlc();
    }

    private requireMediaElement(): HTMLMediaElement {
        const media = this.editor.activeMediaElement;
        if (!media) throw this.missingMediaError();
        return media;
    }

    private missingMediaError(): Error {
        return new Error("Media action requires a mounted media element");
    }
}
