import type { EnglishCatalogEntry } from "./common";

export const voiceAssistantCatalog = {
    off: { message: "Voice assistant unavailable" },
    waiting: { message: "Voice assistant ready - microphone active" },
    listening: { message: "Listening" },
    thinking: { message: "Thinking" },
    speaking: { message: "Speaking" },
    wakeMissing: { message: "Install the Wake Word board to use voice assistant" },
    ttsMissing: { message: "Install the Text to Speech board for spoken replies; replies will appear as text" },
    loopbackUnavailable: { message: "Computer-audio protection unavailable" },
    paused: { message: "Voice assistant paused" },
    providerFailed: { message: "Wake provider unavailable" },
    cancelled: { message: "Voice assistant request cancelled" },
} satisfies Record<string, EnglishCatalogEntry>;
