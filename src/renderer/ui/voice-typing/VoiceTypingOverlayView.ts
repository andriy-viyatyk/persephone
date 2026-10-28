import { t } from "../../../shared/i18n/t";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { getOverlayLayer } from "../../uikit/shared/overlayLayer";
import "./VoiceTypingOverlayView.css";

/** Speech RMS rarely exceeds 0.4; this matches the Speech to Text board's recorder meter. */
const LEVEL_SCALE = 2.6;

export interface VoiceTypingOverlayState {
    status: "idle" | "starting" | "recording" | "transcribing";
    binding: string;
    translating: boolean;
    level: number;
    durationMs: number;
}

export class VoiceTypingOverlayView extends VanillaView<Record<string, never>> {
    private readonly label = document.createElement("span");
    private readonly details = document.createElement("span");
    private readonly meter = document.createElement("span");

    public constructor(props: Record<string, never>) {
        super(props, document.createElement("div"));
        this.root.className = "voice-typing-overlay";
        this.root.dataset.name = "voice-typing-overlay";
        this.root.setAttribute("aria-live", "polite");
        this.root.append(this.label, this.details, this.meter);
    }

    protected onMount(): void {
        getOverlayLayer().append(this.root);
    }

    protected onDispose(): void {
        this.root.remove();
    }

    public updateState(state: VoiceTypingOverlayState): void {
        this.root.hidden = state.status === "idle";
        if (state.status === "starting") {
            this.label.textContent = t("voiceTyping.starting");
            this.details.textContent = "";
            this.meter.hidden = true;
        } else if (state.status === "recording") {
            this.label.textContent = state.translating
                ? t("voiceTyping.translatingRecording", { binding: state.binding })
                : t("voiceTyping.recording", { binding: state.binding });
            this.details.textContent = t("voiceTyping.recordingDuration", { seconds: (state.durationMs / 1000).toFixed(0) });
            this.meter.hidden = false;
            this.meter.style.setProperty("--voice-typing-level", `${Math.max(0, Math.min(1, state.level * LEVEL_SCALE)) * 100}%`);
        } else if (state.status === "transcribing") {
            this.label.textContent = state.translating ? t("voiceTyping.translatingTranscribing") : t("voiceTyping.transcribing");
            this.details.textContent = "";
            this.meter.hidden = true;
        } else {
            this.label.textContent = "";
            this.details.textContent = "";
            this.meter.hidden = true;
        }
    }
}
