import type { EnglishCatalogEntry } from "./common";

export const voiceTypingCatalog = {
    starting: { message: "Starting microphone…", note: "Shown briefly after the shortcut until the microphone delivers audio; the user should wait for the Recording status before speaking." },
    recording: { message: "Recording — {binding} to stop, Esc to cancel", note: "Status shown while Persephone captures microphone audio. Keep `{binding}` unchanged; pressing that shortcut stops capture and starts transcription." },
    recordingDuration: { message: "{seconds}s", note: "Elapsed recording time displayed beside the audio level meter. Keep `{seconds}` unchanged." },
    transcribing: { message: "Transcribing — Esc to cancel", note: "Status shown after capture ends while the speech provider returns a transcript." },
    copied: { message: "Transcribed text copied to the clipboard", note: "Shown when the originally focused input is no longer editable, so the transcript was preserved in the system clipboard." },
    cancelled: { message: "Voice typing cancelled.", note: "Voice capture or transcription was cancelled with Escape." },
    notReady: { message: "Open the Speech to Text board and finish its setup, then try again.", note: "The trusted transcription provider is installed but its speech runtime or model is not ready. Do not open the board automatically." },
    missingProvider: { message: "Install and trust the Speech to Text board from Tools & Editors to use voice typing.", note: "No trusted speech.transcribe v1 provider is available in the board catalog." },
    providerRefused: { message: "The Speech to Text board does not allow Persephone to connect. Change its caller approval policy to Accept granted.", note: "The provider refused the host caller, usually because its caller-approval-policy is same-board-only." },
    permissionDenied: { message: "Microphone access was denied. Allow microphone access for Persephone and try again.", note: "Voice typing requests one short-lived microphone grant for the Persephone window only." },
    tooLong: { message: "Recording stopped because it reached the five-minute limit.", note: "The speech provider's advertised maximum recording duration is five minutes." },
    failed: { message: "Voice typing could not complete.", note: "General voice typing failure. A more specific provider or microphone message may follow." },
} satisfies Record<string, EnglishCatalogEntry>;
