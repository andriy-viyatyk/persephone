import { settings } from "../../api/settings";
import type { MicrophoneCleaningOptions } from "../../../shared/microphone-cleaning-types";
import { AUDIO_RETRY, AUDIO_STATUS } from "../../../ipc/audio-channels";
import type { PcmAudioCapture } from "./PcmAudioCapture";
import { microphoneDeviceId } from "./microphone-device";

export function microphoneOptions(stream: MediaStream): MicrophoneCleaningOptions {
    const id = microphoneDeviceId(stream);
    return {
        enabled: settings.get("microphone.clean"),
        attenuationDb: settings.get("microphone.attenuation-db"),
        notch: id ? settings.get("microphone.notches")[id] : undefined,
    };
}

export function reportMicrophoneStatus(mode: string, reason: string): void {
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
