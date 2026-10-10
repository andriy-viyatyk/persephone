import { app } from "./app";
import { pagesModel } from "./pages";
import { errMessage } from "../../shared/utils";
import { t } from "../../shared/i18n/t";
import { api } from "../../ipc/renderer/api";
import color from "../theme/color";
import type { RecordingRegion } from "../../ipc/api-param-types";

export interface RecordingResult {
    path: string;
    durationMs: number;
    mimeType: string;
    width: number;
    height: number;
    stoppedBy: "user" | "agent" | "page-closed" | "window-close";
}
export interface WindowRecordingState {
    readonly status: "idle" | "ready" | "recording" | "paused";
    readonly elapsedMs: number;
    readonly region?: RecordingRegion;
    readonly last?: RecordingResult;
    readonly hideStatusChrome?: boolean;
}
interface Session {
    id: string;
    region: RecordingRegion;
    openPlayer: boolean;
    pageId?: string;
    target?: HTMLElement;
    media: MediaStream;
    output: MediaStream;
    video?: HTMLVideoElement;
    canvas?: HTMLCanvasElement;
    recorder?: MediaRecorder;
    mimeType?: string;
    width: number;
    height: number;
    chunkWrites: Promise<void>;
    cancelled?: boolean;
    stopPromise?: Promise<RecordingResult>;
    elapsedMs: number;
    startedAt?: number;
    missingSince?: number;
}

class WindowRecordingModel {
    private current: Session | undefined;
    private value: WindowRecordingState = { status: "idle", elapsedMs: 0 };
    /** Set by `start({ hideStatusChrome })` before capture begins; cleared when the session returns to idle. */
    private hideChrome = false;
    private readonly listeners = new Set<(state: WindowRecordingState) => void>();
    private timer: ReturnType<typeof setInterval> | undefined;
    // Subscribed per page/editor session, never at module load: this module is reached from `app`
    // (app → window → window-screen), so `pagesModel` may not be initialized yet at that point.
    private pageStateUnsubscribe: (() => void) | undefined;

    get state(): WindowRecordingState {
        return { ...this.value, ...(this.value.last ? { last: { ...this.value.last } } : {}) };
    }
    clearLast(filePath: string): void {
        if (this.value.last?.path !== filePath) return;
        this.setState({ status: "idle", elapsedMs: 0 });
    }
    subscribe(listener: (state: WindowRecordingState) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    }

