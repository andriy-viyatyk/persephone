import { settings, type BrowserProfile } from "../../../api/settings";
import type { BrowserNetwork } from "../../../../ipc/browser-network-ipc";
import { ui } from "../../../api/ui";
import { DialogButton } from "../../../ui/dialogs/dialog-buttons";
import { TComponentModel } from "../../../core/state/model";
import { getPartitionString } from "../../browser/BrowserEditorModel";
import { api } from "../../../../ipc/renderer/api";
import { BrowserChannel, type BrowserPermissionDecisionEntry } from "../../../../ipc/browser-ipc";
import { TAG_COLORS } from "../../../theme/palette-colors";
import { createDepsGate, type DepsGate } from "../../../uikit/shared/deps-gate";
import { t } from "../../../../shared/i18n/t";

const { ipcRenderer } = require("electron");

export interface BrowserProfilesSectionProps {
    profiles: BrowserProfile[];
    defaultProfile: string;
    torExePath: string;
    torSocksPort: number;
    torBookmarksFile: string;
}

const defaultBrowserProfilesSectionState = {
    newName: "",
    newColor: TAG_COLORS[0].hex,
    clearedProfile: null as string | null,
    torPortValue: null as string | null,
};

export type BrowserProfilesSectionState = typeof defaultBrowserProfilesSectionState;

/** Owns profile mutations and asynchronous profile-data/bookmark operations. */
export class BrowserProfilesSectionModel extends TComponentModel<BrowserProfilesSectionState, BrowserProfilesSectionProps> {
    private clearedTimer: ReturnType<typeof setTimeout> | undefined;
    private initialized = false;
    private readonly torSocksPortGate: DepsGate = createDepsGate();

    init(): void {
        this.state.update((state) => { state.torPortValue = String(this.props.torSocksPort); });
        this.torSocksPortGate.prime([this.props.torSocksPort]);
        this.initialized = true;
    }

    setProps = (props: BrowserProfilesSectionProps): void => {
        if (!this.initialized) return;
        if (this.torSocksPortGate.changed([props.torSocksPort])) {
            this.state.update((state) => { state.torPortValue = String(props.torSocksPort); });
        }
    };

    setNewName = (newName: string) => this.state.update((state) => { state.newName = newName; });
    setNewColor = (newColor: string) => this.state.update((state) => { state.newColor = newColor; });

    get canAdd(): boolean {
        const name = this.state.get().newName.trim().toLowerCase();
        return name.length > 0 && !this.props.profiles.some((profile) => profile.name.toLowerCase() === name);
    }

    handleAddProfile = () => {
        const name = this.state.get().newName.trim();
        if (!this.canAdd) return;
        settings.set("browser-profiles", [...this.props.profiles, { name, color: this.state.get().newColor }]);
        this.state.update((state) => {
            state.newName = "";
            state.newColor = TAG_COLORS[(this.props.profiles.length + 1) % TAG_COLORS.length].hex;
        });
    };

    handleRemoveProfile = async (name: string) => {
        const result = await ui.confirm(
            t("settings.deleteProfileConfirmation", { name }),
                { title: t("settings.deleteProfileTitle"), buttons: [DialogButton.delete, DialogButton.cancel] },
        );
        if (result !== DialogButton.delete) return;
        await ipcRenderer.invoke(BrowserChannel.clearProfileData, getPartitionString(name, false));
        await ipcRenderer.invoke(BrowserChannel.clearPermissionDecisions, name);
        settings.set("browser-profiles", this.props.profiles.filter((profile) => profile.name !== name));
        if (this.props.defaultProfile === name) settings.set("browser-default-profile", "");
    };

    getPermissionDecisions = (name: string): Promise<BrowserPermissionDecisionEntry[]> =>
        ipcRenderer.invoke(BrowserChannel.listPermissionDecisions, name || "default");

    removePermissionDecision = (name: string, entry: BrowserPermissionDecisionEntry): Promise<boolean> =>
        ipcRenderer.invoke(BrowserChannel.removePermissionDecision, {
            profileName: name || "default", origin: entry.origin, permission: entry.permission,
        });

