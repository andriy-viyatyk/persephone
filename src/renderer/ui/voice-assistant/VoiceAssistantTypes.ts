export type VoiceAssistantState = "off" | "waiting" | "listening" | "thinking" | "speaking";

export interface WakeEvent {
    type: "wake" | "stop";
    phrase: string;
    person: string;
    score: number;
    /** Milliseconds from the first input sample to the end of the phrase. */
    time: number;
    /** Milliseconds from the first input sample to the start of the phrase. */
    start?: number;
}

export interface VoiceRequestHandler {
    handle(req: { text: string; person: string }, ctx: {
        signal: AbortSignal;
        setReply(text: string): void;
        setSpeaking(on: boolean): void;
    }): Promise<void>;
}

export type VoiceInterruptHandler = () => void | Promise<void>;
