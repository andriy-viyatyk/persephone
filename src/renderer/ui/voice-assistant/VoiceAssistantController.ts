import { EventEndpoint, type VoiceAssistantStatus } from "../../../ipc/api-types";
import { api } from "../../../ipc/renderer/api";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import { t } from "../../../shared/i18n/t";
import { errMessage } from "../../../shared/utils";
import { settings } from "../../api/settings";
import { liveSpeechSessionCoordinator } from "../speech/LiveSpeechSessionCoordinator";
import { PcmAudioCapture } from "../speech/PcmAudioCapture";
import { SpeechTranscriptionProvider, type SpeechServiceChannel } from "../speech/SpeechTranscriptionProvider";
import { getVoiceRequestHandler } from "./VoiceAssistantHooks";
import { playVoiceAssistantTone } from "./VoiceAssistantTones";
import type { WakeEvent } from "./VoiceAssistantTypes";
import { WakeServiceProvider, type WakeListenHandle } from "./WakeServiceProvider";
import { CHANNEL_OPEN_TIMEOUT_MS, DELIVERY_ALLOWANCE_MS, LONGEST_PHRASE_MS, LOOPBACK_GATE_CLOSE_RMS, LOOPBACK_GATE_OPEN_RMS, LOOPBACK_LAG_MAX_MS, LOOPBACK_LEAD_MAX_MS, LOOPBACK_PREROLL_MS, LOOPBACK_TAIL_MS, MAX_QUEUED_CHUNKS, PROVIDER_RETRY_MS, STOP_HOLDBACK_MS } from "./voice-assistant-constants";

const RATE = 16000;
interface Chunk { data: ArrayBuffer; time: number }
interface Segment { sent: number; time: number }
interface Detection { event: WakeEvent; time: number }
interface Request {
    person: string; start: number; held: Chunk[]; channel?: SpeechServiceChannel; queue: Promise<void>; queued: number;
    ending: boolean; ready: boolean; segments: string[]; drafts: Map<string, string>; levels: { time: number; level: number }[];
    threshold?: number; quietSince?: number; lastSent: number; endBoundary?: number; timer?: ReturnType<typeof setTimeout>;
}

/** Owns capture only while this renderer is the eligible voice assistant owner. */
export class VoiceAssistantController {
    private disposed = false;
    private started = false;
    private generation = 0;
    private owner = false;
    private windowId?: number;
    private paused = false;
    private ready = false;
    private opening = false;
    private retry?: ReturnType<typeof setTimeout>;
    private decision?: ReturnType<typeof setTimeout>;
    private subscriptions: (() => void)[] = [];
    private wake?: WakeServiceProvider;
    private transcription?: SpeechTranscriptionProvider;
    private micChannel?: WakeListenHandle;
    private loopChannel?: WakeListenHandle;
    private mic?: PcmAudioCapture;
    private loop?: PcmAudioCapture;
    private micOrigin?: number;
    private micHistory: Chunk[] = [];
    private loopPreroll: Chunk[] = [];
    private loopSegments: Segment[] = [];
    private loopSamples = 0;
    private loopGate = false;
    private loopQuiet = 0;
    private loopHits: Detection[] = [];
    private recentDecision?: Detection;
    private pendingWake?: Detection;
    private pendingStop?: WakeEvent;
    private request?: Request;
    private handlerAbort?: AbortController;
    private status: VoiceAssistantStatus = { state: "off" };
    private notice = "";

