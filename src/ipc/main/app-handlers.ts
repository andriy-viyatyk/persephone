import { BrowserWindow, nativeTheme, type IpcMainEvent } from "electron";
import { getAssetPath, getAppRootPath, getDataFolder } from "../../main/utils";
import { getUiPreferences, setUiPreference } from "../../main/ui-preferences";
import { openWindows } from "../../main/open-windows";
import { versionService } from "../../main/version-service";
import * as browserRegistration from "../../main/browser-registration";
import { setMainLocale } from "../../main/i18n-locale";
import { getSiteExtensionRuntime } from "../../main/site-extension-runtime";
import type { AppApi } from "../contracts/app";
import { bindDomain } from "./endpoint-registry";

export function initAppHandlers(): void {
    bindDomain<AppApi>({
        getAppRootPath: async () => getAppRootPath(),
        getAssetsPath: async (_event: IpcMainEvent, fileName: string) => `${getAssetPath()}/${fileName}`,
        getDataFolder: async () => getDataFolder(),
        setActiveLocale: async (_event: IpcMainEvent, code: string) => setMainLocale(code),
        reloadAllWindows: async () => openWindows.send("eReloadForLanguage", undefined),
        getUiPreferences: async () => getUiPreferences(),
        setUiPreference: async (_event: IpcMainEvent, key: string, value: string | number | boolean) =>
            setUiPreference(key, value),
        inspectElement: async (event: IpcMainEvent, x: number, y: number) =>
            BrowserWindow.fromWebContents(event.sender)?.webContents.inspectElement(x, y),
        openDevTools: async (event: IpcMainEvent) =>
            BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools(),
        getSiteExtensionRuntime: async () => getSiteExtensionRuntime(),
        checkForUpdates: async (_event: IpcMainEvent, force?: boolean) => versionService.checkForUpdates(force),
        getAppVersion: async () => versionService.getAppVersion(),
        getRuntimeVersions: async () => versionService.getRuntimeVersions(),
        setNativeTheme: async (_event: IpcMainEvent, mode: "light" | "dark") => { nativeTheme.themeSource = mode; },
        registerAsDefaultBrowser: async () => browserRegistration.registerAsDefaultBrowser(),
        unregisterAsDefaultBrowser: async () => browserRegistration.unregisterAsDefaultBrowser(),
        isRegisteredAsDefaultBrowser: async () => browserRegistration.isRegisteredAsDefaultBrowser(),
        openDefaultAppsSettings: async () => browserRegistration.openDefaultAppsSettings()
    });
}

