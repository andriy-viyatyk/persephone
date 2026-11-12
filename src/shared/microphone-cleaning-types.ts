/** Initial values pending measurements on the target microphones and weak laptop. */
export const MICROPHONE_TUNING = {
    attenuationDb: 30,
    notchFrequency: 152, notchQ: 8, notchGainDb: -18,
} as const;

export interface MicrophoneNotch { enabled: boolean; frequency: number; q: number; gainDb: number }
export interface MicrophoneCleaningOptions { enabled: boolean; attenuationDb: number; notch?: MicrophoneNotch }

export const MICROPHONE_NOTCH_FREQUENCY_RANGE = { min: 20, max: 7999 } as const;

export function normalizeMicrophoneSetting(key: string, value: unknown): unknown {
    if (key === "microphone.clean") return typeof value === "boolean" ? value : true;
    if (key === "microphone.attenuation-db") return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : MICROPHONE_TUNING.attenuationDb;
    if (key !== "microphone.notches") return value;
    const result: Record<string, MicrophoneNotch> = Object.create(null) as Record<string, MicrophoneNotch>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [id, raw] of Object.entries(value)) {
        if (!id || id === "default" || !raw || typeof raw !== "object") continue;
        const n = raw as Partial<MicrophoneNotch>;
        if (typeof n.enabled === "boolean" && typeof n.frequency === "number" && n.frequency >= MICROPHONE_NOTCH_FREQUENCY_RANGE.min && n.frequency <= MICROPHONE_NOTCH_FREQUENCY_RANGE.max
            && typeof n.q === "number" && n.q >= 0.1 && n.q <= 50 && typeof n.gainDb === "number" && n.gainDb >= -60 && n.gainDb <= 0) {
            result[id] = { enabled: n.enabled, frequency: n.frequency, q: n.q, gainDb: n.gainDb };
        }
    }
    return result;
}
