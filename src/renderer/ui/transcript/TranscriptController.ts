import type * as monaco from "monaco-editor";
import { api } from "../../../ipc/renderer/api";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { ui } from "../../api/ui";
import { liveSpeechSessionCoordinator } from "../speech/LiveSpeechSessionCoordinator";
import { PcmAudioCapture } from "../speech/PcmAudioCapture";
import { createSpeechServiceChannel, type SpeechServiceChannel } from "../speech/SpeechServiceChannel";
import { SpeechTranscriptionProvider } from "../speech/SpeechTranscriptionProvider";

export type TranscriptSource = "microphone" | "computer" | "both";
export interface TranscriptState { status: "idle" | "starting" | "recording" | "transcribing"; level: number }

interface SourceSession {
    kind: "microphone" | "computer";
    channel?: SpeechServiceChannel;
    capture?: PcmAudioCapture;
    sendQueue: Promise<void>;
    ended: boolean;
    terminal?: Promise<void>;
    resolveTerminal?: () => void;
    terminalReceived?: boolean;
    queuedChunks: number;
    level?: number;
}

export class TranscriptController {
    private readonly providers = new SpeechTranscriptionProvider();
    private readonly onState: (state: TranscriptState) => void;
    private readonly getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined;
    private readonly sources: SourceSession[] = [];
    private releaseLease: (() => void) | undefined;
    private finishing = false;
    private cancelled = false;
    private readonly pendingPorts = new Map<string, MessagePort>();
    private readonly portWaiters = new Map<string, (port: MessagePort) => void>();
    private channelSubscription: (() => void) | undefined;

    public constructor(getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined, onState: (state: TranscriptState) => void) {
        this.getEditor = getEditor;
        this.onState = onState;
    }

    public async start(source: TranscriptSource): Promise<void> {
        if (this.sources.length || this.finishing) return;
        if (source !== "microphone" && process.platform !== "win32") return;
        const releaseLease = liveSpeechSessionCoordinator.acquire("transcript");
        if (!releaseLease) { ui.notify(t("transcript.sessionConflict"), "warning"); return; }
        this.releaseLease = releaseLease;
        this.cancelled = false;
        this.finishing = false;
        this.lastLine = undefined;
        this.onState({ status: "starting", level: 0 });
        try {
            const providers = await this.providers.list();
            const provider = providers[0];
            if (!provider) throw new Error(t("transcript.missingProvider"));
            const supportsLive = await this.providers.supportsLive(provider);
            if (this.cancelled) return;
            if (!supportsLive) {
                ui.notify(t("transcript.liveRequired"), "warning");
                await this.finish();
                return;
            }
            const sourceKinds: Array<"microphone" | "computer"> = source === "both" ? ["computer", "microphone"] : [source === "computer" ? "computer" : "microphone"];
            this.channelSubscription = api.onBoardServiceChannel((boardId, channelId, port) => {
                if (!boardId.startsWith("voice-typing:")) return;
                const waiter = this.portWaiters.get(channelId);
                if (waiter) { this.portWaiters.delete(channelId); waiter(port); }
                else this.pendingPorts.set(channelId, port);
            });
            this.sources.push(...sourceKinds.map((kind): SourceSession => ({ kind, sendQueue: Promise.resolve(), ended: false, queuedChunks: 0 })));
            for (const item of this.sources) {
                await this.openChannel(item, provider.provider);
                if (this.cancelled) return;
                if (this.finishing) {
                    item.ended = true;
                    item.channel?.send({ type: "end" });
                }
            }
            if (this.finishing) { await Promise.all(this.sources.map((item) => item.terminal)); await this.finish(); return; }
            for (const item of this.sources) {
                await this.openCapture(item);
                if (this.cancelled) return;
            }
            if (!this.cancelled && !this.finishing) this.onState({ status: "recording", level: 0 });
        } catch (error: unknown) {
            ui.notify(errMessage(error, t("transcript.failed")), "warning");
            await this.cancel();
        }
    }

