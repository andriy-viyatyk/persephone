import type { EventObject } from "./event-object";

export interface VoiceTypingApi {
    insertVoiceTypingText: (
        request: { sessionId: string; text: string; deferClipboard?: boolean },
    ) => Promise<{ copied: boolean }>;
    armVoiceTypingMicrophone: () => Promise<void>;
    clearVoiceTypingMicrophone: () => Promise<void>;
    armTranscriptLoopback: () => Promise<void>;
    clearTranscriptLoopback: () => Promise<void>;
    setVoiceTypingConfig: (request: { shortcut: string; translateShortcut: string }) => Promise<void>;
    setVoiceTypingState: (request: { state: "idle" | "recording" | "transcribing" }) => Promise<void>;
}

export interface VoiceTypingEvents {
    eVoiceTypingShortcut: EventObject<{
            sessionId: string;
            action: "start" | "stop" | "cancel";
            mode?: "transcribe" | "translate";
            source: "app" | { kind: "guest"; webContentsId: number };
        }>;
}

