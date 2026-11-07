export const AUDIO_DEVICES_REQUEST = "persephone:audio-devices-request";
export const AUDIO_DEVICES_REPLY = "persephone:audio-devices-reply";

export interface AudioDevice { deviceId: string; label: string; isDefault: boolean }
export interface AudioDevicesRequest { requestId: string; epoch: number }
export type AudioDevicesReply =
    | { requestId: string; epoch: number; devices: AudioDevice[] }
    | { requestId: string; epoch: number; error: string };
