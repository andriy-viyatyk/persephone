/**
 * Keyboard input for browser automation.
 *
 * Key layout derived from Playwright's USKeyboardLayout
 * (Apache 2.0, originally from Puppeteer/Google).
 */
import type { CdpSession } from "./CdpSession";
import { callOnRef } from "./ref";
import type { IBrowserTarget } from "./types";

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

const modifierBits: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
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
    return [...keys].reduce((mask, key) => mask | (modifierBits[key] ?? 0), 0);
}
function eventParams(key: string, type: KeyEventType, modifiers: number, shifted = false): CdpKeyEvent {
    const definition = resolveKeyDefinition(key);
    const letter = /^[a-z]$/i.test(key);
    const printable = definition.text !== undefined;
    const isShifted = shifted || Boolean(modifiers & modifierBits.Shift);
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

/** Element kind used by the explicitly synthetic legacy fill path. */
type ElementKind = "input" | "textarea" | "contentEditable" | "unknown";

// ── Public API ──────────────────────────────────────────────────────

/** Dispatch the old synthetic DOM-key path for callers that explicitly request it. */
export async function pressSyntheticKey(cdp: CdpSession, key: string): Promise<void> {
    await dispatchSyntheticKey(cdp, key);
}

/**
 * Resolve and focus an element only for the explicitly requested synthetic fill path.
 */
async function focusElementBySelector(cdp: CdpSession, selector: string): Promise<ElementKind> {
    const s = JSON.stringify(selector);
    return await cdp.evaluate(`(() => {
        // Legacy synthetic compatibility picks the first selector match, preferring a visible
        // alternative only when that first match is hidden. Trusted operations use strict locators.
        let el = document.querySelector(${s});
        if (!el) throw new Error('Element not found: ' + ${s});
        // In this explicitly synthetic route only, if the first match is hidden, try a visible alternative.
        if (el.offsetHeight === 0 || getComputedStyle(el).display === 'none') {
            const all = document.querySelectorAll(${s});
            for (const candidate of all) {
                if (candidate.offsetHeight > 0 && getComputedStyle(candidate).display !== 'none') {
                    el = candidate;
                    break;
                }
            }
        }
        el.scrollIntoView({ block: 'center' });
        el.focus();
        if (el.tagName === 'INPUT') return 'input';
        if (el.tagName === 'TEXTAREA') return 'textarea';
        if (el.isContentEditable) return 'contentEditable';
        return 'unknown';
    })()`);
}

/**
 * Focus an element by ref (backendDOMNodeId) and detect its type.
 */
async function focusElementByRef(cdp: CdpSession, ref: string): Promise<ElementKind> {
    return await callOnRef(cdp, ref, `function() {
        this.scrollIntoView({ block: 'center' });
        this.focus();
        if (this.tagName === 'INPUT') return 'input';
        if (this.tagName === 'TEXTAREA') return 'textarea';
        if (this.isContentEditable) return 'contentEditable';
        return 'unknown';
    }`, true) || "unknown";
}

/**
 * Fill a form control via direct value assignment for synthetic compatibility.
 * For <textarea>, uses the native prototype setter to bypass framework interception
 * (e.g., Gmail ignores regular .value assignment on its textarea).
 */
async function fillInput(cdp: CdpSession, selector: string | undefined, ref: string | undefined, text: string): Promise<void> {
    const t = JSON.stringify(text);
    // JS snippet that sets value using native prototype setter (bypasses framework interception)
    // and dispatches InputEvent (not just Event) to trigger framework change detection
    const fillCode = `
        this.scrollIntoView({ block: 'center' });
        this.focus();
        const proto = this.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(this, ${t});
        this.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${t} }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
    `;
    if (selector) {
        const s = JSON.stringify(selector);
        await cdp.evaluate(`(() => {
            const el = document.querySelector(${s});
            if (!el) throw new Error('Element not found: ' + ${s});
            (function() { ${fillCode} }).call(el);
        })()`);
    } else if (ref) {
        await callOnRef(cdp, ref, `function() { ${fillCode} }`);
    }
}

/**
 * Fill a <textarea> or contentEditable element via Electron's webview.insertText() for synthetic compatibility.
 * Selects all existing content first, then inserts new text.
 * The element must already be focused via focusElement.
 *
 * The legacy synthetic path uses this because:
 * - <textarea>: Frameworks (Gmail) may ignore programmatic .value changes
 * - contentEditable: .value doesn't exist, and Trusted Types may block DOM assignment
 * - webview.insertText() works like real typing at the Chromium level
 */
async function fillWithInsertText(
    cdp: CdpSession,
    target: IBrowserTarget,
    elementKind: ElementKind,
    text: string,
    tabId?: string,
): Promise<void> {
    // Select all existing content
    if (elementKind === "textarea") {
        await cdp.evaluate(`(() => {
            const el = document.activeElement;
            if (el && el.select) el.select();
        })()`);
    } else {
        await cdp.evaluate("document.execCommand('selectAll')");
    }
    if (text) {
        // Retain the legacy native insertion behavior for synthetic callers.
        await target.insertText(text, tabId);
    } else {
        await cdp.evaluate("document.execCommand('delete')");
    }
}

/**
 * Type text character by character via Electron's webview.insertText() for synthetic callers.
 * Works on both input/textarea and contentEditable.
 * The element must already be focused.
 */
async function typeSlowly(
    cdp: CdpSession,
    target: IBrowserTarget,
    elementKind: ElementKind,
    text: string,
    tabId?: string,
): Promise<void> {
    if (elementKind === "input" || elementKind === "textarea") {
        await cdp.evaluate(`(() => {
            const el = document.activeElement;
            if (el && el.select) el.select();
        })()`);
    } else {
        await cdp.evaluate("document.execCommand('selectAll')");
    }
    if (text) {
        // Type character by character via webview.insertText()
        for (const char of text) {
            await target.insertText(char, tabId);
        }
    } else {
        await cdp.evaluate("document.execCommand('delete')");
    }
}

// ── Unified Type Command ────────────────────────────────────────────

/** Options for the type command (matches Playwright MCP browser_type). */
export interface TypeOptions {
    /** CSS selector for the target element. */
    selector?: string;
    /** Element ref from accessibility snapshot (e.g. "e52"). */
    ref?: string;
    /** Text to type. */
    text: string;
    /** Target tab, defaulting to the active tab. */
    tabId?: string;
    /** Type one character at a time (triggers key handlers). Default: false (bulk fill). */
    slowly?: boolean;
    /** Press Enter after typing. Default: false. */
    submit?: boolean;
    /** Keep the legacy DOM/value path for pages that explicitly request it. */
    synthetic?: boolean;
}

/**
 * Retain the legacy synthetic type path for callers that explicitly request { synthetic: true }.
 *
 * It detects element type and uses the previous value/insertText strategy:
 * - <input>/<textarea> default: el.value = text (atomic, fast)
 * - <input>/<textarea> slowly: webview.insertText() char by char
 * - contentEditable default: selectAll + webview.insertText() (bulk)
 * - contentEditable slowly: webview.insertText() char by char
 *
 * @param target - Browser automation target (provides webview access)
 * @param options - Type options (selector/ref, text, slowly, submit)
 */
export async function typeText(target: IBrowserTarget, options: TypeOptions): Promise<void> {
    const { selector, ref, text, tabId, slowly, submit } = options;
    if (!selector && !ref) throw new Error("Missing 'selector' or 'ref' parameter");

    const cdp = target.cdp(tabId);

    // The old synthetic path still asks Electron to focus the host before DOM evaluation.
    target.focusWebview(tabId);

    // Detect element type
    const elementKind = selector
        ? await focusElementBySelector(cdp, selector)
        : await focusElementByRef(cdp, ref!); // eslint-disable-line @typescript-eslint/no-non-null-assertion

    // Fill using the appropriate strategy
    if (slowly) {
        await typeSlowly(cdp, target, elementKind, text, tabId);
    } else if (elementKind === "input" || elementKind === "textarea") {
        // Atomic focus + value assignment via native setter (prevents focus interception)
        await fillInput(cdp, selector, ref, text);
    } else if (elementKind === "contentEditable") {
        await fillWithInsertText(cdp, target, elementKind, text, tabId);
    } else {
        // Legacy synthetic compatibility retains the old unknown-element value-setter fallback.
        await fillInput(cdp, selector, ref, text);
    }

    // Submit (press Enter) if requested
    if (submit) {
        await pressKey(cdp, "Enter", { synthetic: options.synthetic });
    }
}
