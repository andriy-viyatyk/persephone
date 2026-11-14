import { BrowserChannel, type BrowserPermissionDecisionEntry } from "../../ipc/browser-ipc";
import type { BrowserNetwork } from "../../ipc/browser-network-ipc";
import { getPartitionString } from "../../shared/browser-partition";
import type { BrowserProfile } from "./settings-schema";
import { settings } from "./settings";

const { ipcRenderer } = require("electron");

interface IBrowserProfiles {
    list(): BrowserProfile[];
    canAdd(name: string): boolean;
    add(name: string, color: string): void;
    remove(name: string): Promise<void>;
    setDefault(name: string): void;
    setColor(name: string, color: string): void;
    setBookmarksFile(name: string, path: string | undefined): void;
    setNetwork(name: string, network: BrowserNetwork): void;
    clearData(profileName: string): Promise<unknown>;
    listPermissionDecisions(name: string): Promise<BrowserPermissionDecisionEntry[]>;
    removePermissionDecision(name: string, entry: BrowserPermissionDecisionEntry): Promise<boolean>;
    clearPermissionDecisions(name: string): Promise<boolean>;
}

export const browserProfiles: IBrowserProfiles = {
    list(): BrowserProfile[] {
        return settings.get("browser-profiles");
    },

    canAdd(name: string): boolean {
        const normalizedName = name.trim().toLowerCase();
        return normalizedName.length > 0 && !settings.get("browser-profiles").some((profile) => profile.name.toLowerCase() === normalizedName);
    },

    add(name: string, color: string): void {
        const trimmedName = name.trim();
        settings.set("browser-profiles", [...settings.get("browser-profiles"), { name: trimmedName, color }]);
    },

    async remove(name: string): Promise<void> {
        await ipcRenderer.invoke(BrowserChannel.clearProfileData, getPartitionString(name, false));
        await ipcRenderer.invoke(BrowserChannel.clearPermissionDecisions, name);
        settings.set("browser-profiles", settings.get("browser-profiles").filter((profile) => profile.name !== name));
        if (settings.get("browser-default-profile") === name) settings.set("browser-default-profile", "");
    },

    setDefault(name: string): void {
        settings.set("browser-default-profile", settings.get("browser-default-profile") === name ? "" : name);
    },

    setColor(name: string, color: string): void {
        settings.set("browser-profiles", settings.get("browser-profiles").map((profile) => profile.name === name ? { ...profile, color } : profile));
    },

    setBookmarksFile(name: string, path: string | undefined): void {
        settings.set("browser-profiles", settings.get("browser-profiles").map((profile) => profile.name === name ? { ...profile, bookmarksFile: path } : profile));
    },

    setNetwork(name: string, network: BrowserNetwork): void {
        settings.set("browser-profiles", settings.get("browser-profiles").map((profile) => profile.name === name ? { ...profile, network } : profile));
    },

    clearData(profileName: string): Promise<unknown> {
        return ipcRenderer.invoke(BrowserChannel.clearProfileData, getPartitionString(profileName, false));
    },

    listPermissionDecisions(name: string): Promise<BrowserPermissionDecisionEntry[]> {
        return ipcRenderer.invoke(BrowserChannel.listPermissionDecisions, name || "default");
    },

    removePermissionDecision(name: string, entry: BrowserPermissionDecisionEntry): Promise<boolean> {
        return ipcRenderer.invoke(BrowserChannel.removePermissionDecision, {
            profileName: name || "default", origin: entry.origin, permission: entry.permission,
        });
    },

    clearPermissionDecisions(name: string): Promise<boolean> {
        return ipcRenderer.invoke(BrowserChannel.clearPermissionDecisions, name || "default");
    },
};
