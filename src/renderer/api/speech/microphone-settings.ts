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

export function watchMicrophoneSettings(capture: PcmAudioCapture, stream: MediaStream): void {
    capture.onStop(settings.watch("microphone.clean", () => {
        void capture.reconfigureMicrophone(microphoneOptions(stream));
    }));
    capture.onStop(settings.watch("microphone.attenuation-db", () => {
        capture.updateCleaning(microphoneOptions(stream));
    }));
    capture.onStop(settings.watch("microphone.notches", () => {
        capture.updateCleaning(microphoneOptions(stream));
    }));
    const { ipcRenderer } = require("electron") as typeof import("electron");
    const retry = (): void => capture.retryMicrophone(microphoneOptions(stream));
    ipcRenderer.on(AUDIO_RETRY, retry);
    capture.onStop(() => ipcRenderer.removeListener(AUDIO_RETRY, retry));
    let deviceTimer: ReturnType<typeof setTimeout> | undefined;
    const deviceChanged = (): void => {
        clearTimeout(deviceTimer);
        deviceTimer = setTimeout(retry, 300);
    };
    navigator.mediaDevices.addEventListener("devicechange", deviceChanged);
    capture.onStop(() => { clearTimeout(deviceTimer); navigator.mediaDevices.removeEventListener("devicechange", deviceChanged); });
}
