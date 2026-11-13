import { openWindows } from "./open-windows";

export interface AudioCaptureCountSnapshot {
    count: number;
    revision: number;
}

let snapshot: AudioCaptureCountSnapshot = { count: 0, revision: 0 };
const listeners = new Set<() => void>();

export function getAudioCaptureCount(): AudioCaptureCountSnapshot {
    return { ...snapshot };
}

export function setAudioCaptureCount(count: number): void {
    const nextCount = Number.isSafeInteger(count) && count >= 0 ? count : 0;
    if (snapshot.count === nextCount) return;
    snapshot = { count: nextCount, revision: snapshot.revision + 1 };
    openWindows.send("eAudioCaptureCount", snapshot);
    for (const listener of listeners) listener();
}

export function subscribeAudioCaptureCount(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
