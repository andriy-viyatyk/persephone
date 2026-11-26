import { isMac, supportedPlatform } from "./platform";

export type ShortcutModifier = "Alt" | "Shift";

export interface ShortcutDescriptor {
    readonly code: string;
    readonly key: string;
    readonly modifiers: readonly ShortcutModifier[];
}

export interface PrimaryModifierEvent {
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
}

export interface ShortcutEvent extends PrimaryModifierEvent {
    readonly code: string;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
}

export const primaryModifier = supportedPlatform === "darwin" && isMac ? "Cmd" : "Ctrl";

function shortcut(
    code: string,
    key: string,
    ...modifiers: ShortcutModifier[]
): ShortcutDescriptor {
    return { code, key, modifiers };
}

/** Shared identities for application shortcuts whose key handling is centrally owned. */
export const keymap = {
    nextTab: shortcut("Tab", "Tab"),
    previousTab: shortcut("Tab", "Tab", "Shift"),
    closePageW: shortcut("KeyW", "W"),
    closePageF4: shortcut("F4", "F4"),
    newPage: shortcut("KeyN", "N"),
    newWindow: shortcut("KeyN", "N", "Shift"),
    openFile: shortcut("KeyO", "O"),
    nextTheme: shortcut("BracketRight", "]", "Alt"),
    previousTheme: shortcut("BracketLeft", "[", "Alt"),
    copyImage: shortcut("KeyC", "C"),
} as const;

/** Selects only the platform's primary modifier flag; callers retain all other checks. */
export function isPrimaryModifier(event: PrimaryModifierEvent): boolean {
    return primaryModifier === "Cmd" ? event.metaKey : event.ctrlKey;
}

/** Matches the descriptor's key and required modifiers without rejecting additional modifiers. */
export function matchesShortcut(event: ShortcutEvent, descriptor: ShortcutDescriptor): boolean {
    if (event.code !== descriptor.code || !isPrimaryModifier(event)) return false;
    return descriptor.modifiers.every((modifier) => modifier === "Alt" ? event.altKey : event.shiftKey);
}

export function formatShortcut(
    descriptor: ShortcutDescriptor,
    modifier: "Ctrl" | "Cmd" = primaryModifier,
): string {
    return [modifier, ...descriptor.modifiers, descriptor.key].join("+");
}
