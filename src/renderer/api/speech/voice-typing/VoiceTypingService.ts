import { errMessage } from "../../../../shared/utils";
import { api } from "../../../../ipc/renderer/api";
import rendererEvents from "../../../../ipc/renderer/renderer-events";
import { settings } from "../../settings";
import { ui } from "../../ui";
import { t } from "../../../../shared/i18n/t";
import {
    DEFAULT_VOICE_TYPING_SHORTCUT,
    DEFAULT_VOICE_TYPING_TRANSLATE_SHORTCUT,
    normalizeVoiceTypingShortcut,
} from "../../../../shared/voice-typing-shortcut";
import { toClipboard } from "../../../core/utils/utils";
import { TOneState } from "../../../core/state/state";
import { SpeechTranscriptionProvider } from "../SpeechTranscriptionProvider";
import { VoiceTypingSession, type VoiceTypingMode, type VoiceTypingSessionSnapshot } from "./VoiceTypingSession";

export interface VoiceTypingOverlayState {
    status: "idle" | "starting" | "recording" | "transcribing";
    binding: string;
    translating: boolean;
    level: number;
    durationMs: number;
}

const idleOverlayState = (): VoiceTypingOverlayState => ({
    status: "idle",
    binding: DEFAULT_VOICE_TYPING_SHORTCUT,
    translating: false,
    level: 0,
    durationMs: 0,
});

/** Renderer-lifetime owner for voice typing settings, shortcuts, notifications and sessions. */
export class VoiceTypingService {
    public readonly state = new TOneState<VoiceTypingOverlayState>(idleOverlayState());
    private shortcut = DEFAULT_VOICE_TYPING_SHORTCUT;
    private translateShortcut = DEFAULT_VOICE_TYPING_TRANSLATE_SHORTCUT;
    private session: VoiceTypingSession | undefined;
    private shortcutSubscription: (() => void) | undefined;
    private settingsSubscription: (() => void) | undefined;
    private providerDiscovery: SpeechTranscriptionProvider | undefined;
    private started = false;

    public start(): void {
        if (this.started) return;
        this.started = true;
        this.providerDiscovery = new SpeechTranscriptionProvider();
        this.shortcutSubscription = rendererEvents.eVoiceTypingShortcut.subscribe((event) => {
            if (event.action === "start") this.startSession(event.sessionId, event.mode ?? "transcribe");
            else if (event.action === "stop") this.stopSession(event.sessionId);
            else this.cancelSession(event.sessionId);
        });
        const subscriptions = [
            settings.watch("voice-typing.shortcut", () => { void this.sendShortcutConfig(); }),
            settings.watch("voice-typing.translate-shortcut", () => { void this.sendShortcutConfig(); }),
        ];
        this.settingsSubscription = () => subscriptions.forEach((dispose) => dispose());
        void api.setVoiceTypingState({ state: "idle" }).catch((error: unknown) => this.notifyFailure(error));
        void settings.wait().then(() => this.sendShortcutConfig()).catch((error: unknown) => this.notifyFailure(error));
    }

    public dispose(): void {
        this.providerDiscovery?.dispose();
        this.providerDiscovery = undefined;
        this.shortcutSubscription?.();
        this.settingsSubscription?.();
        this.shortcutSubscription = undefined;
        this.settingsSubscription = undefined;
        this.started = false;
        const session = this.session;
        if (session) void session.cancel();
    }

    private async sendShortcutConfig(): Promise<void> {
        this.shortcut = normalizeVoiceTypingShortcut(settings.get("voice-typing.shortcut")) ?? DEFAULT_VOICE_TYPING_SHORTCUT;
        this.translateShortcut = normalizeVoiceTypingShortcut(settings.get("voice-typing.translate-shortcut")) ?? DEFAULT_VOICE_TYPING_TRANSLATE_SHORTCUT;
        this.updateShortcutBinding();
        try {
            await api.setVoiceTypingConfig({ shortcut: this.shortcut, translateShortcut: this.translateShortcut });
        } catch (error: unknown) {
            this.notifyFailure(error);
        }
    }

    private startSession(sessionId: string, mode: VoiceTypingMode): void {
        if (this.session) return;
        const providerDiscovery = this.providerDiscovery;
        if (!providerDiscovery) return;
        const session = new VoiceTypingSession({
            id: sessionId,
            mode,
            providerDiscovery,
            getSilenceDuration: () => settings.get("voice-typing.auto-stop-silence-ms"),
            getInactivityDuration: () => settings.get("voice-typing.auto-stop-inactivity-ms"),
            insert: (id, text, deferClipboard) => api.insertVoiceTypingText({ sessionId: id, text, deferClipboard }),
            clipboard: toClipboard,
            isCurrent: (candidate) => this.session === candidate,
            onState: (snapshot) => this.updateSessionState(snapshot),
            onProcessState: (status) => {
                const state = status === "starting" ? "recording" : status;
                void api.setVoiceTypingState({ state }).catch((error: unknown) => this.notifyFailure(error));
            },
            onError: (code, error) => this.showError(code, error),
            onCopied: () => ui.notify(t("voiceTyping.copied"), "info"),
            onFinished: (finished) => { if (this.session === finished) this.session = undefined; },
        });
        this.session = session;
        session.start();
    }

    private stopSession(sessionId: string): void {
        if (this.session?.sessionId === sessionId) this.session.stop();
    }

    private cancelSession(sessionId: string): void {
        if (this.session?.sessionId === sessionId) void this.session.cancel();
    }

    private updateSessionState(snapshot: VoiceTypingSessionSnapshot): void {
        this.state.set({
            status: snapshot.status,
            binding: snapshot.mode === "translate" ? this.translateShortcut : this.shortcut,
            translating: snapshot.translating,
            level: snapshot.level,
            durationMs: snapshot.durationMs,
        });
    }

    private updateShortcutBinding(): void {
        const current = this.state.get();
        this.state.set({
            ...current,
            binding: this.session?.sessionMode === "translate"
                ? this.translateShortcut
                : this.shortcut,
        });
    }

    private notifyFailure(error: unknown): void {
        ui.notify(errMessage(error, t("voiceTyping.failed")), "error");
    }

    private showError(code: string, error?: unknown): void {
        if (code === "session-conflict") {
            ui.notify(t("voiceTyping.sessionConflict"), "warning");
            return;
        }
        const key = code === "missing-provider" ? "voiceTyping.missingProvider"
            : code === "not-ready" ? "voiceTyping.notReady"
                : code === "connection-refused" ? "voiceTyping.providerRefused"
                    : code === "NotAllowedError" || code === "permission-denied" ? "voiceTyping.permissionDenied"
                        : code === "too-long" ? "voiceTyping.tooLong"
                            : "voiceTyping.failed";
        const detail = error ? errMessage(error, "") : "";
        ui.notify(detail && key === "voiceTyping.failed" ? `${t(key)} ${detail}` : t(key), "warning");
    }
}

export const voiceTypingService = new VoiceTypingService();
