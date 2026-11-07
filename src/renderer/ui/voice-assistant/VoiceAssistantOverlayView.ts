import { EventEndpoint, type VoiceAssistantStatus } from "../../../ipc/api-types";
import { api } from "../../../ipc/renderer/api";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import { t } from "../../../shared/i18n/t";
import { getOverlayLayer } from "../../uikit/shared/overlayLayer";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import "./VoiceAssistantOverlayView.css";

/** Displays the main process's status for the focused normal window. */
export class VoiceAssistantOverlayView extends VanillaView<Record<string, never>> {
    private readonly label = document.createElement("div");
    private readonly request = document.createElement("div");
    private readonly reply = document.createElement("div");
    private readonly notice = document.createElement("div");
    private revision = 0;

    public constructor(props: Record<string, never>) {
        super(props);
        this.root.dataset.type = "voice-assistant-overlay";
        this.root.dataset.name = "voice-assistant-overlay";
        this.root.setAttribute("role", "status");
        this.root.setAttribute("aria-live", "polite");
        this.root.hidden = true;
        this.label.dataset.part = "label";
        this.request.dataset.part = "request";
        this.reply.dataset.part = "reply";
        this.notice.dataset.part = "notice";
        this.root.append(this.label, this.request, this.reply, this.notice);
    }

    protected onMount(): void {
        getOverlayLayer().append(this.root);
        this.own(rendererEvents[EventEndpoint.eVoiceAssistantStatus].subscribe((status) => {
            this.revision++;
            this.renderStatus(status);
        }));
        this.listen(window, "blur", () => { this.root.hidden = true; });
        const revision = this.revision;
        void api.voiceAssistantGetOwner().then(({ status }) => {
            if (!this.isDisposed && revision === this.revision) this.renderStatus(status);
        }).catch(() => {});
    }

    protected onDispose(): void { this.root.remove(); }

    private renderStatus(status: VoiceAssistantStatus | null): void {
        this.root.hidden = !status || !document.hasFocus();
        if (!status) return;
        this.root.dataset.state = status.state;
        this.label.textContent = t(`voiceAssistant.${status.state}`);
        this.request.textContent = status.requestText ?? "";
        this.reply.textContent = status.replyText ?? "";
        this.notice.textContent = status.notice ?? "";
        this.request.hidden = !status.requestText;
        this.reply.hidden = !status.replyText;
        this.notice.hidden = !status.notice;
    }
}
