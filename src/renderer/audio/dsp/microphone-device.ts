/**
 * Resolves the real input device behind a microphone stream.
 *
 * Per-device settings (the resonance notch) are keyed by a real device id, but a stream opened on
 * the system default reports the pseudo-ids "default" or "communications". Chromium gives the
 * pseudo-device the same `groupId` as the physical device it points to, so match on that once,
 * right after the stream opens, and cache the answer for the stream's lifetime.
 */
const resolvedIds = new WeakMap<MediaStream, string>();
const PSEUDO_IDS = new Set(["default", "communications"]);

export async function resolveMicrophoneDevice(stream: MediaStream, enumerate: () => Promise<MediaDeviceInfo[]> = () => navigator.mediaDevices.enumerateDevices()): Promise<void> {
    const track = stream.getAudioTracks()[0]?.getSettings();
    if (!track?.deviceId) return;
    if (!PSEUDO_IDS.has(track.deviceId)) {
        resolvedIds.set(stream, track.deviceId);
        return;
    }
    const devices = await enumerate().catch((): MediaDeviceInfo[] => []);
    const match = devices.find((device) => device.kind === "audioinput" && !PSEUDO_IDS.has(device.deviceId) && !!device.groupId && device.groupId === track.groupId);
    if (match) resolvedIds.set(stream, match.deviceId);
}

/** The real device id for per-device settings, or undefined when it could not be resolved. */
export function microphoneDeviceId(stream: MediaStream): string | undefined {
    const resolved = resolvedIds.get(stream);
    if (resolved) return resolved;
    const id = stream.getAudioTracks()[0]?.getSettings().deviceId;
    return id && !PSEUDO_IDS.has(id) ? id : undefined;
}
