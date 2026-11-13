import type { BrowserPermissionKey } from "../../../ipc/browser-ipc";
import type { MessageKey } from "../../../shared/i18n/en";

/** Shared localized labels for site settings and browser permission prompts. */
export const BROWSER_PERMISSION_LABELS = {
    camera: { setting: "browser.permissionCamera", prompt: "browser.permissionCamera" },
    microphone: { setting: "browser.permissionMicrophone", prompt: "browser.permissionMicrophone" },
    geolocation: { setting: "browser.permissionLocation", prompt: "browser.permissionLocation" },
    notifications: { setting: "browser.permissionNotifications", prompt: "browser.permissionNotifications" },
    midi: { setting: "browser.permissionMidi", prompt: "browser.permissionMidiDevices" },
    midiSysex: { setting: "browser.permissionMidiFullControl", prompt: "browser.permissionMidiSystemMessages" },
    "clipboard-read": { setting: "browser.permissionClipboardRead", prompt: "browser.permissionClipboardContents" },
    "idle-detection": { setting: "browser.permissionIdleDetection", prompt: "browser.permissionIdleDetectionRequest" },
    "window-management": { setting: "browser.permissionWindowManagement", prompt: "browser.permissionWindowInformation" },
    "speaker-selection": { setting: "browser.permissionSpeakerSelection", prompt: "browser.permissionAudioOutput" },
    openExternal: { setting: "browser.permissionOpenSchemeLinks", prompt: "browser.permissionOpenSchemeLinks" },
} satisfies Record<BrowserPermissionKey, { setting: MessageKey; prompt: MessageKey }>;
