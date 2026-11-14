export interface IAudibleEditor {
    readonly audibleEditor: true;
    readonly audible: boolean;
    readonly muted: boolean;
    readonly soundButtonWhenSilent: boolean;
    toggleMuteAll(): void;
}

export function isAudibleEditor(value: unknown): value is IAudibleEditor {
    if (typeof value !== "object" || value === null) return false;
    const editor = value as Partial<IAudibleEditor>;
    return editor.audibleEditor === true
        && typeof editor.audible === "boolean"
        && typeof editor.muted === "boolean"
        && typeof editor.soundButtonWhenSilent === "boolean"
        && typeof editor.toggleMuteAll === "function";
}
