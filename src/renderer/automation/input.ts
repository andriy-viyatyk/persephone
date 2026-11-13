/**
 * Keyboard input for browser automation.
 *
 * Key layout derived from Playwright's USKeyboardLayout
 * (Apache 2.0, originally from Puppeteer/Google).
 */
import type { CdpSession } from "./CdpSession";

// ── Key Definitions ─────────────────────────────────────────────────

export interface KeyDefinition {
    key: string;
    keyCode: number;
    code: string;
    text?: string;
    location?: number;
}

export const KEY_DEFINITIONS: Record<string, KeyDefinition> = {
    // Function keys
    "Escape":    { key: "Escape", keyCode: 27, code: "Escape" },
    "F1":        { key: "F1", keyCode: 112, code: "F1" },
    "F2":        { key: "F2", keyCode: 113, code: "F2" },
    "F3":        { key: "F3", keyCode: 114, code: "F3" },
    "F4":        { key: "F4", keyCode: 115, code: "F4" },
    "F5":        { key: "F5", keyCode: 116, code: "F5" },
    "F6":        { key: "F6", keyCode: 117, code: "F6" },
    "F7":        { key: "F7", keyCode: 118, code: "F7" },
    "F8":        { key: "F8", keyCode: 119, code: "F8" },
    "F9":        { key: "F9", keyCode: 120, code: "F9" },
    "F10":       { key: "F10", keyCode: 121, code: "F10" },
    "F11":       { key: "F11", keyCode: 122, code: "F11" },
    "F12":       { key: "F12", keyCode: 123, code: "F12" },

    // Control keys
    "Backspace": { key: "Backspace", keyCode: 8, code: "Backspace" },
    "Tab":       { key: "Tab", keyCode: 9, code: "Tab" },
    "Enter":     { key: "Enter", keyCode: 13, code: "Enter", text: "\r" },
    " ":         { key: " ", keyCode: 32, code: "Space", text: " " },
    "Space":     { key: " ", keyCode: 32, code: "Space", text: " " },
    "Delete":    { key: "Delete", keyCode: 46, code: "Delete" },
    "Insert":    { key: "Insert", keyCode: 45, code: "Insert" },

    // Navigation
    "Home":      { key: "Home", keyCode: 36, code: "Home" },
    "End":       { key: "End", keyCode: 35, code: "End" },
    "PageUp":    { key: "PageUp", keyCode: 33, code: "PageUp" },
    "PageDown":  { key: "PageDown", keyCode: 34, code: "PageDown" },
    "ArrowLeft": { key: "ArrowLeft", keyCode: 37, code: "ArrowLeft" },
    "ArrowUp":   { key: "ArrowUp", keyCode: 38, code: "ArrowUp" },
    "ArrowRight":{ key: "ArrowRight", keyCode: 39, code: "ArrowRight" },
    "ArrowDown": { key: "ArrowDown", keyCode: 40, code: "ArrowDown" },

    // Modifiers
    "Shift":     { key: "Shift", keyCode: 16, code: "ShiftLeft", location: 1 },
    "Control":   { key: "Control", keyCode: 17, code: "ControlLeft", location: 1 },
    "Alt":       { key: "Alt", keyCode: 18, code: "AltLeft", location: 1 },
    "Meta":      { key: "Meta", keyCode: 91, code: "MetaLeft", location: 1 },
};

// Generate a-z and A-Z
for (let i = 0; i < 26; i++) {
    const lower = String.fromCharCode(97 + i);
    const upper = String.fromCharCode(65 + i);
    const code = `Key${upper}`;
    const keyCode = 65 + i;
    KEY_DEFINITIONS[lower] = { key: lower, keyCode, code, text: lower };
    KEY_DEFINITIONS[upper] = { key: upper, keyCode, code, text: upper };
}

// Generate 0-9
for (let i = 0; i < 10; i++) {
    const d = String(i);
    KEY_DEFINITIONS[d] = { key: d, keyCode: 48 + i, code: `Digit${d}`, text: d };
}

