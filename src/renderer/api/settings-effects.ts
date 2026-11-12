import { AUDIO_SETTINGS_UPDATE } from "../../ipc/audio-channels";
import { api } from "../../ipc/renderer/api";
import { t } from "../../shared/i18n/t";
import { errMessage } from "../../shared/utils";
import { normalizeClipboardMaxItems } from "./settings-schema";
import type { AppSettingsKey } from "./settings-schema";
import { ui } from "./ui";
import type { settings } from "./settings";

type Settings = typeof settings;

interface SettingsEffectRow {
    watch: () => void;
    applyImmediately?: () => void;
    applyAfterStartupDelay?: () => void;
}

let started = false;

/** Own the settings-to-service effects for the lifetime of the renderer. */
export function startSettingsEffects(settingsInstance: Settings): void {
    if (started) return;
    started = true;

    const settingEffects: readonly SettingsEffectRow[] = [
        {
            // Main scripting must be configured as soon as settings are ready.
            watch: () => settingsInstance.watch("main.scripting.enabled", (enabled) => {
                api.setMainScriptsEnabled(!!enabled);
            }),
            applyImmediately: () => api.setMainScriptsEnabled(!!settingsInstance.get("main.scripting.enabled")),
        },
        {
            watch: () => settingsInstance.watch("capabilities.preferredProviders", (preferences) => {
                void api.setCapabilityPreferences(preferences);
            }),
            applyImmediately: () => void api.setCapabilityPreferences(settingsInstance.get("capabilities.preferredProviders")),
        },
        {
            watch: () => settingsInstance.watch("browser-windows-sso", (enabled) => {
                void api.setWindowsSsoEnabled(!!enabled);
            }),
            applyImmediately: () => void api.setWindowsSsoEnabled(!!settingsInstance.get("browser-windows-sso")),
        },
        {
            // MCP is intentionally applied only after the existing 1.5 s startup delay.
            watch: () => settingsInstance.watch("mcp.enabled", (enabled) => applyMcp(enabled)),
            applyAfterStartupDelay: () => {
                if (settingsInstance.get("mcp.enabled")) applyMcp(true);
            },
        },
        {
            // Mneme startup reports failure only; user changes report success and failure.
            watch: () => settingsInstance.watch("mneme.enabled", (enabled) => applyMneme(enabled, false)),
            applyAfterStartupDelay: () => {
                if (settingsInstance.get("mneme.enabled")) applyMneme(true, true);
            },
        },
        {
            watch: () => {
                const clipboardKeys = ["clipboard.enabled", "clipboard.max-items"] as const satisfies readonly AppSettingsKey[];
                for (const key of clipboardKeys) settingsInstance.watch(key, () => applyClipboard(false));
            },
            applyAfterStartupDelay: () => applyClipboard(true),
        },
        {
            // Publish once after settings load, then only when one of the audio settings changes.
            watch: () => {
                const microphoneKeys = [
                    "microphone.clean",
                    "microphone.attenuation-db",
                    "microphone.notches",
                ] as const satisfies readonly AppSettingsKey[];
                for (const key of microphoneKeys) settingsInstance.watch(key, publishMicrophoneSettings);
            },
            applyImmediately: publishMicrophoneSettings,
        },
    ];

    // Attach every change handler before applying any startup snapshot.
    for (const effect of settingEffects) effect.watch();
    for (const effect of settingEffects) effect.applyImmediately?.();

    // Keep MCP, Mneme and clipboard deferred while the first window renders.
    setTimeout(() => {
        for (const effect of settingEffects) effect.applyAfterStartupDelay?.();
    }, 1500);

    function applyMcp(enabled: boolean): void {
        const port = settingsInstance.get("mcp.port");
        void api.setMcpEnabled(enabled, port || undefined).catch((error: unknown) => {
            ui.notify(t("api.mcpProfileStartFailed", { port: port || 7865, error: errMessage(error) }), "error");
        });
    }

    function applyMneme(enabled: boolean, initial: boolean): void {
        const port = settingsInstance.get("mneme.port");
        void api.setMnemeEnabled(enabled, port || undefined).then((status) => {
            if (!enabled) return;
            if (status.running) {
                if (!initial) ui.notify(t("api.mnemeStarted"), "success");
            } else {
                ui.notify(t("api.mnemeFailedToStart", { error: status.error ?? "unknown error" }), "error");
            }
        });
    }

    function applyClipboard(initial: boolean): void {
        const enabled = !!settingsInstance.get("clipboard.enabled");
        const maxItems = normalizeClipboardMaxItems(settingsInstance.get("clipboard.max-items"));
        void api.setClipboardEnabled(enabled, maxItems).then((status) => {
            if (initial && enabled && status.error) {
                ui.notify(t("api.clipboardTrackerFailedToStart", { error: status.error }), "error");
            }
        });
    }

    function publishMicrophoneSettings(): void {
        const { ipcRenderer } = require("electron") as typeof import("electron");
        ipcRenderer.send(AUDIO_SETTINGS_UPDATE, {
            enabled: settingsInstance.get("microphone.clean"),
            attenuationDb: settingsInstance.get("microphone.attenuation-db"),
            notches: settingsInstance.get("microphone.notches"),
        });
    }
}
