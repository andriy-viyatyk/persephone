import { t } from "../../../shared/i18n/t";
import { settings } from "../../api/settings";
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { TextareaView } from "../../uikit/Textarea/TextareaView";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { PageToolbarView, type PageToolbarViewProps } from "../base/PageToolbarView";
import { EditorStatusBarView } from "../base/EditorStatusBarView";
import type { EditorModel } from "../base/EditorModel";
import { VideoEditor } from "./VideoEditor";
import { app } from "../../api/app";
import { errMessage } from "../../../shared/utils";
import type { PlayerState, VideoFormat } from "./video-types";
import { VPlayerView, type VPlayerProps } from "./VPlayer";
import "../../uikit/Button/Button.css";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "../../uikit/Textarea/Textarea.css";
import "./video-editor.css";

interface VideoSurfaceState {
    url: string;
    streamUrl: string;
    inputText: string;
    format: VideoFormat;
    muted: boolean;
    parsedRequest: ParsedHttpRequest | null;
    playerState: PlayerState;
    reloadKey: number;
}

function requireVideoModel(model: EditorModel): VideoEditor {
    if (!(model instanceof VideoEditor)) throw new Error("Video view received an invalid model.");
    return model;
}

export class VideoEditorView extends VanillaView<{ model: EditorModel }> {
    private model: VideoEditor;
    private pageToolbar!: PageToolbarView;
    private toolbarChildren!: HTMLDivElement;
    private urlInput!: TextareaView;
    private playerArea!: HTMLDivElement;
    private player!: VPlayerView;
    private prompt!: HTMLSpanElement;
    private stateBadge!: HTMLSpanElement;
    private vlcContainer!: HTMLDivElement;
    private vlcButton!: ButtonView;
    private saveRecordingButton!: ButtonView;
    private discardRecordingButton!: ButtonView;
    private recordingActions!: HTMLDivElement;
    private shuffle = false;

    public constructor(props: { model: EditorModel }) {
        super(props, createPanelElement({
            name: "video-player",
            direction: "column",
            height: "100%",
            background: "dark",
            overflow: "hidden",
        }));
        this.root.dataset.editor = "video";
        this.model = requireVideoModel(props.model);
    }

    protected onMount(): void {
        const state = this.surfaceState();
        this.toolbarChildren = createPanelElement({
            direction: "row",
            align: "center",
            gap: "sm",
            flex: 1,
            minWidth: 0,
        });
        this.urlInput = this.child(new TextareaView(this.urlInputProps(state.inputText)));
        // A fixed one-line slot keeps the toolbar height; the input is positioned inside it and,
        // when focused, grows downward over the player instead of pushing the layout.
        const urlSlot = document.createElement("div");
        urlSlot.dataset.part = "video-url-slot";
        urlSlot.append(this.urlInput.root);
        this.listen(this.urlInput.root, "focus", () => { urlSlot.dataset.expanded = "true"; });
        this.listen(this.urlInput.root, "blur", () => {
            delete urlSlot.dataset.expanded;
            this.urlInput.root.scrollTop = 0;
            this.urlInput.root.scrollLeft = 0;
        });
        this.toolbarChildren.append(urlSlot);
        this.recordingActions = document.createElement("div");
        this.recordingActions.dataset.name = "temporary-recording-actions";
        this.recordingActions.className = "video-recording-actions";
        this.saveRecordingButton = this.child(new ButtonView({ name: "video-recording-save", variant: "default", icon: "save", children: t("editors.saveAsEllipsis"), onClick: () => { void this.runTemporaryAction(this.model.saveTemporaryRecording); } }));
        this.discardRecordingButton = this.child(new ButtonView({ name: "video-recording-discard", variant: "default", icon: "delete", children: t("editors.discard"), onClick: () => { void this.runTemporaryAction(this.model.discardTemporaryRecording); } }));
        this.recordingActions.append(this.saveRecordingButton.root, this.discardRecordingButton.root);
        this.toolbarChildren.append(this.recordingActions);

        this.pageToolbar = this.child(new PageToolbarView(this.pageToolbarProps()));
        this.playerArea = createPanelElement({
            name: "video-player-area",
            direction: "column",
            flex: 1,
            align: "center",
            justify: "center",
            position: "relative",
            overflow: "hidden",
        });

        this.player = this.child(new VPlayerView(this.playerProps(state)));
        this.prompt = createTextElement(t("editors.enterVideoUrlToStart"), {
            color: "light",
            size: "md",
        });
        this.prompt.dataset.part = "video-prompt";
        this.stateBadge = createTextElement(state.playerState, { color: "light", size: "sm" });
        this.stateBadge.dataset.part = "video-state-badge";
        this.vlcContainer = document.createElement("div");
        this.vlcContainer.dataset.part = "video-vlc-container";
        this.vlcButton = this.child(new ButtonView({
            name: "video-open-vlc",
            variant: "link",
            icon: "vlc",
            children: t("editors.openInVlc"),
            onClick: this.model.openInVlc,
        }));
        this.vlcContainer.append(this.vlcButton.root);

        const statusBar = this.child(new EditorStatusBarView({ name: "video-status-bar", model: this.model }));
        this.root.append(this.pageToolbar.root, this.playerArea, statusBar.root);
        this.playerArea.append(this.player.root, this.prompt, this.stateBadge, this.vlcContainer);
        this.pageToolbar.mount();
        statusBar.mount();
        this.urlInput.mount();
        this.player.mount();
        this.vlcButton.mount();
        this.saveRecordingButton.mount();
        this.discardRecordingButton.mount();

        this.bind(
            this.model.state,
            (current) => ({
                url: current.url,
                streamUrl: current.streamUrl,
                inputText: current.inputText,
                format: current.format,
                muted: current.pageMuted,
                parsedRequest: current.parsedRequest,
                playerState: current.playerState,
                reloadKey: current.reloadKey,
            }),
            this.syncSurface,
        );

        this.shuffle = settings.get("audio-shuffle") === true;
        const settingsSubscription = settings.onChanged.subscribe(({ key, value }) => {
            if (key !== "audio-shuffle") return;
            this.shuffle = value === true;
            this.player.update(this.playerProps(this.surfaceState()));
        });
        this.own(settingsSubscription);
    }

