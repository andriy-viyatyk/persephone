import { isLinux } from "../../../../shared/platform";
import { t } from "../../../../shared/i18n/t";
import { settings } from "../../../api/settings";
import { appSettingsStore } from "../fields/settings-store";
import type { SettingsStore } from "../fields/settings-store";
import { ChoiceField } from "../fields/ChoiceField";
import { InputView } from "../../../uikit/Input/InputView";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { createSectionRoot, panel } from "./settings-native";

const TERMINAL_ITEMS: readonly { value: string; key: "settings.autoDetectTerminal" | "settings.powershell7" | "settings.windowsPowershell" | "settings.commandPrompt" | "settings.windowsTerminal" }[] = [
    { value: "", key: "settings.autoDetectTerminal" },
    { value: "pwsh", key: "settings.powershell7" },
    { value: "powershell", key: "settings.windowsPowershell" },
    { value: "cmd", key: "settings.commandPrompt" },
    { value: "wt", key: "settings.windowsTerminal" },
];

export class TerminalSectionView extends VanillaView<Record<string, never>> {
    public constructor(props: Record<string, never>) { super(props, createSectionRoot("settings-section")); }

    protected onMount(): void {
        const host = panel({ maxWidth: 360 });
        if (isLinux) {
            const input = this.child(new InputView({
                "aria-label": t("settings.groupTitleTerminal"),
                placeholder: t("settings.autoDetect"),
                defaultValue: settings.get<string>("terminal.command"),
                onChange: (value) => { void appSettingsStore.set("terminal.command", value); },
            }));
            host.append(input.root);
            input.mount();
            this.own(settings.watch("terminal.command", (value) => { input.inputElement.value = value; }));
        } else {
            const field = this.child(new ChoiceField({
                store: appSettingsStore as SettingsStore<string>,
                id: "terminal.command",
                items: TERMINAL_ITEMS.map((item) => ({ value: item.value, label: t(item.key) })),
                ariaLabel: t("settings.groupTitleTerminal"),
                keepUnknownValue: true,
            }));
            host.append(field.root);
            field.mount();
        }
        this.root.append(host);
    }
}
