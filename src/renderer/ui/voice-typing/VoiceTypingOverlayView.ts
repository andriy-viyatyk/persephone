import { t } from "../../../shared/i18n/t";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { getOverlayLayer } from "../../uikit/shared/overlayLayer";
import "./VoiceTypingOverlayView.css";

export interface VoiceTypingOverlayState {
    status: "idle" | "recording" | "transcribing";
    binding: string;
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
        if (state.status === "recording") {
            this.label.textContent = t("voiceTyping.recording", { binding: state.binding });
            this.details.textContent = t("voiceTyping.recordingDuration", { seconds: (state.durationMs / 1000).toFixed(0) });
            this.meter.hidden = false;
            this.meter.style.setProperty("--voice-typing-level", `${Math.max(0, Math.min(1, state.level)) * 100}%`);
        } else if (state.status === "transcribing") {
            this.label.textContent = t("voiceTyping.transcribing");
            this.details.textContent = "";
            this.meter.hidden = true;
        } else {
            this.label.textContent = "";
            this.details.textContent = "";
            this.meter.hidden = true;
        }
    }
}
