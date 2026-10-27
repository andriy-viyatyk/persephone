import type { EnglishCatalogEntry } from "./common";

export const transcriptCatalog = {
    button: { message: "Transcript", note: "Tooltip for the Transcript toolbar button on Monaco text pages." },
    stop: { message: "Stop transcript", note: "Tooltip and accessible name for ending a running Transcript capture." },
    audioLevel: { message: "Transcript audio level", note: "Accessible name for the live audio level meter in the Monaco toolbar." },
    both: { message: "Both", note: "Source mode that captures the user's microphone and Windows computer audio as separate sources." },
    computerAudio: { message: "Computer audio", note: "Source mode for Windows loopback audio; unavailable on other platforms." },
    microphoneMe: { message: "Microphone (me)", note: "Source mode that captures only the user's microphone." },
    me: { message: "Me", note: "Speaker label prepended to a committed microphone utterance in Both mode." },
    others: { message: "Others", note: "Speaker label prepended to a committed computer-audio utterance in Both mode." },
    sessionConflict: { message: "Stop the other speech capture before starting Transcript or Voice Typing.", note: "Shown when Transcript and Voice Typing try to capture at the same time in one app window." },
    liveRequired: { message: "This Speech to Text provider does not support live transcription.", note: "Shown after the user starts Transcript with a provider that does not advertise the live feature." },
    missingProvider: { message: "Install and trust a Speech to Text provider to use Transcript.", note: "Shown if the provider is removed after the Transcript menu was displayed." },
    failed: { message: "Transcript could not start or finish.", note: "General Transcript capture or provider failure." },
    backpressure: { message: "Transcript stopped because the speech provider could not keep up with captured audio.", note: "Shown when bounded audio buffering reaches its safety limit." },
    cancelled: { message: "Transcript was cancelled.", note: "Reason passed to a provider when the user cancels Transcript." },
} satisfies Record<string, EnglishCatalogEntry>;
