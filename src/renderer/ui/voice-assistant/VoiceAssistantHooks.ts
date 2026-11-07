import type { VoiceInterruptHandler, VoiceRequestHandler } from "./VoiceAssistantTypes";

let requestHandler: VoiceRequestHandler | null = null;
let interruptHandler: VoiceInterruptHandler | null = null;

export function setVoiceRequestHandler(handler: VoiceRequestHandler | null): void {
    requestHandler = handler;
}

export function getVoiceRequestHandler(): VoiceRequestHandler | null {
    return requestHandler;
}

export function setVoiceInterruptHandler(handler: VoiceInterruptHandler | null): void {
    interruptHandler = handler;
}

export function getVoiceInterruptHandler(): VoiceInterruptHandler | null {
    return interruptHandler;
}
