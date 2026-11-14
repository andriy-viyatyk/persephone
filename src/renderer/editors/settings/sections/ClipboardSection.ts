import { settings } from "../../../api/settings";
import { normalizeClipboardMaxItems, settingRange } from "../../../api/settings-schema";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { CheckboxField } from "../fields/CheckboxField";
import { NumberField } from "../fields/NumberField";
import { NotificationView } from "../../../uikit/Notification/NotificationView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { t } from "../../../../shared/i18n/t";
import { createSectionRoot, panel, text } from "./settings-native";
import "../../../uikit/Notification/Notification.css";

export class ClipboardSectionView extends VanillaView<Record<string, never>> {
    private warning: NotificationView | undefined;

    public constructor(props: Record<string, never>) {
        super(props, createSectionRoot("settings-section"));
    }

    protected onMount(): void {

        const enabledRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        const enabled = this.child(new CheckboxField({
            store: appSettingsStore as SettingsStore<boolean>,
            id: "clipboard.enabled",
            label: t("settings.clipboardEnable"),
        }));
        enabledRow.append(enabled.root);
        enabled.mount();
        this.root.append(enabledRow);

        const maxItemsRow = panel({ direction: "row", align: "center", gap: "md", paddingBottom: "lg" });
        maxItemsRow.append(text(t("settings.clipboardMaximumHistory"), { size: "sm" }));
        const range = settingRange("clipboard.max-items");
        const maxItems = this.child(new NumberField({
            store: appSettingsStore as SettingsStore<number>,
            id: "clipboard.max-items",
            width: 72,
            accepts: (value) => Number.isInteger(value) && value >= range.min && value <= range.max,
            fallback: normalizeClipboardMaxItems(settings.get("clipboard.max-items")),
            format: (value) => String(normalizeClipboardMaxItems(value)),
            preserveDraftOnSameValue: true,
        }));
        maxItemsRow.append(maxItems.root);
        maxItems.mount();
        this.root.append(maxItemsRow);

        this.warning = this.child(new NotificationView({ type: "warning", message: t("settings.clipboardReadableWarning") }));
        this.root.append(this.warning.root);
        this.warning.mount();

    }

    protected onDispose(): void {
        this.warning = undefined;
    }
}
