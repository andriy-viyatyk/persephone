import { webContents, type WebContents } from "electron";
import { OneShotFrameGrant } from "./one-shot-frame-grant";

// Grant window and cleanup grace period; keep both values aligned across grant kinds.
const MEDIA_GRANT_TTL_MS = 5000;
const MEDIA_GRANT_CLEANUP_DELAY_MS = 5100;

let audioWindowTargetResolver: () => WebContents | undefined = () => undefined;

export function configureAudioWindowTargetResolver(resolver: () => WebContents | undefined): void {
    audioWindowTargetResolver = resolver;
}

export const recordingGrant = new OneShotFrameGrant({
    ttlMs: MEDIA_GRANT_TTL_MS,
    cleanupDelayMs: MEDIA_GRANT_CLEANUP_DELAY_MS,
    bindFrame: false,
});

export const voiceTypingGrant = new OneShotFrameGrant({
    ttlMs: MEDIA_GRANT_TTL_MS,
    cleanupDelayMs: MEDIA_GRANT_CLEANUP_DELAY_MS,
    bindFrame: false,
    resolveTarget: (id) => webContents.fromId(id),
    listenForDestroyed: true,
    clearExpiredHas: false,
    clearBeforeTargetResolution: true,
});

export const transcriptLoopbackGrant = new OneShotFrameGrant({
    ttlMs: MEDIA_GRANT_TTL_MS,
    cleanupDelayMs: MEDIA_GRANT_CLEANUP_DELAY_MS,
    bindFrame: true,
    platform: "win32",
    resolveTarget: (id) => webContents.fromId(id),
    listenForDestroyed: true,
    clearBeforePlatformCheck: true,
});

export const audioWindowMicrophoneGrant = new OneShotFrameGrant({
    ttlMs: MEDIA_GRANT_TTL_MS,
    cleanupDelayMs: MEDIA_GRANT_CLEANUP_DELAY_MS,
    bindFrame: true,
    listenForDestroyed: true,
    validateTarget: (target) => target === audioWindowTargetResolver(),
    validateBeforeClear: true,
});

export const audioWindowLoopbackGrant = new OneShotFrameGrant({
    ttlMs: MEDIA_GRANT_TTL_MS,
    cleanupDelayMs: MEDIA_GRANT_CLEANUP_DELAY_MS,
    bindFrame: true,
    platform: "win32",
    listenForDestroyed: true,
    validateTarget: (target) => target === audioWindowTargetResolver(),
    validateBeforeClear: true,
});

export function armRecordingMediaGrant(webContentsId: number): void {
    recordingGrant.arm(webContentsId);
}

export function clearRecordingMediaGrant(webContentsId: number): void {
    recordingGrant.clear(webContentsId);
}

export function armVoiceTypingMediaGrant(webContentsId: number): void {
    voiceTypingGrant.arm(webContentsId);
}

export function clearVoiceTypingMediaGrant(webContentsId: number): void {
    voiceTypingGrant.clear(webContentsId);
}

export function armTranscriptLoopbackGrant(webContentsId: number): void {
    transcriptLoopbackGrant.arm(webContentsId);
}

export function clearTranscriptLoopbackGrant(webContentsId: number): void {
    transcriptLoopbackGrant.clear(webContentsId);
}

export function armAudioMicrophoneGrant(target: WebContents): void {
    audioWindowMicrophoneGrant.arm(target);
}

export function armAudioLoopbackGrant(target: WebContents): void {
    audioWindowLoopbackGrant.arm(target);
}

export function clearAudioCaptureGrants(target?: WebContents): void {
    audioWindowMicrophoneGrant.clear(target);
    audioWindowLoopbackGrant.clear(target);
}
