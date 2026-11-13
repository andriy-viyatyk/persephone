import { AUDIO_SETTINGS_UPDATE, AUDIO_SETTINGS_GET, AUDIO_STATUS, AUDIO_STATUS_GET, AUDIO_RETRY, AUDIO_SETTINGS_DEVICES, AUDIO_DEVICES_REPLY, CONTROL_CHANNEL, ARM_CHANNEL, CLEAR_CHANNEL, type AudioDevicesReply } from "../audio-channels";
import { getAudioCaptureCount as getAudioCaptureCountSnapshot } from "../../main/audio-capture-state";
import type { AudioApi } from "../contracts/audio";
import { bindDomain } from "./endpoint-registry";
import { audioService } from "../../main/audio-service";
import { anyPolicy, requireNormalWindow, requireWindowOf } from "../../main/ipc-sender-policies";
import { guardedIpcHandle, guardedIpcOn } from "../../main/ipc-sender-guard";
import { codedError } from "../../shared/coded-error";

export function initAudioHandlers(): void {
    bindDomain<AudioApi>({
        getAudioCaptureCount: async () => getAudioCaptureCountSnapshot(),
    });
    const audioWindow = requireWindowOf(() => audioService.windowContents);
    guardedIpcOn(AUDIO_SETTINGS_UPDATE, (_event, snapshot: unknown) => audioService.updateSettings(snapshot), { policy: requireNormalWindow, deny: "ignore" });
    guardedIpcHandle(AUDIO_SETTINGS_GET, () => audioService.getSettings(), { policy: audioWindow, deny: () => codedError("permission-denied") });
    guardedIpcOn(AUDIO_STATUS, (_event, status: unknown) => audioService.updateStatus(status), { policy: anyPolicy(audioWindow, requireNormalWindow), deny: "ignore" });
    guardedIpcHandle(AUDIO_STATUS_GET, () => audioService.getStatus(), { policy: requireNormalWindow, deny: () => codedError("permission-denied") });
    guardedIpcOn(AUDIO_RETRY, () => audioService.retry(), { policy: requireNormalWindow, deny: "ignore" });
    guardedIpcHandle(AUDIO_SETTINGS_DEVICES, () => audioService.getDevices(), { policy: requireNormalWindow, deny: () => codedError("permission-denied") });
    guardedIpcOn(AUDIO_DEVICES_REPLY, (_event, reply: AudioDevicesReply) => audioService.acceptDevicesReply(reply), { policy: audioWindow, deny: "ignore" });
    guardedIpcOn(CONTROL_CHANNEL, (_event, message: Parameters<typeof audioService.handleControlMessage>[0]) => audioService.handleControlMessage(message), { policy: audioWindow, deny: "ignore" });
    guardedIpcHandle(ARM_CHANNEL, (_event, source: unknown) => audioService.armCapture(source), { policy: audioWindow, deny: () => codedError("permission-denied") });
    guardedIpcHandle(CLEAR_CHANNEL, () => audioService.clearCapture(), { policy: audioWindow, deny: () => codedError("permission-denied") });
}
