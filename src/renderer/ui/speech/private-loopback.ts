import { api } from "../../../ipc/renderer/api";
import { PcmAudioCapture } from "./PcmAudioCapture";
import type { LoopbackLease } from "./LoopbackReference";

let requests: Promise<unknown> = Promise.resolve();

/** The guarded Transcript grant is also used by internal voice-typing references. */
export function openPrivateLoopback(context: AudioContext, borrowed?: MediaStream): Promise<LoopbackLease> {
    const request = requests.then(async (): Promise<LoopbackLease> => {
        let stream = borrowed;
        if (!stream) {
            try {
                await api.armTranscriptLoopback();
                stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
                stream.getVideoTracks().forEach((track) => track.stop());
                if (!stream.getAudioTracks().length) {
                    stream.getTracks().forEach((track) => track.stop());
                    throw new Error("Windows did not provide an audio track");
                }
            } finally { await api.clearTranscriptLoopback().catch(() => {}); }
        }
        const capture = new PcmAudioCapture();
        try { await capture.start(stream, () => {}, () => {}, context, undefined, undefined, undefined, !borrowed); }
        catch (error) { if (!borrowed) stream.getTracks().forEach((track) => track.stop()); throw error; }
        const track = stream.getAudioTracks()[0];
        return {
            context,
            subscribe: (callback, ended) => {
                const unsubscribe = capture.subscribeRaw(callback);
                track?.addEventListener("ended", ended);
                return () => { unsubscribe(); track?.removeEventListener("ended", ended); };
            },
            release: () => { void capture.stop(); },
        };
    });
    requests = request.catch((): undefined => undefined);
    return request;
}
