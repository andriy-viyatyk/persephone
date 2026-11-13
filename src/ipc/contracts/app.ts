import type { RuntimeVersions, UpdateCheckResult } from "../api-param-types";
import type { EventObject } from "./event-object";
import type { TimeoutExemptions } from "../timeout-exemptions";

export interface AppApi {
    getAppRootPath: () => Promise<string>;
    getAssetsPath: (fileName: string) => Promise<string>;
    getDataFolder: () => Promise<string>;
    setActiveLocale: (code: string) => Promise<void>;
    reloadAllWindows: () => Promise<void>;
    getUiPreferences: () => Promise<Record<string, string | number | boolean>>;
    setUiPreference: (
            key: string,
            value: string | number | boolean,
        ) => Promise<string | number | boolean>;
    inspectElement: (x: number, y: number) => Promise<void>;
    openDevTools: () => Promise<void>;
    getSiteExtensionRuntime: () => Promise<string>;
    checkForUpdates: (force?: boolean) => Promise<UpdateCheckResult>;
    getAppVersion: () => Promise<string>;
    getRuntimeVersions: () => Promise<RuntimeVersions>;
    setNativeTheme: (mode: "light" | "dark") => Promise<void>;
    registerAsDefaultBrowser: () => Promise<void>;
    unregisterAsDefaultBrowser: () => Promise<void>;
    isRegisteredAsDefaultBrowser: () => Promise<boolean>;
    openDefaultAppsSettings: () => Promise<void>;
}

export interface AppEvents {
    eUpdateAvailable: EventObject<UpdateCheckResult>;
}


export const appTimeoutExemptions = {
    checkForUpdates: "Remote release metadata fetch has no request-level timeout.",
} satisfies TimeoutExemptions<AppApi>;
