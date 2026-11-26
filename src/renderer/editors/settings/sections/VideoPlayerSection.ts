import { isLinux } from "../../../../shared/platform";
import { t } from "../../../../shared/i18n/t";
import { api } from "../../../../ipc/renderer/api";
import { settings } from "../../../api/settings";
import { settingRange } from "../../../api/settings-schema";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { PathField } from "../fields/PathField";
import { PortField } from "../fields/PortField";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, panel, settingsFieldLabel } from "./settings-native";

export class VideoPlayerSectionView extends VanillaView<Record<string, never>> {
    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        const outer = panel({ direction: "column", rounded: "sm", background: "dark" });
        const pathRow = panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" });
        pathRow.append(settingsFieldLabel(t(isLinux ? "settings.vlcExecutableLabel" : "settings.vlcPathLabel")));
        const pathField = this.child(new PathField({
            store: appSettingsStore as SettingsStore<string>,
            variant: "link-or-placeholder",
            id: "vlc-path",
            title: t(isLinux ? "settings.vlcExecutableLabel" : "settings.vlcPathLabel"),
            emptyText: t("settings.autoDetect"),
            browse: this.handleBrowseVlc,
            clear: () => settings.set("vlc-path", ""),
            clearLabel: t("settings.removeVlcPath"),
            fallback: "",
        }));
        pathRow.append(pathField.root);
        pathField.mount();
        const portRow = panel({ direction: "row", align: "center", gap: "md", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" });
        portRow.append(settingsFieldLabel(t("settings.streamPortLabel")));
        const portField = this.child(new PortField({
            store: appSettingsStore as SettingsStore<number>,
            id: "video-stream.port",
            range: settingRange("video-stream.port"),
            width: 56,
            fallback: settings.get("video-stream.port"),
        }));
        portRow.append(portField.root);
        portField.mount();
        outer.append(pathRow, portRow);
        this.root.append(outer);
    }

    private readonly handleBrowseVlc = async (): Promise<void> => {
        const result = await api.showOpenFileDialog(isLinux
            ? { title: t("settings.selectVlcExecutable") }
            : { title: t("settings.selectVlcExe"), filters: [{ name: t("settings.executableFiles"), extensions: ["exe"] }] });
        if (result?.[0]) settings.set("vlc-path", result[0]);
    };
}