// Common punctuation
const PUNCTUATION: Array<[string, number, string]> = [
    [";", 186, "Semicolon"], ["=", 187, "Equal"], [",", 188, "Comma"],
    ["-", 189, "Minus"], [".", 190, "Period"], ["/", 191, "Slash"],
    ["`", 192, "Backquote"], ["[", 219, "BracketLeft"],
    ["\\", 220, "Backslash"], ["]", 221, "BracketRight"],
    ["'", 222, "Quote"],
];
for (const [key, keyCode, code] of PUNCTUATION) {
    KEY_DEFINITIONS[key] = { key, keyCode, code, text: key };
}

// ── Helpers ─────────────────────────────────────────────────────────

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function resolveKeyDefinition(key: string): KeyDefinition {
    return KEY_DEFINITIONS[key] || { key, keyCode: 0, code: "", text: undefined };
}

type KeyEventType = "keyDown" | "rawKeyDown" | "keyUp" | "char";
interface CdpKeyEvent {
    type: KeyEventType;
    key: string;
    code: string;
    windowsVirtualKeyCode: number;
    modifiers: number;
    location?: number;
    text?: string;
    unmodifiedText?: string;
}

export const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const heldKeysBySession = new WeakMap<CdpSession, Map<string, Set<string>>>();

function sessionKey(sessionId?: string): string { return sessionId ?? ""; }
function heldKeys(cdp: CdpSession, sessionId?: string): Set<string> {
    let sessions = heldKeysBySession.get(cdp);
    if (!sessions) { sessions = new Map(); heldKeysBySession.set(cdp, sessions); }
    let keys = sessions.get(sessionKey(sessionId));
    if (!keys) { keys = new Set(); sessions.set(sessionKey(sessionId), keys); }
    return keys;
}
function modifierMask(keys: ReadonlySet<string>): number {
    return [...keys].reduce((mask, key) => mask | (MODIFIER_BITS[key] ?? 0), 0);
}
function eventParams(key: string, type: KeyEventType, modifiers: number, shifted = false): CdpKeyEvent {
    const definition = resolveKeyDefinition(key);
    const letter = /^[a-z]$/i.test(key);
    const printable = definition.text !== undefined;
    const isShifted = shifted || Boolean(modifiers & MODIFIER_BITS.Shift);
    const keyValue = isShifted && letter ? key.toUpperCase() : definition.key;
    const text = isShifted && letter ? key.toUpperCase() : definition.text;
    const params: CdpKeyEvent = {
        type,
        key: keyValue,
        code: definition.code,
        windowsVirtualKeyCode: definition.keyCode,
        modifiers,
    };
    if (definition.location !== undefined) params.location = definition.location;
    if (type === "keyDown" && printable && !(modifiers & (1 | 2 | 4))) {
        params.text = text;
        params.unmodifiedText = letter ? key.toLowerCase() : definition.text;
    }
    return params;
}

export async function dispatchKeyDown(cdp: CdpSession, key: string, sessionId?: string): Promise<void> {
    const keys = heldKeys(cdp, sessionId);
    const wasHeld = keys.has(key);
    keys.add(key);
    try {
        const modifiers = modifierMask(keys);
        const type = resolveKeyDefinition(key).text !== undefined ? "keyDown" : "rawKeyDown";
        await cdp.send("Input.dispatchKeyEvent", eventParams(key, type, modifiers), sessionId);
    } catch (error: unknown) {
        if (!wasHeld) keys.delete(key);
        throw error;
    }
}

export async function dispatchKeyUp(cdp: CdpSession, key: string, sessionId?: string): Promise<void> {
    const keys = heldKeys(cdp, sessionId);
    const modifiers = modifierMask(keys);
    await cdp.send("Input.dispatchKeyEvent", eventParams(key, "keyUp", modifiers), sessionId);
    keys.delete(key);
}

async function pressMappedKey(cdp: CdpSession, key: string, sessionId?: string): Promise<void> {
    const keys = heldKeys(cdp, sessionId);
    const definition = resolveKeyDefinition(key);
    const type = definition.text !== undefined ? "keyDown" : "rawKeyDown";
    await cdp.send("Input.dispatchKeyEvent", eventParams(key, type, modifierMask(keys)), sessionId);
    await cdp.send("Input.dispatchKeyEvent", eventParams(key, "keyUp", modifierMask(keys)), sessionId);
}

