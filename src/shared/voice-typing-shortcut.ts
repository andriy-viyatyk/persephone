const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const RESERVED_CHORDS = new Set([
    "Ctrl+Tab", "Ctrl+W", "Ctrl+F4", "Ctrl+N", "Ctrl+Shift+N", "Ctrl+O",
    "Ctrl+Alt+[", "Ctrl+Alt+]", "Ctrl+R", "Ctrl+Shift+R", "Ctrl+F5", "Ctrl+Shift+F5",
    "F5", "F12", "Alt+ArrowLeft", "Alt+ArrowRight",
]);
const RESERVED_KEYS = new Set(["Escape", "Enter", "Tab"]);
/** A lone tap of the right Ctrl key, pressed and released with no other key in between. */
export const RIGHT_CTRL_SHORTCUT = "Right Ctrl";
export const SHIFT_RIGHT_CTRL_SHORTCUT = "Shift+Right Ctrl";

function canonicalKey(key: string, code?: string): string {
    const keyboardCode = code ?? "";
    if (/^Key[A-Z]$/.test(keyboardCode)) return keyboardCode.slice(3);
    if (/^Digit[0-9]$/.test(keyboardCode)) return keyboardCode.slice(5);
    if (key.length === 1) return key.toUpperCase();
    if (key === " ") return "Space";
    return key;
}

export function normalizeVoiceTypingShortcut(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const compact = value.replace(/\s+/g, "").toLowerCase();
    if (["rightctrl", "rightcontrol", "controlright"].includes(compact)) return RIGHT_CTRL_SHORTCUT;
    if (["shift+rightctrl", "shift+rightcontrol", "shift+controlright"].includes(compact)) return SHIFT_RIGHT_CTRL_SHORTCUT;
    const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return undefined;
    const rawKey = parts.pop();
    if (!rawKey) return undefined;
    const key = canonicalKey(rawKey);
    if (RESERVED_KEYS.has(key) || !/^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|[\[\]\\;',./`=-]|Arrow(?:Up|Down|Left|Right))$/.test(key)) return undefined;
    const modifiers = new Set<string>();
    for (const part of parts) {
        const normalized = part.toLowerCase();
        const modifier = normalized === "ctrl" || normalized === "control" ? "Ctrl"
            : normalized === "alt" ? "Alt"
                : normalized === "shift" ? "Shift"
                    : normalized === "meta" || normalized === "cmd" || normalized === "command" ? "Meta"
                        : undefined;
        if (!modifier || modifiers.has(modifier)) return undefined;
        modifiers.add(modifier);
    }
    if (modifiers.size === 0) return undefined;
    const chord = [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
    if (RESERVED_CHORDS.has(chord)) return undefined;
    if ((key === "F12") || (key === "F5") || ((key === "ArrowLeft" || key === "ArrowRight") && modifiers.has("Alt"))) return undefined;
    return chord;
}

export function voiceTypingShortcutForInput(input: {
    key: string;
    code?: string;
    control: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
}): string {
    const modifiers = [
        input.control ? "Ctrl" : "",
        input.alt ? "Alt" : "",
        input.shift ? "Shift" : "",
        input.meta ? "Meta" : "",
    ].filter(Boolean);
    return [...modifiers, canonicalKey(input.key, input.code)].join("+");
}

export function voiceTypingShortcutFromKeyboardEvent(event: KeyboardEvent): string | undefined {
    return normalizeVoiceTypingShortcut(voiceTypingShortcutForInput({
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
    }));
}