    clearPermissionDecisions = (name: string): Promise<boolean> =>
        ipcRenderer.invoke(BrowserChannel.clearPermissionDecisions, name || "default");

    handleClearData = async (profileName: string) => {
        const label = profileName || t("settings.defaultProfile");
        const result = await ui.confirm(
            t("settings.clearProfileConfirmation", { name: label }),
                { title: t("settings.clearProfileDataTitle"), buttons: [DialogButton.clear, DialogButton.cancel] },
        );
        if (result !== DialogButton.clear) return;
        await ipcRenderer.invoke(BrowserChannel.clearProfileData, getPartitionString(profileName, false));
        if (!this.isLive) return;
        this.state.update((state) => { state.clearedProfile = profileName; });
        if (this.clearedTimer !== undefined) clearTimeout(this.clearedTimer);
        this.clearedTimer = setTimeout(() => {
            this.clearedTimer = undefined;
            if (this.isLive) this.state.update((state) => {
                if (state.clearedProfile === profileName) state.clearedProfile = null;
            });
        }, 2000);
    };

    handleSetDefault = (name: string) => settings.set("browser-default-profile", this.props.defaultProfile === name ? "" : name);
    handleColorChange = (name: string, color: string) => settings.set("browser-profiles", this.props.profiles.map((profile) => profile.name === name ? { ...profile, color } : profile));

    handleBrowseDefaultBookmarks = async () => {
        const filePath = await this.browseBookmarksFile();
        if (filePath) settings.set("browser-default-bookmarks-file", filePath);
    };

    handleBrowseProfileBookmarks = async (name: string) => {
        const filePath = await this.browseBookmarksFile();
        if (filePath) settings.set("browser-profiles", this.props.profiles.map((profile) => profile.name === name ? { ...profile, bookmarksFile: filePath } : profile));
    };

    handleBrowseIncognitoBookmarks = async () => {
        const filePath = await this.browseBookmarksFile();
        if (filePath) settings.set("browser-incognito-bookmarks-file", filePath);
    };

    handleProfileNetworkChange = (name: string, network: BrowserNetwork) => settings.set("browser-profiles", this.props.profiles.map((profile) => profile.name === name ? { ...profile, network } : profile));
    handleDefaultNetworkChange = (network: BrowserNetwork) => settings.set("browser-default-network", network);
    handleIncognitoNetworkChange = (network: BrowserNetwork) => settings.set("browser-incognito-network", network);
    handleClearProfileBookmarks = (name: string) => settings.set("browser-profiles", this.props.profiles.map((profile) => profile.name === name ? { ...profile, bookmarksFile: undefined } : profile));
    handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Enter") this.handleAddProfile(); };

    get torPortValue(): string {
        return this.state.get().torPortValue ?? String(this.props.torSocksPort);
    }

    setTorPortValue = (value: string) => this.state.update((state) => { state.torPortValue = value; });

    handleTorPortBlur = () => {
        const port = parseInt(this.torPortValue, 10);
        if (port >= 1024 && port <= 65535) settings.set("tor.socks-port", port);
        else this.state.update((state) => { state.torPortValue = String(this.props.torSocksPort); });
    };

    handleBrowseTorExe = async () => {
        const result = await api.showOpenFileDialog({ title: t("settings.selectTorExe"), filters: [{ name: t("settings.executableFiles"), extensions: ["exe"] }] });
        if (result?.[0]) settings.set("tor.exe-path", result[0]);
    };

    handleClearTorExe = () => settings.set("tor.exe-path", "");

    handleBrowseTorBookmarks = async () => {
        const filePath = await this.browseBookmarksFile();
        if (filePath) settings.set("tor.bookmarks-file", filePath);
    };

    handleClearTorBookmarks = () => settings.set("tor.bookmarks-file", "");

    private browseBookmarksFile = async (): Promise<string | undefined> => {
        const result = await api.showOpenFileDialog({ title: t("settings.selectBookmarks"), filters: [{ name: t("settings.linkFiles"), extensions: ["link.json"] }] });
        return result?.[0];
    };

    dispose() {
        if (this.clearedTimer !== undefined) clearTimeout(this.clearedTimer);
        this.clearedTimer = undefined;
    }
}

export { defaultBrowserProfilesSectionState };
