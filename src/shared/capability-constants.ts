export const CAPABILITY_ERROR_CODES = ["no-handler", "untrusted", "handler-closed", "crashed", "cancelled", "timeout", "cycle", "payload-too-large", "busy", "rejected", "permission-denied", "channel-backpressure", "channel-closed"] as const;
export type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number];
const errorCodes: ReadonlySet<string> = new Set(CAPABILITY_ERROR_CODES);
export function isCapabilityErrorCode(value: unknown): value is CapabilityErrorCode {
    return typeof value === "string" && errorCodes.has(value);
}

export const PLATFORM_AUDIO_CAPABILITY_ID = "audio";
export const PLATFORM_CAPABILITY_IDS = {
    textOpen: "text.open",
    contentView: "content.view",
    imageEdit: "image.edit",
    diagramEdit: "diagram.edit",
    httpRequestOpen: "http.request.open",
    certificateView: "certificate.view",
    themeEdit: "theme.edit",
    agentSession: "agent.session",
    speechTranscribe: "speech.transcribe",
    speechSynthesize: "speech.synthesize",
    speechWake: "speech.wake",
    textTranslate: "text.translate",
} as const;
export const PLATFORM_SERVICE_INTERFACE_IDS: ReadonlySet<string> = new Set([
    PLATFORM_CAPABILITY_IDS.agentSession,
    PLATFORM_CAPABILITY_IDS.speechTranscribe,
    PLATFORM_CAPABILITY_IDS.speechSynthesize,
    PLATFORM_CAPABILITY_IDS.speechWake,
    PLATFORM_CAPABILITY_IDS.textTranslate,
]);
