import { englishMessage, t, untranslated } from "../../../shared/i18n/t";
import type { MessageKey } from "../../../shared/i18n/en";
import type { BoardPermissionFlags, NormalizedBoardPermissions } from "../../../shared/board-manifest-utils";

export const BOARD_PERMISSION_INTRODUCTION = englishMessage("board.permissionIntroduction");
export const LEGACY_PERMISSION_EXPLANATION = englishMessage("board.legacyPermissionExplanation");

export function legacyBoardDeprecationWarning(boardName: string): string {
    return englishMessage("board.legacyBoardDeprecationWarning", {
        boardName,
        manifest: "board-manifest.json",
    });
}

export function legacyBoardsDeprecationToast(boardNames: readonly string[]): string {
    if (boardNames.length === 1) return legacyBoardDeprecationWarning(boardNames[0]);
    return englishMessage("board.legacyBoardsDeprecationToast", {
        count: boardNames.length,
        boardNames: boardNames.join(", "),
        manifest: "board-manifest.json",
    } as never);
}

export function legacyBoardDeprecationWarningForUi(boardName: string): string {
    return t("board.legacyBoardDeprecationWarning", {
        boardName,
        manifest: untranslated("board-manifest.json"),
    });
}

export function legacyBoardsDeprecationToastForUi(boardNames: readonly string[]): string {
    if (boardNames.length === 1) return legacyBoardDeprecationWarningForUi(boardNames[0]);
    return t("board.legacyBoardsDeprecationToast", {
        count: boardNames.length,
        boardNames: boardNames.join(", "),
        manifest: untranslated("board-manifest.json"),
    } as never);
}

// Agent-only durable note. Keep this source literal English and out of the UI catalog.
export const LEGACY_BOARD_AGENT_DEPRECATION_NOTE = "This board's permissions are deprecated because its manifest omits the permissions object or uses the historical array form. Add an object-form permissions block to board-manifest.json.";
export const FULL_ACCESS_DETAIL = englishMessage("board.fullAccessDetail");

const FLAG_COPY: Record<keyof BoardPermissionFlags, MessageKey | ""> = {
    execute: "board.permissionExecute",
    service: "board.permissionService",
    fileSystem: "",
    openExternal: "board.permissionOpenExternal",
    appScripting: "board.permissionAppScripting",
    network: "",
    clipboardRead: "board.permissionClipboardRead",
    camera: "board.permissionCamera",
    microphone: "board.permissionMicrophone",
    geolocation: "board.permissionGeolocation",
    notifications: "board.permissionNotifications",
    themes: "board.permissionThemes",
};

export interface BoardPermissionLine {
    /** Stable semantic identity; never derive this from localized or English display copy. */
    kind: string;
    /** English identity/display text retained for agent-facing consumers. */
    text: string;
    textKey: MessageKey;
    textParams?: Record<string, string | number>;
    detailKey?: MessageKey;
    fullAccess: boolean;
}

type FlagKey = keyof BoardPermissionFlags;
type FlagValue = BoardPermissionFlags[FlagKey];

function line(kind: string, textKey: MessageKey, textParams?: Record<string, string | number>, fullAccess = false): BoardPermissionLine {
    return {
        kind,
        textKey,
        ...(textParams ? { textParams } : {}),
        text: englishMessage(textKey, textParams as never),
        ...(fullAccess ? { detailKey: "board.fullAccessDetail" as const } : {}),
        fullAccess,
    };
}

/** Plain-language line for one enabled flag. */
function flagLine(key: FlagKey, value: Exclude<FlagValue, false>): BoardPermissionLine {
    let textKey = FLAG_COPY[key];
    let textParams: Record<string, string | number> | undefined;
    if (key === "fileSystem") {
        textKey = value === "board" ? "board.permissionFileSystemBoard" : "board.permissionFileSystemFull";
    } else if (key === "network") {
        textKey = value === "internet" ? "board.permissionNetworkInternet" : "board.permissionNetworkFull";
    }
    if (!textKey) return line(`${key}:${value}`, "board.permissionNone");
    return line(
        `${key}:${value}`,
        textKey,
        textParams,
        key === "execute" || key === "service" || key === "appScripting"
            || (key === "fileSystem" && value === "full")
            || (key === "network" && value === "full"),
    );
}

const UNRESTRICTED_LINE = line("unrestricted", "board.permissionUnrestricted");

export function boardPermissionLines(permissions: NormalizedBoardPermissions): BoardPermissionLine[] {
    if (permissions.kind === "legacy") return [UNRESTRICTED_LINE];
    const lines: BoardPermissionLine[] = [];
    for (const [key, value] of Object.entries(permissions.flags) as [FlagKey, FlagValue][]) {
        if (value !== false) lines.push(flagLine(key, value));
    }
    if (!lines.length) lines.push(line("none", "board.permissionNone"));
    return lines;
}

export const PERMISSION_CHANGE_TITLE = englishMessage("board.permissionChangeTitle");

export function permissionChangeMessage(boardName: string): string {
    return englishMessage("board.permissionChangeMessage", { boardName });
}

export interface BoardPermissionDiffLine extends BoardPermissionLine {
    /** `kept`: granted and still requested; `added`: newly requested; `removed`: no longer requested. */
    mark: "kept" | "added" | "removed";
}

export function boardPermissionDiffLines(
    granted: NormalizedBoardPermissions,
    proposed: NormalizedBoardPermissions,
): BoardPermissionDiffLine[] {
    const lines: BoardPermissionDiffLine[] = [];
    if (granted.kind === "legacy") lines.push({ ...UNRESTRICTED_LINE, mark: proposed.kind === "legacy" ? "kept" : "removed" });
    if (granted.kind === "flags" || proposed.kind === "flags") {
        const keys = Object.keys(granted.kind === "flags" ? granted.flags : (proposed as { flags: BoardPermissionFlags }).flags) as FlagKey[];
        for (const key of keys) {
            const from: FlagValue = granted.kind === "flags" ? granted.flags[key] : false;
            const to: FlagValue = proposed.kind === "flags" ? proposed.flags[key] : false;
            if (from !== false && from === to) {
                lines.push({ ...flagLine(key, from), mark: "kept" });
                continue;
            }
            if (from !== false) lines.push({ ...flagLine(key, from), mark: "removed" });
            if (to !== false) lines.push({ ...flagLine(key, to), mark: "added" });
        }
    }
    if (proposed.kind === "legacy" && granted.kind === "flags") lines.push({ ...UNRESTRICTED_LINE, mark: "added" });
    return lines;
}
