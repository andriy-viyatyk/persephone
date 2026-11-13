import type * as monaco from "monaco-editor";
import { api } from "../../../ipc/renderer/api";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { ui } from "../../api/ui";
import { liveSpeechSessionCoordinator } from "../../api/speech/LiveSpeechSessionCoordinator";
import { MicrophoneCapture, TranscriptDisplayCapture } from "../../api/speech/MicrophoneCapture";
import { SpeechSessionClient } from "../../api/speech/SpeechSessionClient";
import { SpeechTranscriptionProvider } from "../../api/speech/SpeechTranscriptionProvider";
import { PcmAudioCapture } from "../../audio/dsp/PcmAudioCapture";

export type TranscriptSource = "microphone" | "computer" | "both";
export interface TranscriptState { status: "idle" | "starting" | "recording" | "transcribing"; level: number }

interface SourceSession {
    kind: "microphone" | "computer";
    speech?: SpeechSessionClient;
    capture?: PcmAudioCapture;
    stream?: MediaStream;
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
    private audioContext: AudioContext | undefined;

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
            const provider = (await this.providers.list())[0];
            if (!provider) throw new Error(t("transcript.missingProvider"));
            const supportsLive = await this.providers.supportsLive(provider);
            if (this.cancelled) return;
            if (!supportsLive) {
                ui.notify(t("transcript.liveRequired"), "warning");
                await this.finish();
                return;
            }
            const kinds: Array<"microphone" | "computer"> = source === "both" ? ["computer", "microphone"] : [source === "computer" ? "computer" : "microphone"];
            this.sources.push(...kinds.map((kind): SourceSession => ({ kind, sendQueue: Promise.resolve(), ended: false, queuedChunks: 0 })));
            for (const item of this.sources) {
                await this.openChannel(item, provider.provider);
                if (this.cancelled || !this.sources.includes(item)) return;
                if (this.finishing) { item.ended = true; item.speech?.end(); }
            }
            if (this.finishing) { await Promise.all(this.sources.map((item) => item.terminal)); await this.finish(); return; }
            this.audioContext = new AudioContext();
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
            const ordered = [...this.sources].sort((left, right) => left.kind === right.kind ? 0 : left.kind === "microphone" ? -1 : 1);
            for (const source of ordered) {
                if (source.ended) continue;
                await source.capture?.flush();
                await source.sendQueue;
                await source.capture?.stop();
                source.ended = true;
                source.speech?.end();
            }
            await Promise.all(this.sources.map((source) => source.terminal));
            await this.finish();
        } catch (error: unknown) {
            ui.notify(errMessage(error, t("transcript.failed")), "warning");
            await this.finish();
        }
    }

    public async cancel(): Promise<void> {
        this.cancelled = true;
        for (const source of this.sources) source.speech?.cancel("cancelled", t("transcript.cancelled"));
        await this.finish();
    }

    public dispose(): void {
        void this.cancel();
        this.providers.dispose();
    }

    private async openChannel(source: SourceSession, provider: string): Promise<void> {
        source.terminal = new Promise<void>((resolve) => { source.resolveTerminal = resolve; });
        source.speech = new SpeechSessionClient({
            provider,
            live: true,
            translate: false,
            isCurrent: () => !this.cancelled && this.sources.includes(source),
            timeoutError: () => new Error("The speech provider channel did not reach the app window."),
            onSegment: ({ text, utterance }) => this.append(text, source.kind, utterance),
            onResult: () => {
                source.terminalReceived = true;
                source.resolveTerminal?.();
                if (this.sources.every((item) => item.terminalReceived)) void this.finish();
            },
            onError: ({ message }) => {
                if (!this.cancelled) ui.notify(message ?? t("transcript.failed"), "warning");
                this.cancelled = true;
                source.resolveTerminal?.();
                void this.finish();
            },
            onClose: () => {
                source.resolveTerminal?.();
                if (!source.terminalReceived && !this.finishing && !this.cancelled) { this.cancelled = true; void this.finish(); }
            },
        });
        await source.speech.open();
        if (!this.sources.includes(source) || this.cancelled) return;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(t("transcript.failed"))), 15_000);
            source.speech?.accepted.then(() => { clearTimeout(timeout); resolve(); }, (error: Error) => { clearTimeout(timeout); reject(error); });
        });
    }

    private async openCapture(source: SourceSession): Promise<void> {
        const isCurrent = (): boolean => !this.cancelled && !this.finishing && this.sources.includes(source);
        if (source.kind === "computer") {
            const stream = await TranscriptDisplayCapture.open(isCurrent);
            if (!stream) return;
            if (!isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return; }
            source.stream = stream;
            const capture = new PcmAudioCapture();
            source.capture = capture;
            await capture.start({ stream, onChunk: (data) => this.queueAudio(source, data), onLevel: (level) => this.updateLevel(source, level), sharedContext: this.audioContext });
        } else {
            const opened = await MicrophoneCapture.open({
                purpose: "transcript",
                isCurrent,
                sharedContext: this.audioContext,
                borrowedLoopbackStream: this.sources.find((item) => item.kind === "computer")?.stream,
                onChunk: (data) => this.queueAudio(source, data),
                onLevel: (level) => this.updateLevel(source, level),
                onFailed: () => { void this.cancel(); },
            });
            if (!opened) return;
            source.capture = opened.capture;
            source.stream = opened.stream;
        }
    }

    private queueAudio(source: SourceSession, data: ArrayBuffer): void {
        source.queuedChunks++;
        if (source.queuedChunks > 32) {
            ui.notify(t("transcript.backpressure"), "warning");
            void this.cancel();
            return;
        }
        source.sendQueue = source.sendQueue.then(async () => {
            if (source.ended || this.cancelled) return;
            await source.speech?.sendAudio(data);
        }).catch((error: unknown) => {
            ui.notify(errMessage(error, t("transcript.failed")), "warning");
            void this.cancel();
        }).finally(() => { source.queuedChunks--; });
    }

    private updateLevel(source: SourceSession, level: number): void {
        source.level = level;
        const loudest = Math.max(...this.sources.map((item) => item.level ?? 0));
        if (!this.cancelled) this.onState({ status: this.finishing ? "transcribing" : "recording", level: loudest });
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
        for (const source of this.sources.splice(0).sort((left, right) => left.kind === right.kind ? 0 : left.kind === "microphone" ? -1 : 1)) {
            await source.capture?.stop();
            source.speech?.close();
            if (source.kind === "computer") source.stream?.getTracks().forEach((track) => track.stop());
        }
        await this.audioContext?.close().catch(() => {});
        this.audioContext = undefined;
        await api.clearTranscriptLoopback().catch(() => {});
        await api.clearVoiceTypingMicrophone().catch(() => {});
        this.releaseLease?.();
        this.releaseLease = undefined;
        this.finishing = false;
        this.onState({ status: "idle", level: 0 });
    }
}