    public async stop(): Promise<void> {
        if (!this.sources.length && this.releaseLease) { await this.cancel(); return; }
        if (!this.sources.length || this.finishing) return;
        this.finishing = true;
        this.onState({ status: "transcribing", level: 0 });
        try {
            await Promise.all(this.sources.map(async (source) => {
                if (source.ended) return;
                await source.capture?.flush();
                await source.sendQueue;
                await source.capture?.stop();
                source.ended = true;
                source.channel?.send({ type: "end" });
            }));
            await Promise.all(this.sources.map((source) => source.terminal));
            await this.finish();
        } catch (error: unknown) {
            ui.notify(errMessage(error, t("transcript.failed")), "warning");
            await this.finish();
        }
    }

    public async cancel(): Promise<void> {
        this.cancelled = true;
        for (const source of this.sources) {
            try { source.channel?.send({ type: "cancel" }); } catch { /* provider may already be gone */ }
            source.channel?.close({ code: "cancelled", message: t("transcript.cancelled") });
        }
        await this.finish();
    }

    public dispose(): void {
        void this.cancel();
        this.providers.dispose();
    }

    private async openChannel(source: SourceSession, provider: string): Promise<void> {
        const channelId = await api.connectHostServiceChannel({
            provider,
            version: 1,
            openMessage: { type: "transcribe", format: { encoding: "pcm-s16le", sampleRate: 16_000, channels: 1 }, live: true },
        });
        source.channel = createSpeechServiceChannel(await this.waitForPort(channelId));
        source.terminal = new Promise<void>((resolve) => { source.resolveTerminal = resolve; });
        const ready = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(t("transcript.failed"))), 15_000);
            source.channel?.onMessage((message) => {
                if (!message || typeof message !== "object") return;
                const status = message as { type?: unknown; state?: unknown; message?: unknown };
                if (status.type === "status" && status.state === "listening") { clearTimeout(timeout); resolve(); }
                if (status.type === "error") { clearTimeout(timeout); reject(new Error(typeof status.message === "string" ? status.message : t("transcript.failed"))); }
            });
        });
        source.channel.onMessage((message) => {
            if (!message || typeof message !== "object") return;
            const value = message as { type?: unknown; state?: unknown; text?: unknown; message?: unknown; code?: unknown; utterance?: unknown };
            if (value.type === "segment" && typeof value.text === "string") this.append(value.text, source.kind, value.utterance);
            if (value.type === "result") {
                source.terminalReceived = true;
                source.resolveTerminal?.();
                if (this.sources.every((item) => item.terminalReceived)) void this.finish();
            }
            if (value.type === "error") {
                if (!this.cancelled) ui.notify(typeof value.message === "string" ? value.message : t("transcript.failed"), "warning");
                this.cancelled = true;
                source.resolveTerminal?.();
                void this.finish();
            }
        });
        source.channel.onClose(() => {
            source.resolveTerminal?.();
            if (!source.terminalReceived && !this.finishing && !this.cancelled) { this.cancelled = true; void this.finish(); }
        });
        await ready;
    }

    private async openCapture(source: SourceSession): Promise<void> {
        let stream: MediaStream | undefined;
        if (source.kind === "computer") {
            await api.armTranscriptLoopback();
            try {
                if (this.cancelled) return;
                stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
            } finally {
                await api.clearTranscriptLoopback().catch(() => {});
            }
            stream.getVideoTracks().forEach((track) => track.stop());
            stream.getAudioTracks().forEach((track) => { track.enabled = true; });
        } else {
            await api.armVoiceTypingMicrophone();
            try {
                if (this.cancelled) return;
                stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
            } finally {
                await api.clearVoiceTypingMicrophone().catch(() => {});
            }
        }
        // Stop may have finished the session while the permission prompt was open; nothing would own this stream.
        if (this.cancelled || this.finishing || !this.sources.includes(source)) { stream.getTracks().forEach((track) => track.stop()); return; }
        source.capture = new PcmAudioCapture();
        await source.capture.start(stream, (data) => {
            source.queuedChunks++;
            if (source.queuedChunks > 32) {
                ui.notify(t("transcript.backpressure"), "warning");
                void this.cancel();
                return;
            }
            source.sendQueue = source.sendQueue.then(async () => {
                if (source.ended || this.cancelled) return;
                if (!source.channel?.writable) await source.channel?.whenWritable();
                source.channel?.send({ type: "audio", data });
            }).catch((error: unknown) => {
                ui.notify(errMessage(error, t("transcript.failed")), "warning");
                void this.cancel();
            }).finally(() => { source.queuedChunks--; });
        }, (level) => {
            // In Both mode each source reports its own level; show the louder one so a silent source does not hide the other.
            source.level = level;
            const loudest = Math.max(...this.sources.map((item) => item.level ?? 0));
            if (!this.cancelled) this.onState({ status: this.finishing ? "transcribing" : "recording", level: loudest });
        });
    }

    private waitForPort(channelId: string): Promise<MessagePort> {
        const pending = this.pendingPorts.get(channelId);
        if (pending) { this.pendingPorts.delete(channelId); return Promise.resolve(pending); }
        return new Promise<MessagePort>((resolve, reject) => {
            const timer = setTimeout(() => { this.portWaiters.delete(channelId); reject(new Error("The speech provider channel did not reach the app window.")); }, 5000);
            this.portWaiters.set(channelId, (port) => { clearTimeout(timer); resolve(port); });
        });
    }

    /** The line the transcript last wrote, so later segments of the same utterance continue it. */
    private lastLine: { source: "microphone" | "computer"; utterance: unknown; versionId: number } | undefined;

    private append(rawText: string, source: "microphone" | "computer", utterance: unknown): void {
        const editor = this.getEditor();
        const model = editor?.getModel();
        const text = rawText.trim();
        if (!editor || !model || !text) return;
        const previousSelections = editor.getSelections();
        // Follow the transcript only while its last line is on screen. The scroll height includes Monaco's
        // space past the last line, so scrolling to it would leave just one line at the top.
        const lastLineVisible = editor.getVisibleRanges().some((range) => range.endLineNumber >= model.getLineCount());
        const value = model.getValue();
        const eol = model.getEOL();
        // Continue the line only while nothing else changed the document since this transcript's last write.
        const continues = this.lastLine !== undefined && this.lastLine.source === source && this.lastLine.utterance === utterance
            && this.lastLine.versionId === model.getAlternativeVersionId();
        const label = this.sources.length > 1 ? `${source === "microphone" ? t("transcript.me") : t("transcript.others")}: ` : "";
        const lineStart = value.length && !value.endsWith("\n") && !value.endsWith("\r") ? eol : "";
        const insert = continues ? ` ${text}` : `${lineStart}${label}${text}`;
        const position = model.getPositionAt(model.getValueLength());
        editor.pushUndoStop();
        editor.executeEdits("transcript", [{ range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column }, text: insert, forceMoveMarkers: true }]);
        editor.pushUndoStop();
        this.lastLine = { source, utterance, versionId: model.getAlternativeVersionId() };
        if (previousSelections) editor.setSelections(previousSelections);
        if (lastLineVisible) editor.revealLine(model.getLineCount());
    }

    private async finish(): Promise<void> {
        for (const source of this.sources.splice(0)) {
            await source.capture?.stop();
            source.channel?.close();
        }
        this.channelSubscription?.();
        this.channelSubscription = undefined;
        this.portWaiters.clear();
        this.pendingPorts.forEach((port) => port.close());
        this.pendingPorts.clear();
        await api.clearTranscriptLoopback().catch(() => {});
        await api.clearVoiceTypingMicrophone().catch(() => {});
        this.releaseLease?.();
        this.releaseLease = undefined;
        this.finishing = false;
        this.onState({ status: "idle", level: 0 });
    }
}
