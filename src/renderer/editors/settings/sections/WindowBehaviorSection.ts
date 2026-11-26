import { settings } from "../../../api/settings";
import { api } from "../../../../ipc/renderer/api";
import { getPlatformFeature } from "../../../../shared/platform-features";
import { CheckboxField } from "../fields/CheckboxField";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { HelpIconView } from "../../../uikit/HelpIcon/HelpIconView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, helpIcon, panel } from "./settings-native";
import { t } from "../../../../shared/i18n/t";

export class WindowBehaviorSectionView extends VanillaView<Record<string, never>> {
    private description: HelpIconView | undefined;
    private row: HTMLDivElement | undefined;
    private availabilityGeneration = 0;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {
        const row = panel({ direction: "row", align: "center", paddingBottom: "md" });
        row.hidden = true;
        this.row = row;
        const checkbox = this.child(new CheckboxField({
            store: appSettingsStore as SettingsStore<boolean>,
            id: "window.close-to-tray",
            label: t("settings.keepRunningTray"),
        }));
        row.append(checkbox.root);
        checkbox.mount();
        this.description = helpIcon(t("settings.keepRunningTray"), t("settings.lastWindowTray"), (cleanup) => this.own(cleanup));
        row.append(this.description.root);
        this.root.append(row);
        this.sync();
        this.own(settings.watch("window.close-to-tray", () => this.sync()));

        const generation = ++this.availabilityGeneration;
        void api.getTrayAvailability().then((snapshot) => {
            if (this.isDisposed || generation !== this.availabilityGeneration) return;
            const currentRow = this.row;
            if (!currentRow) return;
            currentRow.hidden = !getPlatformFeature("desktop.closeToTray", {
                "desktop.closeToTray": snapshot.closeToTrayAvailable,
            }).available;
        }).catch(() => {
            if (this.isDisposed || generation !== this.availabilityGeneration) return;
            if (this.row) this.row.hidden = !getPlatformFeature("desktop.closeToTray").available;
        });
    }

    protected onDispose(): void {
        this.availabilityGeneration++;
        this.description = undefined;
        this.row = undefined;
    }

    private sync(): void {
        const closeToTray = settings.get("window.close-to-tray");
        this.description?.update({
            label: t("settings.moreInformation", { label: t("settings.keepRunningTray") }),
            text: closeToTray ? t("settings.lastWindowTray") : t("settings.lastWindowQuit"),
        });
    }
}
