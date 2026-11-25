import { platform as rawPlatform, supportedPlatform } from "./platform";

export type PlatformFeatureId =
    | "terminal.launch"
    | "desktop.fileAssociations"
    | "desktop.defaultBrowser"
    | "desktop.boardShortcut"
    | "screen.snip"
    | "memory.mnemeSidecar"
    | "desktop.virtualPlacement"
    | "browser.windowsSso"
    | "media.vlcAutoDetect"
    | "desktop.tray"
    | "desktop.closeToTray"
    | "clipboard.files"
    | "clipboard.backgroundWatch"
    | "desktop.fileDragOut"
    | "audio.computerCapture"
    | "audio.computerCancellation"
    | "speech.windowsVoiceTyping";
export type FeatureAvailability = { available: true } | { available: false; reason: string };
type PlatformSlot = "win32" | "linux" | "darwin" | "unsupported";

const featureAvailability: Record<PlatformFeatureId, Record<PlatformSlot, boolean>> = {
    "terminal.launch": { win32: true, linux: false, darwin: false, unsupported: false },
    "desktop.fileAssociations": { win32: true, linux: false, darwin: false, unsupported: false },
    "desktop.defaultBrowser": { win32: true, linux: false, darwin: false, unsupported: false },
    "desktop.boardShortcut": { win32: true, linux: false, darwin: false, unsupported: false },
    "screen.snip": { win32: true, linux: false, darwin: false, unsupported: false },
    "memory.mnemeSidecar": { win32: true, linux: false, darwin: false, unsupported: false },
    "desktop.virtualPlacement": { win32: true, linux: false, darwin: false, unsupported: false },
    "browser.windowsSso": { win32: true, linux: false, darwin: false, unsupported: false },
    "media.vlcAutoDetect": { win32: true, linux: false, darwin: false, unsupported: false },
    "desktop.tray": { win32: true, linux: false, darwin: false, unsupported: false },
    "desktop.closeToTray": { win32: true, linux: false, darwin: false, unsupported: false },
    "clipboard.files": { win32: true, linux: false, darwin: false, unsupported: false },
    "clipboard.backgroundWatch": { win32: true, linux: false, darwin: false, unsupported: false },
    "desktop.fileDragOut": { win32: true, linux: false, darwin: false, unsupported: false },
    "audio.computerCapture": { win32: true, linux: false, darwin: false, unsupported: false },
    "audio.computerCancellation": { win32: true, linux: false, darwin: false, unsupported: false },
    "speech.windowsVoiceTyping": { win32: true, linux: false, darwin: false, unsupported: false },
};

const platformNames: Record<Exclude<PlatformSlot, "unsupported">, string> = {
    win32: "Windows",
    linux: "Linux",
    darwin: "macOS",
};

function unavailableReason(platform: PlatformSlot): string {
    const name = platform === "unsupported" ? rawPlatform : platformNames[platform];
    return `Not available on ${name}.`;
}

/** Read the static availability of one platform feature. */
export function getPlatformFeature(id: PlatformFeatureId): FeatureAvailability {
    const currentPlatform: PlatformSlot = supportedPlatform ?? "unsupported";
    if (featureAvailability[id][currentPlatform]) return { available: true };
    return { available: false, reason: unavailableReason(currentPlatform) };
}
