import { api } from "../../../../ipc/renderer/api";
import { t } from "../../../../shared/i18n/t";
import { EventEndpoint } from "../../../../ipc/api-types";
import rendererEvents from "../../../../ipc/renderer/renderer-events";
import { errMessage } from "../../../../shared/utils";
import { settings } from "../../../api/settings";
import { ButtonView } from "../../../uikit/Button/ButtonView";
import { CheckboxView } from "../../../uikit/Checkbox/CheckboxView";
import { InputView } from "../../../uikit/Input/InputView";
import { SelectView, type SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { PcmAudioCapture } from "../../../ui/speech/PcmAudioCapture";
import { WakeServiceProvider, type WakeDescription, type WakeEnrollment, type WakePhrase } from "../../../ui/voice-assistant/WakeServiceProvider";
import { createSectionRoot, panel, settingsFieldLabel, text } from "./settings-native";
import "../../../uikit/Button/Button.css";
import "../../../uikit/Checkbox/Checkbox.css";
import "../../../uikit/Select/Select.css";

interface Recording {
    cancelled: boolean;
    finish: () => void;
    capture?: PcmAudioCapture;
    stream?: MediaStream;
}

export class VoiceAssistantSectionView extends VanillaView<Record<string, never>> {
    private provider?: WakeServiceProvider;
    private description?: WakeDescription;
    private devices: MediaDeviceInfo[] = [];
    private phrases: WakePhrase[] = [];
    private results = new Map<string, WakeEnrollment>();
    private rejected: WakeEnrollment[] = [];
    private person = "";
    private recording?: Recording;
    private microphone?: SelectView<IListBoxItem>;
    private silence?: SelectView<IListBoxItem>;
    private threshold?: InputView;
    private enabled?: CheckboxView;
    private status = document.createElement("div");
    private enrollment = document.createElement("div");
    private list = document.createElement("div");
    private dynamicButtons: ButtonView[] = [];
    private deviceError = "";
    private providerError = "";
    private ttsMissing = false;
    private loopbackUnavailable = false;

    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        this.root.append(panel({ paddingBottom: "lg" }, text(t("settings.voiceAssistantTitle"), { bold: true, size: "sm" })), panel({ paddingBottom: "md" }, text(t("settings.voiceAssistantDescription"), { color: "light", size: "xs" })));
        this.enabled = this.child(new CheckboxView(this.enabledProps()));
        this.root.append(panel({ paddingBottom: "md" }, this.enabled.mount()));
        this.microphone = this.child(new SelectView(this.microphoneProps()));
        this.addRow(t("settings.voiceAssistantMicrophone"), this.microphone.mount());
        this.silence = this.child(new SelectView(this.silenceProps()));
        this.addRow(t("settings.voiceAssistantSilence"), this.silence.mount());
        this.threshold = this.child(new InputView({ size: "sm", width: 180, type: "number", min: 0, max: 1, step: 0.01, value: settings.get("voice-assistant.threshold") ?? "", placeholder: t("settings.voiceAssistantProviderDefault"), "aria-label": t("settings.voiceAssistantThreshold"), onChange: (value) => { const number = Number(value); if (!value.trim()) settings.set("voice-assistant.threshold", null); else if (Number.isFinite(number) && number >= 0 && number <= 1) settings.set("voice-assistant.threshold", number); } }));
        this.addRow(t("settings.voiceAssistantThreshold"), this.threshold.mount());
        this.root.append(this.status, panel({ paddingBottom: "md" }, text(t("settings.voiceAssistantEnroll"), { bold: true, size: "sm" })));
        const person = this.child(new InputView({ size: "sm", width: 180, value: this.person, placeholder: t("settings.voiceAssistantPersonPlaceholder"), "aria-label": t("settings.voiceAssistantPerson"), onChange: (value) => { this.person = value; } }));
        this.addRow(t("settings.voiceAssistantPerson"), person.mount());
        this.root.append(this.enrollment, this.list);
        this.renderEnrollment();
        this.own(settings.onChanged.subscribe(({ key }) => {
            if (key === "voice-assistant.enabled") this.enabled?.update(this.enabledProps());
            if (key === "voice-assistant.microphone") this.microphone?.update(this.microphoneProps());
            if (key === "voice-assistant.silence-ms") this.silence?.update(this.silenceProps());
            if (key === "voice-assistant.threshold" && this.threshold) this.threshold.inputElement.value = String(settings.get(key) ?? "");
        }));
        let statusRevision = 0;
        this.own(rendererEvents[EventEndpoint.eVoiceAssistantStatus].subscribe((status) => {
            statusRevision++;
            this.loopbackUnavailable = status?.notice?.includes(t("settings.voiceAssistantLoopbackUnavailable")) ?? false;
            this.renderStatus();
        }));
        void api.voiceAssistantGetOwner().then(({ status }) => {
            if (this.isDisposed || statusRevision) return;
            this.loopbackUnavailable = status?.notice?.includes(t("settings.voiceAssistantLoopbackUnavailable")) ?? false;
            this.renderStatus();
        }).catch(() => {});
        navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChange);
        this.own(() => navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChange));
        void this.refreshDevices();
        void this.refreshProvider();
    }

    protected onDispose(): void {
        if (this.recording) { this.recording.cancelled = true; this.recording.finish(); void this.recording.capture?.stop(); this.recording.stream?.getTracks().forEach((track) => track.stop()); }
        void api.voiceAssistantPause({ reason: "enrollment", active: false }).catch(() => {});
        this.provider?.dispose();
    }

    private addRow(label: string, control: HTMLElement): void { this.root.append(panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" }, settingsFieldLabel(label), control)); }
    private enabledProps() { return { checked: settings.get("voice-assistant.enabled"), onChange: (value: boolean) => settings.set("voice-assistant.enabled", value), children: t("settings.voiceAssistantEnabled") }; }
    private microphoneProps(): SelectViewProps<IListBoxItem> {
        const saved = settings.get("voice-assistant.microphone");
        const items: IListBoxItem[] = [{ value: "", label: t("settings.voiceAssistantDefaultMicrophone") }, ...this.devices.map((device, index) => ({ value: device.deviceId, label: device.label || t("settings.voiceAssistantUnnamedMicrophone", { number: index + 1 }) }))];
        if (saved && !items.some((item) => item.value === saved)) items.push({ value: saved, label: t("settings.voiceAssistantDeviceMissing", { device: saved }) });
        return { items, value: items.find((item) => item.value === saved) ?? items[0], onChange: (item) => settings.set("voice-assistant.microphone", String(item?.value ?? "")) };
    }
    private silenceProps(): SelectViewProps<IListBoxItem> {
        const items: IListBoxItem[] = [2000, 3000, 5000, 10000].map((value) => ({ value, label: t("settings.voiceTypingAutoStopSeconds", { seconds: value / 1000 }) }));
        return { items, value: items.find((item) => item.value === settings.get("voice-assistant.silence-ms")) ?? items[0], onChange: (item) => settings.set("voice-assistant.silence-ms", Number(item?.value ?? 2000)) };
    }
    private readonly onDeviceChange = (): void => { void this.refreshDevices(); };
    private async refreshDevices(): Promise<void> {
        try { this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput"); this.deviceError = ""; }
        catch (error) { this.deviceError = t("settings.voiceAssistantDevicesFailed", { error: errMessage(error) }); }
        if (!this.isDisposed) { this.microphone?.update(this.microphoneProps()); this.renderStatus(); }
    }
    private async refreshProvider(): Promise<void> {
        try {
            const [providers, tts] = await Promise.all([WakeServiceProvider.listProviders(), api.getBoardServiceProviders("speech.synthesize")]);
            if (this.isDisposed) return;
            this.ttsMissing = !tts.some((provider) => provider.version === 1);
            if (!providers.length) { this.providerError = t("settings.voiceAssistantWakeMissing"); this.renderStatus(); return; }
            const provider = new WakeServiceProvider(providers[0]);
            this.provider = provider;
            this.description = await provider.describe();
            this.phrases = await provider.list();
            this.providerError = "";
        } catch (error) { this.providerError = this.formatProviderError(error); }
        if (!this.isDisposed) { this.renderStatus(); this.renderEnrollment(); }
    }
    private formatProviderError(error: unknown): string {
        const code = (error as { code?: string })?.code;
        if (code === "provider-not-local") return t("settings.voiceAssistantProviderNotLocal");
        if (code === "not-ready") return t("settings.voiceAssistantProviderNotReady");
        if (code === "connection-refused") return t("settings.voiceAssistantProviderRefused");
        if (code === "no-enrollments") return t("settings.voiceAssistantNoEnrollments");
        return t("settings.voiceAssistantProviderFailed", { error: errMessage(error) });
    }
    private renderStatus(): void {
        this.status.replaceChildren();
        // Errors stand out; informational notices stay muted.
        const errors = [this.providerError, this.deviceError];
        const notices = [this.ttsMissing ? t("settings.voiceAssistantTtsMissing") : "", this.loopbackUnavailable ? t("settings.voiceAssistantLoopbackUnavailable") : "", this.description && !this.phrases.some((phrase) => phrase.samples.length) ? t("settings.voiceAssistantNoEnrollments") : ""];
        errors.filter(Boolean).forEach((message) => this.status.append(panel({ paddingBottom: "md" }, text(message, { color: "error", size: "sm" }))));
        notices.filter(Boolean).forEach((message) => this.status.append(panel({ paddingBottom: "md" }, text(message, { color: "warning", size: "xs" }))));
    }
    private addButton(host: HTMLElement, label: string, onClick: () => void, disabled = false, title?: string): void {
        const button = this.child(new ButtonView({ size: "sm", variant: "default", children: label, onClick, disabled, title }));
        this.dynamicButtons.push(button); host.append(button.mount());
    }
    private renderEnrollment(): void {
        this.dynamicButtons.forEach((button) => this.releaseChild(button)); this.dynamicButtons = [];
        this.enrollment.replaceChildren(); this.list.replaceChildren();
        const controls = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "md" });
        if (this.recording) {
            controls.append(text(t("settings.voiceAssistantRecording"), { size: "xs" }));
            this.addButton(controls, t("settings.voiceAssistantFinish"), () => this.recording?.finish());
            this.addButton(controls, t("settings.voiceAssistantCancel"), () => { if (this.recording) { this.recording.cancelled = true; this.recording.finish(); } });
        } else {
            this.addButton(controls, t("settings.voiceAssistantRecordWake"), () => { void this.record("wake"); }, !this.description);
            this.addButton(controls, t("settings.voiceAssistantRecordStop"), () => { void this.record("stop"); }, !this.description);
        }
        this.enrollment.append(controls);
        for (const phrase of this.phrases) {
            const kind = phrase.kind === "wake" ? t("settings.voiceAssistantWakeKind") : t("settings.voiceAssistantStopKind");
            // One compact row per person and kind: the label, then a small delete button per sample.
            const row = panel({ direction: "row", align: "center", gap: "sm", paddingBottom: "sm" });
            row.style.flexWrap = "wrap";
            const label = text(`${phrase.person} / ${kind}${phrase.phrase !== phrase.kind ? ` / ${phrase.phrase}` : ""}`, { bold: true, size: "xs" });
            label.style.minWidth = "160px";
            row.append(label);
            const results: string[] = [];
            phrase.samples.forEach((sample, index) => {
                const number = index + 1;
                const result = this.results.get(sample.sampleId);
                if (result) results.push(`${t("settings.voiceAssistantSample", { number })}: ${this.resultText(result)}`);
                this.addButton(row, `${number} ✕`, () => { void this.deleteSample(sample.sampleId); }, !!this.recording, t("settings.voiceAssistantDelete", { number }));
            });
            this.list.append(row);
            results.forEach((line) => this.list.append(panel({ paddingBottom: "sm" }, text(line, { color: "light", size: "xs" }))));
        }
        this.rejected.forEach((result) => this.list.append(panel({ paddingBottom: "md" }, text(this.resultText(result), { size: "xs" }))));
    }
    private resultText(result: WakeEnrollment): string {
        const reason = result.quality.reason;
        const reasonText = reason === "silence" ? t("settings.voiceAssistantReasonSilence") : reason === "short" ? t("settings.voiceAssistantReasonShort") : reason === "noise" ? t("settings.voiceAssistantReasonNoise") : reason;
        return `${result.quality.accepted ? t("settings.voiceAssistantQualityAccepted") : t("settings.voiceAssistantQualityRejected")}${reasonText ? `: ${reasonText}` : ""} - ${result.match === null ? t("settings.voiceAssistantFirstSample") : t("settings.voiceAssistantMatch", { score: result.match.toFixed(2) })}`;
    }
    private async deleteSample(id: string): Promise<void> {
        try { if (!this.provider) return; await this.provider.delete(id); this.results.delete(id); this.phrases = await this.provider.list(); this.providerError = ""; }
        catch (error) { this.providerError = this.formatProviderError(error); }
        if (!this.isDisposed) { this.renderStatus(); this.renderEnrollment(); }
    }
    private async record(kind: "wake" | "stop"): Promise<void> {
        const provider = this.provider, description = this.description;
        if (!provider || !description || this.recording) return;
        const person = this.person.trim() || t("settings.voiceAssistantPersonPlaceholder");
        let finish!: () => void;
        const done = new Promise<void>((resolve) => { finish = resolve; });
        const recording: Recording = { cancelled: false, finish };
        this.recording = recording; this.renderEnrollment();
        const chunks: ArrayBuffer[] = [];
        const limit = Math.floor(Math.min(description.maxEnrollMs, 2500) * 16) * 2;
        let bytes = 0;
        let capturing = true;
        try {
            await api.voiceAssistantPause({ reason: "enrollment", active: true });
            if (recording.cancelled || this.isDisposed) return;
            await api.armVoiceTypingMicrophone();
            try {
                const deviceId = settings.get("voice-assistant.microphone");
                recording.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
            } finally { await api.clearVoiceTypingMicrophone().catch(() => {}); }
            if (recording.cancelled || this.isDisposed) return;
            recording.capture = new PcmAudioCapture();
            await recording.capture.start(recording.stream, (chunk) => { const take = Math.min(chunk.byteLength, limit - bytes); if (take > 0) { chunks.push(chunk.slice(0, take)); bytes += take; } if (bytes >= limit) finish(); }, () => {});
            if (recording.cancelled || this.isDisposed) return;
            const timer = setTimeout(finish, Math.min(description.maxEnrollMs, 2500));
            await done; clearTimeout(timer);
            if (!recording.cancelled && !this.isDisposed) await recording.capture.flush();
            await recording.capture.stop();
            if (recording.cancelled || this.isDisposed) return;
            capturing = false;
            const pcm = new Uint8Array(bytes); let offset = 0;
            for (const chunk of chunks) { pcm.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
            chunks.length = 0;
            const result = await provider.enroll(pcm.buffer, { phrase: kind, kind, person });
            if (this.isDisposed) return;
            if (result.quality.accepted) this.results.set(result.sampleId, result); else this.rejected.push(result);
            this.phrases = await provider.list(); this.providerError = "";
        } catch (error) {
            if (!recording.cancelled && !this.isDisposed) this.providerError = capturing ? t("settings.voiceAssistantCaptureFailed", { error: errMessage(error) }) : this.formatProviderError(error);
        } finally {
            chunks.length = 0;
            await recording.capture?.stop(); recording.stream?.getTracks().forEach((track) => track.stop());
            await api.voiceAssistantPause({ reason: "enrollment", active: false }).catch(() => {});
            if (this.recording === recording) this.recording = undefined;
            if (!this.isDisposed) { this.renderStatus(); this.renderEnrollment(); void this.refreshDevices(); }
        }
    }
}