/** Press a key or compound key using trusted CDP input unless synthetic is explicitly selected. */
export async function pressKey(
    cdp: CdpSession,
    key: string,
    options: { sessionId?: string; synthetic?: boolean } = {},
): Promise<void> {
    if (options.synthetic) {
        await dispatchSyntheticKey(cdp, key);
        return;
    }
    const parts = key.split("+");
    const mainKey = parts.pop();
    if (!mainKey) throw new Error("A key is required.");
    const aliases: Record<string, string> = { Ctrl: "Control", Cmd: "Meta", Command: "Meta" };
    const modifiers = [...new Set(parts.map(part => aliases[part] ?? part).filter(part => MODIFIER_KEYS.has(part)))];
    const pressed: string[] = [];
    let dispatchFailure: unknown;
    try {
        for (const modifier of modifiers) {
            const wasHeld = heldKeys(cdp, options.sessionId).has(modifier);
            await dispatchKeyDown(cdp, modifier, options.sessionId);
            if (!wasHeld) pressed.push(modifier);
        }
        await pressMappedKey(cdp, mainKey, options.sessionId);
    } catch (error: unknown) {
        dispatchFailure = error;
    }
    for (const modifier of pressed.reverse()) {
        try {
            await dispatchKeyUp(cdp, modifier, options.sessionId);
        } catch (error: unknown) {
            if (dispatchFailure === undefined) dispatchFailure = error;
        }
    }
    if (dispatchFailure !== undefined) throw dispatchFailure;
}

/**
 * Send a mapped character as trusted keyDown (carrying its text) + keyUp; return false if
 * unmapped. No separate `char` event: a `keyDown` with `text` already inserts the character
 * (it is rawKeyDown + char in one), so adding `char` typed every character twice.
 */
export async function typeMappedCharacter(cdp: CdpSession, character: string, sessionId?: string): Promise<boolean> {
    const shifted = /^[A-Z]$/.test(character);
    const key = shifted ? character.toLowerCase() : character;
    const definition = KEY_DEFINITIONS[key];
    if (!definition?.code || definition.text === undefined) return false;
    const keys = heldKeys(cdp, sessionId);
    const addedShift = shifted && !keys.has("Shift");
    if (addedShift) keys.add("Shift");
    const modifiers = modifierMask(keys);
    try {
        const downParams = eventParams(key, "keyDown", modifiers, shifted);
        downParams.text = character;
        downParams.unmodifiedText = key;
        await cdp.send("Input.dispatchKeyEvent", downParams, sessionId);
        await cdp.send("Input.dispatchKeyEvent", eventParams(key, "keyUp", modifiers, shifted), sessionId);
        return true;
    } finally {
        if (addedShift) keys.delete("Shift");
    }
}

async function dispatchSyntheticKey(cdp: CdpSession, key: string): Promise<void> {
    const parts = key.split("+");
    const mainKey = parts.pop() ?? "";
    const modifiers = new Set(parts.map(part => ({ Ctrl: "Control", Cmd: "Meta", Command: "Meta" }[part] ?? part)).filter(part => MODIFIER_KEYS.has(part)));
    const definition = resolveKeyDefinition(mainKey);
    await cdp.evaluate(`(() => {
        const el = document.activeElement || document.body;
        const opts = { key: ${JSON.stringify(definition.key)}, code: ${JSON.stringify(definition.code)}, keyCode: ${definition.keyCode}, which: ${definition.keyCode},
            ctrlKey: ${modifiers.has("Control")}, shiftKey: ${modifiers.has("Shift")}, altKey: ${modifiers.has("Alt")}, metaKey: ${modifiers.has("Meta")}, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keypress', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
    })()`);
}

/** Dispatch the old synthetic DOM-key path for callers that explicitly request it. */
export async function pressSyntheticKey(cdp: CdpSession, key: string): Promise<void> {
    await dispatchSyntheticKey(cdp, key);
}
