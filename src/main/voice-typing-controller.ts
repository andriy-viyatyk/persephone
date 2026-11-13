import { clipboard, type WebContents } from "electron";
import type { EventPayload } from "../ipc/event-types";
import {
    DEFAULT_VOICE_TYPING_SHORTCUT,
    DEFAULT_VOICE_TYPING_TRANSLATE_SHORTCUT,
    normalizeVoiceTypingShortcut,
    RIGHT_CTRL_SHORTCUT,
    SHIFT_RIGHT_CTRL_SHORTCUT,
    voiceTypingShortcutForInput,
} from "../shared/voice-typing-shortcut";
import { errMessage } from "../shared/utils";

export type VoiceTypingState = "idle" | "recording" | "transcribing";
type VoiceTypingMode = "transcribe" | "translate";
type VoiceTypingSource = "app" | { kind: "guest"; webContentsId: number };
type VoiceTypingEventSender = (
    eventName: "eVoiceTypingShortcut",
    data: EventPayload<"eVoiceTypingShortcut">,
) => void;

function inputMatchesShortcut(input: Electron.Input, shortcut: string): boolean {
    return voiceTypingShortcutForInput(input) === shortcut;
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(fallback);
        }, milliseconds);
        promise.then((value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(fallback);
        });
    });
}

export class VoiceTypingController {
    private voiceTypingShortcut = DEFAULT_VOICE_TYPING_SHORTCUT;
    private voiceTypingTranslateShortcut = DEFAULT_VOICE_TYPING_TRANSLATE_SHORTCUT;
    private rightCtrlTap: { target: WebContents; shift: boolean } | undefined;
    private voiceTypingState: VoiceTypingState = "idle";
    private voiceTypingSession: { id: string; target: WebContents } | undefined;
    private voiceTypingControlSession: { id: string; target: WebContents; mode: VoiceTypingMode } | undefined;

    constructor(private readonly send: VoiceTypingEventSender) {}

    handleInput(event: Electron.Event, input: Electron.Input, target: WebContents, source: VoiceTypingSource): void {
        const rightCtrlShortcut = this.trackRightCtrlTap(input, target);
        if (rightCtrlShortcut && [this.voiceTypingShortcut, this.voiceTypingTranslateShortcut].includes(rightCtrlShortcut)) {
            this.toggleVoiceTyping(target, source, rightCtrlShortcut === this.voiceTypingTranslateShortcut ? "translate" : "transcribe");
            return;
        }
        if (input.type !== "keyDown" || input.isAutoRepeat) return;
        if (inputMatchesShortcut(input, this.voiceTypingShortcut) || inputMatchesShortcut(input, this.voiceTypingTranslateShortcut)) {
            event.preventDefault();
            const mode = inputMatchesShortcut(input, this.voiceTypingTranslateShortcut) ? "translate" : "transcribe";
            this.toggleVoiceTyping(target, source, mode);
            return;
        }
        if (input.key === "Escape" && this.voiceTypingState !== "idle" && this.voiceTypingControlSession) {
            event.preventDefault();
            const sessionId = this.voiceTypingControlSession.id;
            this.voiceTypingState = "idle";
            this.clearSessions();
            this.send("eVoiceTypingShortcut", { sessionId, action: "cancel", source });
        }
    }

    setShortcuts(shortcut: string, translateShortcut: string): void {
        this.voiceTypingShortcut = normalizeVoiceTypingShortcut(shortcut) ?? DEFAULT_VOICE_TYPING_SHORTCUT;
        this.voiceTypingTranslateShortcut = normalizeVoiceTypingShortcut(translateShortcut) ?? DEFAULT_VOICE_TYPING_TRANSLATE_SHORTCUT;
    }

    setState(state: VoiceTypingState): void {
        this.voiceTypingState = state;
        if (state === "idle") this.clearSessions();
    }

