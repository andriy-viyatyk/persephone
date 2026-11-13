import type { IpcMainEvent } from "electron";
import { openWindows } from "../../main/open-windows";
import {
    clearTranscriptLoopbackGrant,
    clearVoiceTypingMediaGrant,
    armTranscriptLoopbackGrant,
    armVoiceTypingMediaGrant,
} from "../../main/media-grants";
import { requireAppWindow } from "../../main/ipc-sender-policies";
import type { VoiceTypingApi } from "../contracts/voice-typing";
import { bindDomain } from "./endpoint-registry";

export function initVoiceTypingHandlers(): void {
    bindDomain<VoiceTypingApi>({
        setVoiceTypingConfig: async (event: IpcMainEvent, request: { shortcut: string; translateShortcut: string }) =>
            openWindows.setVoiceTypingConfig(event.sender, request),
        setVoiceTypingState: async (event: IpcMainEvent, request: { state: "idle" | "recording" | "transcribing" }) =>
            openWindows.setVoiceTypingState(event.sender, request),
        armVoiceTypingMicrophone: async (event: IpcMainEvent) => armVoiceTypingMediaGrant(event.sender.id),
        clearVoiceTypingMicrophone: async (event: IpcMainEvent) => clearVoiceTypingMediaGrant(event.sender.id),
        armTranscriptLoopback: async (event: IpcMainEvent) => {
            if (process.platform !== "win32") throw new Error("permission-denied");
            armTranscriptLoopbackGrant(event.sender.id);
        },
        clearTranscriptLoopback: async (event: IpcMainEvent) => clearTranscriptLoopbackGrant(event.sender.id),
        insertVoiceTypingText: async (
            event: IpcMainEvent,
            request: { sessionId: string; text: string; deferClipboard?: boolean },
        ): Promise<{ copied: boolean }> => {
            if (!request || typeof request.sessionId !== "string" || typeof request.text !== "string") {
                throw new TypeError("Invalid voice typing result.");
            }
            return openWindows.insertVoiceTypingText(event.sender, request);
        }
    }, {
        setVoiceTypingConfig: { policy: requireAppWindow, deny: () => new Error("permission-denied") },
        setVoiceTypingState: { policy: requireAppWindow, deny: () => new Error("permission-denied") },
        armTranscriptLoopback: { policy: requireAppWindow, deny: () => new Error("permission-denied") }
    });
}