    public start(): void {
        if (this.started || this.disposed) return;
        this.started = true;
        this.subscriptions.push(rendererEvents[EventEndpoint.eVoiceAssistantOwnerChanged].subscribe(({ windowId }) => { this.owner = this.windowId !== undefined && windowId === this.windowId; this.reconcile(); }));
        this.subscriptions.push(rendererEvents[EventEndpoint.eVoiceAssistantPause].subscribe(({ active }) => { this.paused = active; this.reconcile(); }));
        this.subscriptions.push(liveSpeechSessionCoordinator.subscribe(() => this.reconcile()));
        this.subscriptions.push(settings.onChanged.subscribe(({ key }) => { if (key.startsWith("voice-assistant.")) this.restart(); }));
        void Promise.all([settings.wait(), api.voiceAssistantGetOwner()]).then(([, owner]) => {
            if (this.disposed) return;
            this.windowId = owner.windowId; this.owner = owner.ownerWindowId === owner.windowId; this.paused = owner.paused; this.ready = true; this.reconcile();
        }).catch((error: unknown) => this.fail(error));
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe()); this.stop();
    }

    private eligible(): boolean { return !this.disposed && this.ready && this.owner && settings.get("voice-assistant.enabled") && !this.paused && !liveSpeechSessionCoordinator.isBusy(); }
    private reconcile(): void {
        if (!this.eligible()) {
            if (this.opening || this.wake || this.retry || this.status.state !== "off") this.stop();
            if (this.owner && settings.get("voice-assistant.enabled") && (this.paused || liveSpeechSessionCoordinator.isBusy())) this.publish({ state: "off", notice: t("settings.voiceAssistantPaused") });
            return;
        }
        if (!this.wake && !this.retry && !this.opening) { this.opening = true; void this.open(++this.generation); }
    }
    private restart(): void { this.stop(); this.reconcile(); }
    private valid(generation: number): boolean { return generation === this.generation && this.eligible(); }
    private publish(status: VoiceAssistantStatus): void { this.status = status; if (this.owner) void api.voiceAssistantStatus(status).catch(() => {}); }
    private update(status: Partial<VoiceAssistantStatus>): void { this.publish({ ...this.status, ...status, notice: status.notice ?? (this.notice || undefined) }); }

    private async open(generation: number): Promise<void> {
        try {
            const providers = await WakeServiceProvider.listProviders();
            if (!this.valid(generation)) return;
            if (!providers.length) throw new Error(t("settings.voiceAssistantWakeMissing"));
            const provider = new WakeServiceProvider(providers[0]); this.wake = provider;
            await provider.describe();
            const phrases = await provider.list();
            if (!this.valid(generation)) return;
            if (!phrases.some((phrase) => phrase.kind === "wake" && phrase.samples.length)) throw new Error(t("settings.voiceAssistantNoEnrollments"));
            const tts = await api.getBoardServiceProviders("speech.synthesize");
            if (!this.valid(generation)) return;
            this.notice = tts.some((item) => item.version === 1) ? "" : t("settings.voiceAssistantTtsMissing");
            const threshold = settings.get("voice-assistant.threshold") ?? undefined;
            const micChannel = await provider.listen(threshold);
            if (!this.valid(generation)) { micChannel.close(); return; }
            this.micChannel = micChannel;
            micChannel.onEvent((event) => this.onMicEvent(event));
            micChannel.onClose((reason) => { if (this.valid(generation)) this.fail(new Error(reason.message)); });
            this.transcription = new SpeechTranscriptionProvider();
            await api.armVoiceTypingMicrophone();
            let stream: MediaStream;
            try {
                const device = settings.get("voice-assistant.microphone");
                stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(device ? { deviceId: { exact: device } } : {}) } });
            } catch (error: unknown) {
                throw new Error(t("settings.voiceAssistantCaptureFailed", { error: errMessage(error) }));
            } finally { await api.clearVoiceTypingMicrophone().catch(() => {}); }
            if (!this.valid(generation)) { stream.getTracks().forEach((track) => track.stop()); return; }
            const capture = new PcmAudioCapture(); this.mic = capture;
            await capture.start(stream, (data, time) => this.onMicChunk({ data, time }), (level) => this.onMicLevel(level));
            if (!this.valid(generation)) { void capture.stop(); return; }
            this.publish({ state: "waiting", notice: this.notice || undefined });
            void this.openLoopback(provider, threshold, generation);
        } catch (error: unknown) { if (this.valid(generation)) this.fail(error); }
        finally { if (generation === this.generation) this.opening = false; }
    }

    private async openLoopback(provider: WakeServiceProvider, threshold: number | undefined, generation: number): Promise<void> {
        let stream: MediaStream | undefined;
        try {
            if (process.platform !== "win32") throw new Error("Unsupported platform");
            const channel = await provider.listen(threshold);
            if (!this.valid(generation)) { channel.close(); return; }
            this.loopChannel = channel;
            channel.onEvent((event) => this.onLoopEvent(event));
            channel.onClose((reason) => { if (this.valid(generation) && this.loopChannel === channel) this.fail(new Error(reason.message)); });
            await api.armTranscriptLoopback();
            try { stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }); }
            finally { await api.clearTranscriptLoopback().catch(() => {}); }
            stream.getVideoTracks().forEach((track) => track.stop());
            if (!stream.getAudioTracks().length) throw new Error("No loopback audio");
            if (!this.valid(generation)) { stream.getTracks().forEach((track) => track.stop()); return; }
            stream.getAudioTracks().forEach((track) => { track.onended = () => {
                if (!this.valid(generation) || this.loopChannel !== channel) return;
                this.loopChannel = undefined; channel.close(); void this.loop?.stop(); this.loop = undefined;
                this.notice = [this.notice, t("settings.voiceAssistantLoopbackUnavailable")].filter(Boolean).join(" "); this.update({});
            }; });
            const capture = new PcmAudioCapture(); this.loop = capture;
            await capture.start(stream, (data, time) => this.onLoopChunk({ data, time }), () => {});
            if (!this.valid(generation)) void capture.stop();
        } catch {
            stream?.getTracks().forEach((track) => track.stop());
            if (!this.valid(generation)) return;
            const channel = this.loopChannel; this.loopChannel = undefined; channel?.close();
            this.notice = [this.notice, t("settings.voiceAssistantLoopbackUnavailable")].filter(Boolean).join(" "); this.update({});
        }
    }

    private sendWake(channel: WakeListenHandle, chunk: Chunk, loop: boolean): void {
        const generation = this.generation;
        const queue = loop ? this.loopQueue : this.micQueue;
        if (queue.count >= MAX_QUEUED_CHUNKS) { this.fail(new Error("Wake channel backpressure")); return; }
        queue.count++;
        queue.promise = queue.promise.then(async () => {
            if (!channel.writable) await channel.whenWritable();
            if (!this.valid(generation)) return;
            if (loop && (this.loopSegments.length === 0 || queue.newSegment)) { this.loopSegments.push({ sent: this.loopSamples, time: chunk.time }); queue.newSegment = false; }
            channel.send(chunk.data);
            if (loop) this.loopSamples += chunk.data.byteLength / 2;
        }).catch((error: unknown) => { if (this.valid(generation)) this.fail(error); }).finally(() => { queue.count--; });
    }
    private micQueue = { promise: Promise.resolve(), count: 0, newSegment: false };
    private loopQueue = { promise: Promise.resolve(), count: 0, newSegment: false };
    private onMicChunk(chunk: Chunk): void {
        this.micOrigin ??= chunk.time;
        if (this.micChannel) this.sendWake(this.micChannel, chunk, false);
        this.micHistory.push(chunk);
        while (this.micHistory.length && chunk.time - this.micHistory[0].time > STOP_HOLDBACK_MS + LOOPBACK_LAG_MAX_MS + DELIVERY_ALLOWANCE_MS + 1000) this.micHistory.shift();
        const request = this.request;
        if (request && !request.ending) {
            request.held.push(chunk); this.drainHeld(request, chunk.time - STOP_HOLDBACK_MS);
            if (request.held.length > MAX_QUEUED_CHUNKS) this.requestFailed(request, new Error("Transcription capture buffer full"));
        }
    }
    private onLoopChunk(chunk: Chunk): void {
        const channel = this.loopChannel; if (!channel) return;
        const samples = new DataView(chunk.data); let energy = 0;
        for (let offset = 0; offset < samples.byteLength; offset += 2) { const value = samples.getInt16(offset, true) / 32768; energy += value * value; }
        const level = Math.sqrt(energy / Math.max(1, samples.byteLength / 2));
        const duration = chunk.data.byteLength / 2 / RATE * 1000;
        if (!this.loopGate) {
            this.loopPreroll.push(chunk);
            while (this.loopPreroll.length > 1 && chunk.time - this.loopPreroll[0].time >= LOOPBACK_PREROLL_MS) this.loopPreroll.shift();
            if (level < LOOPBACK_GATE_OPEN_RMS) return;
            this.loopGate = true; this.loopQuiet = 0;
            const first = this.loopPreroll.splice(0);
            for (let i = 0; i < first.length; i++) this.queueLoop(channel, first[i], i === 0);
        } else {
            this.queueLoop(channel, chunk, false);
            this.loopQuiet = level < LOOPBACK_GATE_CLOSE_RMS ? this.loopQuiet + duration : 0;
            if (this.loopQuiet >= LOOPBACK_TAIL_MS) this.loopGate = false;
        }
    }
    private queueLoop(channel: WakeListenHandle, chunk: Chunk, start: boolean): void {
        // A marker must travel with the queued chunk, not the current gate state.
        const queue = this.loopQueue; const generation = this.generation;
        if (queue.count >= MAX_QUEUED_CHUNKS) { this.fail(new Error("Loopback channel backpressure")); return; }
        queue.count++;
        queue.promise = queue.promise.then(async () => {
            if (!channel.writable) await channel.whenWritable();
            if (!this.valid(generation)) return;
            if (start) this.loopSegments.push({ sent: this.loopSamples, time: chunk.time });
            while (this.loopSegments.length > 1 && chunk.time - this.loopSegments[1].time > 10000) this.loopSegments.shift();
            channel.send(chunk.data); this.loopSamples += chunk.data.byteLength / 2;
        }).catch((error: unknown) => { if (this.valid(generation)) this.fail(error); }).finally(() => { queue.count--; });
    }
    private loopTime(ms: number): number | undefined {
        const sample = ms * RATE / 1000;
        const segment = [...this.loopSegments].reverse().find((item) => item.sent <= sample);
        return segment && segment.time + (sample - segment.sent) * 1000 / RATE;
    }
    private matches(mic: Detection, loop: Detection): boolean {
        if (mic.event.person !== loop.event.person || mic.event.phrase !== loop.event.phrase) return false;
        const delta = loop.time - mic.time;
        console.debug("Voice assistant wake timing", { micTime: mic.time, loopTime: loop.time, delta, micScore: mic.event.score, loopScore: loop.event.score });
        return delta >= -LOOPBACK_LEAD_MAX_MS && delta <= LOOPBACK_LAG_MAX_MS;
    }
    private onLoopEvent(event: WakeEvent): void {
        if (event.type !== "wake") return;
        const time = this.loopTime(event.time); if (time === undefined) return;
        const hit = { event, time }; this.loopHits.push(hit);
        this.loopHits = this.loopHits.filter((item) => time - item.time < 10000);
        if (this.recentDecision && this.matches(this.recentDecision, hit)) console.debug("Voice assistant late loopback detection");
    }
    private onMicEvent(event: WakeEvent): void {
        if (this.micOrigin === undefined) return;
        if (event.type === "stop" && this.request && !this.request.ending) {
            const boundary = this.micOrigin + Math.max(0, event.start ?? event.time - LONGEST_PHRASE_MS);
            void this.endRequest(this.request, boundary); return;
        }
        if (event.type === "stop" && this.pendingWake) { this.pendingStop = event; return; }
        if (event.type !== "wake" || this.status.state !== "waiting" || this.pendingWake) return;
        const hit = { event, time: this.micOrigin + event.time }; this.pendingWake = hit;
        this.decision = setTimeout(() => {
            this.decision = undefined; this.pendingWake = undefined; this.recentDecision = hit;
            if (this.loopHits.some((loop) => this.matches(hit, loop))) { this.pendingStop = undefined; return; }
            this.beginRequest(hit);
            const stop = this.pendingStop; this.pendingStop = undefined;
            if (stop) this.onMicEvent(stop);
        }, LOOPBACK_LAG_MAX_MS + DELIVERY_ALLOWANCE_MS);
    }

    private beginRequest(hit: Detection): void {
        if (!this.eligible() || this.status.state !== "waiting") return;
        const request: Request = { person: hit.event.person, start: hit.time, held: [], queue: Promise.resolve(), queued: 0, ending: false, ready: false, segments: [], drafts: new Map(), levels: [], lastSent: hit.time };
        this.request = request;
        for (const chunk of this.micHistory) {
            const skip = Math.max(0, Math.min(chunk.data.byteLength / 2, Math.ceil((hit.time - chunk.time) * RATE / 1000)));
            if (skip * 2 < chunk.data.byteLength) request.held.push({ data: chunk.data.slice(skip * 2), time: chunk.time + skip * 1000 / RATE });
        }
        this.publish({ state: "listening", requestText: "", notice: this.notice || undefined }); playVoiceAssistantTone(true);
        void this.openTranscription(request);
    }
    private async openTranscription(request: Request): Promise<void> {
        const generation = this.generation;
        try {
            const provider = this.transcription; if (!provider) throw new Error(t("voiceTyping.missingProvider"));
            const selected = (await provider.list())[0]; if (!selected) throw new Error(t("voiceTyping.missingProvider"));
            const live = await provider.supportsLive(selected).catch(() => false) ?? false;
            if (!this.valid(generation) || this.request !== request) return;
            const channel = await provider.open(selected, live);
            if (!this.valid(generation) || this.request !== request) { channel.close(); return; }
            request.channel = channel;
            channel.onMessage((message) => this.onTranscript(request, message));
            channel.onClose((reason) => { if (this.request === request) this.requestFailed(request, new Error(reason.message)); });
            request.timer = setTimeout(() => this.requestFailed(request, new Error("Transcription provider did not become ready")), CHANNEL_OPEN_TIMEOUT_MS);
        } catch (error: unknown) { if (this.request === request) this.requestFailed(request, error); }
    }
    private drainHeld(request: Request, before: number): void {
        if (!request.channel || !request.ready) return;
        while (request.held.length) {
            const chunk = request.held[0];
            const samples = Math.max(0, Math.min(chunk.data.byteLength / 2, Math.floor((before - chunk.time) * RATE / 1000)));
            if (!samples) break;
            request.held.shift();
            if (samples * 2 < chunk.data.byteLength) request.held.unshift({ data: chunk.data.slice(samples * 2), time: chunk.time + samples * 1000 / RATE });
            request.lastSent = chunk.time + samples * 1000 / RATE;
            this.queueAudio(request, chunk.data.slice(0, samples * 2));
        }
    }
    private queueAudio(request: Request, data: ArrayBuffer): void {
        const channel = request.channel; if (!channel) return;
        if (request.queued >= MAX_QUEUED_CHUNKS) { this.requestFailed(request, new Error("Transcription channel backpressure")); return; }
        request.queued++;
        request.queue = request.queue.then(async () => { if (!channel.writable) await channel.whenWritable(); if (this.request === request) channel.send({ type: "audio", data }); }).catch((error: unknown) => { if (this.request === request) this.requestFailed(request, error); }).finally(() => { request.queued--; });
    }
    private async endRequest(request: Request, boundary = Infinity): Promise<void> {
        if (this.request !== request || request.ending) return;
        request.ending = true; request.endBoundary = boundary;
        if (boundary < request.lastSent) console.debug("Voice assistant stop boundary arrived after audio was sent", { boundary, sentUntil: request.lastSent });
        this.drainHeld(request, boundary);
        if (request.ready) await this.finishSending(request);
    }
    private async finishSending(request: Request): Promise<void> {
        const channel = request.channel; if (!channel) return;
        // If opening finished after stop, the held tail still needs its selected boundary.
        this.drainHeld(request, request.endBoundary ?? Infinity); request.held = [];
        await request.queue;
        if (this.request !== request) return;
        try { if (!channel.writable) await channel.whenWritable(); if (this.request !== request) return; channel.send({ type: "end" }); request.timer = setTimeout(() => this.requestFailed(request, new Error("Transcription timed out")), CHANNEL_OPEN_TIMEOUT_MS); }
        catch (error: unknown) { this.requestFailed(request, error); }
    }
    private onTranscript(request: Request, message: unknown): void {
        if (this.request !== request || !message || typeof message !== "object") return;
        const value = message as { type?: string; state?: string; text?: string; utterance?: string | number; startMs?: number; endMs?: number; message?: string };
        const id = value.utterance === undefined ? "" : String(value.utterance);
        if (value.type === "status" && value.state === "listening" && !request.ready) {
            request.ready = true; if (request.timer) clearTimeout(request.timer); request.timer = undefined;
            if (request.ending) void this.finishSending(request);
            else this.drainHeld(request, performance.now() - STOP_HOLDBACK_MS);
        } else if (value.type === "draft" && typeof value.text === "string") { request.drafts.set(id, value.text); this.showDraft(request); }
        else if (value.type === "segment" && typeof value.text === "string") {
            request.drafts.delete(id); if (value.text.trim()) request.segments.push(value.text.trim());
            if (typeof value.startMs === "number" && typeof value.endMs === "number") {
                const levels = request.levels.filter((item) => item.time >= request.start + value.startMs! && item.time <= request.start + value.endMs!).map((item) => item.level).sort((a, b) => a - b);
                if (levels.length) request.threshold = Math.max(0.005, levels[Math.floor(levels.length / 2)] * 0.2);
            }
            this.showDraft(request);
        } else if (value.type === "result" && typeof value.text === "string") this.completeRequest(request, value.text.trim());
        else if (value.type === "error") this.requestFailed(request, new Error(value.message ?? "Transcription failed"));
    }
    private showDraft(request: Request): void { this.update({ requestText: [...request.segments, ...request.drafts.values()].filter(Boolean).join(" ") }); }
    private onMicLevel(level: number): void {
        const request = this.request; if (!request || request.ending) return;
        const now = performance.now(); request.levels.push({ time: now, level });
        while (request.levels.length && now - request.levels[0].time > 30000) request.levels.shift();
        if (!request.segments.length || request.drafts.size || request.threshold === undefined) { request.quietSince = undefined; return; }
        if (level >= request.threshold) request.quietSince = undefined;
        else { request.quietSince ??= now; if (now - request.quietSince >= settings.get("voice-assistant.silence-ms")) void this.endRequest(request); }
    }
    private requestFailed(request: Request, error: unknown): void {
        if (this.request !== request) return;
        this.clearRequest(request); this.publish({ state: "waiting", notice: errMessage(error) });
    }
    private clearRequest(request: Request): void {
        this.request = undefined; if (request.timer) clearTimeout(request.timer); request.held = []; request.channel?.close();
    }
    private completeRequest(request: Request, text: string): void {
        this.clearRequest(request);
        if (!text) { this.publish({ state: "waiting", notice: this.notice || undefined }); return; }
        playVoiceAssistantTone(false);
        const handler = getVoiceRequestHandler();
        if (!handler) { this.publish({ state: "waiting", requestText: text, notice: this.notice || undefined }); return; }
        const abort = new AbortController(); this.handlerAbort = abort;
        this.publish({ state: "thinking", requestText: text, notice: this.notice || undefined });
        void Promise.resolve().then(() => handler.handle({ text, person: request.person }, {
            signal: abort.signal,
            setReply: (replyText) => { if (this.handlerAbort === abort && !abort.signal.aborted) this.update({ replyText }); },
            setSpeaking: (on) => { if (this.handlerAbort === abort && !abort.signal.aborted) this.update({ state: on ? "speaking" : "thinking" }); },
        })).then(() => { if (this.handlerAbort === abort && !abort.signal.aborted) { this.handlerAbort = undefined; this.update({ state: "waiting" }); } }, (error: unknown) => { if (this.handlerAbort === abort && !abort.signal.aborted) { this.handlerAbort = undefined; this.update({ state: "waiting", notice: errMessage(error) }); } });
    }
    private fail(error: unknown): void {
        if (this.disposed) return;
        const code = (error as { code?: string })?.code;
        const notice = code === "provider-not-local" ? t("settings.voiceAssistantProviderNotLocal")
            : code === "not-ready" ? t("settings.voiceAssistantProviderNotReady")
            : code === "connection-refused" ? t("settings.voiceAssistantProviderRefused")
            : code === "no-enrollments" ? t("settings.voiceAssistantNoEnrollments")
            : errMessage(error);
        this.stop();
        if (!this.eligible()) return;
        this.publish({ state: "off", notice });
        this.retry = setTimeout(() => { this.retry = undefined; this.reconcile(); }, PROVIDER_RETRY_MS);
    }
    private stop(): void {
        this.generation++; this.opening = false;
        if (this.retry) clearTimeout(this.retry); this.retry = undefined;
        if (this.decision) clearTimeout(this.decision); this.decision = undefined; this.pendingWake = undefined; this.pendingStop = undefined;
        this.handlerAbort?.abort(); this.handlerAbort = undefined;
        if (this.request) this.clearRequest(this.request);
        const mic = this.mic, loop = this.loop; this.mic = undefined; this.loop = undefined;
        void mic?.stop(); void loop?.stop();
        this.micChannel = undefined; this.loopChannel = undefined; this.wake?.dispose(); this.wake = undefined;
        this.transcription?.dispose(); this.transcription = undefined;
        this.micOrigin = undefined; this.micHistory = []; this.loopPreroll = []; this.loopSegments = []; this.loopSamples = 0; this.loopGate = false; this.loopQuiet = 0; this.loopHits = []; this.recentDecision = undefined;
        this.micQueue = { promise: Promise.resolve(), count: 0, newSegment: false }; this.loopQueue = { promise: Promise.resolve(), count: 0, newSegment: false };
        this.notice = ""; this.publish({ state: "off" });
    }
}