    protected onUpdate(props: { model: EditorModel }): void {
        const nextModel = requireVideoModel(props.model);
        if (nextModel !== this.model) {
            throw new Error("Video view model identity cannot change while the view is mounted.");
        }
        this.syncSurface(this.surfaceState());
    }

    private surfaceState(): VideoSurfaceState {
        const state = this.model.state.get();
        return {
            url: state.url,
            streamUrl: state.streamUrl,
            inputText: state.inputText,
            format: state.format,
            muted: state.pageMuted,
            parsedRequest: state.parsedRequest,
            playerState: state.playerState,
            reloadKey: state.reloadKey,
        };
    }

    private pageToolbarProps(): PageToolbarViewProps {
        return {
            name: "video-toolbar",
            model: this.model,
            noSpacer: true,
            borderBottom: true,
            overflowVisible: true,
            children: this.toolbarChildren,
        };
    }

    private urlInputProps(value: string) {
        return {
            name: "video-url-input",
            value,
            onChange: this.model.setInputText,
            placeholder: t("editors.videoUrlOrCurl", { shortcut: "Enter" }),
            singleLine: true,
            onKeyDown: (event: KeyboardEvent) => {
                if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey) {
                    event.preventDefault();
                    void this.model.submitUrl(this.model.state.get().inputText);
                }
            },
            minHeight: 28,
            size: "sm" as const,
        };
    }

    private playerProps(state: VideoSurfaceState): VPlayerProps {
        return {
            src: state.streamUrl,
            format: state.format,
            muted: state.muted,
            parsedRequest: state.parsedRequest,
            sourceUrl: state.url,
            reloadKey: state.reloadKey,
            onStateChange: this.model.onPlayerStateChange,
            onMutedChange: this.model.onMutedChange,
            onEnded: this.model.playNext,
            hasNext: this.model.canPlayNext,
            shuffle: this.shuffle,
            onNext: this.model.playNext,
            onToggleShuffle: this.model.toggleShuffle,
            onMediaElementChange: this.model.setMediaElement,
        };
    }

    private readonly syncSurface = (state: VideoSurfaceState): void => {
        this.urlInput.update(this.urlInputProps(state.inputText));
        this.player.update(this.playerProps(state));
        this.prompt.hidden = Boolean(state.url);
        const showBadge = !["playing", "paused", "stopped"].includes(state.playerState);
        this.stateBadge.textContent = state.playerState;
        this.stateBadge.hidden = !showBadge;
        const showVlcButton = Boolean(state.url)
            && !["loading", "playing", "stopped"].includes(state.playerState);
        this.vlcContainer.hidden = !showVlcButton;
        this.recordingActions.hidden = !this.model.isTemporaryRecording;
        this.pageToolbar.update(this.pageToolbarProps());
    };

    private async runTemporaryAction(action: () => Promise<void>): Promise<void> {
        try { await action(); }
        catch (error: unknown) { app.ui.notify(t("editors.recordingActionFailed", { error: errMessage(error) }), "error"); }
    }
}
