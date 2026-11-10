export const CONTROL_CHANNEL = "persephone:audio-control";
export const ARM_CHANNEL = "persephone:audio-arm-capture";
export const CLEAR_CHANNEL = "persephone:audio-clear-capture";
export const CLOSE_CHANNEL = "persephone:audio-close-channel";
export const OPEN_CHANNEL = "persephone:audio-open-channel";
export const AUDIO_DEVICES_REQUEST = "persephone:audio-devices-request";
export const AUDIO_DEVICES_REPLY = "persephone:audio-devices-reply";
export const AUDIO_SETTINGS_UPDATE = "persephone:audio-settings-update";
export const AUDIO_SETTINGS_GET = "persephone:audio-settings-get";
export const AUDIO_STATUS = "persephone:audio-processing-status";
export const AUDIO_SETTINGS_DEVICES = "persephone:audio-settings-devices";
export const AUDIO_STATUS_GET = "persephone:audio-status-get";
export const AUDIO_RETRY = "persephone:audio-retry";

export interface AudioDevice { deviceId: string; label: string; isDefault: boolean }
export interface AudioProcessingStatus { mode: string; reason: string }
export interface AudioDevicesRequest { requestId: string; epoch: number }
export type AudioDevicesReply =
    | { requestId: string; epoch: number; devices: AudioDevice[] }
    | { requestId: string; epoch: number; error: string };
