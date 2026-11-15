import { app } from "../../api/app";
import { windowRecording, type WindowRecordingState } from "../../api/window-recording";
import type { IconName } from "../../theme/icon-registry";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";

interface RecordingParts {
    dot: HTMLSpanElement;
    elapsed: HTMLSpanElement;
    start: HTMLButtonElement;
    cancel: HTMLButtonElement;
    pause: HTMLButtonElement;
    resume: HTMLButtonElement;
    stop: HTMLButtonElement;
}

export class RecordingControlsView extends VanillaView<object> {
    private parts: RecordingParts | undefined;
    private hiddenChromeState: { hidden: HTMLElement["hidden"]; display: string } | undefined;

    public constructor(props: object) {
        super(props, document.createElement("div"));
        this.root.className = "recording-controls";
        this.root.dataset.name = "window-recording-controls";
        this.root.hidden = true;
    }

    protected onMount(): void {
        this.own(windowRecording.subscribe((state) => this.updateRecordingControls(state)));
    }

    /** Built once and updated in place: the elapsed timer ticks every 200 ms, and rebuilding the
     *  buttons on each tick would swallow a click whose target is replaced mid-press. */
    private updateRecordingControls(state: WindowRecordingState): void {
        const restoringChrome = !state.hideStatusChrome && this.hiddenChromeState !== undefined;
        if (state.hideStatusChrome && !this.hiddenChromeState) {
            this.hiddenChromeState = { hidden: this.root.hidden, display: this.root.style.display };
        } else if (!state.hideStatusChrome && this.hiddenChromeState) {
            const previous = this.hiddenChromeState;
            this.hiddenChromeState = undefined;
            this.root.hidden = previous.hidden;
            this.root.style.display = previous.display;
        }
        const parts = this.parts ??= this.buildRecordingControls();
        if (!restoringChrome) this.root.hidden = state.status === "idle";
        this.root.dataset.status = state.status;
        const seconds = Math.floor(state.elapsedMs / 1000);
        parts.elapsed.textContent = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
        parts.start.hidden = parts.cancel.hidden = state.status !== "ready";
        parts.pause.hidden = state.status !== "recording";
        parts.resume.hidden = state.status !== "paused";
        parts.stop.hidden = state.status !== "recording" && state.status !== "paused";
        if (this.hiddenChromeState) this.root.hidden = true;
    }

    private buildRecordingControls(): RecordingParts {
        const dot = document.createElement("span");
        dot.dataset.name = "recording-indicator";
        const elapsed = document.createElement("span");
        elapsed.dataset.name = "recording-elapsed";
        const parts = {
            dot,
            elapsed,
            start: this.recordingButton("recording-start", "circle", t("shell.start"), () => this.startPreparedRecording()),
            cancel: this.recordingButton("recording-cancel", "close", t("common.cancel"), () => { void windowRecording.cancel(); }),
            pause: this.recordingButton("recording-pause", "pause", t("shell.pause"), () => { void windowRecording.pause(); }),
            resume: this.recordingButton("recording-resume", "play", t("shell.resume"), () => { void windowRecording.resume(); }),
            stop: this.recordingButton("recording-stop", "stop", t("shell.stop"), () => {
                void windowRecording.stop("user").catch((error: unknown) => app.ui.notify(t("shell.recordingFinishFailed", { error: errMessage(error) }), "error"));
            }),
        };
        this.root.append(dot, elapsed, parts.start, parts.pause, parts.resume, parts.stop, parts.cancel);
        return parts;
    }

    private recordingButton(name: string, icon: IconName, label: string, action: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.name = name;
        button.title = label;
        const text = document.createElement("span");
        text.textContent = label;
        button.append(createIconElement(icon), text);
        this.listen(button, "click", action);
        return button;
    }

    private startPreparedRecording(): void {
        try { windowRecording.startPrepared(); }
        catch (error: unknown) {
            void windowRecording.cancel();
            app.ui.notify(t("shell.recordingStartFailed", { error: errMessage(error) }), "error");
        }
    }
}
