/** Initial values pending measurements on the target microphones and weak laptop. */
export const MICROPHONE_TUNING = {
    attenuationDb: 30,
    notchFrequency: 152, notchQ: 8, notchGainDb: -18,
} as const;

export interface MicrophoneNotch { enabled: boolean; frequency: number; q: number; gainDb: number }
export interface MicrophoneCleaningOptions { enabled: boolean; attenuationDb: number; notch?: MicrophoneNotch }

// Later loopback timestamp makes the reference lead delayed mic (lab shift −64 ms).
export const ECHO_TUNING = { referenceLeadMs: 64, referenceStallMs: 300, maxPendingMs: 500 } as const;