    async insertText(sessionId: string, text: string, deferClipboard = false): Promise<{ copied: boolean }> {
        const session = this.voiceTypingSession;
        if (!session || session.id !== sessionId || !["recording", "transcribing"].includes(this.voiceTypingState)) throw new Error("The voice typing session is no longer active.");
        const target = session.target;
        if (!target.isDestroyed()) {
            const frame = target.focusedFrame;
            if (frame) {
                try {
                    // Returns the character before the caret ("" at the start), or null when nothing editable has focus.
                    const before = await withDeadline(frame.executeJavaScript(`(() => {
                        const element = document.activeElement;
                        const textInput = element instanceof HTMLTextAreaElement
                            || element instanceof HTMLInputElement && ["text", "search", "url", "tel", "email", "password", "number"].includes(element.type);
                        if (textInput) {
                            try { return element.value.slice(0, element.selectionStart ?? element.value.length).slice(-1); } catch { return ""; }
                        }
                        if (!(element instanceof HTMLElement)) return null;
                        // Monaco keeps focus on an EditContext element, which is neither an input nor contenteditable.
                        if (element.editContext) return element.editContext.text.slice(0, element.editContext.selectionStart).slice(-1);
                        if (!element.isContentEditable) return null;
                        const selection = getSelection();
                        if (!selection || !selection.rangeCount || !element.contains(selection.anchorNode)) return "";
                        const range = document.createRange();
                        range.selectNodeContents(element);
                        range.setEnd(selection.anchorNode, selection.anchorOffset);
                        return range.toString().slice(-1);
                    })()`) as Promise<string | null>, 1200, null);
                    const editable = typeof before === "string";
                    // Dictation continues the text: separate it from a preceding word.
                    if (before && !/\s/.test(before)) text = ` ${text}`;
                    if (this.voiceTypingSession?.id !== sessionId || !["recording", "transcribing"].includes(this.voiceTypingState)) {
                        throw new Error("The voice typing session is no longer active.");
                    }
                    if (editable && !target.isDestroyed()) {
                        // webContents.insertText() crashes the renderer when focus is in a cross-origin
                        // child frame (a board iframe), so a child frame inserts through its own document.
                        const inserted = frame === target.mainFrame
                            ? await withDeadline(target.insertText(text).then(() => true), 1500, false)
                            : await withDeadline(frame.executeJavaScript(`document.execCommand("insertText", false, ${JSON.stringify(text)})`) as Promise<boolean>, 1500, false);
                        if (inserted) {
                            if (!deferClipboard) this.clearSession();
                            return { copied: false };
                        }
                    }
                } catch (error: unknown) {
                    console.warn(`Voice typing insertion check failed: ${errMessage(error)}`);
                }
            }
        }
        if (!deferClipboard) await clipboard.writeText(text);
        this.clearSession();
        return { copied: true };
    }

    clearSession(): void {
        this.voiceTypingSession = undefined;
    }

    clearSessions(): void {
        this.clearSession();
        this.voiceTypingControlSession = undefined;
    }

    private trackRightCtrlTap(input: Electron.Input, target: WebContents): string | undefined {
        const isRightCtrl = input.code === "ControlRight";
        if (input.type === "keyDown") {
            if (isRightCtrl) {
                if (!input.isAutoRepeat) this.rightCtrlTap = input.alt || input.meta ? undefined : { target, shift: input.shift };
            } else if (input.key === "Shift" && this.rightCtrlTap?.target === target) {
                this.rightCtrlTap.shift = true;
            } else {
                this.rightCtrlTap = undefined;
            }
            return undefined;
        }
        if (input.type !== "keyUp" || !isRightCtrl) {
            if (input.type === "keyUp" && input.key === "Shift" && this.rightCtrlTap?.target === target) this.rightCtrlTap.shift = true;
            return undefined;
        }
        const tap = this.rightCtrlTap;
        this.rightCtrlTap = undefined;
        if (tap?.target !== target) return undefined;
        return tap.shift ? SHIFT_RIGHT_CTRL_SHORTCUT : RIGHT_CTRL_SHORTCUT;
    }

    private toggleVoiceTyping(target: WebContents, source: VoiceTypingSource, mode: VoiceTypingMode): void {
        if (this.voiceTypingState === "transcribing") return;
        if (this.voiceTypingState === "idle") {
            const sessionId = crypto.randomUUID();
            this.voiceTypingSession = { id: sessionId, target };
            this.voiceTypingControlSession = { id: sessionId, target, mode };
            this.voiceTypingState = "recording";
            this.send("eVoiceTypingShortcut", { sessionId, action: "start", mode, source });
        } else if (this.voiceTypingControlSession) {
            this.voiceTypingState = "transcribing";
            this.send("eVoiceTypingShortcut", { sessionId: this.voiceTypingControlSession.id, action: "stop", source });
        }
    }
}