    async prepare(region: RecordingRegion, openPlayer: boolean, hideStatusChrome = false): Promise<void> {
        if (this.current) throw new Error("A recording is already active or ready in this window.");
        let target: HTMLElement | undefined;
        let pageId: string | undefined;
        if (region !== "window") {
            const page = pagesModel.query.activePage;
            if (!page) throw new Error("There is no active page to record.");
            pageId = page.id;
            const slot = document.querySelector<HTMLElement>(`[data-name="page-slot"][data-page-id="${CSS.escape(pageId)}"]`);
            target = region === "page" ? slot ?? undefined : slot?.querySelector<HTMLElement>('[data-name="page-editor"]') ?? undefined;
            if (!target || !isVisible(target)) throw new Error(region === "page" ? "The active page is not visible." : "The active page has no visible editor area.");
        }
        let media: MediaStream | undefined;
        let extraTracks: MediaStreamTrack[] = [];
        let capture: Awaited<ReturnType<typeof api.startWindowRecording>> | undefined;
        try {
            if (hideStatusChrome) {
                // Hide before capture starts, so the first frame is already clean. Still idle here,
                // so publish directly: setState() treats idle as the end of a session.
                this.hideChrome = true;
                this.value = { ...this.value, hideStatusChrome: true };
                this.publish();
            }
            capture = await api.startWindowRecording({ region });
            media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
                chromeMediaSource: "desktop", chromeMediaSourceId: capture.chromeMediaSourceId, maxFrameRate: 30,
            } } as MediaTrackConstraints });
            const sourceTrack = media.getVideoTracks()[0];
            if (!sourceTrack) throw new Error("The window capture did not provide a video track.");
            let output = media;
            let video: HTMLVideoElement | undefined;
            let canvas: HTMLCanvasElement | undefined;
            // Decode the stream once to learn the real frame size: `track.getSettings()` can report
            // the capture's maximum size rather than the window's (seen live: 2560x1440 for a
            // 1296x968 window). Page/editor crops keep this element as their frame source; a
            // window recording only measures with it.
            video = document.createElement("video");
            video.muted = true;
            video.playsInline = true;
            video.srcObject = media;
            await video.play();
            await waitForFrameSize(video);
            let width = video.videoWidth;
            let height = video.videoHeight;
            if (region === "window") {
                video.pause();
                video.srcObject = null;
                video = undefined;
            } else {
                if (!target) throw new Error("The selected recording target is unavailable.");
                const rect = target.getBoundingClientRect();
                width = Math.max(2, Math.round(rect.width * video.videoWidth / window.innerWidth));
                height = Math.max(2, Math.round(rect.height * video.videoHeight / window.innerHeight));
                canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const canvasTrack = canvas.captureStream(30).getVideoTracks()[0];
                if (!canvasTrack) throw new Error("Could not create a recording canvas track.");
                extraTracks = [canvasTrack];
                if ("contentHint" in canvasTrack) canvasTrack.contentHint = "text";
                output = new MediaStream([canvasTrack]);
            }
            this.current = { id: capture.recordingId, region, openPlayer, pageId, target, media, output, video, canvas, width, height, chunkWrites: Promise.resolve(), elapsedMs: 0 };
            if (video && canvas) this.startFramePump(this.current);
            if (region !== "window") this.pageStateUnsubscribe = pagesModel.state.subscribe(() => this.checkBoundTarget());
            this.setState({ status: "ready", elapsedMs: 0, region });
        } catch (error: unknown) {
            this.current = undefined;
            media?.getTracks().forEach((track) => track.stop());
            extraTracks.forEach((track) => track.stop());
            if (capture) await api.cancelWindowRecording(capture.recordingId).catch((_error: unknown): void => undefined);
            this.setState({ status: "idle", elapsedMs: 0 });
            throw error;
        }
    }

    async start(region: RecordingRegion, options?: { openPlayer?: boolean; hideStatusChrome?: boolean }): Promise<void> {
        // A start refused because a recording is already running must leave that recording alone:
        // clean up only a session this call created.
        const existing = this.current;
        try {
            await this.prepare(region, options?.openPlayer ?? false, options?.hideStatusChrome ?? false);
            this.startPrepared();
            // Resolve once the recorder's `start` event has run, so `state` already reads "recording".
            const recorder = this.current?.recorder;
            if (recorder) await new Promise<void>((resolve) => {
                recorder.addEventListener("start", () => resolve(), { once: true });
                // `onerror` already cancels the session; do not wait for a start that never comes.
                recorder.addEventListener("error", () => resolve(), { once: true });
            });
        } catch (error: unknown) {
            app.ui.notify(t("api.recordingCouldNotStart", { error: errMessage(error) }), "error");
            if (this.current && this.current !== existing) await this.cancel();
            throw error;
        }
    }

    startPrepared(): void {
        const session = this.requireSession();
        const candidates = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"];
        session.mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
        const recorder = new MediaRecorder(session.output, { ...(session.mimeType ? { mimeType: session.mimeType } : {}), videoBitsPerSecond: 6_000_000 });
        session.recorder = recorder;
        session.mimeType = recorder.mimeType || session.mimeType || "video/webm";
        recorder.ondataavailable = (event) => {
            if (!event.data.size) return;
            session.chunkWrites = session.chunkWrites.then(async () => {
                // The recorder flushes a last chunk after cancel(), when main has already dropped the session.
                if (session.cancelled) return;
                const bytes = new Uint8Array(await event.data.arrayBuffer());
                await api.appendWindowRecordingChunk({ recordingId: session.id, chunk: bytes });
            });
        };
        recorder.onerror = (event) => { app.ui.notify(t("api.recordingFailed", { error: errMessage(event) }), "error"); void this.cancel(); };
        recorder.onstart = () => {
            session.startedAt = performance.now();
            this.setState({ status: "recording", elapsedMs: 0, region: session.region });
            this.timer = setInterval(() => this.refreshElapsed(), 200);
        };
        recorder.onpause = () => { this.pauseElapsed(session); this.setState({ status: "paused", elapsedMs: session.elapsedMs, region: session.region }); };
        recorder.onresume = () => { session.startedAt = performance.now(); this.setState({ status: "recording", elapsedMs: session.elapsedMs, region: session.region }); };
        try { recorder.start(1000); }
        catch (error: unknown) {
            app.ui.notify(t("api.recordingCouldNotStart", { error: errMessage(error) }), "error");
            void this.cancel();
            throw error;
        }
    }

    /** Resolves once the recorder has paused, so `state` already reads "paused". */
    pause(): Promise<void> { return this.switchRecorder("recording", "pause"); }
    /** Resolves once the recorder has resumed, so `state` already reads "recording". */
    resume(): Promise<void> { return this.switchRecorder("paused", "resume"); }

    private switchRecorder(from: RecordingState, to: "pause" | "resume"): Promise<void> {
        const recorder = this.requireSession().recorder;
        if (recorder?.state !== from) return Promise.resolve();
        return new Promise<void>((resolve) => {
            recorder.addEventListener(to, () => resolve(), { once: true });
            recorder[to]();
        });
    }

    async stop(stoppedBy: RecordingResult["stoppedBy"] = "agent"): Promise<RecordingResult> {
        const session = this.current;
        if (!session) {
            if (this.value.last) return { ...this.value.last };
            throw new Error("No recording is active.");
        }
        if (session.stopPromise) return session.stopPromise;
        session.stopPromise = this.finish(session, stoppedBy);
        return session.stopPromise;
    }

    async cancel(): Promise<void> {
        const session = this.current;
        if (!session) return;
        session.cancelled = true;
        this.current = undefined;
        this.stopTimer();
        this.unwatchPages();
        session.recorder?.stream.getTracks().forEach((track) => track.stop());
        session.media.getTracks().forEach((track) => track.stop());
        if (session.video) { session.video.pause(); session.video.srcObject = null; }
        await api.cancelWindowRecording(session.id).catch((error: unknown) => app.ui.notify(t("api.recordingCouldNotRemove", { error: errMessage(error) }), "error"));
        this.setState({ status: "idle", elapsedMs: 0 });
    }

    private async finish(session: Session, stoppedBy: RecordingResult["stoppedBy"]): Promise<RecordingResult> {
        const recorder = session.recorder;
        if (!recorder) { await this.cancel(); throw new Error("Recording has not started."); }
        this.pauseElapsed(session);
        let path: string;
        try {
            if (recorder.state !== "inactive") await new Promise<void>((resolve, reject) => {
                recorder.addEventListener("stop", () => resolve(), { once: true });
                recorder.addEventListener("error", () => reject(new Error("MediaRecorder failed to stop.")), { once: true });
                recorder.stop();
            });
            await session.chunkWrites;
            session.media.getTracks().forEach((track) => track.stop());
            session.output.getTracks().forEach((track) => track.stop());
            if (session.video) { session.video.pause(); session.video.srcObject = null; }
            this.stopTimer();
            const extension = session.mimeType?.includes("mp4") ? "mp4" : "webm";
            path = await api.finalizeWindowRecording({ recordingId: session.id, extension });
        } catch (error: unknown) {
            app.ui.notify(t("api.recordingCouldNotFinish", { error: errMessage(error) }), "error");
            await this.cancel();
            throw error;
        }
        const result: RecordingResult = { path, durationMs: session.elapsedMs, mimeType: session.mimeType ?? "video/webm", width: session.width, height: session.height, stoppedBy };
        this.current = undefined;
        this.unwatchPages();
        this.setState({ status: "idle", elapsedMs: 0, last: result });
        if (session.openPlayer) await pagesModel.openFile(path);
        return result;
    }

    private startFramePump(session: Session): void {
        const { video, canvas, target } = session;
        if (!video || !canvas || !target) return;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create the recording crop canvas.");
        const backgroundToken = color.background.default.slice(4, -1);
        const letterboxColor = getComputedStyle(document.documentElement).getPropertyValue(backgroundToken).trim();
        const draw = (): void => {
            if (this.current !== session) return;
            const rect = target.getBoundingClientRect();
            const frameWidth = video.videoWidth;
            const frameHeight = video.videoHeight;
            if (!isVisible(target) || !frameWidth || !frameHeight) {
                session.missingSince ??= performance.now();
                if (performance.now() - session.missingSince > 1500) {
                    if (session.recorder) void this.stop("page-closed").catch((_error: unknown): void => undefined);
                    else void this.cancel();
                    return;
                }
            } else {
                session.missingSince = undefined;
                const scaleX = frameWidth / window.innerWidth;
                const scaleY = frameHeight / window.innerHeight;
                const sx = Math.max(0, rect.left * scaleX);
                const sy = Math.max(0, rect.top * scaleY);
                const sw = Math.min(frameWidth - sx, rect.width * scaleX);
                const sh = Math.min(frameHeight - sy, rect.height * scaleY);
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.fillStyle = letterboxColor;
                context.fillRect(0, 0, canvas.width, canvas.height);
                const ratio = Math.min(canvas.width / sw, canvas.height / sh);
                const dw = sw * ratio;
                const dh = sh * ratio;
                context.drawImage(video, sx, sy, sw, sh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
            }
            video.requestVideoFrameCallback(draw);
        };
        video.requestVideoFrameCallback(draw);
    }

    private checkBoundTarget(): void {
        const session = this.current;
        if (session?.region !== "window" && session?.pageId && !pagesModel.query.findPage(session.pageId)) {
            if (session.recorder) void this.stop("page-closed").catch((_error: unknown): void => undefined);
            else void this.cancel();
        }
    }
    private refreshElapsed(): void {
        const session = this.current;
        if (session?.startedAt) this.setState({ status: "recording", elapsedMs: session.elapsedMs + performance.now() - session.startedAt, region: session.region });
    }
    private pauseElapsed(session: Session): void {
        if (session.startedAt) { session.elapsedMs += performance.now() - session.startedAt; session.startedAt = undefined; }
    }
    private unwatchPages(): void { this.pageStateUnsubscribe?.(); this.pageStateUnsubscribe = undefined; }
    private stopTimer(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
    private requireSession(): Session { if (!this.current) throw new Error("No recording is active."); return this.current; }
    private setState(state: WindowRecordingState): void {
        if (state.status === "idle") this.hideChrome = false;
        this.value = { ...state, hideStatusChrome: this.hideChrome, ...(state.last ? { last: { ...state.last } } : {}) };
        this.publish();
    }
    private publish(): void {
        for (const listener of this.listeners) listener(this.state);
    }
}

async function waitForFrameSize(video: HTMLVideoElement): Promise<void> {
    const deadline = performance.now() + 3000;
    while (!video.videoWidth || !video.videoHeight) {
        if (performance.now() > deadline) throw new Error("The window capture did not deliver a frame.");
        await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
    }
}

function isVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

export const windowRecording = new WindowRecordingModel();
