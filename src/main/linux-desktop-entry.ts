import { app } from "electron";
import path from "node:path";

/** Escape a desktop-file string value (the key-file layer, not Exec syntax). */
export function serializeDesktopEntryValue(value: string): string {
    if (containsControlCharacter(value, new Set([9, 10, 13]))) {
        throw new Error("Desktop entry values cannot contain control characters.");
    }
    return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
}

/** Characters the Desktop Entry spec reserves; an argument containing one must be quoted. */
const EXEC_RESERVED_CHARACTERS = /[\s"'\\><~|&;$*?#()`]/;

/**
 * Serialize a fixed argument using the Desktop Entry Exec quoting rules. Quote only when the spec
 * requires it: `xdg-settings` resolves the handler's binary from the first Exec word without
 * unquoting it, so a quoted executable makes `xdg-settings set default-web-browser` fail.
 */
export function serializeDesktopExecArgument(argument: string): string {
    if (containsControlCharacter(argument)) throw new Error("Desktop command arguments cannot contain control characters.");
    if (argument !== "" && !EXEC_RESERVED_CHARACTERS.test(argument)) return argument.replace(/%/g, "%%");
    const escaped = argument
        .replace(/%/g, "%%")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`");
    return `"${escaped}"`;
}

function containsControlCharacter(value: string, allowed: ReadonlySet<number> = new Set()): boolean {
    return Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 || (code >= 127 && code <= 159)) && !allowed.has(code);
    });
}

/** Return the absolute executable and argv used by desktop entries in dev and packaged builds. */
export function linuxDesktopInvocation(featureArguments: readonly string[] = []): string[] {
    const executable = path.resolve(app.getPath("exe"));
    const invocation = app.isPackaged
        ? [executable]
        : [executable, path.resolve(app.getAppPath())];
    return [...invocation, ...featureArguments];
}

export function serializeDesktopExec(arguments_: readonly string[], fieldCode?: "%u"): string {
    const execLine = [...arguments_.map(serializeDesktopExecArgument), ...(fieldCode ? [fieldCode] : [])].join(" ");
    return serializeDesktopEntryValue(execLine);
}
