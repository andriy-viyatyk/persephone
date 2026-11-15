import { settings } from "../settings";
import type { MicrophoneCleaningOptions } from "../../../shared/microphone-cleaning-types";
import { AUDIO_RETRY, AUDIO_SETTINGS_DEVICES, AUDIO_STATUS, AUDIO_STATUS_GET } from "../../../ipc/audio-channels";
import type { AudioDevice, AudioProcessingMode, AudioProcessingStatus } from "../../../ipc/audio-channels";
import type { PcmAudioCapture } from "../../audio/dsp/PcmAudioCapture";
import { microphoneDeviceId } from "../../audio/dsp/microphone-device";

export interface MicrophoneSettingsDevice { deviceId: string; label: string; isDefault: boolean }

export const microphoneSettings = {
    async listDevices(): Promise<MicrophoneSettingsDevice[]> {
        const { ipcRenderer } = require("electron") as typeof import("electron");
        const devices = await ipcRenderer.invoke(AUDIO_SETTINGS_DEVICES).catch((): AudioDevice[] => []) as AudioDevice[];
        const inputs = devices.filter((item) => item.deviceId && item.deviceId !== "default" && item.deviceId !== "communications");
        // Chromium labels the pseudo-device "Default - <real label>"; that names the current Windows default.
        const defaultLabel = devices.find((item) => item.deviceId === "default")?.label.replace(/^Default - /, "");
        const defaultId = inputs.find((item) => item.label === defaultLabel)?.deviceId;
        return inputs.map((item) => ({ deviceId: item.deviceId, label: item.label, isDefault: item.deviceId === defaultId }));
    },
    onStatus(callback: (status: AudioProcessingStatus) => void): () => void {
        const { ipcRenderer } = require("electron") as typeof import("electron");
        const listener = (_event: Electron.IpcRendererEvent, status: AudioProcessingStatus): void => callback(status);
        ipcRenderer.on(AUDIO_STATUS, listener);
        void ipcRenderer.invoke(AUDIO_STATUS_GET).then((statuses: AudioProcessingStatus[]) => {
            for (const status of statuses ?? []) callback(status);
        });
        return () => ipcRenderer.removeListener(AUDIO_STATUS, listener);
    },
    retry(): void {
        const { ipcRenderer } = require("electron") as typeof import("electron");
        ipcRenderer.send(AUDIO_RETRY);
    },
};

export function microphoneOptions(stream: MediaStream): MicrophoneCleaningOptions {
    const id = microphoneDeviceId(stream);
    return {
        enabled: settings.get("microphone.clean"),
        attenuationDb: settings.get("microphone.attenuation-db"),
        notch: id ? settings.get("microphone.notches")[id] : undefined,
    };
}

export function reportMicrophoneStatus(mode: AudioProcessingMode, reason: string): void {
    const { ipcRenderer } = require("electron") as typeof import("electron");
    ipcRenderer.send(AUDIO_STATUS, { mode, reason });
}

/** True when Windows now routes the default input to a different device than the captured track's. */
async function defaultMicrophoneMoved(track: MediaStreamTrack): Promise<boolean> {
    const devices = await navigator.mediaDevices.enumerateDevices().catch((): MediaDeviceInfo[] => []);
    const current = devices.find((device) => device.kind === "audioinput" && device.deviceId === "default")?.groupId;
    const captured = track.getSettings().groupId;
    return !!current && !!captured && current !== captured;
}

export function watchMicrophoneSettings(capture: PcmAudioCapture, stream: MediaStream): void {
    // The capture replaces its stream when the default device changes, so always read the live one.
    const options = (): MicrophoneCleaningOptions => microphoneOptions(capture.mediaStream ?? stream);
    capture.onStop(settings.watch("microphone.clean", () => {
        void capture.reconfigureMicrophone(options());
    }));
    capture.onStop(settings.watch("microphone.attenuation-db", () => {
        capture.updateCleaning(options());
    }));
    capture.onStop(settings.watch("microphone.notches", () => {
        capture.updateCleaning(options());
    }));
    const { ipcRenderer } = require("electron") as typeof import("electron");
    const retry = (): void => capture.retryMicrophone(options());
    ipcRenderer.on(AUDIO_RETRY, retry);
    capture.onStop(() => ipcRenderer.removeListener(AUDIO_RETRY, retry));
    // A device was added or removed: follow a new default microphone (a headset plugged back in);
    // otherwise retry the echo reference, which may have moved with the default speakers. An ended
    // track (the device unplugged) is handled by the capture itself.
    const followDefault = async (): Promise<void> => {
        const track = capture.mediaStream?.getAudioTracks()[0];
        if (track?.readyState !== "live") return;
        if (await defaultMicrophoneMoved(track)) capture.switchStream();
        else retry();
    };
    let deviceTimer: ReturnType<typeof setTimeout> | undefined;
    const deviceChanged = (): void => {
        clearTimeout(deviceTimer);
        deviceTimer = setTimeout(() => { void followDefault(); }, 300);
    };
    navigator.mediaDevices.addEventListener("devicechange", deviceChanged);
    capture.onStop(() => { clearTimeout(deviceTimer); navigator.mediaDevices.removeEventListener("devicechange", deviceChanged); });
}
