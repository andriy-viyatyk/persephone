// Voice assistant tuning values. Starting guesses until measured on the user's setup (EPIC-139).
// Audio arrives from PcmAudioCapture in 200 ms chunks (3,200 samples at 16 kHz).

/** ms: computer audio may reach the microphone this long after loopback heard it (TV processing, room). */
export const LOOPBACK_LEAD_MAX_MS = 1500;
/** ms: loopback detection may follow the microphone detection by this much (detection jitter). */
export const LOOPBACK_LAG_MAX_MS = 300;
/** ms: extra wait for a loopback event to be delivered before a microphone hit is accepted. */
export const DELIVERY_ALLOWANCE_MS = 300;
/** ms: newest request audio held back from transcription so a stop word can be cut out. */
export const STOP_HOLDBACK_MS = 3000;
/** ms: assumed stop-phrase length when the provider sends no `start`. */
export const LONGEST_PHRASE_MS = 2500;
/** normalized RMS: loopback level that opens the gate (computer audio is playing). */
export const LOOPBACK_GATE_OPEN_RMS = 0.01;
/** normalized RMS: lower level that closes it again; the gap prevents chatter. */
export const LOOPBACK_GATE_CLOSE_RMS = 0.006;
/** ms: loopback audio kept from before the gate opened, so a phrase's first syllable is not lost. */
export const LOOPBACK_PREROLL_MS = 400;
/** ms: loopback keeps flowing through brief quiet gaps after the level drops. */
export const LOOPBACK_TAIL_MS = 500;
/** ms: back-off before reopening after a provider failure or restart. */
export const PROVIDER_RETRY_MS = 1500;
/** chunks: send queue bound for a channel under backpressure (32 x 200 ms = 6.4 s). */
export const MAX_QUEUED_CHUNKS = 32;
/** chunks: request audio held while transcription starts and for the stop holdback (150 x 200 ms = 30 s);
 *  a cold speech-to-text model can take several seconds to accept audio. */
export const MAX_HELD_CHUNKS = 150;
/** ms: bound on waiting for a provider channel to open or a transcription result to arrive. */
export const CHANNEL_OPEN_TIMEOUT_MS = 15000;
