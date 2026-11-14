import { settings } from "../../../api/settings";
import type { BrowserProfile } from "../../../api/settings-schema";
import type { BrowserNetwork } from "../../../../ipc/browser-network-ipc";
import { browserProfiles } from "../../../api/browser-profiles";
import { ui } from "../../../api/ui";
import { DialogButton } from "../../../ui/dialogs/dialog-buttons";
import { TComponentModel } from "../../../core/state/model";
import { api } from "../../../../ipc/renderer/api";
import type { BrowserPermissionDecisionEntry } from "../../../../ipc/browser-ipc";
import { TAG_COLORS } from "../../../theme/palette-colors";
import { t } from "../../../../shared/i18n/t";

export interface BrowserProfilesSectionProps {
    profiles: BrowserProfile[];
    defaultProfile: string;
}

const defaultBrowserProfilesSectionState = {
    newName: "",
    newColor: TAG_COLORS[0].hex,
    clearedProfile: null as string | null,
};

export type BrowserProfilesSectionState = typeof defaultBrowserProfilesSectionState;

/** Owns the browser-profile form drafts, dialogs, and clear feedback. */
export class BrowserProfilesSectionModel extends TComponentModel<BrowserProfilesSectionState, BrowserProfilesSectionProps> {
    private clearedTimer: ReturnType<typeof setTimeout> | undefined;

    setNewName = (newName: string) => this.state.update((state) => { state.newName = newName; });
    setNewColor = (newColor: string) => this.state.update((state) => { state.newColor = newColor; });

    get canAdd(): boolean {
        return browserProfiles.canAdd(this.state.get().newName);
    }

    handleAddProfile = () => {
        const name = this.state.get().newName;
        if (!this.canAdd) return;
        browserProfiles.add(name, this.state.get().newColor);
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
        await browserProfiles.remove(name);
    };

    getPermissionDecisions = (name: string): Promise<BrowserPermissionDecisionEntry[]> =>
        browserProfiles.listPermissionDecisions(name);

    removePermissionDecision = (name: string, entry: BrowserPermissionDecisionEntry): Promise<boolean> =>
        browserProfiles.removePermissionDecision(name, entry);

    clearPermissionDecisions = (name: string): Promise<boolean> =>
        browserProfiles.clearPermissionDecisions(name);

    handleClearData = async (profileName: string) => {
        const label = profileName || t("settings.defaultProfile");
        const result = await ui.confirm(
            t("settings.clearProfileConfirmation", { name: label }),
                { title: t("settings.clearProfileDataTitle"), buttons: [DialogButton.clear, DialogButton.cancel] },
        );
        if (result !== DialogButton.clear) return;
        await browserProfiles.clearData(profileName);
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

    handleSetDefault = (name: string) => browserProfiles.setDefault(name);
    handleColorChange = (name: string, color: string) => browserProfiles.setColor(name, color);

    handleBrowseDefaultBookmarks = async () => {
        const filePath = await this.browseBookmarksFile();
        if (filePath) settings.set("browser-default-bookmarks-file", filePath);
    };

    handleBrowseProfileBookmarks = async (name: string) => {
        const filePath = await this.browseBookmarksFile();
        if (filePath) browserProfiles.setBookmarksFile(name, filePath);
    };

    handleBrowseIncognitoBookmarks = async () => {
        const filePath = await this.browseBookmarksFile();
        if (filePath) settings.set("browser-incognito-bookmarks-file", filePath);
    };

    handleProfileNetworkChange = (name: string, network: BrowserNetwork) => browserProfiles.setNetwork(name, network);
    handleDefaultNetworkChange = (network: BrowserNetwork) => settings.set("browser-default-network", network);
    handleIncognitoNetworkChange = (network: BrowserNetwork) => settings.set("browser-incognito-network", network);
    handleClearProfileBookmarks = (name: string) => browserProfiles.setBookmarksFile(name, undefined);
    handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Enter") this.handleAddProfile(); };

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
