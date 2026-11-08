/** Initial values pending measurements on the target microphones and weak laptop. */
export const MICROPHONE_TUNING = {
    attenuationDb: 30, targetPeak: 0.126, maxGain: 6.3, minSpeechPeak: 0.008,
    // Per 10 ms frame: drop fast on loud speech (~30 ms), rise over ~0.5 s; silence holds the gain.
    gainAttack: 0.3, gainRelease: 0.02, headroom: 0.95,
    maxPendingMs: 500, overloadRatio: 0.9, overloadFrames: 300,
    modelDelayFrames: 3, flushTimeoutMs: 3000,
    notchFrequency: 152, notchQ: 8, notchGainDb: -18,
} as const;

export interface MicrophoneNotch { enabled: boolean; frequency: number; q: number; gainDb: number }
export interface MicrophoneCleaningOptions { enabled: boolean; attenuationDb: number; notch?: MicrophoneNotch }
