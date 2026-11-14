import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { TextListField } from "../fields/TextListField";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { t } from "../../../../shared/i18n/t";
import { createSectionRoot, helpIcon, panel, settingsFieldLabel } from "./settings-native";

export class FileSearchSectionView extends VanillaView<Record<string, never>> {
    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        this.root.append(panel({ paddingBottom: "md" }, settingsFieldLabel(t("settings.fileSearchExtensionsLabel")), helpIcon(t("settings.fileSearchExtensionsLabel"), t("settings.fileSearchExtensionsDescription"), (cleanup) => this.own(cleanup)).root));

        const extensions = this.child(new TextListField({
            store: appSettingsStore as SettingsStore<string[]>,
            id: "search-extensions",
            ariaLabel: t("settings.fileSearchExtensionsLabel"),
        }));
        this.root.append(extensions.root);
        extensions.mount();

        this.root.append(panel({ paddingTop: "lg", paddingBottom: "md" }, settingsFieldLabel(t("settings.fileSearchExclusionsLabel")), helpIcon(t("settings.fileSearchExclusionsLabel"), t("settings.fileSearchExclusionsDescription"), (cleanup) => this.own(cleanup)).root));

        const exclusions = this.child(new TextListField({
            store: appSettingsStore as SettingsStore<string[]>,
            id: "search-exclude",
            ariaLabel: t("settings.fileSearchExclusionsLabel"),
        }));
        this.root.append(exclusions.root);
        exclusions.mount();
    }
}
