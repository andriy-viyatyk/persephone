import type { EventObject } from "./event-object";

export interface AudioApi {
    getAudioCaptureCount: () => Promise<{ count: number; revision: number }>;
}

export interface AudioEvents {
    eAudioCaptureCount: EventObject<{ count: number; revision: number }>;
}

